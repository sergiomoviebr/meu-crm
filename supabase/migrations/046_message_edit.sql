-- ============================================================
-- 046_message_edit
--
-- Basic message management for the Inbox: editing a sent message's
-- text (fixing a typo/mistake) and deleting a whole conversation.
--
-- Deleting a conversation was already possible via the existing
-- `conversations_delete` RLS policy (017_account_sharing.sql), but
-- `deals.conversation_id` had no ON DELETE action (defaults to NO
-- ACTION), so any conversation with a linked deal couldn't actually
-- be deleted — Postgres would reject it with a raw FK-violation
-- error. Every other table referencing conversation_id already
-- follows the project's stated convention (SET NULL for rows with
-- audit/reporting value, CASCADE for rows scoped entirely to the
-- conversation) — see docs/engineering-standards.md's Database
-- section and 004_contact_delete_set_null.sql. This brings `deals`
-- in line: the deal (a real business record) survives, just detached
-- from the now-gone conversation.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_conversation_id_fkey;
ALTER TABLE deals ADD CONSTRAINT deals_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
