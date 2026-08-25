import type { WhatsAppChannel } from '@/types';

export type MessagingPolicyDecision =
  | { mode: 'free_form'; reason: 'personal_channel' | 'customer_window_open' }
  | { mode: 'approved_template'; reason: 'customer_window_closed' };

const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Central provider policy for starting/continuing a WhatsApp conversation.
 * This does not hide or expire a CRM conversation; it only selects which
 * outbound mechanism the provider permits at this instant.
 */
export function decideWhatsAppMessagingPolicy(input: {
  channel: WhatsAppChannel;
  lastCustomerMessageAt?: string | null;
  now?: Date;
}): MessagingPolicyDecision {
  if (input.channel === 'whatsapp_personal') {
    return { mode: 'free_form', reason: 'personal_channel' };
  }
  const timestamp = input.lastCustomerMessageAt
    ? new Date(input.lastCustomerMessageAt).getTime()
    : Number.NaN;
  const now = (input.now ?? new Date()).getTime();
  if (Number.isFinite(timestamp) && now - timestamp < CUSTOMER_CARE_WINDOW_MS) {
    return { mode: 'free_form', reason: 'customer_window_open' };
  }
  return { mode: 'approved_template', reason: 'customer_window_closed' };
}
