-- ============================================================
-- Contact relationship intelligence
--
-- Additive evolution of the existing contacts module. Existing child
-- relationships remain untouched; deletion becomes recoverable and the
-- current tags/notes/deals/conversations architecture is reused.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS preferred_name TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS cnpj TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS secondary_phone TEXT,
  ADD COLUMN IF NOT EXISTS birth_day SMALLINT,
  ADD COLUMN IF NOT EXISTS birth_month SMALLINT,
  ADD COLUMN IF NOT EXISTS birth_year SMALLINT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS address_zip TEXT,
  ADD COLUMN IF NOT EXISTS address_street TEXT,
  ADD COLUMN IF NOT EXISTS address_number TEXT,
  ADD COLUMN IF NOT EXISTS address_complement TEXT,
  ADD COLUMN IF NOT EXISTS address_neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS address_city TEXT,
  ADD COLUMN IF NOT EXISTS address_state TEXT,
  ADD COLUMN IF NOT EXISTS address_country TEXT DEFAULT 'Brasil',
  ADD COLUMN IF NOT EXISTS relationship_type TEXT DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS relationship_status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS cpf_normalized TEXT
    GENERATED ALWAYS AS (regexp_replace(COALESCE(cpf, ''), '\D', '', 'g')) STORED,
  ADD COLUMN IF NOT EXISTS cnpj_normalized TEXT
    GENERATED ALWAYS AS (regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g')) STORED,
  ADD COLUMN IF NOT EXISTS whatsapp_normalized TEXT
    GENERATED ALWAYS AS (regexp_replace(COALESCE(whatsapp, ''), '\D', '', 'g')) STORED;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_birth_day_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_birth_day_check
      CHECK (birth_day IS NULL OR birth_day BETWEEN 1 AND 31);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_birth_month_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_birth_month_check
      CHECK (birth_month IS NULL OR birth_month BETWEEN 1 AND 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_birth_year_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_birth_year_check
      CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_birth_parts_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_birth_parts_check
      CHECK ((birth_day IS NULL) = (birth_month IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_relationship_type_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_relationship_type_check
      CHECK (relationship_type IS NULL OR relationship_type IN
        ('client', 'lead', 'prospect', 'partner', 'supplier', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_relationship_status_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_relationship_status_check
      CHECK (relationship_status IS NULL OR relationship_status IN
        ('active', 'inactive', 'nurturing', 'qualified', 'unqualified'));
  END IF;
END $$;

-- A deleted contact no longer blocks a new active contact with the same
-- identifiers. Restoring is guarded by the same indexes and fails safely if
-- another active record has since claimed the identifier.
DROP INDEX IF EXISTS idx_contacts_account_phone_normalized;
CREATE UNIQUE INDEX idx_contacts_account_phone_normalized
  ON contacts(account_id, phone_normalized)
  WHERE phone_normalized <> '' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_cpf_active
  ON contacts(account_id, cpf_normalized)
  WHERE cpf_normalized <> '' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_cnpj_active
  ON contacts(account_id, cnpj_normalized)
  WHERE cnpj_normalized <> '' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_whatsapp_active
  ON contacts(account_id, whatsapp_normalized)
  WHERE whatsapp_normalized <> '' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_account_active_created
  ON contacts(account_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_account_owner_active
  ON contacts(account_id, owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_account_relationship_active
  ON contacts(account_id, relationship_type, relationship_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_account_location_active
  ON contacts(account_id, address_state, address_city) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_account_birthday_active
  ON contacts(account_id, birth_month, birth_day) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_account_followup_active
  ON contacts(account_id, next_follow_up_at) WHERE deleted_at IS NULL;

COMMENT ON COLUMN contacts.cpf IS
  'Sensitive Brazilian CPF. Never include in list payloads or application logs.';
COMMENT ON COLUMN contacts.deleted_at IS
  'Soft-delete timestamp. Child conversations, messages, deals and history remain intact.';

-- ============================================================
-- Contact event timeline
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'CONTACT_CREATED', 'CONTACT_UPDATED', 'CONTACT_DELETED',
    'CONTACT_RESTORED', 'CONTACT_ARCHIVED', 'CONTACT_TAG_ADDED',
    'CONTACT_TAG_REMOVED', 'CONTACT_OWNER_CHANGED', 'FOLLOWUP_CREATED',
    'MESSAGE_SENT', 'MESSAGE_RECEIVED'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_events_contact_time
  ON contact_events(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_events_account_time
  ON contact_events(account_id, occurred_at DESC);

ALTER TABLE contact_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_events_select ON contact_events;
CREATE POLICY contact_events_select ON contact_events FOR SELECT
  USING (is_account_member(account_id));

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

DROP TRIGGER IF EXISTS on_contact_change_event ON contacts;
CREATE TRIGGER on_contact_change_event
  AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION log_contact_change();

CREATE OR REPLACE FUNCTION log_contact_tag_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id UUID := COALESCE(NEW.contact_id, OLD.contact_id);
  v_tag_id UUID := COALESCE(NEW.tag_id, OLD.tag_id);
  v_account_id UUID;
BEGIN
  SELECT account_id INTO v_account_id FROM contacts WHERE id = v_contact_id;
  IF v_account_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  INSERT INTO contact_events(account_id, contact_id, actor_user_id, event_type, metadata)
  VALUES (
    v_account_id, v_contact_id, auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'CONTACT_TAG_ADDED' ELSE 'CONTACT_TAG_REMOVED' END,
    jsonb_build_object('tag_id', v_tag_id)
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to log contact tag event: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS on_contact_tag_change_event ON contact_tags;
CREATE TRIGGER on_contact_tag_change_event
  AFTER INSERT OR DELETE ON contact_tags
  FOR EACH ROW EXECUTE FUNCTION log_contact_tag_change();

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
  INSERT INTO contact_events(account_id, contact_id, actor_user_id, event_type, metadata, occurred_at)
  VALUES (
    v_account_id, v_contact_id, auth.uid(),
    CASE WHEN NEW.sender_type = 'customer' THEN 'MESSAGE_RECEIVED' ELSE 'MESSAGE_SENT' END,
    jsonb_build_object('message_id', NEW.id, 'conversation_id', NEW.conversation_id),
    COALESCE(NEW.created_at, NOW())
  );
  UPDATE contacts SET
    last_contact_at = COALESCE(NEW.created_at, NOW()),
    first_contact_at = COALESCE(first_contact_at, NEW.created_at, NOW())
  WHERE id = v_contact_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to log contact message event: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_contact_message_event ON messages;
CREATE TRIGGER on_contact_message_event
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION log_contact_message_event();

-- ============================================================
-- Birthdays and reminders
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS birthday_notice_days SMALLINT[] NOT NULL DEFAULT ARRAY[0, 1, 3, 7]::SMALLINT[];

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS action_url TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'contact_birthday', 'contact_reminder'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_reminders_due
  ON contact_reminders(remind_at) WHERE completed_at IS NULL AND notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_reminders_contact
  ON contact_reminders(contact_id, remind_at DESC);

ALTER TABLE contact_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_reminders_select ON contact_reminders;
DROP POLICY IF EXISTS contact_reminders_insert ON contact_reminders;
DROP POLICY IF EXISTS contact_reminders_update ON contact_reminders;
DROP POLICY IF EXISTS contact_reminders_delete ON contact_reminders;
CREATE POLICY contact_reminders_select ON contact_reminders FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY contact_reminders_insert ON contact_reminders FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND auth.uid() = user_id);
CREATE POLICY contact_reminders_update ON contact_reminders FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_reminders_delete ON contact_reminders FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION contact_next_birthday(
  p_day SMALLINT,
  p_month SMALLINT,
  p_from DATE DEFAULT CURRENT_DATE
) RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM p_from)::INTEGER;
  v_last_day INTEGER;
  v_candidate DATE;
BEGIN
  v_last_day := EXTRACT(DAY FROM (date_trunc('month', make_date(v_year, p_month, 1))
    + INTERVAL '1 month - 1 day'))::INTEGER;
  v_candidate := make_date(v_year, p_month, LEAST(p_day, v_last_day));
  IF v_candidate < p_from THEN
    v_year := v_year + 1;
    v_last_day := EXTRACT(DAY FROM (date_trunc('month', make_date(v_year, p_month, 1))
      + INTERVAL '1 month - 1 day'))::INTEGER;
    v_candidate := make_date(v_year, p_month, LEAST(p_day, v_last_day));
  END IF;
  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION get_upcoming_contact_birthdays(
  p_account_id UUID,
  p_days INTEGER DEFAULT 30,
  p_from DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
  id UUID,
  name TEXT,
  preferred_name TEXT,
  company TEXT,
  phone TEXT,
  birth_day SMALLINT,
  birth_month SMALLINT,
  birth_year SMALLINT,
  next_birthday DATE,
  days_until INTEGER
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  WITH birthdays AS (
    SELECT c.id, c.name, c.preferred_name, c.company, c.phone,
      c.birth_day, c.birth_month, c.birth_year,
      contact_next_birthday(c.birth_day, c.birth_month, p_from) AS next_birthday
    FROM contacts c
    WHERE c.account_id = p_account_id
      AND c.deleted_at IS NULL
      AND c.birth_day IS NOT NULL
      AND c.birth_month IS NOT NULL
  )
  SELECT b.*, (b.next_birthday - p_from)::INTEGER AS days_until
  FROM birthdays b
  WHERE b.next_birthday <= p_from + GREATEST(0, LEAST(p_days, 366))
  ORDER BY b.next_birthday, COALESCE(b.preferred_name, b.name, b.phone);
$$;

CREATE OR REPLACE FUNCTION create_contact_birthday_notifications(
  p_account_id UUID,
  p_user_id UUID,
  p_reference_date DATE DEFAULT CURRENT_DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notice_days SMALLINT[];
  v_row RECORD;
  v_count INTEGER := 0;
  v_title TEXT;
BEGIN
  SELECT birthday_notice_days INTO v_notice_days
  FROM profiles
  WHERE user_id = p_user_id AND account_id = p_account_id;
  IF v_notice_days IS NULL THEN RETURN 0; END IF;

  FOR v_row IN
    SELECT * FROM get_upcoming_contact_birthdays(
      p_account_id,
      GREATEST(0, COALESCE((SELECT MAX(x) FROM unnest(v_notice_days) x), 0)),
      p_reference_date
    )
    WHERE days_until = ANY(v_notice_days)
  LOOP
    v_title := CASE v_row.days_until
      WHEN 0 THEN 'Hoje é aniversário de ' || COALESCE(v_row.preferred_name, v_row.name, v_row.phone)
      WHEN 1 THEN 'Amanhã é aniversário de ' || COALESCE(v_row.preferred_name, v_row.name, v_row.phone)
      ELSE 'Aniversário de ' || COALESCE(v_row.preferred_name, v_row.name, v_row.phone)
        || ' em ' || v_row.days_until || ' dias'
    END;

    INSERT INTO notifications(
      account_id, user_id, type, contact_id, title, body,
      action_url, metadata, dedupe_key
    ) VALUES (
      p_account_id, p_user_id, 'contact_birthday', v_row.id, v_title,
      COALESCE(v_row.company, 'Abra o contato para enviar uma mensagem.'),
      '/contacts?contact=' || v_row.id,
      jsonb_build_object('days_until', v_row.days_until, 'birthday', v_row.next_birthday),
      'birthday:' || v_row.id || ':' || v_row.next_birthday || ':' || v_row.days_until
    ) ON CONFLICT DO NOTHING;
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION create_due_contact_reminder_notifications(
  p_reference_time TIMESTAMPTZ DEFAULT NOW()
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT r.*, COALESCE(c.preferred_name, c.name, c.phone) AS contact_name
    FROM contact_reminders r
    JOIN contacts c ON c.id = r.contact_id
    WHERE r.completed_at IS NULL AND r.notified_at IS NULL
      AND r.remind_at <= p_reference_time AND c.deleted_at IS NULL
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    INSERT INTO notifications(
      account_id, user_id, type, contact_id, title, body,
      action_url, metadata, dedupe_key
    ) VALUES (
      v_row.account_id, v_row.user_id, 'contact_reminder', v_row.contact_id,
      v_row.title, v_row.contact_name,
      '/contacts?contact=' || v_row.contact_id,
      jsonb_build_object('reminder_id', v_row.id),
      'contact-reminder:' || v_row.id
    ) ON CONFLICT DO NOTHING;
    UPDATE contact_reminders SET notified_at = p_reference_time WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION create_contact_birthday_notifications(UUID, UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_due_contact_reminder_notifications(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_contact_birthday_notifications(UUID, UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION create_due_contact_reminder_notifications(TIMESTAMPTZ) TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contact_reminders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_reminders;
  END IF;
END $$;
