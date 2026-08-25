import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import type { AdPlatform } from '@/types'

const PLATFORMS: AdPlatform[] = ['meta', 'google', 'other']

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { contact_id, platform, name, currency, external_account_id, access_token } = body
  if (!contact_id || typeof contact_id !== 'string') {
    return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  }
  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: `platform must be one of ${PLATFORMS.join(', ')}` }, { status: 400 })
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // The contact must belong to this account — a cross-account contact_id
  // would otherwise let an agent attach an ad account to a client they
  // don't manage (the insert bypasses RLS via the service-role client).
  const { data: contact } = await admin
    .from('contacts')
    .select('id')
    .eq('id', contact_id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const hasToken = typeof access_token === 'string' && access_token.trim().length > 0
  const { data: adAccount, error } = await admin
    .from('ad_accounts')
    .insert({
      account_id: ctx.accountId,
      contact_id,
      user_id: ctx.userId,
      platform,
      name,
      currency: currency || 'BRL',
      external_account_id: external_account_id || null,
      access_token_encrypted: hasToken ? encrypt(access_token) : null,
      connection_status: hasToken && external_account_id ? 'connected' : 'not_connected',
    })
    .select('id, account_id, contact_id, user_id, platform, name, connection_status, external_account_id, currency, metadata, created_at, updated_at')
    .single()

  if (error || !adAccount) {
    const message = error?.message?.includes('duplicate key')
      ? 'This client already has an ad account with that platform and name.'
      : (error?.message ?? 'insert failed')
    return NextResponse.json({ error: message }, { status: error ? 400 : 500 })
  }

  return NextResponse.json({ ad_account: adAccount }, { status: 201 })
}
