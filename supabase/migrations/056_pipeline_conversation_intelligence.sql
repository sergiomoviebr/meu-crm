-- ============================================================
-- Pipeline conversation intelligence
--
-- Makes the existing Kanban read the same conversation/message state as
-- the Inbox. Reply state is derived from message direction; clearing unread
-- messages never clears awaiting_reply.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS pipeline_new_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pipeline_attention_minutes INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS pipeline_overdue_minutes INTEGER NOT NULL DEFAULT 360,
  ADD COLUMN IF NOT EXISTS pipeline_message_notifications BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_pipeline_thresholds_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_pipeline_thresholds_check CHECK (
  pipeline_new_minutes > 0
  AND pipeline_attention_minutes > pipeline_new_minutes
  AND pipeline_overdue_minutes > pipeline_attention_minutes
  AND pipeline_overdue_minutes <= 43200
);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_direction TEXT,
  ADD COLUMN IF NOT EXISTS awaiting_reply BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_team_reply_at TIMESTAMPTZ;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_last_message_direction_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_last_message_direction_check
  CHECK (last_message_direction IS NULL OR last_message_direction IN ('customer', 'agent', 'bot'));

CREATE INDEX IF NOT EXISTS idx_conversations_account_awaiting_reply
  ON conversations(account_id, waiting_since)
  WHERE awaiting_reply = TRUE;
CREATE INDEX IF NOT EXISTS idx_conversations_contact_last_message
  ON conversations(account_id, contact_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_latest
  ON messages(conversation_id, created_at DESC, id DESC);

-- Backfill from the most recent non-failed message. Reading a conversation
-- (unread_count = 0) deliberately does not participate in this calculation.
WITH latest AS (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id,
    m.sender_type,
    COALESCE(NULLIF(m.content_text, ''), '[' || m.content_type || ']') AS preview,
    m.created_at
  FROM messages m
  WHERE m.status NOT IN ('failed', 'cancelled')
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
)
UPDATE conversations c
SET last_message_text = l.preview,
    last_message_at = l.created_at,
    last_message_direction = l.sender_type,
    awaiting_reply = (l.sender_type = 'customer'),
    waiting_since = CASE WHEN l.sender_type = 'customer' THEN l.created_at ELSE NULL END,
    last_customer_message_at = CASE WHEN l.sender_type = 'customer' THEN l.created_at ELSE c.last_customer_message_at END,
    last_team_reply_at = CASE WHEN l.sender_type IN ('agent', 'bot') THEN l.created_at ELSE c.last_team_reply_at END
FROM latest l
WHERE c.id = l.conversation_id;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'conversation_assigned',
    'contact_birthday',
    'contact_reminder',
    'conversation_message',
    'conversation_overdue'
  )
);

CREATE OR REPLACE FUNCTION sync_conversation_reply_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message RECORD;
  v_conversation conversations%ROWTYPE;
  v_contact_name TEXT;
  v_recipient RECORD;
  v_preview TEXT;
BEGIN
  -- Delivery/read transitions do not change reply state. Only a transition
  -- into or out of a failed terminal state requires a recomputation.
  IF TG_OP = 'UPDATE'
     AND ((OLD.status IN ('failed', 'cancelled')) = (NEW.status IN ('failed', 'cancelled'))) THEN
    RETURN NEW;
  END IF;

  SELECT m.sender_type,
         COALESCE(NULLIF(m.content_text, ''), '[' || m.content_type || ']') AS preview,
         m.created_at
  INTO v_message
  FROM messages m
  WHERE m.conversation_id = NEW.conversation_id
    AND m.status NOT IN ('failed', 'cancelled')
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    UPDATE conversations SET
      last_message_text = NULL,
      last_message_at = NULL,
      last_message_direction = NULL,
      awaiting_reply = FALSE,
      waiting_since = NULL,
      updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
  END IF;

  UPDATE conversations SET
    last_message_text = v_message.preview,
    last_message_at = v_message.created_at,
    last_message_direction = v_message.sender_type,
    awaiting_reply = (v_message.sender_type = 'customer'),
    waiting_since = CASE WHEN v_message.sender_type = 'customer' THEN v_message.created_at ELSE NULL END,
    last_customer_message_at = CASE
      WHEN v_message.sender_type = 'customer' THEN v_message.created_at
      ELSE last_customer_message_at
    END,
    last_team_reply_at = CASE
      WHEN v_message.sender_type IN ('agent', 'bot') THEN v_message.created_at
      ELSE last_team_reply_at
    END,
    updated_at = NOW()
  WHERE id = NEW.conversation_id
  RETURNING * INTO v_conversation;

  -- Group consecutive inbound messages into one per-conversation
  -- notification per recipient. The title/body/count are refreshed instead
  -- of producing a noisy notification for each WhatsApp bubble.
  IF TG_OP = 'INSERT' AND NEW.sender_type = 'customer' THEN
    SELECT COALESCE(NULLIF(c.preferred_name, ''), NULLIF(c.name, ''), c.phone)
    INTO v_contact_name
    FROM contacts c WHERE c.id = v_conversation.contact_id;
    v_preview := COALESCE(NULLIF(NEW.content_text, ''), '[' || NEW.content_type || ']');

    FOR v_recipient IN
      SELECT p.user_id
      FROM profiles p
      JOIN accounts a ON a.id = p.account_id
      WHERE p.account_id = v_conversation.account_id
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND a.pipeline_message_notifications = TRUE
        AND (
          v_conversation.assigned_agent_id IS NULL
          OR p.user_id = v_conversation.assigned_agent_id
        )
    LOOP
      INSERT INTO notifications(
        account_id, user_id, type, conversation_id, contact_id,
        title, body, action_url, metadata, dedupe_key, read_at, created_at
      ) VALUES (
        v_conversation.account_id,
        v_recipient.user_id,
        'conversation_message',
        v_conversation.id,
        v_conversation.contact_id,
        'Nova mensagem de ' || COALESCE(v_contact_name, 'contato'),
        LEFT(v_preview, 240),
        '/inbox?c=' || v_conversation.id,
        jsonb_build_object('message_count', 1, 'waiting_since', NEW.created_at),
        'conversation-message:' || v_conversation.id,
        NULL,
        NOW()
      )
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
      DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        read_at = NULL,
        created_at = NOW(),
        metadata = jsonb_build_object(
          'message_count', COALESCE((notifications.metadata->>'message_count')::INTEGER, 0) + 1,
          'waiting_since', COALESCE(notifications.metadata->'waiting_since', EXCLUDED.metadata->'waiting_since')
        );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to sync conversation reply state for %: %', NEW.conversation_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION sync_conversation_reply_state() OWNER TO postgres;
