import { describe, it, expect } from 'vitest'
import { publishPost } from './publish'
import { SocialPublishError, type PublishArgs, type SocialPlatform } from './types'

function args(overrides: Partial<PublishArgs> = {}): PublishArgs {
  return {
    profile: { platform: 'instagram', externalAccountId: null, accessToken: null },
    contentType: 'image',
    caption: 'Hello world',
    hashtags: ['#crm'],
    media: [{ url: 'https://example.com/a.png', kind: 'image' }],
    linkUrl: null,
    timeoutMs: 5000,
    ...overrides,
  }
}

describe('publishPost', () => {
  it('dispatches to the right provider by platform and fails not_configured when disconnected', async () => {
    for (const platform of ['instagram', 'facebook', 'linkedin'] as SocialPlatform[]) {
      await expect(
        publishPost(args({ profile: { platform, externalAccountId: null, accessToken: null } })),
      ).rejects.toMatchObject({ code: 'provider_not_configured', status: 422 })
    }
  })

  it('reaches not_implemented once connected (no real API wired up yet)', async () => {
    await expect(
      publishPost(
        args({
          profile: { platform: 'instagram', externalAccountId: 'acct-1', accessToken: 'token-1' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_implemented', status: 501 })
  })

  it('throws SocialPublishError for an unsupported platform', async () => {
    await expect(
      publishPost(
        args({
          // @ts-expect-error deliberately invalid platform to exercise the default branch
          profile: { platform: 'tiktok', externalAccountId: 'x', accessToken: 'y' },
        }),
      ),
    ).rejects.toBeInstanceOf(SocialPublishError)
  })
})
