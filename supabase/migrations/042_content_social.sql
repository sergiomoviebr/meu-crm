-- ============================================================
-- 042_content_social.sql
--
-- "Conteúdo e Redes Sociais" module: content creation, editorial
-- calendar, multi-network scheduling and publishing history for
-- clients already registered in the CRM.
--
-- Deliberately reuses `contacts` as the "client" entity instead of
-- introducing a second client/company table — a contact already
-- represents the business/person the account manages on behalf of,
-- and every social profile just links to an existing contact_id.
--
-- Three tables:
--   social_profiles      — one row per connected network per contact
--                           (Instagram/Facebook/LinkedIn today; new
--                           platforms are an additive CHECK-constraint
--                           change, not a schema rebuild).
--   content_posts        — one row per piece of content, independent
--                           of how many networks it targets.
--   content_post_targets — fan-out: one row per (post, social_profile),
--                           so the same content can succeed on one
--                           network and fail on another, mirroring
--                           broadcasts/broadcast_recipients.
--
-- RLS follows the post-017 is_account_member(account_id, min_role)
-- convention throughout (NOT the pre-017 auth.uid() = user_id style).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. social_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS social_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'linkedin')),
  handle TEXT NOT NULL,
  display_name TEXT,
  -- 'connected' is set once a real access token + external account id
  -- are stored; until then publishing attempts fail with
  -- provider_not_configured (see src/lib/social/providers/*.ts).
  connection_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (connection_status IN ('not_connected', 'connected', 'error')),
  external_account_id TEXT,
  -- AES-256-GCM via src/lib/whatsapp/encryption.ts (encrypt/decrypt) —
  -- no new crypto scheme for this module.
  access_token_encrypted TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id, platform, handle)
);

CREATE INDEX IF NOT EXISTS idx_social_profiles_account ON social_profiles(account_id);
CREATE INDEX IF NOT EXISTS idx_social_profiles_contact ON social_profiles(contact_id);

ALTER TABLE social_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS social_profiles_select ON social_profiles;
DROP POLICY IF EXISTS social_profiles_insert ON social_profiles;
DROP POLICY IF EXISTS social_profiles_update ON social_profiles;
DROP POLICY IF EXISTS social_profiles_delete ON social_profiles;
CREATE POLICY social_profiles_select ON social_profiles FOR SELECT USING (is_account_member(account_id));
CREATE POLICY social_profiles_insert ON social_profiles FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY social_profiles_update ON social_profiles FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY social_profiles_delete ON social_profiles FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON social_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON social_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. content_posts
-- ============================================================
CREATE TABLE IF NOT EXISTS content_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image', 'video', 'carousel', 'text', 'story', 'reel')),
  caption TEXT,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  -- [{ url, path, kind, position }] — path is the content-media storage
  -- object path (see 043_content_media.sql), url is its public URL.
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  link_url TEXT,
  cta TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft', 'pending_approval', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_posts_account ON content_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_content_posts_contact ON content_posts(contact_id);
-- Matches the cron drain query's WHERE clause exactly (status = 'scheduled' AND scheduled_at <= now()).
CREATE INDEX IF NOT EXISTS idx_content_posts_due ON content_posts(status, scheduled_at);

ALTER TABLE content_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_posts_select ON content_posts;
DROP POLICY IF EXISTS content_posts_insert ON content_posts;
DROP POLICY IF EXISTS content_posts_update ON content_posts;
DROP POLICY IF EXISTS content_posts_delete ON content_posts;
CREATE POLICY content_posts_select ON content_posts FOR SELECT USING (is_account_member(account_id));
CREATE POLICY content_posts_insert ON content_posts FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY content_posts_update ON content_posts FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY content_posts_delete ON content_posts FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON content_posts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON content_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. content_post_targets
--
-- No account_id of its own (pure fan-out child row) — RLS joins
-- through content_posts, mirroring broadcast_recipients' policy shape.
-- ============================================================
CREATE TABLE IF NOT EXISTS content_post_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  social_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  external_post_id TEXT,
  error_code TEXT,
  error_message TEXT,
  attempted_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, social_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_content_post_targets_post ON content_post_targets(post_id);

ALTER TABLE content_post_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_post_targets_select ON content_post_targets;
DROP POLICY IF EXISTS content_post_targets_modify ON content_post_targets;
CREATE POLICY content_post_targets_select ON content_post_targets FOR SELECT USING (
  EXISTS (SELECT 1 FROM content_posts p WHERE p.id = content_post_targets.post_id AND is_account_member(p.account_id))
);
CREATE POLICY content_post_targets_modify ON content_post_targets FOR ALL USING (
  EXISTS (SELECT 1 FROM content_posts p WHERE p.id = content_post_targets.post_id AND is_account_member(p.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM content_posts p WHERE p.id = content_post_targets.post_id AND is_account_member(p.account_id, 'agent'))
);
