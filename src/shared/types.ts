export type MessageType = 'proposal' | 'question' | 'answer' | 'contract-update' | 'task-request' | 'status-update' | 'delivery' | 'delivered' | 'agreement' | 'blocked' | 'general';

export interface WTProject {
  id: string;
  path: string;
  description?: string;
  registeredAt: string;
}

export interface WTMessage {
  id: string;
  conversationId: string;
  from: string;
  to: string;
  type: MessageType;
  subject: string;
  body: string;
  respondsTo?: string;
  round: number;
  timestamp: string;
}

export interface WTConversation {
  id: string;
  subject: string;
  participants: [string, string];
  maxRounds: number;
  currentRound: number;
  status: 'active' | 'paused' | 'completed' | 'blocked' | 'implementing';
  endType?: 'agreement' | 'blocked' | 'delivered' | 'max-rounds' | 'timeout' | 'ceo-stopped';
  createdAt: string;
  updatedAt: string;
}

export interface WTConfig {
  projectId: string;
  projectPath: string;
  redisUrl: string;
  maxConcurrentConversations: number;
  defaultMaxRounds: number;
  roundTimeoutMs: number;
  claudeCliPath: string;
}

export const ENDING_TYPES = ['agreement', 'blocked', 'delivered'] as const;

export const REDIS_KEYS = {
  projects: 'wt:projects',
  conversation: (id: string) => `wt:conversation:${id}`,
  conversations: 'wt:conversations',
  stream: (projectId: string) => `wt:stream:${projectId}`,
  consumerGroup: (projectId: string) => `wt:cg:${projectId}`,
} as const;
