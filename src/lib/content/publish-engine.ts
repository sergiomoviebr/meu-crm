import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { publishPost } from '@/lib/social/publish'
import { SocialPublishError } from '@/lib/social/types'
import { logger } from '@/lib/logger'
import type { ContentPost, PostContentType, SocialPlatform } from '@/types'

const PUBLISH_TIMEOUT_MS = 30_000

/**
 * Attempt to publish every pending target of one due `content_posts`
 * row, then roll the post's own status up from the target outcomes.
 *
 * Called by GET /api/content/cron once the row has been claimed
 * (status flipped scheduled -> publishing by the caller). Never
 * throws — a per-target failure is recorded on that target row, not
 * raised to the caller; the loop always finishes and always writes a
 * final `content_posts.status`.
 */
export async function attemptDuePost(admin: SupabaseClient, post: ContentPost): Promise<void> {
  const { data: targets, error: targetsError } = await admin
    .from('content_post_targets')
    .select('id, status, social_profile:social_profiles(id, platform, external_account_id, access_token_encrypted)')
    .eq('post_id', post.id)
    .eq('status', 'pending')

  if (targetsError) {
    logger.error('Failed to load content post targets', {
      operation: 'content/publish-engine',
      accountId: post.account_id,
      error: targetsError,
    })
    await admin
      .from('content_posts')
      .update({ status: 'failed', error_message: 'Could not load target platforms.' })
      .eq('id', post.id)
    return
  }

  const rows = (targets ?? []) as unknown as TargetRow[]
  if (rows.length === 0) {
    await admin
      .from('content_posts')
      .update({ status: 'failed', error_message: 'No target platforms remain for this post.' })
      .eq('id', post.id)
    return
  }

  let succeeded = 0
  let failed = 0

  for (const target of rows) {
    const profile = target.social_profile
    await admin
      .from('content_post_targets')
      .update({ status: 'publishing', attempted_at: new Date().toISOString() })
      .eq('id', target.id)

    try {
      const result = await publishPost({
        profile: {
          platform: profile.platform,
          externalAccountId: profile.external_account_id,
          accessToken: profile.access_token_encrypted ? decrypt(profile.access_token_encrypted) : null,
        },
        contentType: post.content_type as PostContentType,
        caption: post.caption ?? '',
        hashtags: post.hashtags ?? [],
        media: (post.media ?? []).map((m) => ({ url: m.url, kind: m.kind })),
        linkUrl: post.link_url ?? null,
        timeoutMs: PUBLISH_TIMEOUT_MS,
      })

      await admin
        .from('content_post_targets')
        .update({
          status: 'published',
          external_post_id: result.externalPostId,
          published_at: new Date().toISOString(),
        })
        .eq('id', target.id)
      succeeded++
    } catch (err) {
      const social = err instanceof SocialPublishError ? err : null
      await admin
        .from('content_post_targets')
        .update({
          status: 'failed',
          error_code: social?.code ?? 'unknown_error',
          error_message: social?.message ?? (err instanceof Error ? err.message : String(err)),
        })
        .eq('id', target.id)
      failed++
      logger.error('Content target publish failed', {
        operation: 'content/publish-engine',
        accountId: post.account_id,
        postId: post.id,
        targetId: target.id,
        error: err,
      })
    }
  }

  await rollUpPostStatus(admin, post.id, succeeded, failed, rows.length)
}

interface TargetRow {
  id: string
  status: string
  social_profile: {
    id: string
    platform: SocialPlatform
    external_account_id: string | null
    access_token_encrypted: string | null
  }
}

/**
 * No 9th "partially published" status exists in content_posts.status
 * (see supabase/migrations/042_content_social.sql) — a mixed outcome
 * lands on `published` with a note in `error_message`, mirroring how
 * broadcasts.status='sent' already coexists with a nonzero
 * failed_count rather than a distinct partial-failure status.
 */
async function rollUpPostStatus(
  admin: SupabaseClient,
  postId: string,
  succeeded: number,
  failed: number,
  total: number,
): Promise<void> {
  if (failed === 0) {
    await admin
      .from('content_posts')
      .update({ status: 'published', published_at: new Date().toISOString(), error_message: null })
      .eq('id', postId)
    return
  }
  if (succeeded === 0) {
    await admin
      .from('content_posts')
      .update({ status: 'failed', error_message: `Publishing failed on all ${total} platform(s).` })
      .eq('id', postId)
    return
  }
  await admin
    .from('content_posts')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      error_message: `${failed} of ${total} platform(s) failed.`,
    })
    .eq('id', postId)
}
