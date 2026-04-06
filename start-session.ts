/**
 * Start a WalkieTalkie session with a custom topic.
 * Usage: npx tsx start-session.ts "assunto da conversa" "mensagem inicial"
 */
import 'dotenv/config';
import { Redis } from 'ioredis';
import { v4 as uuid } from 'uuid';
import { REDIS_KEYS } from './src/shared/types.js';
import type { WTProject, WTConversation, WTMessage } from './src/shared/types.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const PROJECTS: WTProject[] = [
  {
    id: 'itbooster',
    path: 'C:/Users/inael-pc/Documents/ClaudeCode/ItBooster',
    description: 'IT Booster Autopilot — autonomous operation system',
    registeredAt: new Date().toISOString(),
  },
  {
    id: 'freelanceia',
    path: 'C:/Users/inael-pc/Documents/ClaudeCode/FreelanceIA',
    description: 'FreelanceIA — freelance project sourcing',
    registeredAt: new Date().toISOString(),
  },
];

async function ensureStream(streamKey: string, groupName: string) {
  try {
    await redis.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
  } catch (err: any) {
    if (!err.message?.includes('BUSYGROUP')) throw err;
  }
}

async function main() {
  const subject = process.argv[2] || 'Conversa entre projetos';
  const message = process.argv[3] || 'Olá, vamos conversar sobre integração.';
  const from = process.argv[4] || 'itbooster';
  const maxRounds = parseInt(process.argv[5] || '10', 10);

  const to = PROJECTS.find(p => p.id !== from)!.id;

  console.log('=== WalkieTalkie Session ===');
  console.log(`Subject: ${subject}`);
  console.log(`From: ${from} → To: ${to}`);
  console.log(`Max rounds: ${maxRounds}\n`);

  // Register projects
  for (const p of PROJECTS) {
    await redis.hset(REDIS_KEYS.projects, p.id, JSON.stringify(p));
    await ensureStream(REDIS_KEYS.stream(p.id), REDIS_KEYS.consumerGroup(p.id));
    await ensureStream(REDIS_KEYS.stream(p.id), `wt:cg:discord-${p.id}`);
  }
  console.log('✅ Projects registered');

  // Create conversation
  const convId = `conv-${uuid().slice(0, 8)}`;
  const conversation: WTConversation = {
    id: convId,
    subject,
    participants: [from, to] as [string, string],
    maxRounds,
    currentRound: 1,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await redis.hset(REDIS_KEYS.conversations, convId, JSON.stringify(conversation));

  // Send first message
  const msg: WTMessage = {
    id: `msg-${uuid().slice(0, 8)}`,
    conversationId: convId,
    from,
    to,
    type: 'proposal',
    subject,
    body: message,
    round: 1,
    timestamp: new Date().toISOString(),
  };
  await redis.xadd(REDIS_KEYS.stream(to), '*', 'message', JSON.stringify(msg));
  console.log(`✅ Conversation ${convId} started\n`);

  await redis.disconnect();

  // Start worker
  console.log('=== Starting worker ===');
  await import('./src/worker/index.ts');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
