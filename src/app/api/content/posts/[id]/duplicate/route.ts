import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/content/admin-client'

export async function POST(
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
  const { data: original, error: origErr } = await admin
    .from('content_posts')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (origErr) return NextResponse.json({ error: origErr.message }, { status: 500 })
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: copy, error: copyErr } = await admin
    .from('content_posts')
    .insert({
      account_id: original.account_id,
      contact_id: original.contact_id,
      created_by: ctx.userId,
      content_type: original.content_type,
      caption: original.caption,
      hashtags: original.hashtags,
      media: original.media,
      link_url: original.link_url,
      cta: original.cta,
      status: 'draft',
    })
    .select()
    .single()
  if (copyErr || !copy) {
    return NextResponse.json({ error: copyErr?.message ?? 'copy failed' }, { status: 500 })
  }

  const { data: targets } = await admin
    .from('content_post_targets')
    .select('social_profile_id')
    .eq('post_id', id)

  if (targets && targets.length > 0) {
    const rows = targets.map((t) => ({ post_id: copy.id, social_profile_id: t.social_profile_id }))
    const { error: insErr } = await admin.from('content_post_targets').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ post: copy }, { status: 201 })
}
