import { SocialPublishError, type PublishArgs, type PublishResult } from './types'
import { publishInstagram } from './providers/instagram'
import { publishFacebook } from './providers/facebook'
import { publishLinkedIn } from './providers/linkedin'

/**
 * Publish a post to the network its target profile belongs to.
 * Dispatches to the right adapter, mirroring src/lib/ai/generate.ts's
 * `generateReply` switch. Adding a platform = one new file in
 * providers/ + one new case here.
 */
export async function publishPost(args: PublishArgs): Promise<PublishResult> {
  switch (args.profile.platform) {
    case 'instagram':
      return publishInstagram(args)
    case 'facebook':
      return publishFacebook(args)
    case 'linkedin':
      return publishLinkedIn(args)
    default:
      throw new SocialPublishError(`Unsupported platform: ${args.profile.platform}`, {
        code: 'unsupported_platform',
        status: 400,
      })
  }
}
