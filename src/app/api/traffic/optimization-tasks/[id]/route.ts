import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { logOptimizationEvent } from '@/lib/traffic/log'

const EDITABLE_FIELDS = ['title', 'responsible', 'due_date', 'priority', 'status', 'notes'] as const

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
    .from('traffic_optimization_tasks')
    .select('id, contact_id, status, recommendation_id')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const update: Record<string, unknown> = {}
  for (const k of EDITABLE_FIELDS) {
    if (k in body) update[k] = body[k]
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin.from('traffic_optimization_tasks').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (typeof update.status === 'string' && update.status !== existing.status) {
    await logOptimizationEvent(admin, {
      accountId: ctx.accountId,
      contactId: existing.contact_id as string,
      taskId: id,
      recommendationId: existing.recommendation_id as string | null,
      event: 'status_changed',
      detail: `Tarefa -> ${update.status}`,
      actor: ctx.userId,
    })
  }

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
  const { error } = await admin
    .from('traffic_optimization_tasks')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
