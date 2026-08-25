import type { Deal, PipelineStage } from '@/types'

// ============================================================
// Deterministic signal computation for the Traffic & Performance
// module. Pure functions only — no Supabase client, no AI call. This
// is the layer the AI diagnostic engine (src/lib/traffic/diagnostic.ts)
// narrates over: rules compute the numbers, the LLM only explains and
// prioritizes what these functions already decided. Keeping threshold
// math here (not in a prompt) makes classification deterministic,
// cheap, and unit-testable, instead of asking a model to compute
// percentages itself.
// ============================================================

export interface MetricPoint {
  date: string
  impressions: number
  reach: number
  clicks: number
  spend: number
  leads: number
  conversions: number
  revenue: number
  visits: number
}

export interface WindowAggregate {
  impressions: number
  reach: number
  clicks: number
  spend: number
  leads: number
  conversions: number
  revenue: number
  visits: number
  /** impressions / reach — how many times the average person saw the ad. */
  frequency: number | null
  ctr: number | null
  cpc: number | null
  cpm: number | null
  cpl: number | null
  cpa: number | null
  roas: number | null
}

function sumBy(points: MetricPoint[], key: keyof MetricPoint): number {
  return points.reduce((acc, p) => acc + (typeof p[key] === 'number' ? (p[key] as number) : 0), 0)
}

/** Returns null instead of Infinity/NaN when the denominator is 0 —
 *  callers treat null as "not enough data" rather than a real ratio. */
function safeDiv(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

export function aggregateMetrics(points: MetricPoint[]): WindowAggregate {
  const impressions = sumBy(points, 'impressions')
  const reach = sumBy(points, 'reach')
  const clicks = sumBy(points, 'clicks')
  const spend = sumBy(points, 'spend')
  const leads = sumBy(points, 'leads')
  const conversions = sumBy(points, 'conversions')
  const revenue = sumBy(points, 'revenue')
  const visits = sumBy(points, 'visits')

  return {
    impressions,
    reach,
    clicks,
    spend,
    leads,
    conversions,
    revenue,
    visits,
    frequency: safeDiv(impressions, reach),
    ctr: safeDiv(clicks, impressions),
    cpc: safeDiv(spend, clicks),
    cpm: safeDiv(spend, impressions) != null ? (spend / impressions) * 1000 : null,
    cpl: safeDiv(spend, leads),
    cpa: safeDiv(spend, conversions),
    roas: safeDiv(revenue, spend),
  }
}

/** Percent change from `from` to `to`. Null when there's no baseline
 *  to compare against (from is 0 or null) — "no prior data" is not
 *  the same as "0% change" and must not be reported as one. */
export function pctChange(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from === 0) return null
  return ((to - from) / from) * 100
}

export interface TrendResult {
  current: WindowAggregate
  prior: WindowAggregate
  ctrChangePct: number | null
  cpmChangePct: number | null
  cplChangePct: number | null
  cpaChangePct: number | null
  spendChangePct: number | null
}

/** Compares a current window of metrics against a prior window
 *  (caller picks the windows — prior 7d, prior 30d, best historical
 *  window, etc. — this function just diffs two already-selected
 *  slices, so it composes for any comparison the diagnostic engine
 *  needs). */
export function computeTrend(current: MetricPoint[], priorWindow: MetricPoint[]): TrendResult {
  const currentAgg = aggregateMetrics(current)
  const priorAgg = aggregateMetrics(priorWindow)
  return {
    current: currentAgg,
    prior: priorAgg,
    ctrChangePct: pctChange(priorAgg.ctr, currentAgg.ctr),
    cpmChangePct: pctChange(priorAgg.cpm, currentAgg.cpm),
    cplChangePct: pctChange(priorAgg.cpl, currentAgg.cpl),
    cpaChangePct: pctChange(priorAgg.cpa, currentAgg.cpa),
    spendChangePct: pctChange(priorAgg.spend, currentAgg.spend),
  }
}

// ------------------------------------------------------------
// Creative fatigue radar (spec section 7)
// ------------------------------------------------------------

export type FatigueLevel = 'healthy' | 'monitor' | 'test' | 'replace'

export interface FatigueScore {
  level: FatigueLevel
  daysActive: number | null
  ctrDropPct: number | null
  frequency: number | null
  reasons: string[]
}

// Named, tunable thresholds — every branch below reads as a sentence
// against these, and each is independently assertable in tests.
const FATIGUE_CTR_DROP_MONITOR_PCT = 15
const FATIGUE_CTR_DROP_TEST_PCT = 25
const FATIGUE_CTR_DROP_REPLACE_PCT = 40
const FATIGUE_MIN_DAYS_FOR_TEST = 14
const FATIGUE_MIN_DAYS_FOR_REPLACE = 21
const FATIGUE_HIGH_FREQUENCY = 4

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Deterministic 🟢/🟡/🟠/🔴 classification from CTR decline + days
 * active + frequency — NOT an AI judgment call. The diagnostic engine
 * includes this pre-computed score as a fact in the AI's context; the
 * model's job is to explain it, never to invent its own score.
 */
