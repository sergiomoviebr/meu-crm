-- Follow-up hardening for migration 054.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_cpf_length_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_cpf_length_check
      CHECK (cpf IS NULL OR cpf = '' OR length(cpf_normalized) = 11);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_cnpj_length_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_cnpj_length_check
      CHECK (cnpj IS NULL OR cnpj = '' OR length(cnpj_normalized) = 14);
  END IF;
END $$;

-- Contact events are append-only. Operational users may append explicit
-- events such as FOLLOWUP_CREATED, but no client can rewrite or delete history.
DROP POLICY IF EXISTS contact_events_insert ON contact_events;
CREATE POLICY contact_events_insert ON contact_events FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (actor_user_id IS NULL OR actor_user_id = auth.uid())
  );

-- Do not add a generic CONTACT_UPDATED row when the message trigger only
-- maintains first/last-contact timestamps. MESSAGE_SENT/RECEIVED is already
-- the meaningful timeline event.
CREATE OR REPLACE FUNCTION log_contact_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_type := 'CONTACT_CREATED';
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_type := 'CONTACT_DELETED';
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    v_type := 'CONTACT_RESTORED';
  ELSIF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    v_type := 'CONTACT_ARCHIVED';
  ELSIF OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id THEN
    v_type := 'CONTACT_OWNER_CHANGED';
  ELSIF (to_jsonb(OLD) - 'updated_at' - 'first_contact_at' - 'last_contact_at')
      = (to_jsonb(NEW) - 'updated_at' - 'first_contact_at' - 'last_contact_at') THEN
    RETURN NEW;
  ELSE
    v_type := 'CONTACT_UPDATED';
  END IF;

  INSERT INTO contact_events(account_id, contact_id, actor_user_id, event_type, metadata)
  VALUES (
    NEW.account_id,
    NEW.id,
    auth.uid(),
    v_type,
    CASE WHEN v_type = 'CONTACT_OWNER_CHANGED'
      THEN jsonb_build_object('owner_user_id', NEW.owner_user_id)
      ELSE '{}'::jsonb
    END
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to log contact event for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION contact_next_birthday(SMALLINT, SMALLINT, DATE) STABLE;
