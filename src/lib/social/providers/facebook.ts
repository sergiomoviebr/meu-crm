import { SocialPublishError, type PublishArgs, type PublishResult } from '../types'
import { assertConnected } from './shared'

/**
 * Publish a post to a Facebook Page via the Graph API.
 *
 * Not implemented yet (see instagram.ts's header for the BYO-key
 * rationale). A real implementation needs:
 *   - Text/link posts: POST /{page-id}/feed { message, link, access_token }
 *   - Image posts: POST /{page-id}/photos { url, caption, access_token }
 * Requires a Page access token and the Page id — already modeled as
 * `profile.accessToken` / `profile.externalAccountId`.
 */
export async function publishFacebook(args: PublishArgs): Promise<PublishResult> {
  assertConnected('Facebook', args)
  throw new SocialPublishError('Facebook publishing is not implemented yet.', {
    code: 'not_implemented',
    status: 501,
  })
}
