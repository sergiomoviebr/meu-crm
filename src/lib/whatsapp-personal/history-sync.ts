import type {
  Chat,
  Contact,
  LIDMapping,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';
import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { logger } from '@/lib/logger';
import { tagAsPersonalWhatsApp } from '@/lib/whatsapp-personal/ingest';
import { extractPersonalMessageContent } from '@/lib/whatsapp-personal/message-content';

const MESSAGE_BATCH_SIZE = 200;

export interface PersonalHistorySet {
  chats: Chat[];
  contacts: Contact[];
  messages: WAMessage[];
  lidPnMappings?: LIDMapping[];
}

export interface PersonalHistoryImportResult {
  chatsImported: number;
  chatJidsImported: string[];
  messagesImported: number;
  messagesSeen: number;
}

interface ChatBucket {
  jid: string;
  phoneJid?: string | null;
  name?: string | null;
  unreadCount?: number | null;
  messages: WAMessage[];
}

function isIndividualJid(jid: string): boolean {
  return (
    !jid.endsWith('@g.us') &&
    !jid.endsWith('status@broadcast') &&
    !jid.endsWith('@newsletter') &&
    (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'))
  );
}

function timestampSeconds(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

async function resolvePhoneJid(
  sock: WASocket,
  jid: string,
  hint?: string | null
): Promise<string | null> {
  const directHint = toPhoneJid(hint);
  if (jid.endsWith('@s.whatsapp.net')) return jid;
  if (directHint) return directHint;
  if (!jid.endsWith('@lid')) return null;
  return toPhoneJid(await sock.signalRepository.lidMapping.getPNForLID(jid));
}

function toPhoneJid(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.endsWith('@s.whatsapp.net')) return value;
  const digits = normalizePhone(value);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function preferredName(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Imports one Baileys history chunk. Conversations are resolved once per chat
 * and messages are inserted in batches, avoiding a contact/conversation lookup
 * for every bubble while preserving the database idempotency boundary.
 */
export async function importPersonalHistorySet(
  db: SupabaseClient,
  accountId: string,
  sessionId: string,
  history: PersonalHistorySet,
  sock: WASocket
): Promise<PersonalHistoryImportResult> {
  const buckets = new Map<string, ChatBucket>();
  const contactByJid = new Map<string, Contact>();
  const phoneByLid = new Map<string, string>();

  for (const mapping of history.lidPnMappings ?? []) {
    phoneByLid.set(mapping.lid, mapping.pn);
  }
  for (const contact of history.contacts ?? []) {
    contactByJid.set(contact.id, contact);
    if (contact.lid) contactByJid.set(contact.lid, contact);
    if (contact.phoneNumber) contactByJid.set(contact.phoneNumber, contact);
    if (contact.lid && contact.phoneNumber) {
      phoneByLid.set(contact.lid, contact.phoneNumber);
    }
  }

  for (const chat of history.chats ?? []) {
    if (!chat.id || !isIndividualJid(chat.id)) continue;
    buckets.set(chat.id, {
      jid: chat.id,
      phoneJid: chat.pnJid ?? phoneByLid.get(chat.id),
      name: preferredName(chat.name, chat.displayName),
      unreadCount: chat.unreadCount,
      messages: [],
    });
  }

  for (const message of history.messages ?? []) {
    const jid = message.key.remoteJid;
    if (!jid || !isIndividualJid(jid)) continue;
    const bucket = buckets.get(jid) ?? {
      jid,
      phoneJid: message.key.remoteJidAlt ?? phoneByLid.get(jid),
      messages: [],
    };
    if (!bucket.phoneJid) {
      bucket.phoneJid = message.key.remoteJidAlt ?? phoneByLid.get(jid);
    }
    bucket.messages.push(message);
    buckets.set(jid, bucket);
  }

  let chatsImported = 0;
  const chatJidsImported: string[] = [];
  let messagesImported = 0;
  let messagesSeen = 0;

  for (const bucket of buckets.values()) {
    const phoneJid = await resolvePhoneJid(
      sock,
      bucket.jid,
      bucket.phoneJid ?? phoneByLid.get(bucket.jid)
    );
    if (!phoneJid) {
      logger.warn('Skipping WhatsApp history chat without a phone mapping', {
        operation: 'whatsapp-personal.history-sync',
        accountId,
        sessionId,
      });
      continue;
    }

    const phoneDigits = normalizePhone(phoneJid.split('@')[0]);
    if (!phoneDigits) continue;
    const contact = contactByJid.get(bucket.jid) ?? contactByJid.get(phoneJid);
    const name = preferredName(
      contact?.name,
      contact?.notify,
      contact?.verifiedName,
      bucket.name
    );

    const resolved = await resolveConversationByPhone(
      db,
      accountId,
      `+${phoneDigits}`,
      name,
      'whatsapp_personal',
      sessionId
    );
    if (resolved.contactCreated) {
      await tagAsPersonalWhatsApp(db, accountId, resolved.contactId);
    }
    chatsImported += 1;
    chatJidsImported.push(bucket.jid);

    const rows = bucket.messages
      .sort(
        (a, b) =>
          (timestampSeconds(a.messageTimestamp) ?? 0) -
          (timestampSeconds(b.messageTimestamp) ?? 0)
      )
      .flatMap((message) => {
        const messageId = message.key.id;
        const content = extractPersonalMessageContent(message.message);
        if (!messageId || !content) return [];
        messagesSeen += 1;
        const seconds = timestampSeconds(message.messageTimestamp);
        return [
          {
            conversation_id: resolved.conversationId,
            sender_type: message.key.fromMe ? 'agent' : 'customer',
            content_type: content.contentType,
            content_text: content.contentText,
            message_id: messageId,
            status: message.key.fromMe ? 'sent' : 'delivered',
            provider: 'whatsapp_personal',
            is_history_import: true,
            created_at: seconds
              ? new Date(seconds * 1000).toISOString()
              : new Date().toISOString(),
          },
        ];
      });

    for (let offset = 0; offset < rows.length; offset += MESSAGE_BATCH_SIZE) {
      const { data, error } = await db
        .from('messages')
        .upsert(rows.slice(offset, offset + MESSAGE_BATCH_SIZE), {
          onConflict: 'conversation_id,message_id',
          ignoreDuplicates: true,
        })
        .select('id');
      if (error) throw new Error(error.message);
      messagesImported += data?.length ?? 0;
    }

    const conversationPatch: Record<string, unknown> = {
      whatsapp_remote_jid: phoneJid,
    };
    if (bucket.unreadCount != null) {
      conversationPatch.unread_count = Math.max(0, Number(bucket.unreadCount));
    }
    await db
      .from('conversations')
      .update(conversationPatch)
      .eq('id', resolved.conversationId)
      .eq('whatsapp_personal_session_id', sessionId);
  }

  return { chatsImported, chatJidsImported, messagesImported, messagesSeen };
}
