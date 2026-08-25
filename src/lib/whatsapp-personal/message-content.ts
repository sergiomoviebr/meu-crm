import type { proto } from '@whiskeysockets/baileys';

import type { ContentType } from '@/types';

export interface PersonalMessageContent {
  contentType: ContentType;
  contentText: string | null;
}

function unwrapMessage(
  message: proto.IMessage | null | undefined
): proto.IMessage | null {
  if (!message) return null;
  return (
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message.viewOnceMessageV2Extension?.message ??
    message.documentWithCaptionMessage?.message ??
    message
  );
}

/**
 * Converts the message shapes that can be represented by the CRM into its
 * existing message model. Historical media metadata is retained as a typed
 * placeholder; WhatsApp does not guarantee that old encrypted media remains
 * downloadable by a newly linked device.
 */
export function extractPersonalMessageContent(
  input: proto.IMessage | null | undefined
): PersonalMessageContent | null {
  const message = unwrapMessage(input);
  if (!message) return null;

  const text = message.conversation ?? message.extendedTextMessage?.text;
  if (text) return { contentType: 'text', contentText: text };

  if (message.imageMessage) {
    return {
      contentType: 'image',
      contentText: message.imageMessage.caption?.trim() || null,
    };
  }
  if (message.videoMessage) {
    return {
      contentType: 'video',
      contentText: message.videoMessage.caption?.trim() || null,
    };
  }
  if (message.audioMessage) {
    return { contentType: 'audio', contentText: null };
  }
  if (message.documentMessage) {
    return {
      contentType: 'document',
      contentText:
        message.documentMessage.caption?.trim() ||
        message.documentMessage.fileName?.trim() ||
        null,
    };
  }
  if (message.stickerMessage) {
    return { contentType: 'image', contentText: 'Figurinha' };
  }

  const location = message.locationMessage ?? message.liveLocationMessage;
  if (location) {
    const locationName =
      'name' in location && typeof location.name === 'string'
        ? location.name
        : null;
    const locationAddress =
      'address' in location && typeof location.address === 'string'
        ? location.address
        : null;
    const coordinates =
      location.degreesLatitude != null && location.degreesLongitude != null
        ? `${location.degreesLatitude},${location.degreesLongitude}`
        : null;
    return {
      contentType: 'location',
      contentText:
        [locationName, locationAddress, coordinates]
          .filter(Boolean)
          .join(' - ') || null,
    };
  }

  const interactiveText =
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.listResponseMessage?.title ??
    message.templateButtonReplyMessage?.selectedDisplayText;
  if (interactiveText) {
    return { contentType: 'interactive', contentText: interactiveText };
  }

  if (message.contactMessage) {
    return {
      contentType: 'text',
      contentText: `Contato compartilhado: ${message.contactMessage.displayName || 'Contato'}`,
    };
  }
  if (message.contactsArrayMessage) {
    return {
      contentType: 'text',
      contentText: `Contatos compartilhados: ${message.contactsArrayMessage.displayName || 'Contatos'}`,
    };
  }

  // Protocol, reaction, key-distribution and revoked-message envelopes are
  // state events, not visible chat bubbles.
  return null;
}

export interface ExternalAdReplyInfo {
  sourceId: string | null;
  sourceUrl: string | null;
  ctwaClid: string | null;
  title: string | null;
  body: string | null;
}

/**
 * Click-to-WhatsApp-ad context travels with the message itself at the
 * protocol level (`contextInfo.externalAdReply`), not just through
 * the Meta Cloud API's `referral` webhook field — so a personal
 * (Baileys/QR) connection sees it too, on whichever message subtype
 * carries the contextInfo. Checked here in rough order of how often
 * an ad's prefilled message actually arrives as each type.
 */
export function extractExternalAdReply(
  input: proto.IMessage | null | undefined
): ExternalAdReplyInfo | null {
  const message = unwrapMessage(input);
  if (!message) return null;

  const contextInfo =
    message.extendedTextMessage?.contextInfo ??
    message.imageMessage?.contextInfo ??
    message.videoMessage?.contextInfo ??
    message.documentMessage?.contextInfo ??
    message.audioMessage?.contextInfo ??
    message.stickerMessage?.contextInfo;

  const info = contextInfo?.externalAdReply;
  if (!info) return null;

  return {
    sourceId: info.sourceId ?? null,
    sourceUrl: info.sourceUrl ?? null,
    ctwaClid: info.ctwaClid ?? null,
    title: info.title ?? null,
    body: info.body ?? null,
  };
}
