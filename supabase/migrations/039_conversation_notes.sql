-- ============================================================
-- 039_conversation_notes
--
-- Internal notes scoped to a single conversation, not the contact as a
-- whole. `contact_notes` (migration 001) already covers "context about
-- this person that should follow them everywhere" (e.g. "VIP client");
-- this covers "context about THIS specific chat" (e.g. "waiting on
-- manager approval for the refund on this thread") — structurally
-- identical to contact_notes, just re-scoped to conversation_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_notes_conversation
  ON conversation_notes(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_account
  ON conversation_notes(account_id);

ALTER TABLE conversation_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_notes_select ON conversation_notes;
DROP POLICY IF EXISTS conversation_notes_insert ON conversation_notes;
DROP POLICY IF EXISTS conversation_notes_delete ON conversation_notes;

-- Same min-role as contact_notes: any account member can read, 'agent'
-- or above can write — mirrors contact_notes_* in 017_account_sharing.sql.
CREATE POLICY conversation_notes_select ON conversation_notes FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY conversation_notes_insert ON conversation_notes FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND c.account_id = conversation_notes.account_id
    )
  );

CREATE POLICY conversation_notes_delete ON conversation_notes FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- ENABLE REALTIME — a note added by one agent shows up for a
-- teammate who has the same conversation open, without a refresh.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversation_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversation_notes;
  END IF;
END $$;
