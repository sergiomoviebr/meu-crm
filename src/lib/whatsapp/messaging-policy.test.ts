import { describe, expect, it } from 'vitest';
import { decideWhatsAppMessagingPolicy } from './messaging-policy';

const now = new Date('2026-08-19T12:00:00.000Z');

describe('decideWhatsAppMessagingPolicy', () => {
  it('never applies the Cloud API window to personal WhatsApp', () => {
    expect(decideWhatsAppMessagingPolicy({ channel: 'whatsapp_personal', now })).toEqual({ mode: 'free_form', reason: 'personal_channel' });
  });
  it('allows free-form Cloud API messages inside 24 hours', () => {
    expect(decideWhatsAppMessagingPolicy({ channel: 'meta_cloud_api', lastCustomerMessageAt: '2026-08-18T12:00:01.000Z', now }).mode).toBe('free_form');
  });
  it('requires a template at the 24-hour boundary', () => {
    expect(decideWhatsAppMessagingPolicy({ channel: 'meta_cloud_api', lastCustomerMessageAt: '2026-08-18T12:00:00.000Z', now }).mode).toBe('approved_template');
  });
  it('requires a template when no customer message exists', () => {
    expect(decideWhatsAppMessagingPolicy({ channel: 'meta_cloud_api', now }).mode).toBe('approved_template');
  });
});
