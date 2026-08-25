import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

vi.mock('@/lib/whatsapp-personal/send', () => ({
  createPersonalMessageId: vi.fn(() => 'wa-msg-1'),
  sendPersonalTextMessage: vi.fn(),
}));

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('requires a location object for location messages', async () => {
    await expectSendError(
      { ...base, messageType: 'location' },
      400,
      /location is required/
    );
  });

  it('rejects an out-of-range or non-numeric latitude', async () => {
    for (const latitude of [91, -91, NaN]) {
      await expectSendError(
        { ...base, messageType: 'location', location: { latitude, longitude: 0 } },
        400,
        /latitude/
      );
    }
  });

  it('rejects an out-of-range or non-numeric longitude', async () => {
    for (const longitude of [181, -181, NaN]) {
      await expectSendError(
        { ...base, messageType: 'location', location: { latitude: 0, longitude } },
        400,
        /longitude/
      );
    }
  });

  it('accepts boundary lat/lng values (±90 / ±180) and reaches the DB', async () => {
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    for (const [latitude, longitude] of [
      [90, 180],
      [-90, -180],
    ]) {
      await expect(
        sendMessageToConversation(db, 'acct-1', {
          ...base,
          messageType: 'location',
          location: { latitude, longitude },
        })
      ).rejects.toThrow('reached DB');
    }
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

describe('sendMessageToConversation — whatsapp_personal channel branch', () => {
  const conversation = {
    id: 'cv-1',
    channel: 'whatsapp_personal',
    whatsapp_personal_session_id: 'session-1',
    contact: { id: 'contact-1', phone: '+14155550123' },
  };

  function makePersonalChannelDb(): SupabaseClient {
    let table = '';
    let mode: 'select' | 'insert' | 'update' = 'select';
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: () => {
        mode = 'insert';
        return builder;
      },
      update: () => {
        mode = 'update';
        return builder;
      },
      eq: () => builder,
      single: () => {
        if (table === 'conversations' && mode === 'select') {
          return Promise.resolve({ data: conversation, error: null });
        }
        if (table === 'messages' && mode === 'insert') {
          return Promise.resolve({ data: { id: 'msg-row-1' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // Thenable: `await db.from('conversations').update().eq()` lands here.
      then: (resolve: (v: { data: null; error: null }) => void) =>
        resolve({ data: null, error: null }),
    };
    return {
      from: (t: string) => {
        table = t;
        mode = 'select';
        return builder;
      },
    } as unknown as SupabaseClient;
  }

  it('rejects a non-text message before touching the personal-channel send path', async () => {
    const db = makePersonalChannelDb();
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
      })
    ).rejects.toMatchObject({ code: 'unsupported_channel_message_type', status: 400 });
  });

  it('dispatches text through sendPersonalTextMessage and persists the sent message', async () => {
    const { sendPersonalTextMessage } = await import('@/lib/whatsapp-personal/send');
    vi.mocked(sendPersonalTextMessage).mockResolvedValueOnce({ messageId: 'wa-msg-1' });

    const db = makePersonalChannelDb();
    const result = await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Hello there',
    });

    // sanitizedPhone strips all non-digits (Meta-API convention, reused
    // here) before reaching the personal-channel send path — no '+'.
    expect(sendPersonalTextMessage).toHaveBeenCalledWith(
      'acct-1',
      'session-1',
      '14155550123',
      'Hello there',
      'wa-msg-1',
      undefined,
    );
    expect(result).toEqual({ messageId: 'msg-row-1', whatsappMessageId: 'wa-msg-1' });
  });
});
