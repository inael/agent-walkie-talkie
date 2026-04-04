import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { getRedis, ensureStream } from '../shared/redis.js';
import { REDIS_KEYS, type WTProject, type WTConversation, type WTMessage, type MessageType } from '../shared/types.js';

const PROJECT_ID = process.env.WT_PROJECT_ID || 'unknown';
const PROJECT_PATH = process.env.WT_PROJECT_PATH || process.cwd();
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const server = new McpServer({
  name: 'agent-walkie-talkie',
  version: '0.1.0',
});

const redis = getRedis(REDIS_URL);

// ─── wt_register ────────────────────────────────────────────
server.tool(
  'wt_register',
  'Register this project as a walkie-talkie participant',
  {
    description: z.string().optional().describe('Short description of this project'),
  },
  async ({ description }) => {
    const project: WTProject = {
      id: PROJECT_ID,
      path: PROJECT_PATH,
      description: description || undefined,
      registeredAt: new Date().toISOString(),
    };

    await redis.hset(REDIS_KEYS.projects, PROJECT_ID, JSON.stringify(project));
    await ensureStream(redis, REDIS_KEYS.stream(PROJECT_ID), REDIS_KEYS.consumerGroup(PROJECT_ID));

    return {
      content: [{ type: 'text', text: `Registered project "${PROJECT_ID}" at ${PROJECT_PATH}. Ready to communicate.` }],
    };
  }
);

