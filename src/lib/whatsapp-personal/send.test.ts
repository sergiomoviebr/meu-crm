import { describe, expect, it, vi } from 'vitest';

import { sendPersonalTextMessage } from './send';
import { SendMessageError } from '@/lib/whatsapp/send-message';

const { getRestoredLiveSocket } = vi.hoisted(() => ({ getRestoredLiveSocket: vi.fn() }));
vi.mock('@/lib/whatsapp-personal/connection-manager', () => ({ getRestoredLiveSocket }));

describe('sendPersonalTextMessage', () => {
  it('throws whatsapp_personal_disconnected when there is no live socket', async () => {
    getRestoredLiveSocket.mockResolvedValue(null);
    await expect(sendPersonalTextMessage('acct-1', 'session-1', '5511999990000', 'oi')).rejects.toMatchObject({
      code: 'whatsapp_personal_disconnected',
      status: 400,
    });
  });

  it('throws whatsapp_personal_number_not_found instead of silently sending to a bad JID', async () => {
    const sendMessage = vi.fn();
    getRestoredLiveSocket.mockResolvedValue({
      onWhatsApp: vi.fn().mockResolvedValue([{ jid: '5511999990000@s.whatsapp.net', exists: false }]),
      sendMessage,
    });

    await expect(sendPersonalTextMessage('acct-1', 'session-1', '5511999990000', 'oi')).rejects.toMatchObject({
      code: 'whatsapp_personal_number_not_found',
      status: 400,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends to the JID WhatsApp itself resolved, not a naively-constructed one', async () => {
    const sendMessage = vi.fn(async (_jid: string, _content: unknown, options: { messageId: string }) => ({
      key: { id: options.messageId },
    }));
    getRestoredLiveSocket.mockResolvedValue({
      // WhatsApp can resolve a phone number to a different (e.g.
      // LID-based) JID than a naive `${digits}@s.whatsapp.net` guess —
      // this is exactly what onWhatsApp is for.
      onWhatsApp: vi.fn().mockResolvedValue([{ jid: '5511999990000@lid', exists: true }]),
      sendMessage,
    });

    const result = await sendPersonalTextMessage('acct-1', 'session-1', '+5511999990000', 'oi');

    expect(sendMessage).toHaveBeenCalledWith(
      '5511999990000@lid',
      { text: 'oi' },
      { messageId: expect.any(String) },
    );
    expect(result.messageId).toEqual(expect.any(String));
  });

  it('uses the JID stored from the conversation without a new provider lookup', async () => {
    const onWhatsApp = vi.fn();
    const sendMessage = vi.fn(async () => ({ key: { id: 'wa-known-1' } }));
    getRestoredLiveSocket.mockResolvedValue({ onWhatsApp, sendMessage });

    await sendPersonalTextMessage(
      'acct-1',
      'session-1',
      '+5511999990000',
      'oi',
      'wa-known-1',
      '5511999990000@s.whatsapp.net',
    );

    expect(onWhatsApp).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      '5511999990000@s.whatsapp.net',
      { text: 'oi' },
      { messageId: 'wa-known-1' },
    );
  });

  it('preserves a provider failure code instead of collapsing it to a generic error', async () => {
    getRestoredLiveSocket.mockResolvedValue({
      onWhatsApp: vi.fn(),
      sendMessage: vi.fn().mockRejectedValue(new Error('Connection Closed')),
    });

    await expect(sendPersonalTextMessage(
      'acct-1', 'session-1', '+5511999990000', 'oi', 'wa-known-2',
      '5511999990000@s.whatsapp.net',
    )).rejects.toMatchObject({ code: 'whatsapp_personal_provider_error', status: 502 });
  });

  it('throws a SendMessageError instance', async () => {
    getRestoredLiveSocket.mockResolvedValue(null);
    await expect(sendPersonalTextMessage('acct-1', 'session-1', '5511999990000', 'oi')).rejects.toBeInstanceOf(
      SendMessageError
    );
  });
});
