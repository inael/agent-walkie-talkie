import { Redis } from 'ioredis';

let client: Redis | null = null;

export type RedisClient = Redis;

export function getRedis(url?: string): RedisClient {
  if (!client) {
    client = new Redis(url || process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
    });
  }
  return client;
}

export async function ensureStream(redis: RedisClient, streamKey: string, groupName: string): Promise<void> {
  try {
    await redis.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
  } catch (err: any) {
    if (!err.message?.includes('BUSYGROUP')) throw err;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
