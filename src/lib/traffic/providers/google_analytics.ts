import { TrafficProviderError, type PullMetricsArgs, type PullMetricsResult } from './types'
import { assertConnected } from './shared'

/**
 * Pull daily landing-page visit counts from the GA4 Data API.
 *
 * Not implemented yet (see meta_ads.ts's header for the BYO-key
 * rationale). A real implementation needs:
 *   POST https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport
 *   { dateRanges: [{startDate, endDate}], dimensions: [{name:'date'},{name:'pagePath'}],
 *     metrics: [{name:'screenPageViews'}] }
 * filtered to the landing page's `pagePath`. Requires an OAuth
 * refresh token + the GA4 property id — the refresh token maps to
 * `account.accessToken`, the property id to
 * `account.externalAccountId`. `entityType` for this provider is
 * always effectively 'landing_page' even though the shared
 * PullMetricsArgs type allows campaign/ad_set/ad too (GA4 has no
 * concept of those — this provider only ever gets called for
 * landing-page entities).
 */
export async function pullMetrics(args: PullMetricsArgs): Promise<PullMetricsResult> {
  assertConnected('Google Analytics', args)
  throw new TrafficProviderError('Google Analytics metric pulls are not implemented yet.', {
    code: 'not_implemented',
    status: 501,
  })
}
