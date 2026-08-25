import { describe, it, expect } from 'vitest'
import {
  aggregateMetrics,
  pctChange,
  computeTrend,
  computeCreativeFatigueScore,
  computeFunnelConversionRates,
  computeLandingPageSignal,
  type MetricPoint,
} from './signals'
import type { Deal, PipelineStage } from '@/types'

function point(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    date: '2026-08-01',
    impressions: 0,
    reach: 0,
    clicks: 0,
    spend: 0,
    leads: 0,
    conversions: 0,
    revenue: 0,
    visits: 0,
    ...overrides,
  }
}

describe('aggregateMetrics', () => {
  it('sums raw fields and derives ratios', () => {
    const agg = aggregateMetrics([
      point({ impressions: 1000, reach: 500, clicks: 20, spend: 100, leads: 5, conversions: 2, revenue: 400 }),
      point({ impressions: 1000, reach: 500, clicks: 20, spend: 100, leads: 5, conversions: 2, revenue: 400 }),
    ])
    expect(agg.impressions).toBe(2000)
    expect(agg.clicks).toBe(40)
    expect(agg.frequency).toBe(2) // 2000/1000
    expect(agg.ctr).toBeCloseTo(0.02) // 40/2000
    expect(agg.cpm).toBeCloseTo(100) // 200/2000*1000
    expect(agg.cpl).toBeCloseTo(20) // 200/10
    expect(agg.cpa).toBeCloseTo(50) // 200/4
    expect(agg.roas).toBeCloseTo(4) // 800/200
  })

  it('returns null ratios instead of NaN/Infinity on zero denominators', () => {
    const agg = aggregateMetrics([point()])
    expect(agg.ctr).toBeNull()
    expect(agg.cpc).toBeNull()
    expect(agg.cpm).toBeNull()
    expect(agg.cpl).toBeNull()
    expect(agg.cpa).toBeNull()
    expect(agg.roas).toBeNull()
    expect(agg.frequency).toBeNull()
  })
})

describe('pctChange', () => {
  it('computes signed percent change', () => {
    expect(pctChange(100, 80)).toBeCloseTo(-20)
    expect(pctChange(100, 130)).toBeCloseTo(30)
  })
  it('returns null when there is no baseline', () => {
    expect(pctChange(0, 50)).toBeNull()
    expect(pctChange(null, 50)).toBeNull()
    expect(pctChange(50, null)).toBeNull()
  })
})

describe('computeTrend', () => {
  it('diffs current vs a prior window', () => {
    const prior = [point({ impressions: 1000, clicks: 30 })] // ctr 0.03
    const current = [point({ impressions: 1000, clicks: 20 })] // ctr 0.02, -33.3%
    const trend = computeTrend(current, prior)
    expect(trend.ctrChangePct).toBeLessThan(0)
    expect(trend.ctrChangePct).toBeCloseTo(-33.333, 1)
  })
})

