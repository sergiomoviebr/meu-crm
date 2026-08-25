import { TrafficProviderError, type PullMetricsArgs, type PullMetricsResult } from './types'
import { pullMetrics as pullMetaAds } from './meta_ads'
import { pullMetrics as pullGoogleAds } from './google_ads'
import type { AdPlatform } from '@/types'

/**
 * Pull metrics from the platform an ad account belongs to. Dispatches
 * to the right adapter, mirroring src/lib/social/publish.ts. Adding a
 * platform = one new file in providers/ + one new case here.
 *
 * 'other' has no adapter — accounts on unsupported platforms are
 * manual/CSV-only by definition, so a pull attempt fails with a
 * clear, distinct code rather than a generic "not implemented".
 */
export async function pullMetricsFor(
  platform: AdPlatform,
  args: PullMetricsArgs,
): Promise<PullMetricsResult> {
  switch (platform) {
    case 'meta':
      return pullMetaAds(args)
    case 'google':
      return pullGoogleAds(args)
    case 'other':
      throw new TrafficProviderError('This platform has no automatic pull integration — use manual entry or CSV import.', {
        code: 'unsupported_platform',
        status: 400,
      })
    default:
      throw new TrafficProviderError(`Unsupported platform: ${platform}`, {
        code: 'unsupported_platform',
        status: 400,
      })
  }
}
