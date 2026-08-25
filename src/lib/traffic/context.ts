import type { SupabaseClient } from '@supabase/supabase-js'
import type { Deal, PipelineStage, RecommendationEntityType } from '@/types'
import {
  aggregateMetrics,
  computeCreativeFatigueScore,
  computeFunnelConversionRates,
  computeLandingPageSignal,
  computeTrend,
  type FatigueScore,
  type MetricPoint,
  type TrendResult,
} from './signals'

// ============================================================
// Context gathering for the AI diagnostic engine. Structurally
// mirrors src/lib/ai/knowledge.ts's retrieveKnowledge(): fetch the
// relevant slice of account data, format it as a bounded labeled text
// block, degrade gracefully to "insufficient data" rather than
// throwing when a client has little/no history yet.
// ============================================================

const RECENT_WINDOW_DAYS = 7
const LOOKBACK_DAYS = 30
/** Hard cap on the prompt's context text so a client with a long
 *  metrics history never blows past a sane token budget. */
const MAX_CONTEXT_CHARS = 14_000

export interface RefEntry {
  entityType: RecommendationEntityType
  entityId: string | null
}

export interface ClientPerformanceContext {
  contextText: string
  /** Label (e.g. "ad_3") -> real entity, as given to the model in the
   *  prompt. The diagnostic parser maps entity_id_ref back through
   *  this table; a ref the model didn't copy from here is dropped. */
  entityRefMap: Map<string, RefEntry>
  /** True when there is at least one ad/campaign/landing-page with
   *  metrics in the lookback window — callers skip the AI call
   *  entirely (rather than pay for an "insufficient data" response)
   *  when this is false. */
  hasData: boolean
}

interface RawAdRow {
  id: string
  name: string
  ad_set_id: string
  launched_at: string | null
  status: string
}

