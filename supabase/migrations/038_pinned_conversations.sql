-- ============================================================
-- 038_pinned_conversations
--
-- Lets an agent pin conversations to the top of their own inbox view.
-- Deliberately per-user, not account-wide: pinning is a personal
-- triage preference (what THIS agent wants to see first), not a
-- shared setting other teammates should inherit — so it's a join
-- table keyed on (user_id, conversation_id), not a column on
-- `conversations`.
--
-- Any account role can pin/unpin (even 'viewer') — organizing your own
-- view is a read-side action, not a write to shared operational data,
-- so this doesn't go through the `is_account_member(account_id,
-- 'agent')` min-role gate that mutating shared rows (contacts,
-- conversations, notes) uses elsewhere.
-- ============================================================

CREATE TABLE IF NOT EXISTS pinned_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_conversations_user
  ON pinned_conversations(user_id);

ALTER TABLE pinned_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pinned_conversations_select ON pinned_conversations;
DROP POLICY IF EXISTS pinned_conversations_insert ON pinned_conversations;
DROP POLICY IF EXISTS pinned_conversations_delete ON pinned_conversations;

-- Read/delete: strictly your own pins — no reason for a teammate to see
-- or clear another agent's pinned list.
CREATE POLICY pinned_conversations_select ON pinned_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY pinned_conversations_delete ON pinned_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- Insert: must be pinning your own row, AND the account_id you're
-- claiming must actually match the conversation's real account, AND
-- you must belong to that account — closes the gap where a client
-- could otherwise send an arbitrary account_id alongside a
-- conversation_id it doesn't actually belong to.
CREATE POLICY pinned_conversations_insert ON pinned_conversations FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND is_account_member(account_id)
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND c.account_id = pinned_conversations.account_id
    )
  );

-- ============================================================
-- ENABLE REALTIME — so pinning in one tab/device reflects in another
-- without a manual refresh, consistent with how conversations/messages
-- already stream.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pinned_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pinned_conversations;
  END IF;
END $$;
