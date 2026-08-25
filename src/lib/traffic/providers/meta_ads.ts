import { TrafficProviderError, type PullMetricsArgs, type PullMetricsResult } from './types'
import { assertConnected } from './shared'

/**
 * Pull daily insights from the Meta Marketing API.
 *
 * Not implemented yet — same BYO-credentials rationale as
 * src/lib/social/providers/instagram.ts. A real implementation needs:
 *   GET /{entity-id}/insights?fields=impressions,reach,clicks,spend,
 *     actions&time_range={since,until}&time_increment=1
 *   (campaign/adset/ad ids all share this same insights endpoint
 *   shape — only the entity id in the path changes.)
 * Requires a long-lived System User or Page access token with
 * `ads_read` scope and the Business Manager's ad account id — both
 * already modeled as `account.accessToken` / `account.externalAccountId`
 * on AdAccountConnection, so no interface change is needed later,
 * only this function's body.
 */
export async function pullMetrics(args: PullMetricsArgs): Promise<PullMetricsResult> {
  assertConnected('Meta Ads', args)
  throw new TrafficProviderError('Meta Ads metric pulls are not implemented yet.', {
    code: 'not_implemented',
    status: 501,
  })
}
