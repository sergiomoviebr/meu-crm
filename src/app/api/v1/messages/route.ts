// ============================================================
// POST /api/v1/messages — send a WhatsApp message via the public API.
//
// The headline public endpoint (issue #245). Unlike the dashboard's
// `/api/whatsapp/send` (which takes an internal `conversation_id`),
// this takes a phone number — what an external automation actually
// has — resolves-or-creates the contact + conversation, then runs the
// same shared send core.
//
// Auth: API key with the `messages:send` scope. Account context (and
// the service-role client) come from `requireApiKey`.
//
// Body:
//   {
//     "to": "+14155550123",                 // required, E.164
//     "type": "text",                        // text|template|image|video|document|audio (default: text)
//     "text": "Hello!",                      // text body, or media caption
//     "media_url": "https://…/file.pdf",     // required for image/video/document/audio
//     "filename": "invoice.pdf",             // optional, document filename
//     "template": {                          // required when type=template
//       "name": "order_update",
//       "language": "en_US",
//       "params": ["A123"] | { "body": [...] }   // array = positional body; object = structured
//     },
//     "reply_to_message_id": "<uuid>",       // optional, must be in the same conversation
//     "name": "Jane Doe"                     // optional, names a newly-created contact
//   }
//
// Response (201):
//   { "data": { "message_id", "whatsapp_message_id", "conversation_id",
//               "contact_id", "contact_created" } }
// ============================================================

import { z } from 'zod';
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseJsonBody } from '@/lib/api/v1/validate';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

// Shape/presence only — message-type-specific rules (e.g. a template
// needs `template.name`, an image needs `media_url`) stay in
// `validateSendMessageParams` (src/lib/whatsapp/send-message.ts), which
// already owns that domain logic and is shared with the dashboard's own
// send route.
const SendMessageSchema = z.object({
  to: z.string().trim().min(1, "'to' is required"),
  type: z.string().optional().default('text'),
  text: z.string().optional(),
  media_url: z.string().optional(),
  filename: z.string().optional(),
  template: z
    .object({
      name: z.string().optional(),
      language: z.string().optional(),
      params: z
        .union([z.array(z.string()), z.record(z.string(), z.unknown())])
        .optional(),
    })
    .optional(),
  reply_to_message_id: z.string().optional(),
  name: z.string().optional(),
  interactive_payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const body = await parseJsonBody(request, SendMessageSchema);

    const to = body.to.trim();
    const type = body.type;
    const template = body.template ?? null;

    // `params` as an array → legacy positional body params; as an
    // object → structured header/body/button params.
    const templateParams = Array.isArray(template?.params)
      ? template.params
      : undefined;
    const templateMessageParams =
      template?.params && !Array.isArray(template.params)
        ? template.params
        : undefined;

    const interactivePayload =
      (body.interactive_payload as InteractiveMessagePayload | undefined) ?? null;

    // Validate the message shape BEFORE resolveConversationByPhone
    // finds-or-creates a contact + conversation, so a bad payload 400s
    // without leaving an orphan contact/conversation behind.
    validateSendMessageParams({
      messageType: type,
      contentText: body.text ?? null,
      mediaUrl: body.media_url ?? null,
      templateName: template?.name ?? null,
      interactivePayload,
    });

    // Find-or-create the conversation for this phone, then send. Both
    // steps share `SendMessageError`, so one catch maps the whole
    // pipeline to the envelope.
    const resolved = await resolveConversationByPhone(
      ctx.supabase,
      ctx.accountId,
      to,
      body.name ?? null
    );

    const result = await sendMessageToConversation(
      ctx.supabase,
      ctx.accountId,
      {
        conversationId: resolved.conversationId,
        messageType: type,
        contentText: body.text ?? null,
        mediaUrl: body.media_url ?? null,
        filename: body.filename ?? null,
        templateName: template?.name ?? null,
        templateLanguage: template?.language ?? null,
        templateParams,
        templateMessageParams,
        interactivePayload,
        replyToMessageId: body.reply_to_message_id ?? null,
      }
    );

    return ok(
      {
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
      },
      201
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
