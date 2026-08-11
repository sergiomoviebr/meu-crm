-- ============================================================
-- 040_ai_summary_mode
--
-- Widens ai_usage_log.mode's CHECK constraint to add 'summary' — the
-- on-demand "Summarize this conversation" feature (src/lib/ai/summarize.ts)
-- logs spend through the same table as draft/auto_reply (033_ai_reply_polish.sql),
-- just a third mode value.
-- ============================================================

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'summary'));
