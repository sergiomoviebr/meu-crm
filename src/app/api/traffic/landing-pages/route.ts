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

  const { contact_id, name, url, notes } = body
  if (!contact_id || typeof contact_id !== 'string') {
    return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: contact } = await admin
    .from('contacts')
    .select('id')
    .eq('id', contact_id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const { data: landingPage, error } = await admin
    .from('landing_pages')
    .insert({ account_id: ctx.accountId, contact_id, name, url, notes: notes || null })
    .select()
    .single()

  if (error || !landingPage) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  return NextResponse.json({ landing_page: landingPage }, { status: 201 })
}
