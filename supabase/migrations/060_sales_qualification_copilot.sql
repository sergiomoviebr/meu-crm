ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS qualification_score INTEGER NOT NULL DEFAULT 0 CHECK (qualification_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS lead_temperature TEXT NOT NULL DEFAULT 'cold' CHECK (lead_temperature IN ('cold','warm','hot','very_hot')),
  ADD COLUMN IF NOT EXISTS main_pain TEXT,
  ADD COLUMN IF NOT EXISTS last_sales_intent TEXT,
  ADD COLUMN IF NOT EXISTS next_best_action TEXT;

CREATE TABLE IF NOT EXISTS automation_sales_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  source_message TEXT NOT NULL,
  intent TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  score_delta INTEGER NOT NULL DEFAULT 0,
  temperature TEXT NOT NULL CHECK (temperature IN ('cold','warm','hot','very_hot')),
  pain TEXT,
  suggested_reply TEXT NOT NULL,
  next_action TEXT NOT NULL,
  human_handoff BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','edited','ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_suggestions_contact ON automation_sales_suggestions(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_suggestions_pending ON automation_sales_suggestions(account_id, created_at DESC) WHERE status = 'pending';
ALTER TABLE automation_sales_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_sales_suggestions_select ON automation_sales_suggestions;
DROP POLICY IF EXISTS automation_sales_suggestions_update ON automation_sales_suggestions;
CREATE POLICY automation_sales_suggestions_select ON automation_sales_suggestions FOR SELECT USING (is_account_member(account_id));
CREATE POLICY automation_sales_suggestions_update ON automation_sales_suggestions FOR UPDATE USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'automation_sales_suggestions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE automation_sales_suggestions;
  END IF;
END $$;
