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

async function main() {
  console.log('=== WalkieTalkie E2E Test ===\n');

  // 1. Register projects
  const itbooster: WTProject = {
    id: 'itbooster',
    path: 'C:/Users/inael-pc/Documents/ClaudeCode/ItBooster',
    description: 'IT Booster Autopilot — autonomous operation system',
    registeredAt: new Date().toISOString(),
  };

  const freelanceia: WTProject = {
    id: 'freelanceia',
    path: 'C:/Users/inael-pc/Documents/ClaudeCode/FreelanceIA',
    description: 'FreelanceIA — scrapes freelance platforms, sends projects to IT Booster',
    registeredAt: new Date().toISOString(),
  };

  await redis.hset(REDIS_KEYS.projects, 'itbooster', JSON.stringify(itbooster));
  await redis.hset(REDIS_KEYS.projects, 'freelanceia', JSON.stringify(freelanceia));
  console.log('✅ Projects registered: itbooster, freelanceia');

  // 2. Create streams and consumer groups
  await ensureStream(REDIS_KEYS.stream('itbooster'), REDIS_KEYS.consumerGroup('itbooster'));
  await ensureStream(REDIS_KEYS.stream('freelanceia'), REDIS_KEYS.consumerGroup('freelanceia'));
  console.log('✅ Redis streams created');

  // 3. Create conversation
  const convId = `conv-${uuid().slice(0, 8)}`;
  const conversation: WTConversation = {
    id: convId,
    subject: 'API de Integração — FreelanceIA envia projetos para ITBooster',
    participants: ['itbooster', 'freelanceia'],
    maxRounds: 10,
    currentRound: 1,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await redis.hset(REDIS_KEYS.conversations, convId, JSON.stringify(conversation));
  console.log(`✅ Conversation created: ${convId}`);

  // 4. Send initial message from ITBooster to FreelanceIA
  const firstMessage: WTMessage = {
    id: `msg-${uuid().slice(0, 8)}`,
    conversationId: convId,
    from: 'itbooster',
    to: 'freelanceia',
    type: 'proposal',
    subject: conversation.subject,
    body: `Olá FreelanceIA! Sou o sistema IT Booster Autopilot.

Preciso integrar com vocês para receber projetos de freelance automaticamente. Hoje vocês já enviam projetos via webhook POST para nosso endpoint, mas a comunicação é unidirecional.

Proponho o seguinte fluxo bidirecional:

1. **FreelanceIA → ITBooster:** POST /webhook (já existe) para enviar novos projetos
2. **ITBooster → FreelanceIA:** Novo endpoint de callback para:
   - Enviar perguntas de clarificação (discovery phase)
   - Notificar mudanças de status (planning → executing → done)
   - Enviar entregas parciais (por marco)
   - Notificar entrega final

3. **FreelanceIA → ITBooster:** Novo endpoint para:
   - Responder perguntas de clarificação
   - Aprovar/rejeitar planos
   - Dar feedback em entregas parciais

Perguntas para vocês:
- Vocês já têm um servidor HTTP rodando que possa receber callbacks?
- Qual formato preferem para os payloads (JSON schema)?
- Como vocês se comunicam com os clientes finais (WhatsApp, email, plataforma)?

Aguardo proposta de vocês sobre como implementar isso do lado FreelanceIA.`,
    round: 1,
    timestamp: new Date().toISOString(),
  };

  await redis.xadd(
    REDIS_KEYS.stream('freelanceia'),
    '*',
    'message', JSON.stringify(firstMessage)
  );
  console.log('✅ Initial message sent from ITBooster → FreelanceIA');

  console.log('\n=== Test ready! ===');
  console.log(`Conversation ID: ${convId}`);
  console.log('Now start the worker: npm run worker');
  console.log('And the discord bot: npm run discord');
  console.log('And the web UI: npm run web');

  await redis.quit();
}

main().catch(console.error);
