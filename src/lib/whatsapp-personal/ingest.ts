// ============================================================
// Turns one inbound/outbound Baileys `messages.upsert` event into the
// same conversations/messages rows the Meta webhook produces, so the
// existing Inbox (realtime-subscribed to postgres_changes) picks it
// up with zero frontend changes. Reuses
// src/lib/whatsapp/resolve-conversation.ts's contact/conversation
// dedupe unchanged (channel='whatsapp_personal').
//
// Scope: individual chats. Groups/status broadcasts are
// filtered at the socket level (connection-manager.ts's
// shouldIgnoreJid); the checks here are defense-in-depth for the same
// boundary. Media messages keep their bubble type even when an old
// encrypted attachment is no longer available to a newly linked device.
//
// Automation dispatch: only the relationship-level triggers
// (`new_contact_created`, `first_inbound_message`) fire on this
// channel — the same "first contact becomes a lead" automations that
// already run off the Meta webhook. Content-level triggers
// (`new_message_received`, `keyword_match`, AI auto-reply) are
// deliberately NOT wired here: those can send messages back out, and
// doing that automatically over an unofficial, ban-risk channel is a
// bigger step than "capture the lead" — a possible future extension,
// not assumed here.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isLidUser,
  jidDecode,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';

import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { logger } from '@/lib/logger';
import {
  extractExternalAdReply,
  extractPersonalMessageContent,
} from '@/lib/whatsapp-personal/message-content';
import {
  attributeLeadIfNeeded,
  referralFromExternalAdReply,
} from '@/lib/traffic/attribution';

const PERSONAL_TAG_NAME = 'WhatsApp Pessoal';
const PERSONAL_TAG_COLOR = '#25D366';

