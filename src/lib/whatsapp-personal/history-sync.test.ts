import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Chat,
  Contact,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';

import { importPersonalHistorySet } from './history-sync';

const mocks = vi.hoisted(() => ({
  resolveConversationByPhone: vi.fn(),
  tagAsPersonalWhatsApp: vi.fn(async () => {}),
}));

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: mocks.resolveConversationByPhone,
}));
vi.mock('@/lib/whatsapp-personal/ingest', () => ({
  tagAsPersonalWhatsApp: mocks.tagAsPersonalWhatsApp,
}));

function message(
  jid: string,
  id: string,
  text: string,
  fromMe = false,
  timestamp = 1_700_000_000
): WAMessage {
  return {
    key: { remoteJid: jid, id, fromMe },
    message: { conversation: text },
    messageTimestamp: timestamp,
  } as WAMessage;
}

function makeDb() {
  const messageRows: Record<string, unknown>[] = [];
  const conversationPatches: Record<string, unknown>[] = [];
  let table = '';
  let result: { data: { id: string }[]; error: null } = {
    data: [],
    error: null,
  };

  const builder: Record<string, unknown> = {
    upsert: (rows: Record<string, unknown>[]) => {
      messageRows.push(...rows);
      result = {
        data: rows.map((_, index) => ({
          id: `inserted-${messageRows.length}-${index}`,
        })),
        error: null,
      };
      return builder;
    },
    update: (patch: Record<string, unknown>) => {
      if (table === 'conversations') conversationPatches.push(patch);
      result = { data: [], error: null };
      return builder;
    },
    select: () => Promise.resolve(result),
    eq: () => builder,
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  const db = {
    from: (name: string) => {
      table = name;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, messageRows, conversationPatches };
}

describe('importPersonalHistorySet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConversationByPhone
      .mockResolvedValueOnce({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        contactCreated: true,
      })
      .mockResolvedValueOnce({
        conversationId: 'conv-2',
        contactId: 'contact-2',
        contactCreated: false,
      });
  });

  it('imports every individual chat once, batches messages and ignores groups', async () => {
    const { db, messageRows, conversationPatches } = makeDb();
    const sock = {
      signalRepository: {
        lidMapping: {
          getPNForLID: vi.fn(async () => '5511888880000@s.whatsapp.net'),
        },
      },
    } as unknown as WASocket;

    const result = await importPersonalHistorySet(
      db,
      'account-1',
      'session-1',
      {
        chats: [
          {
            id: '5511999990000@s.whatsapp.net',
            unreadCount: 2,
          } as Chat,
          { id: '999888777@lid', name: 'Maria' } as Chat,
          { id: '1203630@g.us', name: 'Grupo' } as Chat,
        ],
        contacts: [
          {
            id: '5511999990000@s.whatsapp.net',
            name: 'João',
          } as Contact,
        ],
        messages: [
          message('5511999990000@s.whatsapp.net', 'm-2', 'Mais nova', true, 20),
          message(
            '5511999990000@s.whatsapp.net',
            'm-1',
            'Mais antiga',
            false,
            10
          ),
          message('999888777@lid', 'm-3', 'Oi', false, 30),
          message('1203630@g.us', 'm-group', 'Ignorar', false, 40),
        ],
        lidPnMappings: [
          { lid: '999888777@lid', pn: '5511888880000@s.whatsapp.net' },
        ],
      },
      sock
    );

    expect(result).toMatchObject({
      chatsImported: 2,
      messagesImported: 3,
      messagesSeen: 3,
    });
    expect(result.chatJidsImported).toEqual([
      '5511999990000@s.whatsapp.net',
      '999888777@lid',
    ]);
    expect(mocks.resolveConversationByPhone).toHaveBeenNthCalledWith(
      1,
      db,
      'account-1',
      '+5511999990000',
      'João',
      'whatsapp_personal',
      'session-1'
    );
    expect(mocks.tagAsPersonalWhatsApp).toHaveBeenCalledWith(
      db,
      'account-1',
      'contact-1'
    );
    expect(messageRows.map((row) => row.message_id)).toEqual([
      'm-1',
      'm-2',
      'm-3',
    ]);
    expect(messageRows.every((row) => row.is_history_import === true)).toBe(
      true
    );
    expect(conversationPatches).toContainEqual(
      expect.objectContaining({ unread_count: 2 })
    );
  });
});
