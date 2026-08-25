import { TrafficProviderError, type PullMetricsArgs } from './types'

/** Every real provider call needs a stored access token + external
 *  account id. Until an ad account connects a real one (OAuth flow,
 *  not built yet), every pull attempt fails here with a consistent
 *  error shape the UI can render as one generic "not connected"
 *  banner across platforms — mirrors src/lib/social/providers/shared.ts. */
export function assertConnected(platform: string, args: PullMetricsArgs): void {
  if (!args.account.accessToken || !args.account.externalAccountId) {
    throw new TrafficProviderError(
      `${platform} account is not connected. Configure a real access token to enable automatic metric pulls.`,
      { code: 'provider_not_configured', status: 422 },
    )
  }
}
