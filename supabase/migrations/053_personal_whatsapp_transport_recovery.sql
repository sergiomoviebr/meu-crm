-- Persist the provider's real chat address so replies do not need an
-- additional onWhatsApp lookup before every send. This is especially
-- important for multi-device/LID identities.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_remote_jid TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_personal_remote_jid
  ON conversations(whatsapp_personal_session_id, whatsapp_remote_jid)
  WHERE channel = 'whatsapp_personal' AND whatsapp_remote_jid IS NOT NULL;

COMMENT ON COLUMN conversations.whatsapp_remote_jid IS
  'Baileys remote JID observed on inbound/outbound events for this personal WhatsApp session.';
