import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/whatsapp-personal/admin-client'
import { disconnectConnection } from '@/lib/whatsapp-personal/connection-manager'

async function parseConnectionId(request?: Request): Promise<string | null> {
  if (!request) return null
  const body = await request.json().catch(() => null)
  return typeof body?.connectionId === 'string' ? body.connectionId : null
}

export async function POST(request?: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const connectionId = await parseConnectionId(request)
  if (!connectionId) return NextResponse.json({ error: 'connectionId é obrigatório.' }, { status: 400 })

  const { data: owned } = await supabaseAdmin()
    .from('whatsapp_personal_sessions')
    .select('id')
    .eq('id', connectionId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 })

  await disconnectConnection(ctx.accountId, connectionId)
  return NextResponse.json({ id: connectionId, status: 'disconnected' })
}

export async function DELETE(request?: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const connectionId = await parseConnectionId(request)
  if (!connectionId) return NextResponse.json({ error: 'connectionId é obrigatório.' }, { status: 400 })

  const admin = supabaseAdmin()
  const { count } = await admin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('whatsapp_personal_session_id', connectionId)
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Esta conexão possui conversas. Desconecte-a para preservar o histórico.' },
      { status: 409 },
    )
  }

  const { data: row } = await admin
    .from('whatsapp_personal_sessions')
    .select('id, is_default')
    .eq('id', connectionId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 })

  await disconnectConnection(ctx.accountId, connectionId)
  const { error } = await admin
    .from('whatsapp_personal_sessions')
    .delete()
    .eq('id', connectionId)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (row.is_default) {
    const { data: next } = await admin
      .from('whatsapp_personal_sessions')
      .select('id')
      .eq('account_id', ctx.accountId)
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (next) await admin.from('whatsapp_personal_sessions').update({ is_default: true }).eq('id', next.id)
  }

  return NextResponse.json({ success: true })
}