describe('computeCreativeFatigueScore', () => {
  function trendWithCtrDrop(dropPct: number) {
    const prior = [point({ impressions: 1000, clicks: 100 })] // ctr 0.10
    const currentCtr = 0.1 * (1 - dropPct / 100)
    const current = [point({ impressions: 1000, clicks: Math.round(currentCtr * 1000) })]
    return computeTrend(current, prior)
  }

  it('healthy: small or no CTR drop', () => {
    const trend = trendWithCtrDrop(5)
    const score = computeCreativeFatigueScore({ launchedAt: '2026-07-25' }, trend, new Date('2026-08-01'))
    expect(score.level).toBe('healthy')
  })

  it('monitor: CTR drop crosses the monitor threshold regardless of days active', () => {
    const trend = trendWithCtrDrop(20)
    const score = computeCreativeFatigueScore({ launchedAt: '2026-07-31' }, trend, new Date('2026-08-01'))
    expect(score.level).toBe('monitor')
  })

  it('test: CTR drop >=25% AND >=14 days active', () => {
    const trend = trendWithCtrDrop(30)
    const score = computeCreativeFatigueScore({ launchedAt: '2026-07-15' }, trend, new Date('2026-08-01'))
    expect(score.daysActive).toBe(17)
    expect(score.level).toBe('test')
  })

  it('does not escalate to test when days active is below the threshold', () => {
    const trend = trendWithCtrDrop(30)
    const score = computeCreativeFatigueScore({ launchedAt: '2026-07-28' }, trend, new Date('2026-08-01'))
    expect(score.daysActive).toBe(4)
    expect(score.level).toBe('monitor')
  })

  it('replace: CTR drop >=40% AND >=21 days active', () => {
    const trend = trendWithCtrDrop(45)
    const score = computeCreativeFatigueScore({ launchedAt: '2026-07-01' }, trend, new Date('2026-08-01'))
    expect(score.level).toBe('replace')
    expect(score.reasons.length).toBeGreaterThan(0)
  })

  it('escalates one level when frequency is also high', () => {
    const prior = [point({ impressions: 1000, clicks: 100, reach: 1000 })]
    const current = [point({ impressions: 5000, clicks: 350, reach: 1000 })] // freq 5x, ctr drop ~30%
    const trend = computeTrend(current, prior)
    const score = computeCreativeFatigueScore({ launchedAt: '2026-07-15' }, trend, new Date('2026-08-01'))
    expect(score.frequency).toBeCloseTo(5)
    expect(score.level).toBe('replace') // 'test' escalated to 'replace' by high frequency
  })

  it('flags insufficient data without launch date or prior comparison', () => {
    const trend = computeTrend([point()], [point()])
    const score = computeCreativeFatigueScore({ launchedAt: null }, trend)
    expect(score.level).toBe('healthy')
    expect(score.reasons).toContain('Dados insuficientes para uma avaliação completa')
  })
})

describe('computeFunnelConversionRates', () => {
  const stages: PipelineStage[] = [
    { id: 's1', pipeline_id: 'p1', name: 'Lead', position: 0, color: '#000', created_at: '' },
    { id: 's2', pipeline_id: 'p1', name: 'Contato', position: 1, color: '#000', created_at: '' },
    { id: 's3', pipeline_id: 'p1', name: 'Venda', position: 2, color: '#000', created_at: '' },
  ]

  function deal(stageId: string, status: Deal['status'] = 'open'): Deal {
    return {
      id: `d-${Math.random()}`,
      user_id: 'u1',
      pipeline_id: 'p1',
      stage_id: stageId,
      contact_id: 'c1',
      title: 'x',
      value: 0,
      status,
      created_at: '',
    }
  }

  it('computes snapshot stage-to-stage conversion, excluding lost deals', () => {
    const deals = [
      deal('s1'), deal('s1'), deal('s1'), deal('s1'), deal('s1'), // 5 at Lead+
      deal('s2'), deal('s2'), // 2 at Contato+ (also counted at Lead+)
      deal('s3'), // 1 at Venda
      deal('s1', 'lost'), // excluded
    ]
    const result = computeFunnelConversionRates(stages, deals)
    expect(result[0].dealsAtOrPastStage).toBe(8) // 5+2+1, lost excluded
    expect(result[0].conversionFromPreviousPct).toBeNull()
    expect(result[1].dealsAtOrPastStage).toBe(3) // s2+s3
    expect(result[1].conversionFromPreviousPct).toBeCloseTo((3 / 8) * 100)
    expect(result[2].dealsAtOrPastStage).toBe(1)
    expect(result[2].conversionFromPreviousPct).toBeCloseTo((1 / 3) * 100)
  })

  it('returns null conversion when the previous stage has zero deals', () => {
    const result = computeFunnelConversionRates(stages, [])
    expect(result.every((r) => r.dealsAtOrPastStage === 0)).toBe(true)
    expect(result[1].conversionFromPreviousPct).toBeNull()
  })
})

describe('computeLandingPageSignal', () => {
  it('computes conversion rate and its trend', () => {
    const prior = [point({ visits: 1000, leads: 50 })] // 5%
    const current = [point({ visits: 1000, leads: 30 })] // 3%
    const signal = computeLandingPageSignal(current, prior)
    expect(signal.conversionRatePct).toBeCloseTo(3)
    expect(signal.conversionRateChangePct).toBeCloseTo(-40) // (3-5)/5
  })
})
