import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { ingestPersonalMessage } from './ingest';

function fakeSock(getPNForLID: (lid: string) => Promise<string | null> = async () => null): WASocket {
  return {
    signalRepository: { lidMapping: { getPNForLID } },
  } as unknown as WASocket;
}

const { resolveConversationByPhone } = vi.hoisted(() => ({
  resolveConversationByPhone: vi.fn(),
}));
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({ resolveConversationByPhone }));

const { resolveAuditUserId } = vi.hoisted(() => ({ resolveAuditUserId: vi.fn() }));
vi.mock('@/lib/api/v1/contacts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/v1/contacts')>(
    '@/lib/api/v1/contacts'
  );
  return { ...actual, resolveAuditUserId };
});

const { runAutomationsForTrigger } = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger }));

function textMessage(overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'wamid-1', fromMe: false },
    message: { conversation: 'Oi, tudo bem?' },
    pushName: 'Fulano',
    messageTimestamp: 1700000000,
    ...overrides,
  } as WAMessage;
}

interface DbCalls {
  upsertMessage?: Record<string, unknown>;
  rpcCalled?: boolean;
  conversationUpdate?: Record<string, unknown>;
  tagInsert?: boolean;
  contactTagsUpsert?: boolean;
}

function makeDb(opts: {
  insertedRows?: { id: string }[] | null;
  existingTag?: { id: string } | null;
  /** Prior sender_type='customer' message count — drives isFirstInboundMessage. */
  priorCustomerMessageCount?: number;
}): { db: SupabaseClient; calls: DbCalls } {
  const calls: DbCalls = {};
  let table = '';
  let mode: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  let countQuery = false;

  const builder: Record<string, unknown> = {
    select: (_col?: string, selectOpts?: { count?: string }) => {
      countQuery = Boolean(selectOpts?.count);
      return builder;
    },
    insert: (payload: Record<string, unknown>) => {
      mode = 'insert';
      if (table === 'tags') calls.tagInsert = true;
      void payload;
      return builder;
    },
    upsert: (payload: Record<string, unknown>) => {
      mode = 'upsert';
      if (table === 'messages') calls.upsertMessage = payload;
      if (table === 'contact_tags') calls.contactTagsUpsert = true;
      return builder;
    },
    update: (payload: Record<string, unknown>) => {
      mode = 'update';
      if (table === 'conversations') calls.conversationUpdate = payload;
      return builder;
    },
    eq: () => builder,
    maybeSingle: () => {
      if (table === 'tags') return Promise.resolve({ data: opts.existingTag ?? null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    single: () => {
      if (table === 'tags' && mode === 'insert') {
        return Promise.resolve({ data: { id: 'tag-new' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then: (
      resolve: (v: { data: { id: string }[] | null; count?: number; error: null }) => void
    ) => {
      if (table === 'messages' && mode === 'upsert') {
        return resolve({ data: opts.insertedRows ?? [{ id: 'msg-1' }], error: null });
      }
      if (table === 'messages' && mode === 'select' && countQuery) {
        return resolve({ data: null, count: opts.priorCustomerMessageCount ?? 0, error: null });
      }
      return resolve({ data: null, error: null });
    },
  };

  const db = {
    from: (t: string) => {
      table = t;
      mode = 'select';
      countQuery = false;
      return builder;
    },
    rpc: (name: string) => {
      if (name === 'bump_conversation_on_inbound') calls.rpcCalled = true;
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;

  return { db, calls };
}

describe('ingestPersonalMessage', () => {
  it('ignores group JIDs without resolving a conversation', async () => {
    const { db } = makeDb({});
    await ingestPersonalMessage(
      db,
      'acct-1',
      'session-1',
      textMessage({ key: { remoteJid: '123456-789@g.us', id: 'w1', fromMe: false } }),
      fakeSock()
    );
    expect(resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('ignores messages with no text body (v1 is text-only)', async () => {
    const { db } = makeDb({});
    await ingestPersonalMessage(db, 'acct-1', 'session-1', textMessage({ message: {} }), fakeSock());
    expect(resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('resolves via resolveConversationByPhone on the whatsapp_personal channel and inserts the message', async () => {
    resolveConversationByPhone.mockResolvedValueOnce({
      conversationId: 'cv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    const { db, calls } = makeDb({});

    await ingestPersonalMessage(db, 'acct-1', 'session-1', textMessage(), fakeSock());

    expect(resolveConversationByPhone).toHaveBeenCalledWith(
      db,
      'acct-1',
      '+5511999990000',
      'Fulano',
      'whatsapp_personal',
      'session-1',
    );
    expect(calls.upsertMessage).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Oi, tudo bem?',
      message_id: 'wamid-1',
    });
    expect(calls.rpcCalled).toBe(true);
    expect(calls.contactTagsUpsert).toBeFalsy();
    // No prior customer message (default count 0) — this is a first contact.
    expect(runAutomationsForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        triggerType: 'first_inbound_message',
        contactId: 'contact-1',
      })
    );
  });

  it('tags a newly-created contact with "WhatsApp Pessoal" and dispatches new_contact_created', async () => {
    resolveConversationByPhone.mockResolvedValueOnce({
      conversationId: 'cv-2',
      contactId: 'contact-2',
      contactCreated: true,
    });
    resolveAuditUserId.mockResolvedValueOnce('owner-1');
    const { db, calls } = makeDb({ existingTag: null });

    await ingestPersonalMessage(db, 'acct-1', 'session-1', textMessage(), fakeSock());

    expect(calls.tagInsert).toBe(true);
    expect(calls.contactTagsUpsert).toBe(true);
    expect(runAutomationsForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'new_contact_created', contactId: 'contact-2' })
    );
    expect(runAutomationsForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'first_inbound_message', contactId: 'contact-2' })
    );
  });

  it('does not dispatch first_inbound_message when the contact has messaged before', async () => {
    resolveConversationByPhone.mockResolvedValueOnce({
      conversationId: 'cv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    const { db } = makeDb({ priorCustomerMessageCount: 3 });

    await ingestPersonalMessage(db, 'acct-1', 'session-1', textMessage(), fakeSock());

    expect(runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('does not dispatch any automation trigger for an outbound fromMe message', async () => {
    resolveConversationByPhone.mockResolvedValueOnce({
      conversationId: 'cv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    const { db } = makeDb({});

    await ingestPersonalMessage(
      db,
      'acct-1',
      'session-1',
      textMessage({ key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'w3', fromMe: true } }),
      fakeSock()
    );

    expect(runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('is a no-op on a duplicate message_id (idempotent replay)', async () => {
    resolveConversationByPhone.mockResolvedValueOnce({
      conversationId: 'cv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    const { db, calls } = makeDb({ insertedRows: [] });

    await ingestPersonalMessage(db, 'acct-1', 'session-1', textMessage(), fakeSock());

    expect(calls.rpcCalled).toBeUndefined();
    expect(calls.conversationUpdate).toEqual({
      whatsapp_remote_jid: '5511999990000@s.whatsapp.net',
    });
    expect(runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('updates the conversation directly (no unread bump) for an outbound fromMe message', async () => {
    resolveConversationByPhone.mockResolvedValueOnce({
      conversationId: 'cv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    const { db, calls } = makeDb({});

    await ingestPersonalMessage(
      db,
      'acct-1',
      'session-1',
      textMessage({ key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'w2', fromMe: true } }),
      fakeSock()
    );

    expect(calls.upsertMessage).toMatchObject({ sender_type: 'agent', status: 'sent' });
    expect(calls.rpcCalled).toBeUndefined();
    expect(calls.conversationUpdate).toMatchObject({ last_message_text: 'Oi, tudo bem?' });
  });

  it('does not use the sender pushName as the contact name hint for an outbound fromMe message', async () => {
    // pushName on a fromMe message is OUR OWN account's display name, not
    // the contact's — using it here was the exact bug that showed the
    // CRM owner's own name at the top of the thread instead of the
    // contact's. (See resolveConversationByPhone's `name` arg below.)
    resolveConversationByPhone.mockResolvedValueOnce({
      conversationId: 'cv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    const { db } = makeDb({});

    await ingestPersonalMessage(
      db,
      'acct-1',
      'session-1',
      textMessage({
        key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'w4', fromMe: true },
        pushName: 'Account Owner',
      }),
      fakeSock()
    );

    expect(resolveConversationByPhone).toHaveBeenCalledWith(
      db,
      'acct-1',
      '+5511999990000',
      null,
      'whatsapp_personal',
      'session-1',
    );
  });

  describe('LID-addressed chats', () => {
    const LID_MESSAGE = textMessage({
      key: { remoteJid: '999888777@lid', id: 'w-lid-1', fromMe: false },
    });

    it('resolves the real phone number via the LID↔PN map before touching contacts', async () => {
      resolveConversationByPhone.mockResolvedValueOnce({
        conversationId: 'cv-1',
        contactId: 'contact-1',
        contactCreated: false,
      });
      const { db } = makeDb({});
      const sock = fakeSock(async (lid) =>
        lid === '999888777@lid' ? '5511999990000@s.whatsapp.net' : null
      );

      await ingestPersonalMessage(db, 'acct-1', 'session-1', LID_MESSAGE, sock);

      expect(resolveConversationByPhone).toHaveBeenCalledWith(
        db,
        'acct-1',
        '+5511999990000',
        'Fulano',
        'whatsapp_personal',
        'session-1',
      );
    });

    it('skips the message (does not fabricate a phone number) when the LID has no known mapping yet', async () => {
      const { db } = makeDb({});

      await ingestPersonalMessage(db, 'acct-1', 'session-1', LID_MESSAGE, fakeSock(async () => null));

      expect(resolveConversationByPhone).not.toHaveBeenCalled();
    });
  });
});
