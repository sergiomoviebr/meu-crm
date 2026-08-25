-- Message delivery observability and real provider status tracking.
-- Extends the existing messages table; no message or conversation is replaced.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (
  status IN ('pending', 'queued', 'sending', 'sent', 'delivered', 'read', 'replied', 'failed', 'cancelled')
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_status TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_http_status INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_response JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sending_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

UPDATE messages SET provider = CASE
  WHEN provider IS NOT NULL THEN provider
  WHEN EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id AND c.channel = 'whatsapp_personal'
  ) THEN 'whatsapp_personal'
  ELSE 'meta_cloud_api'
END;

UPDATE messages SET
  sent_at = CASE WHEN status IN ('sent', 'delivered', 'read', 'replied') THEN created_at ELSE sent_at END,
  delivered_at = CASE WHEN status IN ('delivered', 'read', 'replied') THEN created_at ELSE delivered_at END,
  read_at = CASE WHEN status IN ('read', 'replied') THEN created_at ELSE read_at END,
  attempt_count = CASE WHEN sender_type IN ('agent', 'bot') THEN GREATEST(attempt_count, 1) ELSE attempt_count END;

CREATE INDEX IF NOT EXISTS idx_messages_delivery_status ON messages(status, created_at DESC)
  WHERE sender_type IN ('agent', 'bot');
CREATE INDEX IF NOT EXISTS idx_messages_provider_external ON messages(provider, message_id)
  WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_status_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  provider_status TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_status_events_message ON message_status_events(message_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_status_events_account ON message_status_events(account_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS message_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'accepted', 'failed', 'cancelled')),
  http_status INTEGER,
  external_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  is_retryable BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (message_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_message_delivery_attempts_account ON message_delivery_attempts(account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_delivery_attempts_failed ON message_delivery_attempts(account_id, started_at DESC) WHERE status = 'failed';

ALTER TABLE message_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_delivery_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_status_events_select ON message_status_events;
CREATE POLICY message_status_events_select ON message_status_events FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS message_delivery_attempts_select ON message_delivery_attempts;
CREATE POLICY message_delivery_attempts_select ON message_delivery_attempts FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS message_delivery_attempts_insert ON message_delivery_attempts;
DROP POLICY IF EXISTS message_delivery_attempts_update ON message_delivery_attempts;
CREATE POLICY message_delivery_attempts_insert ON message_delivery_attempts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY message_delivery_attempts_update ON message_delivery_attempts FOR UPDATE
  USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

-- Status history is written centrally for every insert/update path:
-- Inbox, public API, Meta webhook, Baileys receipt and automations.
CREATE OR REPLACE FUNCTION log_message_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT account_id INTO v_account_id FROM conversations WHERE id = NEW.conversation_id;
    IF v_account_id IS NOT NULL THEN
      INSERT INTO message_status_events (
        account_id, message_id, from_status, to_status, source, provider_status, occurred_at
      ) VALUES (
        v_account_id,
        NEW.id,
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
        NEW.status,
        COALESCE(NULLIF(current_setting('app.message_status_source', true), ''), 'system'),
        NEW.provider_status,
        CASE NEW.status
          WHEN 'queued' THEN COALESCE(NEW.queued_at, NEW.created_at, NOW())
          WHEN 'sending' THEN COALESCE(NEW.sending_at, NEW.created_at, NOW())
          WHEN 'sent' THEN COALESCE(NEW.sent_at, NEW.created_at, NOW())
          WHEN 'delivered' THEN COALESCE(NEW.delivered_at, NEW.created_at, NOW())
          WHEN 'read' THEN COALESCE(NEW.read_at, NEW.created_at, NOW())
          WHEN 'replied' THEN COALESCE(NEW.replied_at, NEW.created_at, NOW())
          WHEN 'failed' THEN COALESCE(NEW.failed_at, NEW.created_at, NOW())
          WHEN 'cancelled' THEN COALESCE(NEW.cancelled_at, NEW.created_at, NOW())
          ELSE COALESCE(NEW.created_at, NOW())
        END
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS message_status_transition_log ON messages;
CREATE TRIGGER message_status_transition_log
AFTER INSERT OR UPDATE OF status ON messages
FOR EACH ROW EXECUTE FUNCTION log_message_status_transition();
