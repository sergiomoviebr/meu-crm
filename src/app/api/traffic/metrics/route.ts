import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { verifyEntityOwnership } from '@/lib/traffic/entities'
import type { TrafficEntityType } from '@/types'

const VALID_ENTITY_TYPES: TrafficEntityType[] = ['ad_account', 'campaign', 'ad_set', 'ad', 'landing_page']
const NUMERIC_FIELDS = ['impressions', 'reach', 'clicks', 'spend', 'leads', 'conversions', 'revenue', 'visits'] as const

/** Single-row manual metrics entry, upsert semantics (re-saving the
 *  same entity+date corrects that day's numbers instead of duplicating). */
export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { entity_type, entity_id, date } = body
  if (!VALID_ENTITY_TYPES.includes(entity_type)) {
    return NextResponse.json({ error: `entity_type must be one of ${VALID_ENTITY_TYPES.join(', ')}` }, { status: 400 })
  }
  if (!entity_id || typeof entity_id !== 'string') {
    return NextResponse.json({ error: 'entity_id is required' }, { status: 400 })
  }
  if (!date || Number.isNaN(Date.parse(date))) {
    return NextResponse.json({ error: 'date must be a valid YYYY-MM-DD date' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const owned = await verifyEntityOwnership(admin, ctx.accountId, entity_type, entity_id)
  if (!owned) return NextResponse.json({ error: 'Entity not found for this account' }, { status: 404 })

  const row: Record<string, unknown> = {
    account_id: ctx.accountId,
    entity_type,
    entity_id,
    date,
    source: 'manual',
    created_by: ctx.userId,
  }
  for (const field of NUMERIC_FIELDS) {
    const value = body[field]
    if (value == null) continue
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 })
    }
    row[field] = n
  }

  const { data: metric, error } = await admin
    .from('traffic_metrics_daily')
    .upsert(row, { onConflict: 'entity_type,entity_id,date' })
    .select()
    .single()

  if (error || !metric) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  return NextResponse.json({ metric }, { status: 201 })
}
