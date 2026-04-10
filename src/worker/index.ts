import 'dotenv/config';
import { getRedis, ensureStream } from '../shared/redis.js';
import { REDIS_KEYS, type WTMessage, type WTConversation, type WTProject } from '../shared/types.js';
import { spawnClaude, spawnClaudeImplement } from './claude-runner.js';
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

    // Post-agreement: trigger implementation on both sides
    if (conv.status === 'completed' && conv.endType === 'agreement') {
      await triggerImplementation(conv, msg.conversationId, logPrefix);
    }
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

async function collectConversationHistory(convId: string, participants: [string, string]): Promise<WTMessage[]> {
  const messages: WTMessage[] = [];
  for (const pid of participants) {
    const streamKey = REDIS_KEYS.stream(pid);
    try {
      const entries = await redis.xrange(streamKey, '-', '+') as any[];
      for (const [, fields] of entries) {
        const msg: WTMessage = JSON.parse(fields[1]);
        if (msg.conversationId === convId) {
          messages.push(msg);
        }
      }
    } catch { /* stream may not exist */ }
  }
  return messages.sort((a, b) => a.round - b.round);
}

async function generateSummary(contractText: string, conv: WTConversation): Promise<string> {
  const prompt = `Resuma em português brasileiro a conversa abaixo entre "${conv.participants[0]}" e "${conv.participants[1]}" sobre "${conv.subject}".

O resumo deve ter:
1. **O que foi decidido** (bullets curtos)
2. **O que cada lado vai implementar** (bullets curtos)
3. **Pendências ou riscos** (se houver)

Seja direto, máximo 15 linhas. Sem saudações, sem introdução.

## Conversa completa:
${contractText}`;

  try {
    // Use any project path just to run claude -p for summarization
    const result = await spawnClaude(process.cwd(), prompt);
    return result;
  } catch {
    // Fallback: extract last agreement message
    return 'Resumo indisponível — veja a conversa completa acima.';
  }
}

async function triggerImplementation(conv: WTConversation, convId: string, logPrefix: string): Promise<void> {
  // Collect full conversation history as contract
  const messages = await collectConversationHistory(convId, conv.participants);
  const contractText = messages.map(m =>
    `### Round ${m.round} — ${m.from} (${m.type})\n${m.body}`
  ).join('\n\n---\n\n');

  // Generate and post executive summary
  console.log(`${logPrefix} 📋 Generating executive summary...`);
  const summary = await generateSummary(contractText, conv);
  console.log(`${logPrefix} 📋 Summary generated (${summary.length} chars)`);

  // Post summary to both streams (will appear in Discord thread)
  const summaryMsg: WTMessage = {
    id: `msg-summary-${Date.now().toString(36)}`,
    conversationId: convId,
    from: 'walkietalkie-system',
    to: conv.participants[0],
    type: 'delivered',
    subject: `📋 Resumo — ${conv.subject}`,
    body: `📋 **RESUMO EXECUTIVO**\n\n${summary}`,
    round: conv.currentRound + 1,
    timestamp: new Date().toISOString(),
  };
  for (const pid of conv.participants) {
    await redis.xadd(REDIS_KEYS.stream(pid), '*', 'message', JSON.stringify({ ...summaryMsg, to: pid }));
  }

  console.log(`${logPrefix} 🚀 Starting post-agreement implementation phase...`);

  // Update status
  conv.status = 'implementing';
  conv.updatedAt = new Date().toISOString();
  await redis.hset(REDIS_KEYS.conversations, convId, JSON.stringify(conv));

  // Get both projects
  const projects: WTProject[] = [];
  for (const pid of conv.participants) {
    const raw = await redis.hget(REDIS_KEYS.projects, pid);
    if (raw) projects.push(JSON.parse(raw));
  }

  if (projects.length !== 2) {
    console.error(`${logPrefix} Cannot implement: missing project info`);
    return;
  }

  // Implement on both sides in parallel
  const results = await Promise.allSettled(
    projects.map(project => implementOnProject(project, conv, contractText, logPrefix))
  );

  // Update final status
  const allSuccess = results.every(r => r.status === 'fulfilled');
  conv.status = 'completed';
  conv.updatedAt = new Date().toISOString();
  await redis.hset(REDIS_KEYS.conversations, convId, JSON.stringify(conv));

  // Notify via streams
  for (const project of projects) {
    const resultForProject = results[projects.indexOf(project)];
    const success = resultForProject.status === 'fulfilled';
    const summary = success
      ? (resultForProject as PromiseFulfilledResult<string>).value
      : (resultForProject as PromiseRejectedResult).reason?.message || 'Unknown error';

    const notifyMsg: WTMessage = {
      id: `msg-impl-${Date.now().toString(36)}`,
      conversationId: convId,
      from: 'walkietalkie-system',
      to: project.id,
      type: success ? 'delivered' : 'blocked',
      subject: `Implementação ${success ? 'concluída' : 'falhou'} — ${project.id}`,
      body: success
        ? `✅ Implementação concluída no projeto "${project.id}".\n\nResumo:\n${summary}`
        : `❌ Implementação falhou no projeto "${project.id}".\n\nErro:\n${summary}`,
      round: conv.currentRound + 1,
      timestamp: new Date().toISOString(),
    };

    await redis.xadd(REDIS_KEYS.stream(project.id), '*', 'message', JSON.stringify(notifyMsg));
  }

  console.log(`${logPrefix} 🏁 Implementation phase finished. Success: ${allSuccess}`);
}

