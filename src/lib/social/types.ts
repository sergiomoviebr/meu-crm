// ============================================================
// Shared types for the social-publishing layer.
//
// Mirrors src/lib/ai/types.ts's provider-agnostic shape: one small
// surface so the content-post publish engine doesn't care which
// network a target profile is on. Each platform gets its own file
// under providers/ implementing `publish(args)`.
//
// Real Graph/LinkedIn API calls are NOT wired up yet — every provider
// throws SocialPublishError('provider_not_configured') until a real
// access token + external account id are stored on the profile. This
// keeps the whole pipeline (draft -> approve -> schedule -> cron ->
// attempt -> status/error) exercisable end to end today, and is the
// exact drop-in point for real publishing later.
// ============================================================

export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin'

/** A social profile's connection state, decrypted and ready to use. */
export interface SocialProfileConfig {
  platform: SocialPlatform
  externalAccountId: string | null
  /** Decrypted plaintext access token, or null when not connected. */
  accessToken: string | null
}

export interface PublishMediaItem {
  url: string
  kind: 'image' | 'video'
}

export interface PublishArgs {
  profile: SocialProfileConfig
  contentType: 'image' | 'video' | 'carousel' | 'text' | 'story' | 'reel'
  caption: string
  /** Kept separate from `caption` — each platform has its own
   *  convention for where hashtags go (IG appends to the caption text,
   *  LinkedIn appends to `commentary`, FB embeds in `message`), so the
   *  merge is each provider adapter's decision, not this layer's. */
  hashtags: string[]
  media: PublishMediaItem[]
  linkUrl: string | null
  timeoutMs: number
}

export interface PublishResult {
  externalPostId: string
}

/**
 * Typed error for every publish failure mode. `status` maps cleanly to
 * an HTTP response; `code` lets callers branch (provider_not_configured
 * vs not_implemented vs a real future network/auth failure).
 */
export class SocialPublishError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'SocialPublishError'
    this.code = opts.code ?? 'social_publish_error'
    this.status = opts.status ?? 502
  }
}
