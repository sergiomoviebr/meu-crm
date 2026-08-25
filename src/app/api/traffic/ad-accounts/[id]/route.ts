import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'

const EDITABLE_FIELDS = ['name', 'external_account_id', 'currency'] as const

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
  const { data: existing } = await admin
    .from('ad_accounts')
    .select('id, external_account_id, access_token_encrypted')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const update: Record<string, unknown> = {}
  for (const k of EDITABLE_FIELDS) {
    if (k in body) update[k] = body[k]
  }

  const hasNewToken = typeof body.access_token === 'string' && body.access_token.trim().length > 0
  if (hasNewToken) update.access_token_encrypted = encrypt(body.access_token)

  const externalAccountId = 'external_account_id' in update ? update.external_account_id : existing.external_account_id
  const hasToken = hasNewToken || !!existing.access_token_encrypted
  if ('external_account_id' in update || hasNewToken) {
    update.connection_status = externalAccountId && hasToken ? 'connected' : 'not_connected'
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin.from('ad_accounts').update(update).eq('id', id)
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
  const { error } = await admin.from('ad_accounts').delete().eq('id', id).eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
