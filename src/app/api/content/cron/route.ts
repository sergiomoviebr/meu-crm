import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/content/admin-client'
import { attemptDuePost } from '@/lib/content/publish-engine'
import { logger } from '@/lib/logger'
import type { ContentPost } from '@/types'

/**
 * Drain due `content_posts` rows (status='scheduled' AND scheduled_at
 * <= now()). Meant to be hit on a schedule (Vercel Cron / external
 * pinger) — requires a shared secret via the `x-cron-secret` header to
 * match CONTENT_CRON_SECRET. Structurally a copy of
 * src/app/api/automations/cron/route.ts.
 *
 * The claim step (status = 'publishing') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort only;
 * see docs/adr/0003-background-jobs-polling-not-queue.md.
 */
export async function GET(request: Request) {
  const expected = process.env.CONTENT_CRON_SECRET
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
  const { data: due, error } = await admin
    .from('content_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (error) {
    logger.error('Due-post scan failed', { operation: 'content/cron', error })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('content_posts')
      .update({ status: 'publishing' })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await attemptDuePost(admin, row as unknown as ContentPost)
    processed++
  }

  return NextResponse.json({ processed })
}
