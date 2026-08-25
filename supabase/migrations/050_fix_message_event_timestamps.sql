-- Keep status history timestamps tied to the transition that generated
-- the event. Migration 048 originally used a generic COALESCE, which
-- could reuse sent_at for a later failed event.

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
