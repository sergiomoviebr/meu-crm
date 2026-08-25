-- Content Intelligence — Phase 1
-- Extends, rather than replaces, the content_posts module from migration 042.

CREATE TABLE IF NOT EXISTS content_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'website',
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  author TEXT,
  published_at TIMESTAMPTZ,
  public_text TEXT,
  category TEXT,
  topic TEXT,
  content_format TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'analyze', 'reference', 'created', 'archived')),
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_document TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(author, '') || ' ' || coalesce(category, '') || ' ' || coalesce(topic, '') || ' ' ||
      coalesce(public_text, '') || ' ' || coalesce(notes, ''))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_content_references_account_created ON content_references(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_references_contact ON content_references(contact_id);
CREATE INDEX IF NOT EXISTS idx_content_references_search ON content_references USING GIN(search_document);

CREATE TABLE IF NOT EXISTS content_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS content_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS content_reference_collections (
  reference_id UUID NOT NULL REFERENCES content_references(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES content_collections(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reference_id, collection_id)
);

CREATE TABLE IF NOT EXISTS content_reference_tags (
  reference_id UUID NOT NULL REFERENCES content_references(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES content_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reference_id, tag_id)
);

CREATE TABLE IF NOT EXISTS content_ideas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(trim(body)) > 0),
  source_url TEXT,
  asset_url TEXT,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'url', 'image', 'note', 'reference')),
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'organized', 'archived')),
  reference_id UUID REFERENCES content_references(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_ideas_account_created ON content_ideas(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_ideas_contact ON content_ideas(contact_id);

ALTER TABLE content_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reference_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reference_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_ideas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_references_select ON content_references;
DROP POLICY IF EXISTS content_references_modify ON content_references;
CREATE POLICY content_references_select ON content_references FOR SELECT USING (is_account_member(account_id));
CREATE POLICY content_references_modify ON content_references FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS content_collections_select ON content_collections;
DROP POLICY IF EXISTS content_collections_modify ON content_collections;
CREATE POLICY content_collections_select ON content_collections FOR SELECT USING (is_account_member(account_id));
CREATE POLICY content_collections_modify ON content_collections FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS content_tags_select ON content_tags;
DROP POLICY IF EXISTS content_tags_modify ON content_tags;
CREATE POLICY content_tags_select ON content_tags FOR SELECT USING (is_account_member(account_id));
CREATE POLICY content_tags_modify ON content_tags FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS content_reference_collections_select ON content_reference_collections;
DROP POLICY IF EXISTS content_reference_collections_modify ON content_reference_collections;
CREATE POLICY content_reference_collections_select ON content_reference_collections FOR SELECT USING (
  EXISTS (SELECT 1 FROM content_references r WHERE r.id = reference_id AND is_account_member(r.account_id))
);
CREATE POLICY content_reference_collections_modify ON content_reference_collections FOR ALL USING (
  EXISTS (SELECT 1 FROM content_references r WHERE r.id = reference_id AND is_account_member(r.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM content_references r WHERE r.id = reference_id AND is_account_member(r.account_id, 'agent'))
  AND EXISTS (SELECT 1 FROM content_collections c WHERE c.id = collection_id AND c.account_id = (SELECT account_id FROM content_references WHERE id = reference_id))
);

DROP POLICY IF EXISTS content_reference_tags_select ON content_reference_tags;
DROP POLICY IF EXISTS content_reference_tags_modify ON content_reference_tags;
CREATE POLICY content_reference_tags_select ON content_reference_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM content_references r WHERE r.id = reference_id AND is_account_member(r.account_id))
);
CREATE POLICY content_reference_tags_modify ON content_reference_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM content_references r WHERE r.id = reference_id AND is_account_member(r.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM content_references r WHERE r.id = reference_id AND is_account_member(r.account_id, 'agent'))
  AND EXISTS (SELECT 1 FROM content_tags t WHERE t.id = tag_id AND t.account_id = (SELECT account_id FROM content_references WHERE id = reference_id))
);

DROP POLICY IF EXISTS content_ideas_select ON content_ideas;
DROP POLICY IF EXISTS content_ideas_modify ON content_ideas;
CREATE POLICY content_ideas_select ON content_ideas FOR SELECT USING (is_account_member(account_id));
CREATE POLICY content_ideas_modify ON content_ideas FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON content_references;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON content_references FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON content_collections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON content_collections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON content_ideas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON content_ideas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
