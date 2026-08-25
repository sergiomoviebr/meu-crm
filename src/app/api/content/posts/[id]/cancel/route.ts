import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/content/admin-client'
import { transitionPost } from '@/lib/content/posts'

/** Any non-terminal status -> cancelled. */
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

  const result = await transitionPost(supabaseAdmin(), {
    id,
    accountId: ctx.accountId,
    action: 'cancel',
    toStatus: 'cancelled',
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
  return NextResponse.json({ post: result.post })
}
