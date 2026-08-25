import { SocialPublishError, type PublishArgs, type PublishResult } from '../types'
import { assertConnected } from './shared'

/**
 * Publish a post to LinkedIn via the Posts API.
 *
 * Not implemented yet (see instagram.ts's header for the BYO-key
 * rationale). A real implementation needs:
 *   - POST /rest/posts { author: <URN>, commentary, visibility, ... }
 *   - Media posts must first upload the asset via LinkedIn's
 *     Images/Videos API to obtain an asset URN, then reference it in
 *     the post body — there is no single-call image upload like Meta's.
 *   - Requires `w_member_social` (personal) or `w_organization_social`
 *     (company page) scope, gated behind LinkedIn's Community
 *     Management API product access.
 * `profile.externalAccountId` holds the author URN, `profile.accessToken`
 * the OAuth token — both already modeled, no interface change needed.
 */
export async function publishLinkedIn(args: PublishArgs): Promise<PublishResult> {
  assertConnected('LinkedIn', args)
  throw new SocialPublishError('LinkedIn publishing is not implemented yet.', {
    code: 'not_implemented',
    status: 501,
  })
}
