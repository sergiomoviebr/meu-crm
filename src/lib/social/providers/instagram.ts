import { SocialPublishError, type PublishArgs, type PublishResult } from '../types'
import { assertConnected } from './shared'

/**
 * Publish a post to Instagram via the Instagram Graph API.
 *
 * Not implemented yet — see docs/engineering-standards.md's AI section
 * for the precedent this follows (BYO credentials, no platform-wide
 * key). A real implementation needs:
 *   1. POST /{ig-user-id}/media { image_url | video_url, caption, access_token } -> creation_id
 *   2. POST /{ig-user-id}/media_publish { creation_id, access_token } -> { id }
 * Requires an Instagram Business/Creator account linked to a Facebook
 * Page, a long-lived Page access token, and the IG user id — both
 * already modeled as `profile.accessToken` / `profile.externalAccountId`
 * on SocialProfileConfig, so no interface change is needed to wire this
 * in later, only this function's body.
 */
export async function publishInstagram(args: PublishArgs): Promise<PublishResult> {
  assertConnected('Instagram', args)
  throw new SocialPublishError('Instagram publishing is not implemented yet.', {
    code: 'not_implemented',
    status: 501,
  })
}
