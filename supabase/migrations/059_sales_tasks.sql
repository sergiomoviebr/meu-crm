-- Commercial tasks and appointments linked to CRM records.
CREATE TABLE IF NOT EXISTS sales_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  description TEXT,
  task_type TEXT NOT NULL DEFAULT 'task'
    CHECK (task_type IN ('task', 'call', 'meeting', 'follow_up')),
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  assigned_to UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_tasks_account_due
  ON sales_tasks(account_id, due_at) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_sales_tasks_assignee_due
  ON sales_tasks(assigned_to, due_at) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_sales_tasks_contact ON sales_tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_deal ON sales_tasks(deal_id);

DROP TRIGGER IF EXISTS set_updated_at ON sales_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sales_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE sales_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_tasks_select ON sales_tasks;
DROP POLICY IF EXISTS sales_tasks_insert ON sales_tasks;
DROP POLICY IF EXISTS sales_tasks_update ON sales_tasks;
DROP POLICY IF EXISTS sales_tasks_delete ON sales_tasks;

CREATE POLICY sales_tasks_select ON sales_tasks FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY sales_tasks_insert ON sales_tasks FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p
      WHERE p.account_id = sales_tasks.account_id
        AND p.user_id = sales_tasks.assigned_to)
    AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM contacts c
      WHERE c.id = sales_tasks.contact_id AND c.account_id = sales_tasks.account_id))
    AND (deal_id IS NULL OR EXISTS (SELECT 1 FROM deals d
      WHERE d.id = sales_tasks.deal_id AND d.account_id = sales_tasks.account_id))
  );
CREATE POLICY sales_tasks_update ON sales_tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND EXISTS (SELECT 1 FROM profiles p
      WHERE p.account_id = sales_tasks.account_id
        AND p.user_id = sales_tasks.assigned_to)
    AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM contacts c
      WHERE c.id = sales_tasks.contact_id AND c.account_id = sales_tasks.account_id))
    AND (deal_id IS NULL OR EXISTS (SELECT 1 FROM deals d
      WHERE d.id = sales_tasks.deal_id AND d.account_id = sales_tasks.account_id))
  );
CREATE POLICY sales_tasks_delete ON sales_tasks FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'sales_tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sales_tasks;
  END IF;
END $$;
