/**
 * All-in-one: registers projects, sends test message, then starts worker.
 * Discord bot and Web UI should be started separately.
 */
import 'dotenv/config';
import { Redis } from 'ioredis';
import { v4 as uuid } from 'uuid';
import { REDIS_KEYS } from './src/shared/types.js';
import type { WTProject, WTConversation, WTMessage } from './src/shared/types.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function ensureStream(streamKey: string, groupName: string) {
  try {
    await redis.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
  } catch (err: any) {
    if (!err.message?.includes('BUSYGROUP')) throw err;
  }
}

async function setup() {
  console.log('=== Setup ===');

  // Register projects
  const itbooster: WTProject = {
    id: 'itbooster',
    path: 'C:/Users/inael-pc/Documents/ClaudeCode/ItBooster',
    description: 'IT Booster Autopilot',
    registeredAt: new Date().toISOString(),
  };
  const freelanceia: WTProject = {
    id: 'freelanceia',
    path: 'C:/Users/inael-pc/Documents/ClaudeCode/FreelanceIA',
    description: 'FreelanceIA — freelance project sourcing',
    registeredAt: new Date().toISOString(),
  };

  await redis.hset(REDIS_KEYS.projects, 'itbooster', JSON.stringify(itbooster));
  await redis.hset(REDIS_KEYS.projects, 'freelanceia', JSON.stringify(freelanceia));
  console.log('✅ Projects registered');

  // Ensure streams
  await ensureStream(REDIS_KEYS.stream('itbooster'), REDIS_KEYS.consumerGroup('itbooster'));
  await ensureStream(REDIS_KEYS.stream('freelanceia'), REDIS_KEYS.consumerGroup('freelanceia'));

  // Also ensure discord consumer groups
  await ensureStream(REDIS_KEYS.stream('itbooster'), `wt:cg:discord-itbooster`);
  await ensureStream(REDIS_KEYS.stream('freelanceia'), `wt:cg:discord-freelanceia`);
  console.log('✅ Streams ready');

  // Create conversation
  const convId = `conv-${uuid().slice(0, 8)}`;
  const conversation: WTConversation = {
    id: convId,
    subject: 'API de Integração — FreelanceIA ↔ ITBooster',
    participants: ['itbooster', 'freelanceia'],
    maxRounds: 10,
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
    from: 'itbooster',
    to: 'freelanceia',
    type: 'proposal',
    subject: conversation.subject,
    body: `Olá FreelanceIA! Sou o IT Booster Autopilot.

Preciso integrar com vocês para receber projetos automaticamente. Hoje a comunicação é unidirecional (vocês enviam via webhook).

Proponho fluxo bidirecional:
1. FreelanceIA → ITBooster: POST /webhook (já existe)
2. ITBooster → FreelanceIA: callback para perguntas, status updates, entregas
3. FreelanceIA → ITBooster: respostas, aprovações, feedback

Perguntas:
- Vocês têm servidor HTTP para receber callbacks?
- Qual formato preferem para payloads?
- Como se comunicam com clientes (WhatsApp, email, plataforma)?

Aguardo proposta do lado FreelanceIA.`,
    round: 1,
    timestamp: new Date().toISOString(),
  };

  await redis.xadd(REDIS_KEYS.stream('freelanceia'), '*', 'message', JSON.stringify(msg));
  console.log(`✅ Conversation ${convId} created, message sent`);

  await redis.disconnect();
  return convId;
}

setup().then(async convId => {
  console.log(`\n=== Starting worker ===`);
  console.log(`Conversation: ${convId}`);

  // Start worker — it creates its own Redis connection
  await import('./src/worker/index.ts');
}).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
