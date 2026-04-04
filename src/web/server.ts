import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { getRedis } from '../shared/redis.js';
import { REDIS_KEYS, type WTConversation, type WTMessage } from '../shared/types.js';

const PORT = parseInt(process.env.WEB_PORT || '3210', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const redis = getRedis(REDIS_URL);

// Serve static files
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API: List conversations
app.get('/api/conversations', async (_req, res) => {
  const all = await redis.hgetall(REDIS_KEYS.conversations);
  const conversations = Object.values(all).map(v => JSON.parse(v as string));
  res.json(conversations);
});

// API: Get conversation detail
app.get('/api/conversations/:id', async (req, res) => {
  const raw = await redis.hget(REDIS_KEYS.conversations, req.params.id);
  if (!raw) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(raw));
});

// API: Get messages for a conversation (read from all participant streams)
app.get('/api/conversations/:id/messages', async (req, res) => {
  const convRaw = await redis.hget(REDIS_KEYS.conversations, req.params.id);
  if (!convRaw) return res.status(404).json({ error: 'Not found' });

  const conv: WTConversation = JSON.parse(convRaw);
  const messages: WTMessage[] = [];

  for (const participant of conv.participants) {
    const streamKey = REDIS_KEYS.stream(participant);
    try {
      const entries = await redis.xrange(streamKey, '-', '+') as any[];
      for (const [, fields] of entries) {
        const msg: WTMessage = JSON.parse(fields[1]);
        if (msg.conversationId === req.params.id) {
          messages.push(msg);
        }
      }
    } catch { /* stream may not exist */ }
  }

  messages.sort((a, b) => a.round - b.round);
  res.json(messages);
});

// API: Pause conversation
app.post('/api/conversations/:id/pause', async (req, res) => {
  const raw = await redis.hget(REDIS_KEYS.conversations, req.params.id);
  if (!raw) return res.status(404).json({ error: 'Not found' });
  const conv: WTConversation = JSON.parse(raw);
  conv.status = 'paused';
  conv.updatedAt = new Date().toISOString();
  await redis.hset(REDIS_KEYS.conversations, req.params.id, JSON.stringify(conv));
  broadcastUpdate(conv);
  res.json(conv);
});

// API: Resume conversation
app.post('/api/conversations/:id/resume', async (req, res) => {
  const raw = await redis.hget(REDIS_KEYS.conversations, req.params.id);
  if (!raw) return res.status(404).json({ error: 'Not found' });
  const conv: WTConversation = JSON.parse(raw);
  conv.status = 'active';
  conv.updatedAt = new Date().toISOString();
  await redis.hset(REDIS_KEYS.conversations, req.params.id, JSON.stringify(conv));
  broadcastUpdate(conv);
  res.json(conv);
});

// API: Add rounds
app.post('/api/conversations/:id/add-rounds', async (req, res) => {
  const raw = await redis.hget(REDIS_KEYS.conversations, req.params.id);
  if (!raw) return res.status(404).json({ error: 'Not found' });
  const conv: WTConversation = JSON.parse(raw);
  const extra = req.body.rounds || 5;
  conv.maxRounds += extra;
  if (conv.status === 'completed' && conv.endType === 'max-rounds') {
    conv.status = 'active';
    conv.endType = undefined;
  }
  conv.updatedAt = new Date().toISOString();
  await redis.hset(REDIS_KEYS.conversations, req.params.id, JSON.stringify(conv));
  broadcastUpdate(conv);
  res.json(conv);
});

// API: List projects
app.get('/api/projects', async (_req, res) => {
  const all = await redis.hgetall(REDIS_KEYS.projects);
  const projects = Object.values(all).map(v => JSON.parse(v as string));
  res.json(projects);
});

// WebSocket: broadcast updates
function broadcastUpdate(data: any) {
  const payload = JSON.stringify({ type: 'update', data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Poll Redis for new messages and broadcast via WS
let lastIds: Record<string, string> = {};

async function pollAndBroadcast() {
  const projects = await redis.hgetall(REDIS_KEYS.projects);
  for (const projectId of Object.keys(projects)) {
    const streamKey = REDIS_KEYS.stream(projectId);
    const lastId = lastIds[projectId] || '0';
    try {
      const entries = await redis.xrange(streamKey, `(${lastId}`, '+', 'COUNT', '10') as any[];
      for (const [entryId, fields] of entries) {
        const msg: WTMessage = JSON.parse(fields[1]);
        const payload = JSON.stringify({ type: 'message', data: msg });
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        });
        lastIds[projectId] = entryId;
      }
    } catch { /* stream may not exist */ }
  }
}

setInterval(pollAndBroadcast, 1500);

httpServer.listen(PORT, () => {
  console.log(`[Web] WalkieTalkie UI running at http://localhost:${PORT}`);
});
