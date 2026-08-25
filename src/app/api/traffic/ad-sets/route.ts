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

  const { campaign_id, name, targeting_summary, budget, status } = body
  if (!campaign_id || typeof campaign_id !== 'string') {
    return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: campaign } = await admin.from('ad_campaigns').select('id, ad_account_id').eq('id', campaign_id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  const { data: adAccount } = await admin
    .from('ad_accounts')
    .select('id')
    .eq('id', campaign.ad_account_id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!adAccount) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: adSet, error } = await admin
    .from('ad_sets')
    .insert({
      campaign_id,
      name,
      targeting_summary: targeting_summary || null,
      budget: budget ?? null,
      status: status || 'active',
    })
    .select()
    .single()

  if (error || !adSet) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  return NextResponse.json({ ad_set: adSet }, { status: 201 })
}
