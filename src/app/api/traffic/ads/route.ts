import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { ad_set_id, name, headline, body: adBody, media_url, thumbnail_url, cta, landing_page_id, status, launched_at } = body
  if (!ad_set_id || typeof ad_set_id !== 'string') {
    return NextResponse.json({ error: 'ad_set_id is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: adSet } = await admin.from('ad_sets').select('id, campaign_id').eq('id', ad_set_id).maybeSingle()
  if (!adSet) return NextResponse.json({ error: 'Ad set not found' }, { status: 404 })
  const { data: campaign } = await admin.from('ad_campaigns').select('id, ad_account_id').eq('id', adSet.campaign_id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Ad set not found' }, { status: 404 })
  const { data: adAccount } = await admin
    .from('ad_accounts')
    .select('id')
    .eq('id', campaign.ad_account_id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!adAccount) return NextResponse.json({ error: 'Ad set not found' }, { status: 404 })

  if (landing_page_id) {
    const { data: lp } = await admin
      .from('landing_pages')
      .select('id')
      .eq('id', landing_page_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!lp) return NextResponse.json({ error: 'Landing page not found' }, { status: 404 })
  }

  const { data: ad, error } = await admin
    .from('ads')
    .insert({
      ad_set_id,
      name,
      headline: headline || null,
      body: adBody || null,
      media_url: media_url || null,
      thumbnail_url: thumbnail_url || null,
      cta: cta || null,
      landing_page_id: landing_page_id || null,
      status: status || 'active',
      launched_at: launched_at || null,
    })
    .select()
    .single()

  if (error || !ad) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  return NextResponse.json({ ad }, { status: 201 })
}
