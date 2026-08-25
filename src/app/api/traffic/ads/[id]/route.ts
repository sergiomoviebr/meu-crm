import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'

const EDITABLE_FIELDS = [
  'name', 'headline', 'body', 'media_url', 'thumbnail_url', 'cta',
  'landing_page_id', 'status', 'launched_at',
] as const

async function loadOwnedAd(admin: ReturnType<typeof supabaseAdmin>, id: string, accountId: string) {
  const { data: ad } = await admin.from('ads').select('id, ad_set_id').eq('id', id).maybeSingle()
  if (!ad) return null
  const { data: adSet } = await admin.from('ad_sets').select('id, campaign_id').eq('id', ad.ad_set_id).maybeSingle()
  if (!adSet) return null
  const { data: campaign } = await admin.from('ad_campaigns').select('id, ad_account_id').eq('id', adSet.campaign_id).maybeSingle()
  if (!campaign) return null
  const { data: adAccount } = await admin
    .from('ad_accounts')
    .select('id')
    .eq('id', campaign.ad_account_id)
    .eq('account_id', accountId)
    .maybeSingle()
  return adAccount ? ad : null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()
  const existing = await loadOwnedAd(admin, id, ctx.accountId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const update: Record<string, unknown> = {}
  for (const k of EDITABLE_FIELDS) {
    if (k in body) update[k] = body[k]
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin.from('ads').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const admin = supabaseAdmin()
  const existing = await loadOwnedAd(admin, id, ctx.accountId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('ads').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
