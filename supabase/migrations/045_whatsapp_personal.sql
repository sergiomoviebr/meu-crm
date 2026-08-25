-- ============================================================
-- 045_whatsapp_personal
--
-- Second, unofficial WhatsApp channel: connect a real personal
-- WhatsApp account via QR code (WhatsApp Web protocol, e.g. Baileys),
-- so its conversations show up in the same Inbox as the official Meta
-- Cloud API channel. See docs/adr/0005-personal-whatsapp-persistent-
-- connection.md for why this departs from the app's usual
-- no-persistent-process stance, and the ToS/ban-risk tradeoff the
-- account owner accepted knowingly.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ---- whatsapp_personal_sessions --------------------------------
-- One personal-WhatsApp connection per account, mirroring
-- whatsapp_config's UNIQUE(account_id) cardinality. auth_state_encrypted
-- holds the full Baileys creds+signal-keys blob (JSON), AES-256-GCM
-- encrypted via src/lib/whatsapp/encryption.ts — the same generic
-- helper used for Meta access tokens, no new crypto.
CREATE TABLE IF NOT EXISTS whatsapp_personal_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connecting', 'qr_pending', 'connected', 'error')),
  phone_number TEXT,
  auth_state_encrypted TEXT,
  last_error TEXT,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id)
);

ALTER TABLE whatsapp_personal_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_personal_sessions_select ON whatsapp_personal_sessions;
DROP POLICY IF EXISTS whatsapp_personal_sessions_insert ON whatsapp_personal_sessions;
DROP POLICY IF EXISTS whatsapp_personal_sessions_update ON whatsapp_personal_sessions;
DROP POLICY IF EXISTS whatsapp_personal_sessions_delete ON whatsapp_personal_sessions;

-- Settings-class table (holds session credentials) — admin-gated
-- writes, same tier as whatsapp_config.
CREATE POLICY whatsapp_personal_sessions_select ON whatsapp_personal_sessions
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_personal_sessions_insert ON whatsapp_personal_sessions
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_personal_sessions_update ON whatsapp_personal_sessions
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_personal_sessions_delete ON whatsapp_personal_sessions
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_personal_sessions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_personal_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- conversations.channel --------------------------------------
-- Every conversation up to now was implicitly Meta Cloud API. Adding
-- an explicit channel lets a contact carry a separate thread per
-- transport, since the two channels have unrelated delivery/identity
-- semantics (Meta access token vs. a live Baileys socket).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'meta_cloud_api'
    CHECK (channel IN ('meta_cloud_api', 'whatsapp_personal'));

-- Widen the one-conversation-per-(account,contact) guarantee from
-- migration 036 to one-per-(account,contact,channel): a contact can
-- now legitimately have both a Meta thread and a personal-WhatsApp
-- thread. Existing rows already default to 'meta_cloud_api', so this
-- is non-destructive and the old index is a strict subset of the new
-- one's guarantee for pre-existing data.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, channel);
