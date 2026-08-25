-- Bounded, inspectable retry queue for failures known to happen before
-- provider acceptance. Drained by /api/whatsapp/messages/retry-cron.

CREATE TABLE IF NOT EXISTS message_retry_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  result_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'dead', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_retry_jobs_due
  ON message_retry_jobs(next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_message_retry_jobs_account
  ON message_retry_jobs(account_id, created_at DESC);

ALTER TABLE message_retry_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_retry_jobs_select ON message_retry_jobs;
DROP POLICY IF EXISTS message_retry_jobs_insert ON message_retry_jobs;
DROP POLICY IF EXISTS message_retry_jobs_update ON message_retry_jobs;
CREATE POLICY message_retry_jobs_select ON message_retry_jobs FOR SELECT USING (is_account_member(account_id));
CREATE POLICY message_retry_jobs_insert ON message_retry_jobs FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY message_retry_jobs_update ON message_retry_jobs FOR UPDATE
  USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON message_retry_jobs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON message_retry_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
