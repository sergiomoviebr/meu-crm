import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { logOptimizationEvent } from '@/lib/traffic/log'

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { contact_id, recommendation_id, title, responsible, due_date, priority, notes } = body
  if (!contact_id || typeof contact_id !== 'string') {
    return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  }
  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: contact } = await admin
    .from('contacts')
    .select('id')
    .eq('id', contact_id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const { data: task, error } = await admin
    .from('traffic_optimization_tasks')
    .insert({
      account_id: ctx.accountId,
      contact_id,
      recommendation_id: recommendation_id || null,
      title,
      responsible: responsible || null,
      due_date: due_date || null,
      priority: priority || 'medium',
      notes: notes || null,
    })
    .select()
    .single()

  if (error || !task) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })

  await logOptimizationEvent(admin, {
    accountId: ctx.accountId,
    contactId: contact_id,
    taskId: task.id as string,
    recommendationId: recommendation_id || null,
    event: 'task_created',
    detail: title,
    actor: ctx.userId,
  })

  return NextResponse.json({ task }, { status: 201 })
}
