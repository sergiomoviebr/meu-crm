import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { editPersonalTextMessage } from '@/lib/whatsapp-personal/send';

/**
 * PATCH /api/whatsapp/messages/[id]
 *
 * Body: { content_text: string }
 *
 * Fixes a typo/mistake in an already-sent text message. Only our own
 * text messages (sender_type agent/bot) can be edited — you can't
 * edit what a customer said.
 *
 * Whether this changes what the customer actually sees depends on
 * the channel:
 *  - whatsapp_personal: attempts a REAL WhatsApp edit via Baileys
 *    (`edited_on_whatsapp: true` on success). WhatsApp itself rejects
 *    edits outside its own edit window (~15 min) or to a message it
 *    no longer has — those fall back to a CRM-only correction rather
 *    than failing the whole request.
 *  - meta_cloud_api: Meta's Cloud API has no message-edit endpoint,
 *    so this is ALWAYS a CRM-only correction (`edited_on_whatsapp:
 *    false`) — the customer's copy is unchanged. The UI must say so.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id } = await context.params;

    const body = await request.json().catch(() => null);
    const newText =
      typeof body?.content_text === 'string' ? body.content_text.trim() : '';
    if (!newText) {
      return NextResponse.json(
        { error: 'content_text is required' },
        { status: 400 }
      );
    }

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_type, content_type, message_id')
      .eq('id', id)
      .maybeSingle();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    if (message.sender_type !== 'agent' && message.sender_type !== 'bot') {
      return NextResponse.json(
        { error: 'Only your own messages can be edited' },
        { status: 400 }
      );
    }
    if (message.content_type !== 'text') {
      return NextResponse.json(
        { error: 'Only text messages can be edited' },
        { status: 400 }
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(
        'id, channel, whatsapp_personal_session_id, whatsapp_remote_jid, contact:contacts(phone)'
      )
      .eq('id', message.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    const contact = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact;
    let editedOnWhatsapp = false;

    if (
      conversation.channel === 'whatsapp_personal' &&
      conversation.whatsapp_personal_session_id &&
      message.message_id &&
      contact?.phone
    ) {
      try {
        await editPersonalTextMessage(
          accountId,
          conversation.whatsapp_personal_session_id,
          contact.phone,
          message.message_id,
          newText,
          conversation.whatsapp_remote_jid
        );
        editedOnWhatsapp = true;
      } catch (err) {
        // Expired edit window, disconnected socket, number no longer on
        // WhatsApp, etc. — fall back to a CRM-only correction rather
        // than failing the whole request; the response flag tells the
        // UI to be honest about which one happened.
        console.warn(
          '[whatsapp/messages] real WhatsApp edit failed, falling back to CRM-only:',
          err instanceof Error ? err.message : err
        );
      }
    }

    const { error: updateError } = await supabase
      .from('messages')
      .update({ content_text: newText, edited_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ editedOnWhatsapp });
  } catch (error) {
    console.error('Error in WhatsApp message PATCH:', error);
    return toErrorResponse(error);
  }
}
