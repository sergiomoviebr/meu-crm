import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Append-only timeline writer for `traffic_optimization_log` (spec
 * section 18 — "12/08 IA identificou fadiga criativa. 13/08 Novo
 * criativo criado..."). Best-effort: a logging failure must never
 * fail the caller's actual write (recommendation/task creation or
 * status change), so errors are swallowed here, matching the
 * `logAiUsage`/`ai_usage_log` precedent in src/lib/ai/usage.ts.
 */
export async function logOptimizationEvent(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    taskId?: string | null
    recommendationId?: string | null
    event: string
    detail?: string | null
    actor?: string | null
  },
): Promise<void> {
  try {
    await db.from('traffic_optimization_log').insert({
      account_id: args.accountId,
      contact_id: args.contactId,
      task_id: args.taskId ?? null,
      recommendation_id: args.recommendationId ?? null,
      event: args.event,
      detail: args.detail ?? null,
      actor: args.actor ?? null,
    })
  } catch {
    // Best-effort — see doc comment above.
  }
}