async function implementOnProject(
  project: WTProject,
  conv: WTConversation,
  contractText: string,
  logPrefix: string,
): Promise<string> {
  console.log(`${logPrefix} 🔧 Implementing on "${project.id}" at ${project.path}...`);

  const otherProject = conv.participants.find(p => p !== project.id) || 'unknown';

  const prompt = `Você é o agente do projeto "${project.id}".
IMPORTANTE: Responda SEMPRE em português brasileiro.

## Tarefa
Um acordo de integração foi fechado entre "${project.id}" e "${otherProject}" via WalkieTalkie.
Agora você deve IMPLEMENTAR o que foi acordado no código deste projeto.

## Contrato completo da conversa

${contractText}

## Instruções de implementação
1. Leia o contrato acima e identifique O QUE ESTE PROJETO ("${project.id}") precisa fazer.
2. Leia os arquivos relevantes do codebase antes de modificar qualquer coisa.
3. Implemente APENAS o que foi acordado para este lado ("${project.id}").
4. Considere a infraestrutura existente: Docker, Redis, Tailscale, N8N, Evolution API, Discord Bot.
5. Priorize reuso — não reinvente o que já existe no código.
6. Faça mudanças pequenas, reversíveis e testáveis.
7. Atualize docs/context/ com o que foi implementado.
8. Faça git add + git commit com mensagem descritiva (feat: ...).
9. Retorne um RESUMO do que foi implementado (arquivos criados/modificados, endpoints, etc).

## Regras
- NÃO implemente o lado do outro projeto.
- NÃO faça refactor além do necessário.
- NÃO crie arquivos de plano — implemente direto.
- Se algo estiver ambíguo no contrato, escolha a opção mais simples.

## PROIBIDO MODIFICAR (exclusion list)
- NÃO toque em .claude/ (commands, settings, configs)
- NÃO toque em CLAUDE.md
- NÃO delete arquivos que não sejam diretamente relacionados à implementação
- NÃO modifique .gitignore, .env (apenas .env.example)
- NÃO modifique package.json a menos que precise adicionar uma dependência
- Se precisar atualizar docs/context/, APENAS adicione informação — nunca delete conteúdo existente
- NÃO toque em arquivos de banco de dados (*.sqlite, *.db, *.sqlite3)
- NÃO rode migrations, seeds, ou resets de banco
- NÃO execute comandos destrutivos (DROP, TRUNCATE, DELETE sem WHERE)`;

  const result = await spawnClaudeImplement(project.path, prompt);
  console.log(`${logPrefix} ✅ "${project.id}" implementation done (${result.length} chars)`);
  return result;
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
