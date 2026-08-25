import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'

async function loadScopedMessage(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  id: string,
) {
  const { data: message, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_type, content_type, content_text, status, provider, provider_status, message_id, error_code, error_message, attempt_count, created_at, sending_at, sent_at, delivered_at, read_at, failed_at, last_attempt_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !message) return null
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', message.conversation_id)
    .eq('account_id', accountId)
    .maybeSingle()
  return conversation ? message : null
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await context.params
    const message = await loadScopedMessage(ctx.supabase, ctx.accountId, id)
    if (!message) return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })

    const [events, attempts] = await Promise.all([
      ctx.supabase.from('message_status_events').select('id, from_status, to_status, source, provider_status, occurred_at').eq('message_id', id).order('occurred_at'),
      ctx.supabase.from('message_delivery_attempts').select('id, attempt_number, provider, status, http_status, external_message_id, error_code, error_message, is_retryable, started_at, finished_at').eq('message_id', id).order('attempt_number'),
    ])
    return NextResponse.json({ message, events: events.data ?? [], attempts: attempts.data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await context.params
    const message = await loadScopedMessage(ctx.supabase, ctx.accountId, id)
    if (!message) return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })
    if (message.status !== 'failed') return NextResponse.json({ error: 'Somente mensagens com falha podem ser reenviadas.' }, { status: 409 })
    if (message.sender_type !== 'agent' && message.sender_type !== 'bot') return NextResponse.json({ error: 'Esta mensagem não pode ser reenviada.' }, { status: 400 })
    if (message.content_type !== 'text' || !message.content_text) {
      return NextResponse.json({ error: 'A retentativa manual está disponível para mensagens de texto.' }, { status: 400 })
    }

    const result = await sendMessageToConversation(ctx.supabase, ctx.accountId, {
      conversationId: message.conversation_id,
      messageType: 'text',
      contentText: message.content_text,
    })
    return NextResponse.json({ success: true, message_id: result.messageId })
  } catch (error) {
    if (error instanceof SendMessageError) return NextResponse.json({ error: error.message }, { status: error.status })
    return toErrorResponse(error)
  }
}
