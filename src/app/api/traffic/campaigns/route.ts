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

  const { ad_account_id, name, objective, status, budget, budget_type, currency, start_date, end_date } = body
  if (!ad_account_id || typeof ad_account_id !== 'string') {
    return NextResponse.json({ error: 'ad_account_id is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: adAccount } = await admin
    .from('ad_accounts')
    .select('id, currency')
    .eq('id', ad_account_id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!adAccount) return NextResponse.json({ error: 'Ad account not found' }, { status: 404 })

  const { data: campaign, error } = await admin
    .from('ad_campaigns')
    .insert({
      ad_account_id,
      name,
      objective: objective || null,
      status: status || 'active',
      budget: budget ?? null,
      budget_type: budget_type || null,
      currency: currency || adAccount.currency,
      start_date: start_date || null,
      end_date: end_date || null,
    })
    .select()
    .single()

  if (error || !campaign) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  return NextResponse.json({ campaign }, { status: 201 })
}
