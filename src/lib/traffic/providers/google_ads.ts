import { TrafficProviderError, type PullMetricsArgs, type PullMetricsResult } from './types'
import { assertConnected } from './shared'

/**
 * Pull daily performance rows from the Google Ads API.
 *
 * Not implemented yet (see meta_ads.ts's header for the BYO-key
 * rationale). A real implementation needs a GAQL query against
 * `GoogleAdsService.SearchStream`, e.g. for a campaign:
 *   SELECT segments.date, metrics.impressions, metrics.clicks,
 *     metrics.cost_micros, metrics.conversions,
 *     metrics.conversions_value
 *   FROM campaign
 *   WHERE campaign.id = {externalEntityId}
 *     AND segments.date BETWEEN '{dateFrom}' AND '{dateTo}'
 * `cost_micros` needs dividing by 1,000,000 to get spend in account
 * currency. Requires an OAuth refresh token + a developer token +
 * the customer (account) id — the refresh token maps to
 * `account.accessToken`, the customer id to
 * `account.externalAccountId`.
 */
export async function pullMetrics(args: PullMetricsArgs): Promise<PullMetricsResult> {
  assertConnected('Google Ads', args)
  throw new TrafficProviderError('Google Ads metric pulls are not implemented yet.', {
    code: 'not_implemented',
    status: 501,
  })
}
