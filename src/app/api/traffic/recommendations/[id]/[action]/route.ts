import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { transitionRecommendation, RECOMMENDATION_TRANSITIONS } from '@/lib/traffic/recommendations'

/**
 * Workflow actions on a recommendation: review | approve | start |
 * complete | dismiss (see src/lib/traffic/recommendations.ts's
 * RECOMMENDATION_TRANSITIONS). "approve" needs admin — same tier as
 * Content's canApproveContent; every other action only needs agent.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params

  if (!(action in RECOMMENDATION_TRANSITIONS)) {
    return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 })
  }

  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole(action === 'approve' ? 'admin' : 'agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const result = await transitionRecommendation(supabaseAdmin(), {
    id,
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    action: action as keyof typeof RECOMMENDATION_TRANSITIONS,
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
  return NextResponse.json({ recommendation: result.recommendation })
}
