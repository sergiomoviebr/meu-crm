import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { runDiagnostic } from '@/lib/traffic/diagnostic'
import { logger } from '@/lib/logger'

/**
 * Drain accounts with recently-updated metrics and run the Performance
 * Copilot for each of their clients. Structural copy of
 * src/app/api/content/cron/route.ts — shared secret via
 * x-cron-secret + timingSafeEqual, ships disabled (no error, just
 * inert) until TRAFFIC_CRON_SECRET is configured and an external
 * pinger is wired up. The on-demand POST /api/traffic/diagnostics/run
 * route is the primary trigger for Phase 1; this is the "continuous
 * monitoring" path for later.
 */
export async function GET(request: Request) {
  const expected = process.env.TRAFFIC_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const since = new Date()
  since.setDate(since.getDate() - 1)

  const { data: recentMetrics, error } = await admin
    .from('traffic_metrics_daily')
    .select('account_id')
    .gte('created_at', since.toISOString())
    .limit(500)

  if (error) {
    logger.error('Traffic cron scan failed', { operation: 'traffic/cron', error })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const accountIds = [...new Set((recentMetrics ?? []).map((r) => r.account_id as string))]
  if (accountIds.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const accountId of accountIds) {
    const config = await loadAiConfig(admin, accountId)
    if (!config) continue // no AI key configured for this account — skip silently

    const [{ data: adAccounts }, { data: landingPages }] = await Promise.all([
      admin.from('ad_accounts').select('contact_id').eq('account_id', accountId),
      admin.from('landing_pages').select('contact_id').eq('account_id', accountId),
    ])
    const contactIds = [
      ...new Set([...(adAccounts ?? []).map((r) => r.contact_id), ...(landingPages ?? []).map((r) => r.contact_id)]),
    ]

    for (const contactId of contactIds) {
      try {
        await runDiagnostic(admin, { accountId, contactId, config })
        processed++
      } catch (err) {
        logger.error('Traffic cron diagnostic failed for client', {
          operation: 'traffic/cron',
          accountId,
          contactId,
          error: err,
        })
      }
    }
  }

  return NextResponse.json({ processed })
}