// ─── wt_start ───────────────────────────────────────────────
server.tool(
  'wt_start',
  'Start a new conversation with another project',
  {
    to: z.string().describe('Target project ID'),
    subject: z.string().describe('Conversation subject'),
    context: z.string().optional().describe('Initial context or background for the conversation'),
    max_rounds: z.number().optional().describe('Max rounds (default 10)'),
  },
  async ({ to, subject, context, max_rounds }) => {
    const targetRaw = await redis.hget(REDIS_KEYS.projects, to);
    if (!targetRaw) {
      return { content: [{ type: 'text', text: `Project "${to}" not registered. Ask them to run wt_register first.` }] };
    }

    const convId = `conv-${uuid().slice(0, 8)}`;
    const conversation: WTConversation = {
      id: convId,
      subject,
      participants: [PROJECT_ID, to],
      maxRounds: max_rounds || 10,
      currentRound: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await redis.hset(REDIS_KEYS.conversations, convId, JSON.stringify(conversation));

    // Send first message if context provided
    if (context) {
      const msg: WTMessage = {
        id: `msg-${uuid().slice(0, 8)}`,
        conversationId: convId,
        from: PROJECT_ID,
        to,
        type: 'general',
        subject,
        body: context,
        round: 1,
        timestamp: new Date().toISOString(),
      };

      conversation.currentRound = 1;
      conversation.updatedAt = new Date().toISOString();
      await redis.hset(REDIS_KEYS.conversations, convId, JSON.stringify(conversation));

      await redis.xadd(
        REDIS_KEYS.stream(to),
        '*',
        'message', JSON.stringify(msg)
      );

      return {
        content: [{
          type: 'text',
          text: `Conversation "${convId}" started with "${to}" about "${subject}". Initial message sent (round 1/${conversation.maxRounds}).`,
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Conversation "${convId}" created with "${to}" about "${subject}". Use wt_send to send the first message.`,
      }],
    };
  }
);

// ─── wt_send ────────────────────────────────────────────────
server.tool(
  'wt_send',
  'Send a message in an active conversation',
  {
    conversation_id: z.string().describe('Conversation ID'),
    body: z.string().describe('Message content'),
    type: z.enum(['proposal', 'question', 'answer', 'contract-update', 'task-request', 'status-update', 'delivery', 'agreement', 'blocked', 'general']).optional().describe('Message type (default: general)'),
    responds_to: z.string().optional().describe('Message ID this responds to'),
  },
  async ({ conversation_id, body, type, responds_to }) => {
    const convRaw = await redis.hget(REDIS_KEYS.conversations, conversation_id);
    if (!convRaw) {
      return { content: [{ type: 'text', text: `Conversation "${conversation_id}" not found.` }] };
    }

    const conv: WTConversation = JSON.parse(convRaw);
    if (conv.status !== 'active') {
      return { content: [{ type: 'text', text: `Conversation is ${conv.status}. Cannot send messages.` }] };
    }

    const to = conv.participants.find(p => p !== PROJECT_ID);
    if (!to) {
      return { content: [{ type: 'text', text: 'Cannot determine recipient.' }] };
    }

    const msgType = type || 'general';
    const newRound = conv.currentRound + 1;

    // Check max rounds
    if (newRound > conv.maxRounds) {
      conv.status = 'completed';
      conv.endType = 'max-rounds';
      conv.updatedAt = new Date().toISOString();
      await redis.hset(REDIS_KEYS.conversations, conversation_id, JSON.stringify(conv));
      return {
        content: [{
          type: 'text',
          text: `Max rounds (${conv.maxRounds}) reached. Conversation ended. Use wt_start for a new one.`,
        }],
      };
    }

    const msg: WTMessage = {
      id: `msg-${uuid().slice(0, 8)}`,
      conversationId: conversation_id,
      from: PROJECT_ID,
      to,
      type: msgType,
      subject: conv.subject,
      body,
      respondsTo: responds_to,
      round: newRound,
      timestamp: new Date().toISOString(),
    };

    conv.currentRound = newRound;
    conv.updatedAt = new Date().toISOString();

    // Check if this is an ending message
    if (['agreement', 'blocked', 'delivered'].includes(msgType)) {
      conv.status = 'completed';
      conv.endType = msgType as any;
    }

    await redis.hset(REDIS_KEYS.conversations, conversation_id, JSON.stringify(conv));
    await redis.xadd(REDIS_KEYS.stream(to), '*', 'message', JSON.stringify(msg));

    const statusText = conv.status === 'completed'
      ? `Conversation ended (${conv.endType}).`
      : `Round ${newRound}/${conv.maxRounds}.`;

    return {
      content: [{ type: 'text', text: `Message sent to "${to}". ${statusText}` }],
    };
  }
);

// ─── wt_read ────────────────────────────────────────────────
server.tool(
  'wt_read',
  'Read pending messages for this project',
  {
    conversation_id: z.string().optional().describe('Filter by conversation ID'),
    count: z.number().optional().describe('Max messages to read (default 10)'),
  },
  async ({ conversation_id, count }) => {
    const streamKey = REDIS_KEYS.stream(PROJECT_ID);
    const groupName = REDIS_KEYS.consumerGroup(PROJECT_ID);
    const consumerName = `consumer-${PROJECT_ID}`;
    const maxCount = count || 10;

    try {
      await ensureStream(redis, streamKey, groupName);
    } catch { /* group may already exist */ }

    const results = await redis.xreadgroup(
      'GROUP', groupName, consumerName,
      'COUNT', maxCount.toString(),
      'STREAMS', streamKey, '>'
    ) as any;

    if (!results || results.length === 0) {
      return { content: [{ type: 'text', text: 'No new messages.' }] };
    }

    const messages: WTMessage[] = [];
    for (const [, entries] of results) {
      for (const [streamId, fields] of entries) {
        const msgRaw = fields[1]; // fields = ['message', '{...}']
        const msg: WTMessage = JSON.parse(msgRaw);
        if (!conversation_id || msg.conversationId === conversation_id) {
          messages.push(msg);
        }
        // ACK the message
        await redis.xack(streamKey, groupName, streamId);
      }
    }

    if (messages.length === 0) {
      return { content: [{ type: 'text', text: 'No new messages.' }] };
    }

    const formatted = messages.map(m =>
      `---\n**[${m.type}] from ${m.from}** (Round ${m.round}, ${m.conversationId})\n${m.body}`
    ).join('\n\n');

    return {
      content: [{ type: 'text', text: `${messages.length} new message(s):\n\n${formatted}` }],
    };
  }
);

// ─── wt_list ────────────────────────────────────────────────
server.tool(
  'wt_list',
  'List all conversations for this project',
  {
    status: z.enum(['active', 'paused', 'completed', 'blocked', 'all']).optional().describe('Filter by status (default: all)'),
  },
  async ({ status }) => {
    const all = await redis.hgetall(REDIS_KEYS.conversations);
    const conversations: WTConversation[] = Object.values(all)
      .map(v => JSON.parse(v as string))
      .filter(c => c.participants.includes(PROJECT_ID))
      .filter(c => !status || status === 'all' || c.status === status)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (conversations.length === 0) {
      return { content: [{ type: 'text', text: 'No conversations found.' }] };
    }

    const formatted = conversations.map(c => {
      const other = c.participants.find(p => p !== PROJECT_ID);
      return `- **${c.id}** | ${c.subject} | with ${other} | ${c.status} | round ${c.currentRound}/${c.maxRounds}`;
    }).join('\n');

    return {
      content: [{ type: 'text', text: `${conversations.length} conversation(s):\n\n${formatted}` }],
    };
  }
);

// ─── wt_status ──────────────────────────────────────────────
server.tool(
  'wt_status',
  'Show status overview: pending messages, active conversations',
  {},
  async () => {
    // Count pending messages
    const streamKey = REDIS_KEYS.stream(PROJECT_ID);
    let pending = 0;
    try {
      const info = await redis.xpending(streamKey, REDIS_KEYS.consumerGroup(PROJECT_ID)) as any;
      pending = info?.[0] || 0;
    } catch { /* stream may not exist */ }

    // Count conversations
    const all = await redis.hgetall(REDIS_KEYS.conversations);
    const myConvs = Object.values(all)
      .map(v => JSON.parse(v as string))
      .filter((c: WTConversation) => c.participants.includes(PROJECT_ID));

    const active = myConvs.filter(c => c.status === 'active').length;
    const completed = myConvs.filter(c => c.status === 'completed').length;
    const paused = myConvs.filter(c => c.status === 'paused').length;

    // Registered projects
    const projects = await redis.hgetall(REDIS_KEYS.projects);
    const projectList = Object.keys(projects).join(', ');

    return {
      content: [{
        type: 'text',
        text: [
          `**WalkieTalkie Status for "${PROJECT_ID}"**`,
          `Pending messages: ${pending}`,
          `Active conversations: ${active}`,
          `Paused: ${paused}`,
          `Completed: ${completed}`,
          `Registered projects: ${projectList || 'none'}`,
        ].join('\n'),
      }],
    };
  }
);

// ─── wt_end ─────────────────────────────────────────────────
server.tool(
  'wt_end',
  'End a conversation',
  {
    conversation_id: z.string().describe('Conversation ID to end'),
    type: z.enum(['agreement', 'blocked', 'delivered']).describe('How it ended'),
    summary: z.string().optional().describe('Final summary or contract text'),
  },
  async ({ conversation_id, type, summary }) => {
    const convRaw = await redis.hget(REDIS_KEYS.conversations, conversation_id);
    if (!convRaw) {
      return { content: [{ type: 'text', text: `Conversation "${conversation_id}" not found.` }] };
    }

    const conv: WTConversation = JSON.parse(convRaw);
    conv.status = 'completed';
    conv.endType = type;
    conv.updatedAt = new Date().toISOString();
    await redis.hset(REDIS_KEYS.conversations, conversation_id, JSON.stringify(conv));

    // Send ending message to the other side
    const to = conv.participants.find(p => p !== PROJECT_ID);
    if (to) {
      const msg: WTMessage = {
        id: `msg-${uuid().slice(0, 8)}`,
        conversationId: conversation_id,
        from: PROJECT_ID,
        to,
        type: type as MessageType,
        subject: conv.subject,
        body: summary || `Conversation ended: ${type}`,
        round: conv.currentRound + 1,
        timestamp: new Date().toISOString(),
      };
      await redis.xadd(REDIS_KEYS.stream(to), '*', 'message', JSON.stringify(msg));
    }

    return {
      content: [{
        type: 'text',
        text: `Conversation "${conversation_id}" ended (${type}).${summary ? ' Summary saved.' : ''}`,
      }],
    };
  }
);

// ─── Start server ───────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[WalkieTalkie] MCP server running for project "${PROJECT_ID}"`);
}

main().catch(console.error);
