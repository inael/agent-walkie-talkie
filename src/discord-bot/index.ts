import 'dotenv/config';
import { Client, GatewayIntentBits, TextChannel, ThreadAutoArchiveDuration, MessageReaction, User } from 'discord.js';
import { getRedis, ensureStream } from '../shared/redis.js';
import { REDIS_KEYS, type WTMessage, type WTConversation } from '../shared/types.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const POLL_INTERVAL_MS = 2000;

if (!DISCORD_TOKEN || !CHANNEL_ID) {
  console.error('[Discord] Missing DISCORD_TOKEN or DISCORD_CHANNEL_ID');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

const redis = getRedis(REDIS_URL);

// Map conversation ID → Discord thread ID
const threadMap = new Map<string, string>();

// Subscriber stream for Discord notifications
const DISCORD_STREAM = 'wt:stream:discord-notify';
const DISCORD_GROUP = 'wt:cg:discord-notify';

async function getOrCreateThread(channel: TextChannel, conv: WTConversation): Promise<any> {
  const cached = threadMap.get(conv.id);
  if (cached) {
    const thread = channel.threads.cache.get(cached);
    if (thread) return thread;
  }

  const other = conv.participants.join(' ↔ ');
  const thread = await channel.threads.create({
    name: `${conv.subject} (${other})`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: `WalkieTalkie conversation ${conv.id}`,
  });

  threadMap.set(conv.id, thread.id);

  // Post header
  await thread.send(
    `**WalkieTalkie Conversation**\n` +
    `**ID:** \`${conv.id}\`\n` +
    `**Subject:** ${conv.subject}\n` +
    `**Participants:** ${conv.participants.join(' ↔ ')}\n` +
    `**Max rounds:** ${conv.maxRounds}\n` +
    `─────────────────────────`
  );

  return thread;
}

function formatMessage(msg: WTMessage, conv: WTConversation): string {
  const emoji = msg.from === conv.participants[0] ? '🔵' : '🟢';
  const typeTag = msg.type !== 'general' ? ` [${msg.type.toUpperCase()}]` : '';
  const roundInfo = `Round ${msg.round}/${conv.maxRounds}`;

  let text = `${emoji} **${msg.from}**${typeTag} — ${roundInfo}\n${msg.body}`;

  if (msg.type === 'agreement') {
    text += '\n\n✅ **AGREEMENT REACHED** — Conversation ended.';
  } else if (msg.type === 'blocked') {
    text += '\n\n🚫 **BLOCKED** — Human intervention needed.';
  } else if (msg.type === 'delivered') {
    text += '\n\n📦 **DELIVERED** — Conversation ended.';
  }

  // Truncate for Discord 2000 char limit
  if (text.length > 1950) {
    text = text.slice(0, 1950) + '\n... (truncated)';
  }

  return text;
}

async function pollAllStreams(): Promise<void> {
  let channel = client.channels.cache.get(CHANNEL_ID!) as TextChannel;
  if (!channel) {
    try {
      channel = await client.channels.fetch(CHANNEL_ID!) as TextChannel;
    } catch {
      return;
    }
  }
  if (!channel) return;

  // Get all registered projects
  const projects = await redis.hgetall(REDIS_KEYS.projects);
  const projectIds = Object.keys(projects);

  for (const projectId of projectIds) {
    const streamKey = REDIS_KEYS.stream(projectId);

    // Read from the stream using a special discord consumer
    try {
      const groupName = `wt:cg:discord-${projectId}`;
      await ensureStream(redis, streamKey, groupName);

      const results = await redis.xreadgroup(
        'GROUP', groupName, 'discord-reader',
        'COUNT', '5',
        'STREAMS', streamKey, '>'
      ) as any;

      if (!results || results.length === 0) continue;

      for (const [, entries] of results) {
        for (const [streamId, fields] of entries) {
          const msgRaw = fields[1];
          const msg: WTMessage = JSON.parse(msgRaw);

          // Get conversation
          const convRaw = await redis.hget(REDIS_KEYS.conversations, msg.conversationId);
          if (!convRaw) continue;
          const conv: WTConversation = JSON.parse(convRaw);

          // Post to thread
          const thread = await getOrCreateThread(channel, conv);
          const formatted = formatMessage(msg, conv);
          const posted = await thread.send(formatted);

          // Add control reactions on ending messages
          if (['agreement', 'blocked'].includes(msg.type)) {
            await posted.react('✅');
            await posted.react('🔄');
          }

          await redis.xack(streamKey, groupName, streamId);
        }
      }
    } catch (err: any) {
      console.error(`[Discord] Error polling ${projectId}:`, err.message);
    }
  }
}

// Handle reactions for CEO intervention
client.on('messageReactionAdd', async (reaction: MessageReaction | any, user: User | any) => {
  if (user.bot) return;

  const emoji = reaction.emoji.name;
  const threadId = reaction.message.channel?.id;

  // Find conversation by thread
  const convId = [...threadMap.entries()].find(([, tid]) => tid === threadId)?.[0];
  if (!convId) return;

  const convRaw = await redis.hget(REDIS_KEYS.conversations, convId);
  if (!convRaw) return;
  const conv: WTConversation = JSON.parse(convRaw);

  if (emoji === '⛔') {
    // Pause conversation
    conv.status = 'paused';
    conv.updatedAt = new Date().toISOString();
    await redis.hset(REDIS_KEYS.conversations, convId, JSON.stringify(conv));
    const thread = client.channels.cache.get(threadId!) as any;
    await thread?.send('⛔ **Conversation paused by CEO.**');
  }

  if (emoji === '➕') {
    // Add 5 more rounds
    conv.maxRounds += 5;
    if (conv.status === 'completed' && conv.endType === 'max-rounds') {
      conv.status = 'active';
      conv.endType = undefined;
    }
    conv.updatedAt = new Date().toISOString();
    await redis.hset(REDIS_KEYS.conversations, convId, JSON.stringify(conv));
    const thread = client.channels.cache.get(threadId!) as any;
    await thread?.send(`➕ **+5 rounds added.** New max: ${conv.maxRounds}`);
  }
});

client.on('ready', () => {
  console.log(`[Discord] Bot logged in as ${client.user?.tag}`);
  console.log(`[Discord] Watching channel: ${CHANNEL_ID}`);

  // Start polling
  setInterval(pollAllStreams, POLL_INTERVAL_MS);
});

client.login(DISCORD_TOKEN);
