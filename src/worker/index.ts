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
    console.log(`[Worker] Processing message for "${projectId}" from "${msg.from}" — conv: ${msg.conversationId}, round: ${msg.round}, type: ${msg.type}`);

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

    // Spawn Claude in the project directory
    console.log(`[Worker] Spawning claude -p in "${project.path}"...`);
    const response = await spawnClaude(project.path, prompt);
    console.log(`[Worker] Claude responded (${response.length} chars)`);

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
      console.log(`[Worker] Conversation ended: ${responseType}`);
    }

    await redis.hset(REDIS_KEYS.conversations, msg.conversationId, JSON.stringify(conv));
    await redis.xadd(REDIS_KEYS.stream(msg.from), '*', 'message', JSON.stringify(responseMsg));

    console.log(`[Worker] Response sent to "${msg.from}" — round ${conv.currentRound}/${conv.maxRounds}`);
  } catch (err) {
    console.error(`[Worker] Error processing message:`, err);
  } finally {
    processing.delete(lockKey);
  }
}

function buildPrompt(msg: WTMessage, conv: WTConversation, myProjectId: string): string {
  return `You are participating in an inter-project conversation via WalkieTalkie.

## Context
- **Your project:** ${myProjectId}
- **Conversation with:** ${msg.from}
- **Subject:** ${conv.subject}
- **Round:** ${conv.currentRound + 1} of ${conv.maxRounds}
- **Message type received:** ${msg.type}

## Message from "${msg.from}":
${msg.body}

## Instructions
- Respond to the message above in the context of this project.
- Be concise and technical. Focus on actionable decisions.
- If you need information from your project's codebase, read the relevant files first.
- If you have enough information to agree on a design/contract, state it clearly.

## Response format
- Start with your response content directly.
- If you want to end the conversation with an agreement, start your response with: [AGREEMENT]
- If you're blocked and need human intervention, start with: [BLOCKED]
- If you're delivering a result, start with: [DELIVERY]
- Otherwise, just respond normally (the conversation continues).`;
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
