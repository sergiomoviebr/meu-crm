import { describe, expect, it } from 'vitest';

import type { Deal, PipelineReplySettings } from '@/types';
import {
  compactElapsed,
  conversationState,
  replyPriority,
  waitingMinutes,
} from './conversation-status';

const settings: PipelineReplySettings = {
  newMinutes: 30,
  attentionMinutes: 120,
  overdueMinutes: 360,
  messageNotifications: true,
};

function deal(conversation: Deal['conversation']): Deal {
  return {
    id: 'd',
    user_id: 'u',
    pipeline_id: 'p',
    stage_id: 's',
    contact_id: 'c',
    title: 'Lead',
    value: 0,
    created_at: '2026-01-01T00:00:00Z',
    conversation,
  };
}

describe('pipeline conversation intelligence', () => {
  it('keeps read and replied as separate states', () => {
    const awaiting = deal({
      id: 'cv',
      channel: 'meta_cloud_api',
      status: 'open',
      last_message_at: '2026-01-01T00:00:00Z',
      last_message_direction: 'customer',
      awaiting_reply: true,
      unread_count: 0,
    });
    expect(conversationState(awaiting)).toBe('awaiting_reply');
  });

  it('shows a new-message state while unread customer messages exist', () => {
    expect(
      conversationState(
        deal({
          id: 'cv',
          channel: 'whatsapp_personal',
          status: 'open',
          last_message_at: '2026-01-01T00:00:00Z',
          awaiting_reply: true,
          unread_count: 3,
        })
      )
    ).toBe('new_message');
  });

  it('clears awaiting only when the latest direction is from the team', () => {
    expect(
      conversationState(
        deal({
          id: 'cv',
          channel: 'meta_cloud_api',
          status: 'open',
          last_message_at: '2026-01-01T00:00:00Z',
          last_message_direction: 'agent',
          awaiting_reply: false,
          unread_count: 2,
        })
      )
    ).toBe('responded');
  });

  it('classifies configurable waiting thresholds', () => {
    expect(replyPriority(10, settings)).toBe('new');
    expect(replyPriority(45, settings)).toBe('waiting');
    expect(replyPriority(180, settings)).toBe('attention');
    expect(replyPriority(500, settings)).toBe('overdue');
  });

  it('calculates waiting time and compact labels', () => {
    const now = new Date('2026-01-01T03:00:00Z').getTime();
    expect(
      waitingMinutes(
        deal({
          id: 'cv',
          channel: 'meta_cloud_api',
          status: 'open',
          last_message_at: '2026-01-01T01:00:00Z',
          waiting_since: '2026-01-01T01:00:00Z',
          awaiting_reply: true,
          unread_count: 0,
        }),
        now
      )
    ).toBe(120);
    expect(compactElapsed(120)).toBe('2h');
    expect(compactElapsed(2880)).toBe('2 dias');
  });
});