DROP TRIGGER IF EXISTS on_message_sync_conversation_reply_state ON messages;
CREATE TRIGGER on_message_sync_conversation_reply_state
  AFTER INSERT OR UPDATE OF status ON messages
  FOR EACH ROW EXECUTE FUNCTION sync_conversation_reply_state();

-- One security-invoker view hydrates every card. It intentionally omits
-- CPF/CNPJ and message bodies beyond the existing conversation preview.
CREATE OR REPLACE VIEW pipeline_deal_cards
WITH (security_invoker = true)
AS
SELECT
  d.id,
  d.user_id,
  d.account_id,
  d.pipeline_id,
  d.stage_id,
  d.contact_id,
  d.conversation_id,
  d.assigned_to,
  d.title,
  d.value,
  d.currency,
  d.notes,
  d.expected_close_date,
  d.status,
  d.created_at,
  d.updated_at,
  CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'preferred_name', c.preferred_name,
    'phone', c.phone,
    'whatsapp', c.whatsapp,
    'company', c.company,
    'source', c.source,
    'avatar_url', c.avatar_url,
    'owner_user_id', c.owner_user_id
  ) END AS contact,
  CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p.id,
    'user_id', p.user_id,
    'full_name', p.full_name,
    'avatar_url', p.avatar_url
  ) END AS assignee,
  COALESCE(tag_rows.tags, '[]'::jsonb) AS tags,
  CASE WHEN cv.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', cv.id,
    'channel', cv.channel,
    'status', cv.status,
    'last_message_text', cv.last_message_text,
    'last_message_at', cv.last_message_at,
    'last_message_direction', cv.last_message_direction,
    'unread_count', cv.unread_count,
    'awaiting_reply', cv.awaiting_reply,
    'waiting_since', cv.waiting_since,
    'last_customer_message_at', cv.last_customer_message_at,
    'last_team_reply_at', cv.last_team_reply_at
  ) END AS conversation
FROM deals d
LEFT JOIN contacts c ON c.id = d.contact_id AND c.deleted_at IS NULL
LEFT JOIN profiles p ON p.id = d.assigned_to
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
    ORDER BY t.name
  ) AS tags
  FROM contact_tags ct
  JOIN tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = d.contact_id
) tag_rows ON TRUE
LEFT JOIN LATERAL (
  SELECT conv.*
  FROM conversations conv
  WHERE conv.account_id = d.account_id
    AND (
      conv.id = d.conversation_id
      OR (d.conversation_id IS NULL AND conv.contact_id = d.contact_id)
    )
  ORDER BY (conv.id = d.conversation_id) DESC, conv.last_message_at DESC NULLS LAST, conv.created_at DESC
  LIMIT 1
) cv ON TRUE;

GRANT SELECT ON pipeline_deal_cards TO authenticated;

CREATE OR REPLACE FUNCTION create_overdue_conversation_notifications(
  p_reference_time TIMESTAMPTZ DEFAULT NOW()
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_recipient RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT cv.*, a.pipeline_overdue_minutes,
      COALESCE(NULLIF(c.preferred_name, ''), NULLIF(c.name, ''), c.phone) AS contact_name
    FROM conversations cv
    JOIN accounts a ON a.id = cv.account_id
    JOIN contacts c ON c.id = cv.contact_id
    WHERE cv.awaiting_reply = TRUE
      AND cv.waiting_since <= p_reference_time - make_interval(mins => a.pipeline_overdue_minutes)
      AND a.pipeline_message_notifications = TRUE
      AND c.deleted_at IS NULL
  LOOP
    FOR v_recipient IN
      SELECT p.user_id
      FROM profiles p
      WHERE p.account_id = v_row.account_id
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND (v_row.assigned_agent_id IS NULL OR p.user_id = v_row.assigned_agent_id)
    LOOP
      INSERT INTO notifications(
        account_id, user_id, type, conversation_id, contact_id,
        title, body, action_url, metadata, dedupe_key
      ) VALUES (
        v_row.account_id,
        v_recipient.user_id,
        'conversation_overdue',
        v_row.id,
        v_row.contact_id,
        'Resposta atrasada — ' || v_row.contact_name,
        'Este contato continua aguardando uma resposta da equipe.',
        '/inbox?c=' || v_row.id,
        jsonb_build_object('waiting_since', v_row.waiting_since),
        'conversation-overdue:' || v_row.id || ':' || extract(epoch from v_row.waiting_since)::BIGINT
      ) ON CONFLICT DO NOTHING;
      IF FOUND THEN v_count := v_count + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION create_overdue_conversation_notifications(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_overdue_conversation_notifications(TIMESTAMPTZ) TO service_role;

