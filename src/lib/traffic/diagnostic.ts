import type { SupabaseClient } from '@supabase/supabase-js'
import { AiError, type AiConfig, type AiUsage } from '@/lib/ai/types'
import { generateOpenAi } from '@/lib/ai/providers/openai'
import { generateAnthropic } from '@/lib/ai/providers/anthropic'
import { buildDiagnosticSystemPrompt, MAX_DIAGNOSTIC_OUTPUT_TOKENS, aiRequestTimeoutMs } from '@/lib/ai/defaults'
import { logAiUsage } from '@/lib/ai/usage'
import { logger } from '@/lib/logger'
import type { RecommendationCategory, RecommendationEntityType, RecommendationPriority } from '@/types'
import { gatherClientPerformanceContext, type ClientPerformanceContext } from './context'
import { logOptimizationEvent } from './log'

const VALID_ENTITY_TYPES: RecommendationEntityType[] = ['ad_account', 'campaign', 'ad_set', 'ad', 'landing_page', 'funnel']
const VALID_CATEGORIES: RecommendationCategory[] = ['creative_fatigue', 'landing_page', 'funnel', 'budget', 'alert']
const VALID_PRIORITIES: RecommendationPriority[] = ['critical', 'high', 'medium', 'low']

export interface AiDiagnosticRecommendation {
  entity_type: RecommendationEntityType
  /** A [ref:...] label copied from the prompt context, resolved back
   *  to a real UUID by runDiagnostic — never a UUID the model invented. */
  entity_id_ref: string | null
  category: RecommendationCategory
  priority: RecommendationPriority
  problem: string
  diagnosis: string
  recommended_action: string
  expected_impact: string | null
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Parse the model's raw text into validated recommendations. Strips a
 * defensive markdown code fence (Anthropic has no JSON mode and may
 * wrap output in ```json regardless of instructions), then JSON.parses
 * and validates shape. A malformed top-level payload throws (the run
 * failed outright, retryable); an individual item with a bad
 * enum/missing field is dropped and logged, not thrown — one bad
 * recommendation shouldn't fail the whole diagnostic run, mirroring
 * the publish-engine's per-item error philosophy.
 */
export function parseDiagnosticResponse(raw: string): AiDiagnosticRecommendation[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AiError('The AI returned a response that could not be parsed as JSON.', {
      code: 'invalid_diagnostic_json',
      status: 502,
    })
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { recommendations?: unknown }).recommendations)
      ? (parsed as { recommendations: unknown[] }).recommendations
      : null

  if (list == null) {
    throw new AiError('The AI response JSON did not contain a "recommendations" array.', {
      code: 'invalid_diagnostic_json',
      status: 502,
    })
  }

  const out: AiDiagnosticRecommendation[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (!VALID_ENTITY_TYPES.includes(r.entity_type as RecommendationEntityType)) continue
    if (!VALID_CATEGORIES.includes(r.category as RecommendationCategory)) continue
    if (!VALID_PRIORITIES.includes(r.priority as RecommendationPriority)) continue
    if (!isNonEmptyString(r.problem) || !isNonEmptyString(r.diagnosis) || !isNonEmptyString(r.recommended_action)) continue
    if (r.entity_id_ref != null && typeof r.entity_id_ref !== 'string') continue

    out.push({
      entity_type: r.entity_type as RecommendationEntityType,
      entity_id_ref: (r.entity_id_ref as string | null) ?? null,
      category: r.category as RecommendationCategory,
      priority: r.priority as RecommendationPriority,
      problem: r.problem as string,
      diagnosis: r.diagnosis as string,
      recommended_action: r.recommended_action as string,
      expected_impact: isNonEmptyString(r.expected_impact) ? (r.expected_impact as string) : null,
    })
  }
  return out
}

async function callDiagnosticModel(
  config: AiConfig,
  systemPrompt: string,
  contextText: string,
): Promise<{ text: string; usage: AiUsage | null }> {
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages: [{ role: 'user' as const, content: contextText }],
    timeoutMs: aiRequestTimeoutMs(),
    maxOutputTokens: MAX_DIAGNOSTIC_OUTPUT_TOKENS,
    // Only OpenAI has a native JSON mode — Anthropic relies on the
    // prompt instructions + parseDiagnosticResponse's fence-stripping.
    responseFormat: config.provider === 'openai' ? ('json_object' as const) : undefined,
  }
  switch (config.provider) {
    case 'openai':
      return generateOpenAi(providerArgs)
    case 'anthropic':
      return generateAnthropic(providerArgs)
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }
}

export interface RunDiagnosticResult {
  recommendationsCreated: number
  skipped: boolean
  skipReason?: string
}

/**
 * Run the Performance Copilot for one client: gather context, ask the
 * configured AI provider for structured recommendations, validate and
 * write them. Never throws for "nothing to analyze yet" (returns
 * skipped:true) — only throws for a genuine provider/parse failure,
 * which the caller (the API route) surfaces as an error response.
 */
export async function runDiagnostic(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; config: AiConfig },
): Promise<RunDiagnosticResult> {
  const context: ClientPerformanceContext = await gatherClientPerformanceContext(
    db,
    args.accountId,
    args.contactId,
  )

  if (!context.hasData) {
    return { recommendationsCreated: 0, skipped: true, skipReason: 'Sem métricas registradas para este cliente.' }
  }

  const systemPrompt = buildDiagnosticSystemPrompt({ businessContext: args.config.systemPrompt })
  const { text, usage } = await callDiagnosticModel(args.config, systemPrompt, context.contextText)
  const parsedRecommendations = parseDiagnosticResponse(text)

  await logAiUsage(db, {
    accountId: args.accountId,
    conversationId: null,
    mode: 'traffic_diagnostic',
    provider: args.config.provider,
    model: args.config.model,
    usage,
  })

  let created = 0
  for (const rec of parsedRecommendations) {
    const refEntry = rec.entity_id_ref ? context.entityRefMap.get(rec.entity_id_ref) : undefined
    if (rec.entity_id_ref && !refEntry) {
      logger.warn('Diagnostic recommendation referenced an unknown entity ref — dropped', {
        operation: 'traffic/diagnostic',
        accountId: args.accountId,
        contactId: args.contactId,
        ref: rec.entity_id_ref,
      })
      continue
    }

    const { data: inserted, error } = await db
      .from('traffic_recommendations')
      .insert({
        account_id: args.accountId,
        contact_id: args.contactId,
        entity_type: rec.entity_type,
        entity_id: refEntry?.entityId ?? null,
        category: rec.category,
        priority: rec.priority,
        problem: rec.problem,
        diagnosis: rec.diagnosis,
        recommended_action: rec.recommended_action,
        expected_impact: rec.expected_impact,
        ai_raw: rec as unknown as Record<string, unknown>,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      logger.error('Failed to write traffic recommendation', {
        operation: 'traffic/diagnostic',
        accountId: args.accountId,
        contactId: args.contactId,
        error,
      })
      continue
    }

    created++
    await logOptimizationEvent(db, {
      accountId: args.accountId,
      contactId: args.contactId,
      recommendationId: inserted.id as string,
      event: 'recommendation_created',
      detail: rec.problem,
    })
  }

  return { recommendationsCreated: created, skipped: false }
}
