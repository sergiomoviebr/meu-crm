import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/content/admin-client'

const LOCKED_STATUSES = new Set(['publishing', 'published', 'cancelled'])
const EDITABLE_FIELDS = ['caption', 'hashtags', 'media', 'link_url', 'cta', 'content_type'] as const

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
    .from('content_posts')
    .select('id, account_id, status')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (LOCKED_STATUSES.has(existing.status as string)) {
    return NextResponse.json(
      { error: `Cannot edit a post with status '${existing.status}'` },
      { status: 400 },
    )
  }

  const update: Record<string, unknown> = {}
  for (const k of EDITABLE_FIELDS) {
    if (k in body) update[k] = body[k]
  }

  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('content_posts').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (Array.isArray(body.social_profile_ids)) {
    const { error: delErr } = await admin.from('content_post_targets').delete().eq('post_id', id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    const rows = (body.social_profile_ids as string[]).map((social_profile_id) => ({
      post_id: id,
      social_profile_id,
    }))
    if (rows.length > 0) {
      const { error: insErr } = await admin.from('content_post_targets').insert(rows)
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
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
    .from('content_posts')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
