-- ============================================================
-- 062_lead_attribution.sql
--
-- Real commercial attribution: campaign/ad -> lead contact -> deal.
-- Fixes the placeholder assumption already flagged as wrong in the
-- Traffic module's own design notes (src/lib/traffic/context.ts,
-- "commercial funnel" section): deals.contact_id there was the
-- MANAGED CLIENT (ad_accounts.contact_id), not the leads that
-- client's campaigns actually generate. A lead is a distinct
-- `contacts` row (relationship_type = 'lead', created by the WhatsApp
-- webhook/ingest as today) that now links back to the client contact
-- that owns the ads which produced it.
--
-- Two capture paths, both best-effort and written at most once per
-- contact (guarded by `attributed_at IS NULL`, applied at the first
-- inbound message only -- src/lib/traffic/attribution.ts):
--
--   1. `ctwa_referral` -- WhatsApp's own click-to-WhatsApp-ad context.
--      The Meta Cloud API webhook exposes it as `referral` on the
--      message; Baileys (personal/QR WhatsApp) exposes the same
--      source_id/source_url/ctwa_clid shape via
--      message.<type>.contextInfo.externalAdReply, since that
--      metadata travels with the message itself, not the transport.
--      When source_id resolves to a known `ads.external_id` in this
--      account, attribution is granular (campaign/ad_set/ad).
--
--   2. `personal_whatsapp_session` -- fallback when no ad context is
--      present (organic message, or a WhatsApp client that doesn't
--      forward externalAdReply). A personal WhatsApp connection can
--      be pre-linked to the one client it's dedicated to
--      (whatsapp_personal_sessions.client_contact_id); every lead
--      landing on that connection is then at least attributed to the
--      right client, without ad-level granularity.
-- ============================================================

ALTER TABLE whatsapp_personal_sessions
  ADD COLUMN IF NOT EXISTS client_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_personal_sessions_client
  ON whatsapp_personal_sessions(client_contact_id) WHERE client_contact_id IS NOT NULL;

COMMENT ON COLUMN whatsapp_personal_sessions.client_contact_id IS
  'Traffic module client (contacts.id) this personal WhatsApp number is dedicated to, if any. Leads landing on this connection without a resolvable ad are still attributed to this client (attribution_source = personal_whatsapp_session).';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS managed_by_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_source TEXT
    CHECK (attribution_source IN ('ctwa_referral', 'personal_whatsapp_session')),
  ADD COLUMN IF NOT EXISTS attribution_platform TEXT
    CHECK (attribution_platform IN ('meta', 'google', 'other')),
  ADD COLUMN IF NOT EXISTS attribution_campaign_id UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_ad_set_id UUID REFERENCES ad_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_ad_id UUID REFERENCES ads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_click_id TEXT,
  ADD COLUMN IF NOT EXISTS attribution_headline TEXT,
  ADD COLUMN IF NOT EXISTS attribution_source_url TEXT,
  ADD COLUMN IF NOT EXISTS attributed_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.managed_by_contact_id IS
  'For a lead contact: the client contact (contacts.id, itself referenced by ad_accounts.contact_id) whose campaigns generated this lead. NULL for client contacts themselves and for leads with no resolvable attribution.';

CREATE INDEX IF NOT EXISTS idx_contacts_managed_by
  ON contacts(managed_by_contact_id) WHERE managed_by_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_attribution_campaign
  ON contacts(attribution_campaign_id) WHERE attribution_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_attribution_ad
  ON contacts(attribution_ad_id) WHERE attribution_ad_id IS NOT NULL;

-- Resolving a referral's source_id -> a specific ad happens on every
-- first inbound message that carries ad context; index the lookup.
CREATE INDEX IF NOT EXISTS idx_ads_external_id ON ads(external_id) WHERE external_id IS NOT NULL;
