-- Resolve stale message/overdue notifications as soon as the team replies.
-- This is independent from unread_count: opening the chat still does nothing.

CREATE OR REPLACE FUNCTION resolve_pipeline_reply_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type NOT IN ('agent', 'bot')
     OR NEW.status IN ('failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  UPDATE notifications
  SET read_at = COALESCE(read_at, NOW())
  WHERE conversation_id = NEW.conversation_id
    AND type IN ('conversation_message', 'conversation_overdue')
    AND read_at IS NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to resolve pipeline notifications for %: %', NEW.conversation_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION resolve_pipeline_reply_notifications() OWNER TO postgres;
DROP TRIGGER IF EXISTS on_team_reply_resolve_pipeline_notifications ON messages;
CREATE TRIGGER on_team_reply_resolve_pipeline_notifications
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION resolve_pipeline_reply_notifications();

