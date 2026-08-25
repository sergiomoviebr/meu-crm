import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { runDiagnostic } from '@/lib/traffic/diagnostic'
import { logger } from '@/lib/logger'

const LOOKBACK_DAYS = 30

/**
 * Run the Performance Copilot on demand — the primary trigger for
 * Phase 1 (see docs/adr/0003-background-jobs-polling-not-queue.md's
 * philosophy: no queue, synchronous work in the request that asks for
 * it). Body `{ contact_id }` runs one client; `{}` runs every client
 * of this account that has metrics in the last 30 days.
 */
export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => ({}))
  const contactId = typeof body?.contact_id === 'string' ? body.contact_id : null

  const admin = supabaseAdmin()
  const config = await loadAiConfig(admin, ctx.accountId)
  if (!config) {
    return NextResponse.json(
      { error: 'Configure a chave de IA em Configurações → Assistente de IA antes de rodar o diagnóstico.' },
      { status: 422 },
    )
  }

  let contactIds: string[]
  if (contactId) {
    const { data: contact } = await admin
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!contact) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    contactIds = [contactId]
  } else {
    const since = new Date()
    since.setDate(since.getDate() - LOOKBACK_DAYS)
    const { data: rows } = await admin
      .from('traffic_metrics_daily')
      .select('account_id')
      .eq('account_id', ctx.accountId)
      .gte('date', since.toISOString().slice(0, 10))
    if (!rows || rows.length === 0) {
      return NextResponse.json({ processed: 0, recommendationsCreated: 0 })
    }
    // traffic_metrics_daily doesn't carry contact_id directly (it's
    // polymorphic on entity_type/entity_id) — the set of contacts to
    // diagnose account-wide comes from ad_accounts + landing_pages
    // instead, which do carry contact_id.
    const [{ data: adAccounts }, { data: landingPages }] = await Promise.all([
      admin.from('ad_accounts').select('contact_id').eq('account_id', ctx.accountId),
      admin.from('landing_pages').select('contact_id').eq('account_id', ctx.accountId),
    ])
    contactIds = [
      ...new Set([...(adAccounts ?? []).map((r) => r.contact_id), ...(landingPages ?? []).map((r) => r.contact_id)]),
    ]
  }

  let processed = 0
  let recommendationsCreated = 0
  for (const id of contactIds) {
    try {
      const result = await runDiagnostic(admin, { accountId: ctx.accountId, contactId: id, config })
      processed++
      recommendationsCreated += result.recommendationsCreated
    } catch (err) {
      logger.error('Diagnostic run failed for client', {
        operation: 'traffic/diagnostics/run',
        accountId: ctx.accountId,
        contactId: id,
        error: err,
      })
      // One client's provider/parse failure shouldn't abort the rest
      // of an account-wide run; a single-client run (contactId set)
      // still surfaces the error via the loop having length 1.
      if (contactId) {
        const message = err instanceof Error ? err.message : 'Diagnostic run failed'
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }
  }

  return NextResponse.json({ processed, recommendationsCreated })
}
