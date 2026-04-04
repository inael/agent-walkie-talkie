import 'dotenv/config';
import { getRedis, ensureStream } from '../shared/redis.js';
import { REDIS_KEYS, type WTMessage, type WTConversation, type WTProject } from '../shared/types.js';
import { spawnClaude } from './claude-runner.js';
import { checkGuardrails } from './guardrails.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const POLL_INTERVAL_MS = 1000;

const redis = getRedis(REDIS_URL);

// Track active processing to avoid double-processing
const processing = new Set<string>();

async function getRegisteredProjects(): Promise<WTProject[]> {
  const raw = await redis.hgetall(REDIS_KEYS.projects);
  return Object.values(raw).map(v => JSON.parse(v as string));
}

async function processMessage(projectId: string, streamId: string, msg: WTMessage): Promise<void> {
  const lockKey = `${msg.conversationId}:${msg.round}`;
  if (processing.has(lockKey)) {
    console.log(`[Worker] Skipping duplicate: ${lockKey}`);
    return;
  }
  processing.add(lockKey);

  try {
    const logPrefix = `[Worker][${msg.conversationId.slice(-8)}]`;
    console.log(`${logPrefix} R${msg.round}: ${msg.from} → ${projectId} (${msg.type})`);

    // Get conversation
    const convRaw = await redis.hget(REDIS_KEYS.conversations, msg.conversationId);
    if (!convRaw) {
      console.log(`[Worker] Conversation ${msg.conversationId} not found, skipping.`);
      return;
    }

    const conv: WTConversation = JSON.parse(convRaw);

    // Check guardrails
    const guardrailResult = checkGuardrails(conv, msg);
    if (!guardrailResult.ok) {
      console.log(`[Worker] Guardrail blocked: ${guardrailResult.reason}`);
      return;
    }

    // Get target project info
    const projectRaw = await redis.hget(REDIS_KEYS.projects, projectId);
    if (!projectRaw) {
      console.log(`[Worker] Project "${projectId}" not registered, skipping.`);
      return;
    }
    const project: WTProject = JSON.parse(projectRaw);

    // Build prompt for Claude
    const prompt = buildPrompt(msg, conv, projectId);

    console.log(`${logPrefix} Spawning claude -p in "${project.path}"...`);
    const response = await spawnClaude(project.path, prompt);
    console.log(`${logPrefix} Claude responded (${response.length} chars), type: ${detectResponseType(response)}`);

    // Determine response type
    const responseType = detectResponseType(response);

    // Send response back
    const responseMsg: WTMessage = {
      id: `msg-${Date.now().toString(36)}`,
      conversationId: msg.conversationId,
      from: projectId,
      to: msg.from,
      type: responseType,
      subject: conv.subject,
      body: response,
      respondsTo: msg.id,
      round: conv.currentRound + 1,
      timestamp: new Date().toISOString(),
    };

    // Update conversation
    conv.currentRound += 1;
    conv.updatedAt = new Date().toISOString();

    if (['agreement', 'blocked', 'delivered'].includes(responseType)) {
      conv.status = 'completed';
      conv.endType = responseType as any;
      console.log(`${logPrefix} ✅ Conversation ended: ${responseType}`);
    }

    await redis.hset(REDIS_KEYS.conversations, msg.conversationId, JSON.stringify(conv));
    await redis.xadd(REDIS_KEYS.stream(msg.from), '*', 'message', JSON.stringify(responseMsg));

    console.log(`${logPrefix} → Sent to "${msg.from}" (R${conv.currentRound}/${conv.maxRounds})`);
  } catch (err) {
    console.error(`[Worker] Error processing message:`, err);
  } finally {
    processing.delete(lockKey);
  }
}

function buildPrompt(msg: WTMessage, conv: WTConversation, myProjectId: string): string {
  return `Você está participando de uma conversa inter-projeto via WalkieTalkie.
IMPORTANTE: Responda SEMPRE em português brasileiro.

## Contexto
- **Seu projeto:** ${myProjectId}
- **Conversando com:** ${msg.from}
- **Assunto:** ${conv.subject}
- **Round:** ${conv.currentRound + 1} de ${conv.maxRounds}
- **Tipo da mensagem recebida:** ${msg.type}

## Mensagem de "${msg.from}":
${msg.body}

## Instruções
- Responda à mensagem acima no contexto deste projeto.
- Seja conciso e técnico. Foque em decisões acionáveis.
- Se precisar de informação do codebase do seu projeto, leia os arquivos relevantes primeiro.
- Se tiver informação suficiente para fechar um acordo/contrato de design, declare claramente.
- Considere a infraestrutura já disponível: Docker, Redis, Tailscale, N8N, LiteLLM, Evolution API (WhatsApp), Discord Bot, Outline wiki.
- Priorize reuso de soluções existentes — pesquise no GitHub e no codebase antes de propor algo novo.
- Toda decisão deve ser documentada: atualize docs/context/ do seu projeto com o que foi acordado.
- SEMPRE responda em português brasileiro.

## Formato da resposta
- Comece diretamente com o conteúdo da resposta.
- Se quiser encerrar a conversa com um acordo, comece com: [AGREEMENT]
- Se estiver bloqueado e precisar de intervenção humana, comece com: [BLOCKED]
- Se estiver entregando um resultado, comece com: [DELIVERY]
- Caso contrário, responda normalmente (a conversa continua).`;
}

function detectResponseType(response: string): WTMessage['type'] {
  if (response.startsWith('[AGREEMENT]')) return 'agreement';
  if (response.startsWith('[BLOCKED]')) return 'blocked';
  if (response.startsWith('[DELIVERY]')) return 'delivery';
  if (response.includes('?')) return 'question';
  return 'answer';
}

async function pollStreams(): Promise<void> {
  const projects = await getRegisteredProjects();

  for (const project of projects) {
    const streamKey = REDIS_KEYS.stream(project.id);
    const groupName = REDIS_KEYS.consumerGroup(project.id);
    const consumerName = `worker-${project.id}`;

    try {
      await ensureStream(redis, streamKey, groupName);

      const results = await redis.xreadgroup(
        'GROUP', groupName, consumerName,
        'COUNT', '1',
        'STREAMS', streamKey, '>'
      ) as any;

      if (!results || results.length === 0) continue;
      console.log(`[Worker] Found messages in stream for "${project.id}"`);

      for (const [, entries] of results) {
        for (const [streamId, fields] of entries) {
          const msgRaw = fields[1];
          const msg: WTMessage = JSON.parse(msgRaw);
          await redis.xack(streamKey, groupName, streamId);
          await processMessage(project.id, streamId, msg);
        }
      }
    } catch (err: any) {
      if (!err.message?.includes('NOGROUP')) {
        console.error(`[Worker] Error polling ${project.id}:`, err.message);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log('[Worker] WalkieTalkie Worker starting...');
  console.log(`[Worker] Redis: ${REDIS_URL}`);

  // Main loop
  let pollCount = 0;
  while (true) {
    try {
      await pollStreams();
      pollCount++;
      if (pollCount % 30 === 0) {
        console.log(`[Worker] Heartbeat — ${pollCount} polls, still running...`);
      }
    } catch (err: any) {
      console.error(`[Worker] Poll loop error:`, err.message);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch(err => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
