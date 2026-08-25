// ============================================================
// Shared types for the ad-platform metrics-pull layer.
//
// Mirrors src/lib/social/types.ts's provider-agnostic shape: one
// small surface the diagnostic engine and the future automatic
// import job can call without caring which ad platform an account is
// on. Each platform gets its own file under providers/ implementing
// `pullMetrics(args)`.
//
// No real API calls are wired up yet — every provider throws
// TrafficProviderError('not_configured'|'not_implemented') until a
// real access token + external account id are stored on the
// ad_account row. This is the exact drop-in point for a real pull
// later: only the function body changes.
// ============================================================

import type { AdPlatform } from '@/types'

export interface AdAccountConnection {
  platform: AdPlatform
  externalAccountId: string | null
  /** Decrypted plaintext access token, or null when not connected. */
  accessToken: string | null
}

export interface PullMetricsArgs {
  account: AdAccountConnection
  entityType: 'campaign' | 'ad_set' | 'ad'
  externalEntityId: string
  /** Inclusive date range, YYYY-MM-DD. */
  dateFrom: string
  dateTo: string
  timeoutMs: number
}

export interface PulledMetricRow {
  date: string
  impressions: number
  reach: number
  clicks: number
  spend: number
  leads: number
  conversions: number
  revenue: number
}

export interface PullMetricsResult {
  rows: PulledMetricRow[]
}

export class TrafficProviderError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'TrafficProviderError'
    this.code = opts.code ?? 'traffic_provider_error'
    this.status = opts.status ?? 502
  }
}
