import type { Deal, PipelineReplySettings } from '@/types';

export type PipelineConversationState =
  'new_message' | 'awaiting_reply' | 'responded' | 'no_messages';

export type PipelineReplyPriority = 'new' | 'waiting' | 'attention' | 'overdue';

export function conversationState(deal: Deal): PipelineConversationState {
  const conversation = deal.conversation;
  if (!conversation?.last_message_at) return 'no_messages';
  if (conversation.awaiting_reply) {
    return (conversation.unread_count ?? 0) > 0
      ? 'new_message'
      : 'awaiting_reply';
  }
  return 'responded';
}

export function waitingMinutes(
  deal: Deal,
  now: number = Date.now()
): number | null {
  if (!deal.conversation?.awaiting_reply || !deal.conversation.waiting_since) {
    return null;
  }
  return Math.max(
    0,
    Math.floor(
      (now - new Date(deal.conversation.waiting_since).getTime()) / 60000
    )
  );
}

export function replyPriority(
  minutes: number,
  settings: PipelineReplySettings
): PipelineReplyPriority {
  if (minutes < settings.newMinutes) return 'new';
  if (minutes < settings.attentionMinutes) return 'waiting';
  if (minutes < settings.overdueMinutes) return 'attention';
  return 'overdue';
}

export function compactElapsed(minutes: number): string {
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days} dia${days > 1 ? 's' : ''}`;
}

export function minutesSince(
  date: string | null | undefined,
  now: number = Date.now()
): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000));
}
