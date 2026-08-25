-- Executive traffic report notes saved per client, period and platform.
CREATE TABLE IF NOT EXISTS traffic_report_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  platform TEXT NOT NULL DEFAULT 'all' CHECK (platform IN ('all', 'meta', 'google')),
  manager_analysis TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id, period_start, period_end, platform),
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_traffic_report_periods_lookup
  ON traffic_report_periods(account_id, contact_id, period_end DESC);

ALTER TABLE traffic_report_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traffic_report_periods_select ON traffic_report_periods;
DROP POLICY IF EXISTS traffic_report_periods_insert ON traffic_report_periods;
DROP POLICY IF EXISTS traffic_report_periods_update ON traffic_report_periods;
DROP POLICY IF EXISTS traffic_report_periods_delete ON traffic_report_periods;
CREATE POLICY traffic_report_periods_select ON traffic_report_periods FOR SELECT USING (is_account_member(account_id));
CREATE POLICY traffic_report_periods_insert ON traffic_report_periods FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY traffic_report_periods_update ON traffic_report_periods FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY traffic_report_periods_delete ON traffic_report_periods FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON traffic_report_periods;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON traffic_report_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

