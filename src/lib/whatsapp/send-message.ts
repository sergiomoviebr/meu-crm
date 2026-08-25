// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendLocationMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import { decideWhatsAppMessagingPolicy } from '@/lib/whatsapp/messaging-policy';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  createPersonalMessageId,
  sendPersonalTextMessage,
} from '@/lib/whatsapp-personal/send';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  'location',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  /** Required for `messageType === 'location'`. */
  location?: {
    latitude: number;
    longitude: number;
    name?: string | null;
    address?: string | null;
  } | null;
  replyToMessageId?: string | null;
  /** Internal retry worker sets false so a failed retry cannot enqueue
   *  a second independent retry chain. */
  scheduleRetry?: boolean;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

function isRetryableProviderFailure(message: string): boolean {
  return /timeout|timed out|temporar|unavailable|network|fetch failed|connection reset|meta api error:\s*5\d\d/i.test(
    message
  );
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
  location?: { latitude: number; longitude: number } | null;
}): void {
  const {
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
    location,
  } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (messageType === 'location') {
    if (!location) {
      throw new SendMessageError(
        'bad_request',
        'location is required for location messages',
        400
      );
    }
    const { latitude, longitude } = location;
    if (
      typeof latitude !== 'number' ||
      Number.isNaN(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new SendMessageError(
        'bad_request',
        'location.latitude must be a number between -90 and 90',
        400
      );
    }
    if (
      typeof longitude !== 'number' ||
      Number.isNaN(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new SendMessageError(
        'bad_request',
        'location.longitude must be a number between -180 and 180',
        400
      );
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    location,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
    location,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (contact?.deleted_at) {
    throw new SendMessageError(
      'contact_deleted',
      'Este contato está na lixeira. Restaure-o antes de enviar mensagens.',
      409
    );
  }
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // The personal-WhatsApp (QR/Baileys) channel has nothing in common
  // with the Meta-specific plumbing below (access tokens, template/
  // media/interactive builders, phone-variant retries) — v1 only
  // supports plain text on this channel, so it's handled as a fully
  // separate, self-contained path rather than threading conditionals
  // through ~200 lines of Meta-only logic.
  if (conversation.channel === 'whatsapp_personal') {
    if (messageType !== 'text' || !contentText) {
      throw new SendMessageError(
        'unsupported_channel_message_type',
        'Personal WhatsApp only supports plain text messages for now.',
        400
      );
    }
    let personalSessionId = conversation.whatsapp_personal_session_id as
      string | null;
    if (!personalSessionId) {
      const { data: defaultSession } = await db
        .from('whatsapp_personal_sessions')
        .select('id')
        .eq('account_id', accountId)
        .eq('is_default', true)
        .maybeSingle();
      personalSessionId = defaultSession?.id ?? null;
    }
    if (!personalSessionId) {
      throw new SendMessageError(
        'whatsapp_personal_disconnected',
        'Esta conversa não está vinculada a uma conexão do WhatsApp.',
        409
      );
    }
    return sendPersonalChannelMessage(
      db,
      accountId,
      personalSessionId,
      conversationId,
      contact.id,
      sanitizedPhone,
      contentText,
      conversation.whatsapp_remote_jid as string | null,
      params.scheduleRetry !== false
    );
  }

  const messagingPolicy = decideWhatsAppMessagingPolicy({
    channel: 'meta_cloud_api',
    lastCustomerMessageAt: conversation.last_customer_message_at as string | null,
  });
  if (messagingPolicy.mode === 'approved_template' && messageType !== 'template') {
    throw new SendMessageError(
      'approved_template_required',
      'O WhatsApp exige uma mensagem aprovada para continuar este atendimento.',
      409
    );
  }

  // WhatsApp config, account-scoped.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  // Persist the attempt before the external call. Meta accepting a
  // request means "sent to provider", not "delivered to recipient".
  const metaStartedAt = new Date().toISOString();
  const { data: messageRecord, error: createError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text:
        (messageType === 'interactive' ? interactivePayload!.body : null) ??
        (messageType === 'location' && location
          ? [
              location.name,
              location.address,
              `${location.latitude},${location.longitude}`,
            ]
              .filter(Boolean)
              .join(' - ')
          : null) ??
        contentText ??
        null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      interactive_payload:
        messageType === 'interactive' ? interactivePayload : null,
      status: 'sending',
      provider: 'meta_cloud_api',
      provider_status: 'pending',
      attempt_count: 1,
      sending_at: metaStartedAt,
      last_attempt_at: metaStartedAt,
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (createError || !messageRecord) {
    throw new SendMessageError(
      'db_error',
      `Could not create the message attempt: ${createError?.message ?? 'unknown database error'}`,
      500
    );
  }

  await db.from('message_delivery_attempts').insert({
    account_id: accountId,
    message_id: messageRecord.id,
    attempt_number: 1,
    provider: 'meta_cloud_api',
    status: 'started',
    started_at: metaStartedAt,
  });

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'location') {
      const loc = location!;
      const result = await sendLocationMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        latitude: loc.latitude,
        longitude: loc.longitude,
        name: loc.name || undefined,
        address: loc.address || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'interactive') {
      const p = interactivePayload!;
      if (p.kind === 'buttons') {
        const result = await sendInteractiveButtons({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendInteractiveList({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  // Send via Meta — retry across phone-number variants if Meta rejects
  // with "recipient not in allowed list"; persist a working variant
  // back to the contact so the next send goes straight through.
  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  try {
    const variants = phoneVariants(sanitizedPhone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(
          `[send-message] variant "${variant}" rejected by Meta, trying next…`
        );
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-message] Meta send failed for all variants:', message);
    const retryable = isRetryableProviderFailure(message);
    const errorCode = retryable ? 'meta_temporary_error' : 'meta_error';
    const failedAt = new Date().toISOString();
    await Promise.all([
      db
        .from('messages')
        .update({
          status: 'failed',
          provider_status: 'failed',
          error_code: errorCode,
          error_message: message,
          failed_at: failedAt,
        })
        .eq('id', messageRecord.id),
      db
        .from('message_delivery_attempts')
        .update({
          status: 'failed',
          error_code: errorCode,
          error_message: message,
          is_retryable: retryable,
          finished_at: failedAt,
        })
        .eq('message_id', messageRecord.id)
        .eq('attempt_number', 1),
    ]);
    if (retryable && messageType === 'text' && params.scheduleRetry !== false) {
      await db.from('message_retry_jobs').upsert(
        {
          account_id: accountId,
          source_message_id: messageRecord.id,
          status: 'pending',
          attempt_count: 1,
          max_attempts: 3,
          next_attempt_at: new Date(Date.now() + 2 * 60_000).toISOString(),
          last_error: message,
        },
        { onConflict: 'source_message_id' }
      );
    }
    throw new SendMessageError(errorCode, `Meta API error: ${message}`, 502);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
    );
    await db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id);
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  // Same flattening the inbound webhook uses (route.ts's location case)
  // so a location bubble reads identically whether it was sent or
  // received — content_text is the only place location data lives,
  // there's no dedicated lat/lng column.
  const locationText =
    messageType === 'location' && location
      ? [
          location.name,
          location.address,
          `${location.latitude},${location.longitude}`,
        ]
          .filter(Boolean)
          .join(' - ')
      : null;

  const acceptedAt = new Date().toISOString();
  const { error: msgError } = await db
    .from('messages')
    .update({
      message_id: waMessageId,
      status: 'sent',
      provider_status: 'accepted',
      sent_at: acceptedAt,
      error_code: null,
      error_message: null,
    })
    .eq('id', messageRecord.id);

  if (msgError) {
    console.error(
      '[send-message] error updating accepted Meta message:',
      msgError
    );
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to update its status: ${msgError.message}`,
      500
    );
  }

  await db
    .from('message_delivery_attempts')
    .update({
      status: 'accepted',
      external_message_id: waMessageId,
      finished_at: acceptedAt,
    })
    .eq('message_id', messageRecord.id)
    .eq('attempt_number', 1);

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : (locationText ?? contentText ?? `[${messageType}]`);

  await db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}

/**
 * The whatsapp_personal (QR/Baileys) counterpart to the Meta send
 * path above — sends through the account's live socket
 * (src/lib/whatsapp-personal/connection-manager.ts), then persists +
 * updates the conversation + pauses any active Flow, mirroring the
 * Meta path's tail exactly so both channels behave identically from
 * the Inbox's point of view.
 */
async function sendPersonalChannelMessage(
  db: SupabaseClient,
  accountId: string,
  sessionId: string,
  conversationId: string,
  contactId: string,
  phone: string,
  text: string,
  remoteJid: string | null,
  scheduleRetry: boolean
): Promise<SendMessageResult> {
  const waMessageId = createPersonalMessageId();
  const startedAt = new Date().toISOString();
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: text,
      message_id: waMessageId,
      status: 'sending',
      provider: 'whatsapp_personal',
      provider_status: 'pending',
      attempt_count: 1,
      sending_at: startedAt,
      last_attempt_at: startedAt,
    })
    .select()
    .single();

  if (msgError) {
    console.error(
      '[send-message] error creating personal-channel message attempt:',
      msgError
    );
    throw new SendMessageError(
      'db_error',
      `Could not create the message attempt: ${msgError.message}`,
      500
    );
  }

  await db.from('message_delivery_attempts').insert({
    account_id: accountId,
    message_id: messageRecord.id,
    attempt_number: 1,
    provider: 'whatsapp_personal',
    status: 'started',
    started_at: startedAt,
  });

  let resolvedRemoteJid = remoteJid;
  try {
    const personalResult = await sendPersonalTextMessage(
      accountId,
      sessionId,
      phone,
      text,
      waMessageId,
      remoteJid
    );
    resolvedRemoteJid = personalResult.remoteJid ?? resolvedRemoteJid;
  } catch (err) {
    const sendError =
      err instanceof SendMessageError
        ? err
        : new SendMessageError(
            'provider_error',
            'O WhatsApp não confirmou o envio.',
            502
          );
    const failedAt = new Date().toISOString();
    const retryable = [
      'whatsapp_personal_disconnected',
      'whatsapp_personal_lookup_failed',
    ].includes(sendError.code);
    await Promise.all([
      db
        .from('messages')
        .update({
          status: 'failed',
          provider_status: 'failed',
          error_code: sendError.code,
          error_message: sendError.message,
          failed_at: failedAt,
        })
        .eq('id', messageRecord.id),
      db
        .from('message_delivery_attempts')
        .update({
          status: 'failed',
          error_code: sendError.code,
          error_message: sendError.message,
          is_retryable: retryable,
          finished_at: failedAt,
        })
        .eq('message_id', messageRecord.id)
        .eq('attempt_number', 1),
    ]);
    if (retryable && scheduleRetry) {
      await db.from('message_retry_jobs').upsert(
        {
          account_id: accountId,
          source_message_id: messageRecord.id,
          status: 'pending',
          attempt_count: 1,
          max_attempts: 3,
          next_attempt_at: new Date(Date.now() + 2 * 60_000).toISOString(),
          last_error: sendError.message,
        },
        { onConflict: 'source_message_id' }
      );
    }
    throw sendError;
  }

  const acceptedAt = new Date().toISOString();
  await Promise.all([
    db
      .from('messages')
      .update({
        status: 'sent',
        provider_status: 'server_ack',
        sent_at: acceptedAt,
        error_code: null,
        error_message: null,
      })
      .eq('id', messageRecord.id),
    db
      .from('message_delivery_attempts')
      .update({
        status: 'accepted',
        external_message_id: waMessageId,
        finished_at: acceptedAt,
      })
      .eq('message_id', messageRecord.id)
      .eq('attempt_number', 1),
  ]);

  await db
    .from('conversations')
    .update({
      last_message_text: text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(resolvedRemoteJid ? { whatsapp_remote_jid: resolvedRemoteJid } : {}),
    })
    .eq('id', conversationId);

  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
