import { generateMessageIDV2, type WASocket } from '@whiskeysockets/baileys';

import { getRestoredLiveSocket } from '@/lib/whatsapp-personal/connection-manager';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { logger } from '@/lib/logger';

export interface PersonalSendResult {
  messageId: string;
  remoteJid?: string;
}

export function createPersonalMessageId(): string {
  return generateMessageIDV2();
}

async function requireLiveSocket(
  accountId: string,
  sessionId: string
): Promise<WASocket> {
  const sock = await getRestoredLiveSocket(accountId, sessionId);
  if (!sock) {
    throw new SendMessageError(
      'whatsapp_personal_disconnected',
      'O WhatsApp pessoal não está conectado. Abra Configurações para verificar a conexão.',
      400
    );
  }
  return sock;
}

// Resolve the number through WhatsApp itself rather than guessing
// `${digits}@s.whatsapp.net` — under the multi-device protocol a
// number can resolve to a different JID (LID-based), and a wrong
// guess here is exactly the "our POST returns 200 but the message
// never arrives" failure mode: sendMessage() to a malformed/unknown
// JID can resolve without throwing instead of failing loudly.
async function resolveJid(sock: WASocket, phone: string): Promise<string> {
  const digits = phone.replace(/^\+/, '');
  let lookup: Awaited<ReturnType<WASocket['onWhatsApp']>>;
  try {
    lookup = await sock.onWhatsApp(digits);
  } catch (error) {
    logger.warn('Personal WhatsApp number lookup failed', {
      operation: 'whatsapp-personal.lookup',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw new SendMessageError(
      'whatsapp_personal_lookup_failed',
      'O WhatsApp não conseguiu validar o número agora. Aguarde a reconexão e tente novamente.',
      503
    );
  }
  const match = lookup?.[0];
  if (!match?.exists) {
    throw new SendMessageError(
      'whatsapp_personal_number_not_found',
      `${phone} is not on WhatsApp (or the number is wrong).`,
      400
    );
  }
  return match.jid;
}

function usableDirectJid(value: string | null | undefined): value is string {
  return Boolean(value && /^[^@]+@(s\.whatsapp\.net|lid)$/.test(value));
}

/**
 * Sends a plain text message through the account's live personal
 * WhatsApp socket. v1 scope is text-only — callers reject other
 * message types before reaching here (see send-message.ts's
 * channel branch).
 */
export async function sendPersonalTextMessage(
  accountId: string,
  sessionId: string,
  phone: string,
  text: string,
  messageId = createPersonalMessageId(),
  knownRemoteJid?: string | null
): Promise<PersonalSendResult> {
  const sock = await requireLiveSocket(accountId, sessionId);
  const jid = usableDirectJid(knownRemoteJid)
    ? knownRemoteJid
    : await resolveJid(sock, phone);

  let result: Awaited<ReturnType<WASocket['sendMessage']>>;
  try {
    result = await sock.sendMessage(jid, { text }, { messageId });
  } catch (error) {
    logger.error('Personal WhatsApp provider rejected send', {
      operation: 'whatsapp-personal.send',
      accountId,
      sessionId,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw new SendMessageError(
      'whatsapp_personal_provider_error',
      'A conexão com o WhatsApp caiu durante o envio. A mensagem não foi confirmada.',
      502
    );
  }
  if (!result?.key?.id) {
    throw new SendMessageError(
      'db_error',
      'Failed to send personal WhatsApp message',
      500
    );
  }
  if (result.key.id !== messageId) {
    throw new SendMessageError(
      'provider_id_mismatch',
      'O WhatsApp retornou uma confirmação inválida para a mensagem.',
      502
    );
  }

  return { messageId: result.key.id, remoteJid: jid };
}

/**
 * Edits a previously-sent text message on WhatsApp itself (not just
 * our own copy) — only possible for messages this account actually
 * sent (`fromMe: true`) and only within WhatsApp's own edit window
 * (currently ~15 minutes); WhatsApp rejects anything outside that,
 * which surfaces here as a thrown error. Callers (the messages PATCH
 * route) must fall back to a CRM-only correction when this throws.
 */
export async function editPersonalTextMessage(
  accountId: string,
  sessionId: string,
  phone: string,
  messageId: string,
  newText: string,
  knownRemoteJid?: string | null
): Promise<void> {
  const sock = await requireLiveSocket(accountId, sessionId);
  const jid = usableDirectJid(knownRemoteJid)
    ? knownRemoteJid
    : await resolveJid(sock, phone);

  await sock.sendMessage(jid, {
    text: newText,
    edit: { remoteJid: jid, fromMe: true, id: messageId },
  });
}
