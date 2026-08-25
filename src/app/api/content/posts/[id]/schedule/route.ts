import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/content/admin-client'
import { transitionPost } from '@/lib/content/posts'

/** draft|pending_approval|approved -> scheduled, body { scheduled_at }. */
export async function POST(
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
  const scheduledAt = body?.scheduled_at
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json({ error: 'scheduled_at must be a valid ISO date string' }, { status: 400 })
  }
  if (Date.parse(scheduledAt) <= Date.now()) {
    return NextResponse.json({ error: 'scheduled_at must be in the future' }, { status: 400 })
  }

  const result = await transitionPost(supabaseAdmin(), {
    id,
    accountId: ctx.accountId,
    action: 'schedule',
    toStatus: 'scheduled',
    extra: { scheduled_at: scheduledAt },
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
  return NextResponse.json({ post: result.post })
}