export async function ingestPersonalMessage(
  db: SupabaseClient,
  accountId: string,
  sessionId: string,
  message: WAMessage,
  sock: WASocket
): Promise<void> {
  let remoteJid = message.key?.remoteJid;
  const messageId = message.key?.id;
  if (!remoteJid || !messageId) return;
  if (
    remoteJid.endsWith('@g.us') ||
    remoteJid.endsWith('status@broadcast') ||
    remoteJid.endsWith('@newsletter')
  )
    return;

  const content = extractPersonalMessageContent(message.message);
  if (!content) return;

  // Under the multi-device protocol, a chat can be addressed by a LID
  // (a privacy identifier) instead of the actual phone-number JID —
  // `decoded.user` on a LID is an opaque internal id, NOT a phone
  // number. Storing it as `contacts.phone` produces an unreachable,
  // garbage-looking "phone number" (this is what created the
  // "showing my own name / a huge invalid number" contacts). Resolve
  // to the real phone-number JID via Baileys' own LID↔PN map first;
  // if WhatsApp hasn't told us the mapping yet, we genuinely don't
  // have a phone number to file this under, so skip rather than
  // store something we can't ever message back.
  if (isLidUser(remoteJid)) {
    const pnJid = message.key.remoteJidAlt?.endsWith('@s.whatsapp.net')
      ? message.key.remoteJidAlt
      : await sock.signalRepository.lidMapping.getPNForLID(remoteJid);
    if (!pnJid) {
      logger.warn(
        'Skipping personal WhatsApp message from an unmapped LID (no known phone number yet)',
        {
          operation: 'whatsapp-personal.ingest',
          accountId,
        }
      );
      return;
    }
    remoteJid = pnJid;
  }

  const decoded = jidDecode(remoteJid);
  if (!decoded?.user) return;
  const phone = `+${decoded.user}`;
  const fromMe = message.key?.fromMe ?? false;

  // `pushName` is the MESSAGE AUTHOR's own WhatsApp display name — for a
  // genuine inbound message that's the contact, which is exactly what we
  // want as a name hint. For a `fromMe` message (sent from the phone
  // itself, outside the CRM) it's OUR OWN account's push name, not the
  // contact's — passing it here would name a new contact after us, or
  // worse, overwrite an already-correct existing contact name with it
  // (resolveConversationByPhone updates the name whenever a hint differs
  // from what's stored). Only trust it on real inbound.
  const nameHint = fromMe ? null : (message.pushName ?? null);

  let resolved: Awaited<ReturnType<typeof resolveConversationByPhone>>;
  try {
    resolved = await resolveConversationByPhone(
      db,
      accountId,
      phone,
      nameHint,
      'whatsapp_personal',
      sessionId
    );
  } catch (err) {
    logger.error(
      'Failed to resolve conversation for personal WhatsApp message',
      {
        operation: 'whatsapp-personal.ingest',
        accountId,
        sessionId,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    );
    return;
  }

  if (resolved.contactCreated) {
    await tagAsPersonalWhatsApp(db, accountId, resolved.contactId);
  }

  // Store the address WhatsApp itself used for this chat. Future replies
  // can send directly to it instead of issuing a separate onWhatsApp
  // query, which is slower and can time out while the socket reconnects.
  await db
    .from('conversations')
    .update({ whatsapp_remote_jid: remoteJid })
    .eq('id', resolved.conversationId)
    .eq('whatsapp_personal_session_id', sessionId);

  // Mirrors the webhook's isFirstInboundMessage: computed BEFORE the
  // insert below, so it reflects "no prior customer message in this
  // conversation" rather than counting the one we're about to add.
  // Only meaningful for real inbound (fromMe replies aren't "contact").
  let isFirstInboundMessage = false;
  if (!fromMe) {
    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', resolved.conversationId)
      .eq('sender_type', 'customer');
    isFirstInboundMessage = (count ?? 0) === 0;

    // Click-to-WhatsApp ad attribution — best-effort, never blocks
    // ingest. See src/lib/traffic/attribution.ts.
    try {
      await attributeLeadIfNeeded(db, {
        accountId,
        contactId: resolved.contactId,
        isFirstInboundMessage,
        referral: referralFromExternalAdReply(extractExternalAdReply(message.message)),
        personalSessionId: sessionId,
      });
    } catch (err) {
      logger.error('Failed to attribute lead from personal WhatsApp message', {
        operation: 'whatsapp-personal.attributeLead',
        accountId,
        sessionId,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  const createdAt = message.messageTimestamp
    ? new Date(Number(message.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString();
  const preview =
    content.contentText ??
    (
      {
        image: '[Imagem]',
        video: '[Vídeo]',
        audio: '[Áudio]',
        document: '[Documento]',
        location: '[Localização]',
        interactive: '[Interação]',
        template: '[Modelo]',
        text: '[Mensagem]',
      } as const
    )[content.contentType];

  const { data: insertedRows, error: insertError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: resolved.conversationId,
        sender_type: fromMe ? 'agent' : 'customer',
        content_type: content.contentType,
        content_text: content.contentText,
        message_id: messageId,
        status: fromMe ? 'sent' : 'delivered',
        provider: 'whatsapp_personal',
        created_at: createdAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id');

  if (insertError) {
    logger.error('Failed to insert personal WhatsApp message', {
      operation: 'whatsapp-personal.ingest',
      accountId,
      error: new Error(insertError.message),
    });
    return;
  }
  // Baileys can redeliver the same message.upsert event (e.g. a
  // reconnect replaying a buffered batch) — an empty result means the
  // (conversation_id, message_id) unique index (migration 037) caught
  // a replay, same idempotency boundary the Meta webhook relies on.
  if (!insertedRows || insertedRows.length === 0) return;

  if (fromMe) {
    await db
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: createdAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolved.conversationId);
  } else {
    const { error: bumpError } = await db.rpc('bump_conversation_on_inbound', {
      p_conversation_id: resolved.conversationId,
      p_last_message_text: preview,
    });
    if (bumpError) {
      logger.error(
        'Failed to bump conversation for personal WhatsApp message',
        {
          operation: 'whatsapp-personal.ingest',
          accountId,
          error: new Error(bumpError.message),
        }
      );
    }
    await db
      .from('conversations')
      .update({ status: 'open' })
      .eq('id', resolved.conversationId)
      .eq('status', 'closed');

    const automationTriggers: (
      'new_contact_created' | 'first_inbound_message'
    )[] = [];
    if (resolved.contactCreated) automationTriggers.push('new_contact_created');
    if (isFirstInboundMessage) automationTriggers.push('first_inbound_message');
    for (const triggerType of automationTriggers) {
      await runAutomationsForTrigger({
        accountId,
        triggerType,
        contactId: resolved.contactId,
        context: {
          message_text: content.contentText ?? preview,
          conversation_id: resolved.conversationId,
        },
      }).catch((err) =>
        logger.error(
          'Automation dispatch failed for personal WhatsApp message',
          {
            operation: 'whatsapp-personal.ingest',
            accountId,
            triggerType,
            error: err instanceof Error ? err : new Error(String(err)),
          }
        )
      );
    }
  }
}

/**
 * Marks a contact auto-created from this channel with a "WhatsApp
 * Pessoal" tag (reusing the existing tags/contact_tags tables, no new
 * column) so personal chats stay visually distinguishable from real
 * CRM leads in /contacts.
 */
export async function tagAsPersonalWhatsApp(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<void> {
  const { data: existingTag } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', PERSONAL_TAG_NAME)
    .maybeSingle();

  let tagId: string | undefined = existingTag?.id;

  if (!tagId) {
    let ownerUserId: string;
    try {
      ownerUserId = await resolveAuditUserId(db, accountId);
    } catch (err) {
      if (!(err instanceof ContactError)) throw err;
      return; // Best-effort — a missing tag shouldn't fail the whole ingest.
    }

    const { data: createdTag, error: createErr } = await db
      .from('tags')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        name: PERSONAL_TAG_NAME,
        color: PERSONAL_TAG_COLOR,
      })
      .select('id')
      .single();

    if (createErr || !createdTag) {
      // Lost a race against a concurrent message from another new contact.
      const { data: raced } = await db
        .from('tags')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', PERSONAL_TAG_NAME)
        .maybeSingle();
      if (!raced) return;
      tagId = raced.id;
    } else {
      tagId = createdTag.id;
    }
  }

  await db
    .from('contact_tags')
    .upsert(
      { contact_id: contactId, tag_id: tagId },
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
    );
}