function daysAgoIso(days: number, from: Date): string {
  const d = new Date(from)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function splitWindows(rows: MetricPoint[], now: Date): { current: MetricPoint[]; prior: MetricPoint[] } {
  const currentStart = daysAgoIso(RECENT_WINDOW_DAYS, now)
  const priorStart = daysAgoIso(RECENT_WINDOW_DAYS * 2, now)
  const current = rows.filter((r) => r.date >= currentStart)
  const prior = rows.filter((r) => r.date >= priorStart && r.date < currentStart)
  return { current, prior }
}

function fmtPct(v: number | null): string {
  if (v == null) return 'sem dado anterior'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

function fmtMoney(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const FATIGUE_EMOJI: Record<FatigueScore['level'], string> = {
  healthy: '🟢',
  monitor: '🟡',
  test: '🟠',
  replace: '🔴',
}

class RefAllocator {
  private map = new Map<string, RefEntry>()
  private counters: Partial<Record<RecommendationEntityType, number>> = {}

  alloc(entityType: RecommendationEntityType, entityId: string | null): string {
    if (entityType === 'funnel') {
      this.map.set('funnel', { entityType, entityId: null })
      return 'funnel'
    }
    const n = (this.counters[entityType] ?? 0) + 1
    this.counters[entityType] = n
    const ref = `${entityType}_${n}`
    this.map.set(ref, { entityType, entityId })
    return ref
  }

  get entries(): Map<string, RefEntry> {
    return this.map
  }
}

async function fetchMetrics(
  db: SupabaseClient,
  entityType: string,
  entityIds: string[],
  now: Date,
): Promise<Map<string, MetricPoint[]>> {
  const byEntity = new Map<string, MetricPoint[]>()
  if (entityIds.length === 0) return byEntity

  const since = daysAgoIso(LOOKBACK_DAYS, now)
  const { data } = await db
    .from('traffic_metrics_daily')
    .select('entity_id, date, impressions, reach, clicks, spend, leads, conversions, revenue, visits')
    .eq('entity_type', entityType)
    .in('entity_id', entityIds)
    .gte('date', since)

  for (const row of (data ?? []) as (MetricPoint & { entity_id: string })[]) {
    const list = byEntity.get(row.entity_id) ?? []
    list.push(row)
    byEntity.set(row.entity_id, list)
  }
  return byEntity
}

/**
 * Fetch and format one client's ad/creative/landing-page/funnel data
 * for the diagnostic prompt. Never throws — a query failure or empty
 * account degrades to a context that says so, so a client with no
 * data yet just produces zero recommendations rather than an error.
 */
export async function gatherClientPerformanceContext(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  now: Date = new Date(),
): Promise<ClientPerformanceContext> {
  const refs = new RefAllocator()
  const sections: string[] = []
  let hasData = false

  try {
    const { data: adAccounts } = await db
      .from('ad_accounts')
      .select('id, name, platform')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)

    const accounts = (adAccounts ?? []) as { id: string; name: string; platform: string }[]

    if (accounts.length > 0) {
      const { data: campaignRows } = await db
        .from('ad_campaigns')
        .select('id, name, status, budget, ad_account_id')
        .in('ad_account_id', accounts.map((a) => a.id))
      const campaigns = (campaignRows ?? []) as { id: string; name: string; status: string; budget: number | null; ad_account_id: string }[]

      const campaignMetrics = await fetchMetrics(db, 'campaign', campaigns.map((c) => c.id), now)

      const { data: adSetRows } = await db
        .from('ad_sets')
        .select('id, name, campaign_id')
        .in('campaign_id', campaigns.map((c) => c.id))
      const adSets = (adSetRows ?? []) as { id: string; name: string; campaign_id: string }[]

      const { data: adRows } = await db
        .from('ads')
        .select('id, name, ad_set_id, launched_at, status')
        .in('ad_set_id', adSets.map((s) => s.id))
      const ads = (adRows ?? []) as RawAdRow[]

      const adMetrics = await fetchMetrics(db, 'ad', ads.map((a) => a.id), now)

      if (campaigns.length > 0) {
        const campaignLines: string[] = []
        for (const campaign of campaigns) {
          const rows = campaignMetrics.get(campaign.id) ?? []
          if (rows.length === 0) continue
          hasData = true
          const { current, prior } = splitWindows(rows, now)
          const trend: TrendResult = computeTrend(current, prior)
          const ref = refs.alloc('campaign', campaign.id)
          campaignLines.push(
            `- [ref:${ref}] "${campaign.name}" (${campaign.status}) — gasto 7d: R$ ${fmtMoney(trend.current.spend)}, ` +
              `CTR ${fmtPct(trend.ctrChangePct)}, CPM ${fmtPct(trend.cpmChangePct)}, ` +
              `CPL ${fmtPct(trend.cplChangePct)}, CPA ${fmtPct(trend.cpaChangePct)}, ` +
              `leads 7d: ${trend.current.leads}, conversões 7d: ${trend.current.conversions}`,
          )
        }
        if (campaignLines.length > 0) {
          sections.push(`Campanhas:\n${campaignLines.join('\n')}`)
        }
      }

      if (ads.length > 0) {
        const adLines: string[] = []
        // Sort by recent spend so, if the context needs truncation,
        // the highest-spend creatives (the ones worth acting on) are
        // kept and low-spend noise is dropped first.
        const scored = ads.map((ad) => {
          const rows = adMetrics.get(ad.id) ?? []
          const { current, prior } = splitWindows(rows, now)
          const trend = computeTrend(current, prior)
          const fatigue = computeCreativeFatigueScore({ launchedAt: ad.launched_at ?? null }, trend, now)
          return { ad, rows, trend, fatigue }
        })
        scored.sort((a, b) => b.trend.current.spend - a.trend.current.spend)

        for (const { ad, rows, trend, fatigue } of scored) {
          if (rows.length === 0) continue
          hasData = true
          const ref = refs.alloc('ad', ad.id)
          adLines.push(
            `- [ref:${ref}] "${ad.name}" (${ad.status}) — fadiga: ${FATIGUE_EMOJI[fatigue.level]} ${fatigue.level} ` +
              `(dias ativo: ${fatigue.daysActive ?? 'desconhecido'}, ${fatigue.reasons.join('; ') || 'sem sinais relevantes'}) — ` +
              `CTR ${fmtPct(trend.ctrChangePct)}, CPM ${fmtPct(trend.cpmChangePct)}, gasto 7d: R$ ${fmtMoney(trend.current.spend)}`,
          )
        }
        if (adLines.length > 0) {
          sections.push(`Anúncios/criativos (selo de fadiga já calculado — não recalcule):\n${adLines.join('\n')}`)
        }
      }
    }

    const { data: landingPageRows } = await db
      .from('landing_pages')
      .select('id, name, url')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
    const landingPages = (landingPageRows ?? []) as { id: string; name: string; url: string }[]

    if (landingPages.length > 0) {
      const lpMetrics = await fetchMetrics(db, 'landing_page', landingPages.map((l) => l.id), now)
      const lpLines: string[] = []
      for (const lp of landingPages) {
        const rows = lpMetrics.get(lp.id) ?? []
        if (rows.length === 0) continue
        hasData = true
        const { current, prior } = splitWindows(rows, now)
        const signal = computeLandingPageSignal(current, prior)
        const ref = refs.alloc('landing_page', lp.id)
        lpLines.push(
          `- [ref:${ref}] "${lp.name}" (${lp.url}) — visitas 7d: ${signal.visits}, leads 7d: ${signal.leads}, ` +
            `taxa de conversão: ${signal.conversionRatePct?.toFixed(1) ?? 'sem dado'}% (${fmtPct(signal.conversionRateChangePct)} vs. semana anterior)`,
        )
      }
      if (lpLines.length > 0) {
        sections.push(`Landing pages:\n${lpLines.join('\n')}`)
      }
    }

    // Commercial funnel — reuses deals/pipeline_stages, not a new entity.
    // Deals belong to the LEADS this client's campaigns generated
    // (contacts.managed_by_contact_id = contactId, set by
    // src/lib/traffic/attribution.ts), never to contactId's own deals
    // — contactId here is the managed client, not a lead.
    const { data: leadRows } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('managed_by_contact_id', contactId)
    const leadIds = ((leadRows ?? []) as { id: string }[]).map((l) => l.id)

    const { data: dealRows } =
      leadIds.length > 0
        ? await db
            .from('deals')
            .select('id, pipeline_id, stage_id, status, value')
            .in('contact_id', leadIds)
        : { data: [] }
    const deals = (dealRows ?? []) as Deal[]
    if (deals.length > 0) {
      const pipelineIds = [...new Set(deals.map((d) => d.pipeline_id))]
      const { data: stageRows } = await db
        .from('pipeline_stages')
        .select('id, pipeline_id, name, position, color, created_at')
        .in('pipeline_id', pipelineIds)
      const stages = (stageRows ?? []) as PipelineStage[]

      if (stages.length > 0) {
        const conversions = computeFunnelConversionRates(stages, deals)
        const ref = refs.alloc('funnel', null)
        const lines = conversions.map(
          (c) =>
            `  ${c.stageName}: ${c.dealsAtOrPastStage} negócio(s)` +
            (c.conversionFromPreviousPct != null ? ` (${c.conversionFromPreviousPct.toFixed(0)}% do estágio anterior)` : ''),
        )
        sections.push(`Funil comercial [ref:${ref}] (negócios ativos por estágio, do topo para o fundo):\n${lines.join('\n')}`)
        hasData = true
      }
    }
  } catch {
    // Best-effort, same philosophy as retrieveKnowledge — a query
    // failure degrades to whatever context was gathered so far
    // rather than failing the whole diagnostic run.
  }

  let contextText = sections.length > 0 ? sections.join('\n\n') : 'Nenhum dado de campanha ou funil disponível para este cliente ainda.'
  if (contextText.length > MAX_CONTEXT_CHARS) {
    contextText = `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n\n[...contexto truncado por tamanho...]`
  }

  return { contextText, entityRefMap: refs.entries, hasData }
}

// Re-exported for callers that only need the aggregate shape without
// re-running the full context gather (e.g. a future report view).
export { aggregateMetrics }
