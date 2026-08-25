import type { SupabaseClient } from '@supabase/supabase-js'
import type { MessageStatus } from '@/types'
import { logger } from '@/lib/logger'

const STATUS_RANK: Partial<Record<MessageStatus, number>> = {
  pending: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  replied: 6,
}

export function personalAckToStatus(value: number | null | undefined): MessageStatus | null {
  switch (value) {
    case 0: return 'failed'
    case 1: return 'sending'
    case 2: return 'sent'
    case 3: return 'delivered'
    case 4:
    case 5: return 'read'
    default: return null
  }
}

export function receiptToStatus(receipt: {
  receiptTimestamp?: number | bigint | { toString(): string } | null
  readTimestamp?: number | bigint | { toString(): string } | null
  playedTimestamp?: number | bigint | { toString(): string } | null
}): { status: MessageStatus; occurredAt: string } | null {
  const raw = receipt.playedTimestamp ?? receipt.readTimestamp ?? receipt.receiptTimestamp
  if (raw == null) return null
  const status: MessageStatus = receipt.playedTimestamp != null || receipt.readTimestamp != null ? 'read' : 'delivered'
  const seconds = Number(typeof raw === 'object' ? raw.toString() : raw)
  return { status, occurredAt: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString() }
}

export function canAdvanceMessageStatus(current: MessageStatus, incoming: MessageStatus): boolean {
  if (current === incoming) return false
  if (current === 'failed' || current === 'cancelled' || current === 'replied') return false
  if (incoming === 'failed') return ['pending', 'queued', 'sending', 'sent'].includes(current)
  return (STATUS_RANK[incoming] ?? -1) > (STATUS_RANK[current] ?? -1)
}

export async function applyPersonalDeliveryStatus(
  db: SupabaseClient,
  accountId: string,
  sessionId: string,
  externalMessageId: string,
  incoming: MessageStatus,
  occurredAt = new Date().toISOString(),
): Promise<void> {
  const { data, error } = await db
    .from('messages')
    .select('id, status, conversation:conversations!inner(account_id, whatsapp_personal_session_id)')
    .eq('message_id', externalMessageId)
    .eq('provider', 'whatsapp_personal')
    .eq('conversation.account_id', accountId)
    .eq('conversation.whatsapp_personal_session_id', sessionId)
    .in('sender_type', ['agent', 'bot'])
    .maybeSingle()

  if (error || !data) {
    if (error) logger.warn('Could not resolve personal message receipt', { operation: 'whatsapp-personal.delivery-status', accountId, sessionId, externalMessageId, error })
    return
  }

  const current = data.status as MessageStatus
  if (!canAdvanceMessageStatus(current, incoming)) return

  const patch: Record<string, unknown> = { status: incoming, provider_status: incoming }
  if (incoming === 'sent') patch.sent_at = occurredAt
  if (incoming === 'delivered') patch.delivered_at = occurredAt
  if (incoming === 'read') patch.read_at = occurredAt
  if (incoming === 'failed') {
    patch.failed_at = occurredAt
    patch.error_code = 'provider_rejected'
    patch.error_message = 'O WhatsApp não confirmou o envio desta mensagem.'
  }

  const { error: updateError } = await db.from('messages').update(patch).eq('id', data.id).eq('status', current)
  if (updateError) logger.error('Failed to persist personal message receipt', { operation: 'whatsapp-personal.delivery-status', accountId, sessionId, externalMessageId, error: updateError })
}
