-- Import the chat history offered by WhatsApp when a personal session is
-- paired as a linked device. Historical rows remain real Inbox messages, but
-- are marked so one-time backfills do not behave like live customer events.

ALTER TABLE whatsapp_personal_sessions
  ADD COLUMN IF NOT EXISTS history_sync_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS history_sync_progress SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_sync_chats INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_sync_messages INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_sync_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_sync_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_sync_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_personal_history_sync_status_check'
  ) THEN
    ALTER TABLE whatsapp_personal_sessions
      ADD CONSTRAINT whatsapp_personal_history_sync_status_check
      CHECK (history_sync_status IN ('idle', 'pending', 'syncing', 'completed', 'paused', 'error'));
  END IF;
END $$;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_history_import BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_messages_personal_history_import
  ON messages(conversation_id, created_at DESC)
  WHERE is_history_import;

COMMENT ON COLUMN messages.is_history_import IS
  'True for a message imported from WhatsApp linked-device history; suppresses live-only side effects.';

-- Keep the useful contact dates for imported messages, but do not create one
-- contact timeline event for every old bubble.
CREATE OR REPLACE FUNCTION log_contact_message_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id UUID;
  v_account_id UUID;
BEGIN
  SELECT contact_id, account_id INTO v_contact_id, v_account_id
  FROM conversations WHERE id = NEW.conversation_id;
  IF v_contact_id IS NULL THEN RETURN NEW; END IF;

  IF NOT NEW.is_history_import THEN
    INSERT INTO contact_events(account_id, contact_id, actor_user_id, event_type, metadata, occurred_at)
    VALUES (
      v_account_id, v_contact_id, auth.uid(),
      CASE WHEN NEW.sender_type = 'customer' THEN 'MESSAGE_RECEIVED' ELSE 'MESSAGE_SENT' END,
      jsonb_build_object('message_id', NEW.id, 'conversation_id', NEW.conversation_id),
      COALESCE(NEW.created_at, NOW())
    );
  END IF;

  UPDATE contacts SET
    last_contact_at = GREATEST(
      COALESCE(last_contact_at, '-infinity'::timestamptz),
      COALESCE(NEW.created_at, NOW())
    ),
    first_contact_at = LEAST(
      COALESCE(first_contact_at, 'infinity'::timestamptz),
      COALESCE(NEW.created_at, NOW())
    )
  WHERE id = v_contact_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to log contact message event: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Reply state still follows the chronologically newest imported message, but
-- a backfill must never notify the team as if thousands of messages arrived.
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

  IF TG_OP = 'INSERT'
     AND NEW.sender_type = 'customer'
     AND NOT NEW.is_history_import THEN
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

CREATE OR REPLACE FUNCTION resolve_pipeline_reply_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_history_import
     OR NEW.sender_type NOT IN ('agent', 'bot')
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

