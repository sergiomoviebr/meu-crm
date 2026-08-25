import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrafficEntityType } from '@/types'

/**
 * Resolve a CSV/manual-entry "entity_external_id_or_name" cell to a
 * real internal UUID, scoped to the caller's account — shared by the
 * single-row metrics route and the CSV bulk importer so both accept
 * the same flexible reference (a real external_id from the ad
 * platform, or just the entity's name typed by hand).
 */
export interface EntityLookupRow {
  id: string
  externalId: string | null
  name: string
}

export async function loadEntityLookup(
  admin: SupabaseClient,
  accountId: string,
  entityType: TrafficEntityType,
): Promise<EntityLookupRow[]> {
  if (entityType === 'ad_account') {
    const { data } = await admin.from('ad_accounts').select('id, external_account_id, name').eq('account_id', accountId)
    return (data ?? []).map((r) => ({ id: r.id, externalId: r.external_account_id, name: r.name }))
  }

  if (entityType === 'landing_page') {
    const { data } = await admin.from('landing_pages').select('id, name').eq('account_id', accountId)
    return (data ?? []).map((r) => ({ id: r.id, externalId: null, name: r.name }))
  }

  const { data: adAccounts } = await admin.from('ad_accounts').select('id').eq('account_id', accountId)
  const adAccountIds = (adAccounts ?? []).map((a) => a.id)
  if (adAccountIds.length === 0) return []

  if (entityType === 'campaign') {
    const { data } = await admin
      .from('ad_campaigns')
      .select('id, external_id, name')
      .in('ad_account_id', adAccountIds)
    return (data ?? []).map((r) => ({ id: r.id, externalId: r.external_id, name: r.name }))
  }

  const { data: campaigns } = await admin.from('ad_campaigns').select('id').in('ad_account_id', adAccountIds)
  const campaignIds = (campaigns ?? []).map((c) => c.id)
  if (campaignIds.length === 0) return []

  if (entityType === 'ad_set') {
    const { data } = await admin.from('ad_sets').select('id, external_id, name').in('campaign_id', campaignIds)
    return (data ?? []).map((r) => ({ id: r.id, externalId: r.external_id, name: r.name }))
  }

  // entityType === 'ad'
  const { data: adSets } = await admin.from('ad_sets').select('id').in('campaign_id', campaignIds)
  const adSetIds = (adSets ?? []).map((s) => s.id)
  if (adSetIds.length === 0) return []
  const { data } = await admin.from('ads').select('id, external_id, name').in('ad_set_id', adSetIds)
  return (data ?? []).map((r) => ({ id: r.id, externalId: r.external_id, name: r.name }))
}

/** Match id first (exact), then external_id, then a case-insensitive
 *  name match — whichever the caller happened to type/paste. */
export function resolveEntityRef(rows: EntityLookupRow[], ref: string): string | null {
  const byId = rows.find((r) => r.id === ref)
  if (byId) return byId.id
  const byExternal = rows.find((r) => r.externalId && r.externalId === ref)
  if (byExternal) return byExternal.id
  const lower = ref.toLowerCase()
  const byName = rows.find((r) => r.name.toLowerCase() === lower)
  return byName ? byName.id : null
}

/** True when `entityId` really belongs (transitively) to `accountId`
 *  for the given `entityType` — used by the single-row metrics route
 *  to reject a spoofed/cross-account entity_id. */
export async function verifyEntityOwnership(
  admin: SupabaseClient,
  accountId: string,
  entityType: TrafficEntityType,
  entityId: string,
): Promise<boolean> {
  const rows = await loadEntityLookup(admin, accountId, entityType)
  return rows.some((r) => r.id === entityId)
}
