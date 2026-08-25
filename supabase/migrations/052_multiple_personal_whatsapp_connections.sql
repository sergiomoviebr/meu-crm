-- Multiple personal WhatsApp connections per CRM account.
-- Preserves the existing session and binds every existing personal
-- conversation to it before widening conversation uniqueness.

ALTER TABLE whatsapp_personal_sessions
  DROP CONSTRAINT IF EXISTS whatsapp_personal_sessions_account_id_key;

ALTER TABLE whatsapp_personal_sessions
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE whatsapp_personal_sessions
SET label = COALESCE(NULLIF(label, ''),
  CASE WHEN phone_number IS NOT NULL THEN 'WhatsApp ' || phone_number ELSE 'WhatsApp principal' END);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY connected_at NULLS LAST, created_at, id) AS position
  FROM whatsapp_personal_sessions
), accounts_without_default AS (
  SELECT account_id
  FROM whatsapp_personal_sessions
  GROUP BY account_id
  HAVING BOOL_OR(is_default) = FALSE
)
UPDATE whatsapp_personal_sessions s
SET is_default = TRUE
FROM ranked r, accounts_without_default a
WHERE s.id = r.id AND s.account_id = a.account_id AND r.position = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_personal_one_default
  ON whatsapp_personal_sessions(account_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_personal_account_phone
  ON whatsapp_personal_sessions(account_id, phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_personal_account_created
  ON whatsapp_personal_sessions(account_id, created_at);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_personal_session_id UUID
    REFERENCES whatsapp_personal_sessions(id) ON DELETE SET NULL;

UPDATE conversations c
SET whatsapp_personal_session_id = s.id
FROM whatsapp_personal_sessions s
WHERE c.channel = 'whatsapp_personal'
  AND c.account_id = s.account_id
  AND s.is_default
  AND c.whatsapp_personal_session_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_personal_session
  ON conversations(whatsapp_personal_session_id)
  WHERE whatsapp_personal_session_id IS NOT NULL;

DROP INDEX IF EXISTS idx_conversations_account_contact_channel;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_meta_contact
  ON conversations(account_id, contact_id)
  WHERE channel = 'meta_cloud_api';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_personal_contact_session
  ON conversations(account_id, contact_id, whatsapp_personal_session_id)
  WHERE channel = 'whatsapp_personal' AND whatsapp_personal_session_id IS NOT NULL;

COMMENT ON COLUMN whatsapp_personal_sessions.label IS
  'Human-friendly identifier shown in Settings and the Inbox.';
COMMENT ON COLUMN conversations.whatsapp_personal_session_id IS
  'Personal WhatsApp connection that owns this thread; NULL for Meta Cloud conversations.';
