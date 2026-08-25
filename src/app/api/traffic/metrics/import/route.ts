import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { parseMetricsCsv, type MetricsRowError } from '@/lib/traffic/parse-metrics-csv'
import { loadEntityLookup, resolveEntityRef, type EntityLookupRow } from '@/lib/traffic/entities'
import type { TrafficEntityType } from '@/types'

/**
 * Bulk CSV import of traffic_metrics_daily rows. Body: { csv: string }
 * (the client reads the File as text and posts its content — no
 * multipart parsing, matching this codebase's preference for
 * page-local, dependency-free upload handling).
 */
export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const csv = body?.csv
  if (!csv || typeof csv !== 'string') {
    return NextResponse.json({ error: 'csv (string) is required' }, { status: 400 })
  }

  const { rows: parsedRows, errors: parseErrors } = parseMetricsCsv(csv)

  const admin = supabaseAdmin()
  const lookupCache = new Map<TrafficEntityType, EntityLookupRow[]>()
  async function lookupFor(entityType: TrafficEntityType): Promise<EntityLookupRow[]> {
    if (!lookupCache.has(entityType)) {
      lookupCache.set(entityType, await loadEntityLookup(admin, ctx.accountId, entityType))
    }
    return lookupCache.get(entityType)!
  }

  const resolutionErrors: MetricsRowError[] = []
  const upsertRows: Record<string, unknown>[] = []

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i]
    const lookup = await lookupFor(row.entityType)
    const entityId = resolveEntityRef(lookup, row.entityRef)
    if (!entityId) {
      resolutionErrors.push({
        line: i + 2, // best-effort — parser doesn't carry the original line through successful rows
        message: `Não foi possível encontrar "${row.entityRef}" (${row.entityType}) nesta conta`,
      })
      continue
    }
    upsertRows.push({
      account_id: ctx.accountId,
      entity_type: row.entityType,
      entity_id: entityId,
      date: row.date,
      impressions: row.impressions,
      reach: row.reach,
      clicks: row.clicks,
      spend: row.spend,
      leads: row.leads,
      conversions: row.conversions,
      revenue: row.revenue,
      visits: row.visits,
      source: 'csv_import',
      created_by: ctx.userId,
    })
  }

  let imported = 0
  if (upsertRows.length > 0) {
    const { error, count } = await admin
      .from('traffic_metrics_daily')
      .upsert(upsertRows, { onConflict: 'entity_type,entity_id,date', count: 'exact' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    imported = count ?? upsertRows.length
  }

  return NextResponse.json({ imported, errors: [...parseErrors, ...resolutionErrors] })
}