export function computeCreativeFatigueScore(
  ad: { launchedAt: string | null },
  trend: TrendResult,
  now: Date = new Date(),
): FatigueScore {
  const daysActive = ad.launchedAt ? daysBetween(new Date(ad.launchedAt), now) : null
  const ctrChangePct = trend.ctrChangePct
  const ctrDropPct = ctrChangePct != null && ctrChangePct < 0 ? Math.abs(ctrChangePct) : null
  const frequency = trend.current.frequency

  const reasons: string[] = []
  const drop = ctrDropPct ?? 0
  const days = daysActive ?? 0

  let level: FatigueLevel = 'healthy'

  if (drop >= FATIGUE_CTR_DROP_REPLACE_PCT && days >= FATIGUE_MIN_DAYS_FOR_REPLACE) {
    level = 'replace'
    reasons.push(`CTR caiu ${drop.toFixed(0)}% e o criativo está ativo há ${days} dias`)
  } else if (drop >= FATIGUE_CTR_DROP_TEST_PCT && days >= FATIGUE_MIN_DAYS_FOR_TEST) {
    level = 'test'
    reasons.push(`CTR caiu ${drop.toFixed(0)}% nos últimos ${days} dias de veiculação`)
  } else if (drop >= FATIGUE_CTR_DROP_MONITOR_PCT) {
    level = 'monitor'
    reasons.push(`CTR caiu ${drop.toFixed(0)}% — abaixo do limite de atenção`)
  }

  if (frequency != null && frequency >= FATIGUE_HIGH_FREQUENCY) {
    reasons.push(`Frequência elevada (${frequency.toFixed(1)}x)`)
    const order: FatigueLevel[] = ['healthy', 'monitor', 'test', 'replace']
    const nextIndex = Math.min(order.indexOf(level) + 1, order.length - 1)
    level = order[nextIndex]
  }

  if (ctrDropPct == null && daysActive == null) {
    reasons.push('Dados insuficientes para uma avaliação completa')
  }

  return { level, daysActive, ctrDropPct, frequency, reasons }
}

// ------------------------------------------------------------
// Commercial funnel conversion (spec section 9) — reuses the
// existing deals/pipeline_stages model, does not introduce a
// parallel funnel entity.
// ------------------------------------------------------------

export interface FunnelStageConversion {
  stageId: string
  stageName: string
  position: number
  /** Deals currently at or past this stage (status != 'lost'). A
   *  snapshot count, not a historical cohort — deals don't carry a
   *  stage-history row in this schema, so stage-to-stage conversion
   *  is approximated from where deals sit today. Documented
   *  simplification, not a bug. */
  dealsAtOrPastStage: number
  /** Percentage of the previous stage's count that reached this
   *  stage. Null for the first stage (no previous to compare to). */
  conversionFromPreviousPct: number | null
}

export function computeFunnelConversionRates(
  stages: PipelineStage[],
  deals: Deal[],
): FunnelStageConversion[] {
  const sortedStages = [...stages].sort((a, b) => a.position - b.position)
  const activeDeals = deals.filter((d) => d.status !== 'lost')

  const counts = sortedStages.map((stage) => {
    const atOrPast = activeDeals.filter((d) => {
      const dealStage = sortedStages.find((s) => s.id === d.stage_id)
      return dealStage ? dealStage.position >= stage.position : false
    }).length
    return { stage, atOrPast }
  })

  return counts.map(({ stage, atOrPast }, i) => ({
    stageId: stage.id,
    stageName: stage.name,
    position: stage.position,
    dealsAtOrPastStage: atOrPast,
    conversionFromPreviousPct: i === 0 ? null : pctOf(atOrPast, counts[i - 1].atOrPast),
  }))
}

function pctOf(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null
}

// ------------------------------------------------------------
// Landing page signal (spec section 8)
// ------------------------------------------------------------

export interface LandingPageSignal {
  visits: number
  leads: number
  conversionRatePct: number | null
  conversionRateChangePct: number | null
}

export function computeLandingPageSignal(
  current: MetricPoint[],
  priorWindow: MetricPoint[],
): LandingPageSignal {
  const currentAgg = aggregateMetrics(current)
  const priorAgg = aggregateMetrics(priorWindow)
  const currentRate = pctOf(currentAgg.leads, currentAgg.visits)
  const priorRate = pctOf(priorAgg.leads, priorAgg.visits)
  return {
    visits: currentAgg.visits,
    leads: currentAgg.leads,
    conversionRatePct: currentRate,
    conversionRateChangePct: pctChange(priorRate, currentRate),
  }
}
