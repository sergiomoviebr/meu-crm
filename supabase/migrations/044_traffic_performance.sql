-- ============================================================
-- 044_traffic_performance.sql
--
-- "Tráfego & Performance" module: paid ad accounts, campaigns, ad
-- sets, ads/creatives, a generic daily metrics fact table, landing
-- pages, and the AI Performance Copilot's output (recommendations,
-- optimization tasks, and an append-only history log).
--
-- Reuses `contacts` as the "client" entity (same decision as the
-- Content module) — no separate client table. The commercial funnel
-- half (Lead -> Contato -> Agendamento -> Oportunidade -> Venda) is
-- NOT modeled here — it already exists as `deals` moving through
-- `pipeline_stages` (see 001/002/017). Only the top-of-funnel ad data
-- (impressions/clicks/spend, before a contact/deal exists) is new.
--
-- Design call: one generic daily metrics fact table
-- (traffic_metrics_daily), keyed by (entity_type, entity_id, date),
-- instead of five near-duplicate per-level metrics tables. Every
-- level (ad_account/campaign/ad_set/ad/landing_page) needs the same
-- columns and the same "this entity, last 7d vs prior 7d, best
-- window" queries — a fact table lets the signal engine share one
-- query function instead of five copies, at the cost of a
-- polymorphic FK (no DB-level referential integrity to the specific
-- parent table; validated in the application write path instead).
-- Derived ratios (CTR/CPC/CPM/CPL/CPA/ROAS) are computed at query
-- time, never stored, so a metrics correction can't leave a stale
-- ratio behind.
--
-- RLS follows the post-017 is_account_member(account_id, min_role)
-- convention throughout. Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. ad_accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'google', 'other')),
  name TEXT NOT NULL,
  -- 'connected' is set once a real access token + external account id
  -- are stored; until then metric pulls fail with provider_not_configured
  -- (see src/lib/traffic/providers/*.ts). Metrics can still be entered
  -- manually/via CSV regardless of connection_status.
  connection_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (connection_status IN ('not_connected', 'connected', 'error')),
  external_account_id TEXT,
  -- AES-256-GCM via src/lib/whatsapp/encryption.ts (encrypt/decrypt) —
  -- no new crypto scheme, same as social_profiles.access_token_encrypted.
  access_token_encrypted TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id, platform, name)
);

CREATE INDEX IF NOT EXISTS idx_ad_accounts_account ON ad_accounts(account_id);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_contact ON ad_accounts(contact_id);

ALTER TABLE ad_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_accounts_select ON ad_accounts;
DROP POLICY IF EXISTS ad_accounts_insert ON ad_accounts;
DROP POLICY IF EXISTS ad_accounts_update ON ad_accounts;
DROP POLICY IF EXISTS ad_accounts_delete ON ad_accounts;
CREATE POLICY ad_accounts_select ON ad_accounts FOR SELECT USING (is_account_member(account_id));
CREATE POLICY ad_accounts_insert ON ad_accounts FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY ad_accounts_update ON ad_accounts FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY ad_accounts_delete ON ad_accounts FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON ad_accounts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ad_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. ad_campaigns
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended', 'draft')),
  budget NUMERIC(12, 2),
  budget_type TEXT CHECK (budget_type IN ('daily', 'lifetime')),
  currency TEXT NOT NULL DEFAULT 'BRL',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_account ON ad_campaigns(ad_account_id);

ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_campaigns_select ON ad_campaigns;
DROP POLICY IF EXISTS ad_campaigns_modify ON ad_campaigns;
CREATE POLICY ad_campaigns_select ON ad_campaigns FOR SELECT USING (
  EXISTS (SELECT 1 FROM ad_accounts a WHERE a.id = ad_campaigns.ad_account_id AND is_account_member(a.account_id))
);
CREATE POLICY ad_campaigns_modify ON ad_campaigns FOR ALL USING (
  EXISTS (SELECT 1 FROM ad_accounts a WHERE a.id = ad_campaigns.ad_account_id AND is_account_member(a.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM ad_accounts a WHERE a.id = ad_campaigns.ad_account_id AND is_account_member(a.account_id, 'agent'))
);

DROP TRIGGER IF EXISTS set_updated_at ON ad_campaigns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ad_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. ad_sets ("Conjuntos de Anúncios")
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL,
  -- Free-text targeting description, not structured targeting rules —
  -- Phase 1 has no platform API pulling real audience definitions.
  targeting_summary TEXT,
  budget NUMERIC(12, 2),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended', 'draft')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_sets_campaign ON ad_sets(campaign_id);

ALTER TABLE ad_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_sets_select ON ad_sets;
DROP POLICY IF EXISTS ad_sets_modify ON ad_sets;
CREATE POLICY ad_sets_select ON ad_sets FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM ad_campaigns c JOIN ad_accounts a ON a.id = c.ad_account_id
    WHERE c.id = ad_sets.campaign_id AND is_account_member(a.account_id)
  )
);
CREATE POLICY ad_sets_modify ON ad_sets FOR ALL USING (
  EXISTS (
    SELECT 1 FROM ad_campaigns c JOIN ad_accounts a ON a.id = c.ad_account_id
    WHERE c.id = ad_sets.campaign_id AND is_account_member(a.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM ad_campaigns c JOIN ad_accounts a ON a.id = c.ad_account_id
    WHERE c.id = ad_sets.campaign_id AND is_account_member(a.account_id, 'agent')
  )
);

DROP TRIGGER IF EXISTS set_updated_at ON ad_sets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ad_sets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. ads ("Anúncios/Criativos")
-- ============================================================
CREATE TABLE IF NOT EXISTS ads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ad_set_id UUID NOT NULL REFERENCES ad_sets(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL,
  headline TEXT,
  body TEXT,
  media_url TEXT,
  thumbnail_url TEXT,
  cta TEXT,
  landing_page_id UUID, -- FK added after landing_pages exists, below
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended', 'draft')),
  -- Feeds "days active" in the deterministic creative-fatigue score
  -- (src/lib/traffic/signals.ts) — nullable since a manually-entered
  -- ad may predate this field being known.
  launched_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ads_ad_set ON ads(ad_set_id);
CREATE INDEX IF NOT EXISTS idx_ads_landing_page ON ads(landing_page_id);

ALTER TABLE ads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ads_select ON ads;
DROP POLICY IF EXISTS ads_modify ON ads;
CREATE POLICY ads_select ON ads FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM ad_sets s JOIN ad_campaigns c ON c.id = s.campaign_id JOIN ad_accounts a ON a.id = c.ad_account_id
    WHERE s.id = ads.ad_set_id AND is_account_member(a.account_id)
  )
);
CREATE POLICY ads_modify ON ads FOR ALL USING (
  EXISTS (
    SELECT 1 FROM ad_sets s JOIN ad_campaigns c ON c.id = s.campaign_id JOIN ad_accounts a ON a.id = c.ad_account_id
    WHERE s.id = ads.ad_set_id AND is_account_member(a.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM ad_sets s JOIN ad_campaigns c ON c.id = s.campaign_id JOIN ad_accounts a ON a.id = c.ad_account_id
    WHERE s.id = ads.ad_set_id AND is_account_member(a.account_id, 'agent')
  )
);

DROP TRIGGER IF EXISTS set_updated_at ON ads;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 5. landing_pages
-- ============================================================
CREATE TABLE IF NOT EXISTS landing_pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_landing_pages_account ON landing_pages(account_id);
CREATE INDEX IF NOT EXISTS idx_landing_pages_contact ON landing_pages(contact_id);

ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS landing_pages_select ON landing_pages;
DROP POLICY IF EXISTS landing_pages_insert ON landing_pages;
DROP POLICY IF EXISTS landing_pages_update ON landing_pages;
DROP POLICY IF EXISTS landing_pages_delete ON landing_pages;
CREATE POLICY landing_pages_select ON landing_pages FOR SELECT USING (is_account_member(account_id));
CREATE POLICY landing_pages_insert ON landing_pages FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY landing_pages_update ON landing_pages FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY landing_pages_delete ON landing_pages FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON landing_pages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON landing_pages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Now that landing_pages exists, wire ads.landing_page_id to it.
ALTER TABLE ads DROP CONSTRAINT IF EXISTS ads_landing_page_fk;
ALTER TABLE ads ADD CONSTRAINT ads_landing_page_fk
  FOREIGN KEY (landing_page_id) REFERENCES landing_pages(id) ON DELETE SET NULL;

-- ============================================================
-- 6. traffic_metrics_daily — the single fact table (see header note)
-- ============================================================
CREATE TABLE IF NOT EXISTS traffic_metrics_daily (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ad_account', 'campaign', 'ad_set', 'ad', 'landing_page')),
  -- Polymorphic — no FK to a specific parent table. Validated in the
  -- application write path (src/lib/traffic/*.ts), same tradeoff
  -- other polymorphic references in this app already accept.
  entity_id UUID NOT NULL,
  date DATE NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  reach BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  spend NUMERIC(12, 2) NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  visits BIGINT NOT NULL DEFAULT 0, -- landing-page visits; 0 on ad-level rows
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv_import', 'api')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, date)
);

CREATE INDEX IF NOT EXISTS idx_traffic_metrics_entity_date
  ON traffic_metrics_daily(entity_type, entity_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_metrics_account_date
  ON traffic_metrics_daily(account_id, date DESC);

ALTER TABLE traffic_metrics_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traffic_metrics_daily_select ON traffic_metrics_daily;
DROP POLICY IF EXISTS traffic_metrics_daily_insert ON traffic_metrics_daily;
DROP POLICY IF EXISTS traffic_metrics_daily_update ON traffic_metrics_daily;
DROP POLICY IF EXISTS traffic_metrics_daily_delete ON traffic_metrics_daily;
CREATE POLICY traffic_metrics_daily_select ON traffic_metrics_daily FOR SELECT USING (is_account_member(account_id));
CREATE POLICY traffic_metrics_daily_insert ON traffic_metrics_daily FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY traffic_metrics_daily_update ON traffic_metrics_daily FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY traffic_metrics_daily_delete ON traffic_metrics_daily FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 7. traffic_recommendations — the AI diagnostic engine's output
-- ============================================================
CREATE TABLE IF NOT EXISTS traffic_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  entity_type TEXT CHECK (entity_type IN ('ad_account', 'campaign', 'ad_set', 'ad', 'landing_page', 'funnel')),
  entity_id UUID, -- nullable: 'funnel' category recommendations aren't tied to one ad entity
  category TEXT NOT NULL CHECK (category IN
    ('creative_fatigue', 'landing_page', 'funnel', 'budget', 'alert')),
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN
    ('new', 'in_review', 'approved', 'in_progress', 'done', 'dismissed')),
  problem TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  expected_impact TEXT,
  -- Full parsed model response, kept for audit/debugging when a
  -- recommendation looks off — never displayed raw to end users.
  ai_raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_recs_account_status
  ON traffic_recommendations(account_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_traffic_recs_contact
  ON traffic_recommendations(contact_id, created_at DESC);

ALTER TABLE traffic_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traffic_recommendations_select ON traffic_recommendations;
DROP POLICY IF EXISTS traffic_recommendations_insert ON traffic_recommendations;
DROP POLICY IF EXISTS traffic_recommendations_update ON traffic_recommendations;
DROP POLICY IF EXISTS traffic_recommendations_delete ON traffic_recommendations;
CREATE POLICY traffic_recommendations_select ON traffic_recommendations FOR SELECT USING (is_account_member(account_id));
CREATE POLICY traffic_recommendations_insert ON traffic_recommendations FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY traffic_recommendations_update ON traffic_recommendations FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY traffic_recommendations_delete ON traffic_recommendations FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON traffic_recommendations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON traffic_recommendations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 8. traffic_optimization_tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS traffic_optimization_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES traffic_recommendations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  responsible UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_tasks_account_status
  ON traffic_optimization_tasks(account_id, status);
CREATE INDEX IF NOT EXISTS idx_traffic_tasks_contact
  ON traffic_optimization_tasks(contact_id, created_at DESC);

ALTER TABLE traffic_optimization_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traffic_optimization_tasks_select ON traffic_optimization_tasks;
DROP POLICY IF EXISTS traffic_optimization_tasks_insert ON traffic_optimization_tasks;
DROP POLICY IF EXISTS traffic_optimization_tasks_update ON traffic_optimization_tasks;
DROP POLICY IF EXISTS traffic_optimization_tasks_delete ON traffic_optimization_tasks;
CREATE POLICY traffic_optimization_tasks_select ON traffic_optimization_tasks FOR SELECT USING (is_account_member(account_id));
CREATE POLICY traffic_optimization_tasks_insert ON traffic_optimization_tasks FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY traffic_optimization_tasks_update ON traffic_optimization_tasks FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY traffic_optimization_tasks_delete ON traffic_optimization_tasks FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON traffic_optimization_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON traffic_optimization_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 9. traffic_optimization_log — append-only timeline (section 18 of
-- the spec: "12/08 IA identificou fadiga criativa. 13/08 Novo
-- criativo criado. ..."). Written by the diagnostic engine and by
-- the optimization-task status-change route; never edited/deleted by
-- end users.
-- ============================================================
CREATE TABLE IF NOT EXISTS traffic_optimization_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  task_id UUID REFERENCES traffic_optimization_tasks(id) ON DELETE SET NULL,
  recommendation_id UUID REFERENCES traffic_recommendations(id) ON DELETE SET NULL,
  event TEXT NOT NULL, -- 'recommendation_created' | 'task_created' | 'status_changed' | ...
  detail TEXT,
  actor UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_log_contact ON traffic_optimization_log(contact_id, created_at DESC);

ALTER TABLE traffic_optimization_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traffic_optimization_log_select ON traffic_optimization_log;
DROP POLICY IF EXISTS traffic_optimization_log_insert ON traffic_optimization_log;
CREATE POLICY traffic_optimization_log_select ON traffic_optimization_log FOR SELECT USING (is_account_member(account_id));
CREATE POLICY traffic_optimization_log_insert ON traffic_optimization_log FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
-- No UPDATE/DELETE policy — append-only by design, matching the
-- ai_usage_log precedent (immutable audit trail).

-- ============================================================
-- 10. Widen ai_usage_log.mode to accept the Performance Copilot's
-- diagnostic runs, reusing the exact same table/RLS/logging function
-- (src/lib/ai/usage.ts's logAiUsage) rather than a parallel one.
-- ============================================================
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'summary', 'traffic_diagnostic'));
