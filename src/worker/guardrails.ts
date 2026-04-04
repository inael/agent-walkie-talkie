import type { WTConversation, WTMessage } from '../shared/types.js';

export interface GuardrailResult {
  ok: boolean;
  reason?: string;
}

export function checkGuardrails(conv: WTConversation, msg: WTMessage): GuardrailResult {
  // Conversation not active
  if (conv.status !== 'active') {
    return { ok: false, reason: `Conversation is ${conv.status}` };
  }

  // Max rounds exceeded
  if (conv.currentRound >= conv.maxRounds) {
    return { ok: false, reason: `Max rounds reached (${conv.maxRounds})` };
  }

  // Ending message types — allow but don't continue after
  if (['agreement', 'blocked', 'delivered'].includes(msg.type)) {
    return { ok: true }; // Process this last message
  }

  return { ok: true };
}
