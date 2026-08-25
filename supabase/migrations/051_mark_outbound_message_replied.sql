-- A customer reply is a delivery outcome too. Keep this rule in the
-- database so Meta webhooks, Baileys ingestion and future channels all
-- produce the same status without duplicating application logic.

CREATE OR REPLACE FUNCTION mark_previous_outbound_message_replied()
RETURNS TRIGGER AS $$
DECLARE
  v_outbound_id UUID;
BEGIN
  IF NEW.sender_type <> 'customer' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_outbound_id
  FROM messages
  WHERE conversation_id = NEW.conversation_id
    AND sender_type IN ('agent', 'bot')
    AND status IN ('sent', 'delivered', 'read')
    AND created_at <= NEW.created_at
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_outbound_id IS NOT NULL THEN
    UPDATE messages
    SET status = 'replied',
        replied_at = COALESCE(NEW.created_at, NOW())
    WHERE id = v_outbound_id
      AND status IN ('sent', 'delivered', 'read');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS message_customer_reply_status ON messages;
CREATE TRIGGER message_customer_reply_status
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION mark_previous_outbound_message_replied();
