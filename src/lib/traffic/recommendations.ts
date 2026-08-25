import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecommendationStatus } from '@/types'
import { logOptimizationEvent } from './log'

/**
 * Allowed source statuses per workflow action. Loose rather than a
 * strict single-predecessor state machine — same rationale as
 * src/lib/content/posts.ts's TRANSITIONS: a team might approve a
 * recommendation straight from "new" without a separate review step,
 * or dismiss it from anywhere non-terminal.
 */
export const RECOMMENDATION_TRANSITIONS: Record<string, RecommendationStatus[]> = {
  review: ['new'],
  approve: ['new', 'in_review'],
  start: ['approved', 'in_review'],
  complete: ['in_progress', 'approved'],
  dismiss: ['new', 'in_review', 'approved', 'in_progress'],
}

const ACTION_TARGET_STATUS: Record<keyof typeof RECOMMENDATION_TRANSITIONS, RecommendationStatus> = {
  review: 'in_review',
  approve: 'approved',
  start: 'in_progress',
  complete: 'done',
  dismiss: 'dismissed',
}

export interface TransitionResult {
  recommendation?: Record<string, unknown>
  error?: string
  status?: number
}

export async function transitionRecommendation(
  admin: SupabaseClient,
  args: {
    id: string
    accountId: string
    actorUserId: string
    action: keyof typeof RECOMMENDATION_TRANSITIONS
  },
): Promise<TransitionResult> {
  const { data: existing } = await admin
    .from('traffic_recommendations')
    .select('id, status, contact_id')
    .eq('id', args.id)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (!existing) return { error: 'Not found', status: 404 }

  const allowed = RECOMMENDATION_TRANSITIONS[args.action]
  if (!allowed.includes(existing.status as RecommendationStatus)) {
    return {
      error: `Cannot ${args.action} a recommendation with status '${existing.status}'`,
      status: 400,
    }
  }

  const toStatus = ACTION_TARGET_STATUS[args.action]
  const { data: recommendation, error } = await admin
    .from('traffic_recommendations')
    .update({ status: toStatus })
    .eq('id', args.id)
    .select()
    .single()
  if (error || !recommendation) return { error: error?.message ?? 'update failed', status: 500 }

  await logOptimizationEvent(admin, {
    accountId: args.accountId,
    contactId: existing.contact_id as string,
    recommendationId: args.id,
    event: 'status_changed',
    detail: `Recomendação -> ${toStatus}`,
    actor: args.actorUserId,
  })

  return { recommendation: recommendation as Record<string, unknown> }
}
