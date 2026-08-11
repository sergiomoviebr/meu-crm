import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateSummary } from '@/lib/ai/summarize'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/summarize  (agent+)
 *
 * Body: { conversation_id }
 * Returns: { summary } — a short bullet-point recap of the conversation
 * for an agent who's about to pick it up.
 *
 * Uses the account's configured provider/key (BYO), same as
 * /api/ai/draft. Read-only: never sends or stores anything on the
 * conversation itself — only a best-effort usage-log row for spend
 * tracking (see logAiUsage below). Mirrors draft/route.ts closely; the
 * two differ only in which generate* function they call and the rate
 * bucket.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-summary:${userId}`, RATE_LIMITS.aiSummary)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }

    // RLS scopes the SSR client to the caller's account, so a missing
    // row means "not yours / not found" either way.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/summarize] conversation lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[ai/summarize] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'AI assistant is not set up. Enable it in Settings → AI Assistant.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId)
    if (messages.length === 0) {
      return NextResponse.json(
        {
          error: 'No messages to summarize yet.',
          code: 'no_messages',
        },
        { status: 400 },
      )
    }

    const { summary, usage } = await generateSummary({ config, messages })

    // Best-effort spend logging — same reasoning as draft/route.ts:
    // must not fail or delay the summary the agent is waiting on.
    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'summary',
        provider: config.provider,
        model: config.model,
        usage,
      })
    } catch (logErr) {
      console.error('[ai/summarize] usage log skipped:', logErr)
    }

    return NextResponse.json({ summary })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
