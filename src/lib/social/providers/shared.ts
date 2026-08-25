import { SocialPublishError, type PublishArgs } from '../types'

/**
 * Every real provider call needs a stored access token + external
 * account id. Until an account connects a real one (OAuth flow, not
 * built yet), every publish attempt fails here with a consistent
 * error shape the UI/history can render as one generic "not
 * connected" banner across platforms.
 */
export function assertConnected(platform: string, args: PublishArgs): void {
  if (!args.profile.accessToken || !args.profile.externalAccountId) {
    throw new SocialPublishError(
      `${platform} account is not connected. Configure a real access token to enable publishing.`,
      { code: 'provider_not_configured', status: 422 },
    )
  }
}
