import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContentMediaItem, ContentPostStatus, PostContentType } from '@/types'

/**
 * Allowed source statuses per workflow action. Deliberately loose
 * rather than a strict single-predecessor state machine: the user
 * asked for draft / schedule / publish-now / pending-approval as
 * parallel save options, not a mandatory linear pipeline — a team
 * that doesn't use approvals can schedule straight from draft.
 */
export const TRANSITIONS: Record<string, ContentPostStatus[]> = {
  submit: ['draft'],
  approve: ['pending_approval'],
  schedule: ['draft', 'pending_approval', 'approved'],
  publish_now: ['draft', 'pending_approval', 'approved'],
  cancel: ['draft', 'pending_approval', 'approved', 'scheduled'],
}

export interface CreatePostInput {
  accountId: string
  createdBy: string
  contactId: string
  contentType: PostContentType
  caption?: string | null
  hashtags?: string[]
  media?: ContentMediaItem[]
  linkUrl?: string | null
  cta?: string | null
  socialProfileIds: string[]
  /** Initial status — defaults to 'draft'. Callers that want to
   *  submit/schedule/publish immediately do so via the workflow
   *  actions after creation, keeping "create" a single concern. */
  status?: 'draft' | 'pending_approval'
}

export interface CreatePostResult {
  post?: Record<string, unknown>
  error?: string
  status?: number
}

/**
 * Create a draft (or pending-approval) post plus one
 * content_post_targets row per selected social profile. All the
 * social profiles must belong to the same contact as the post — cross-
 * contact targets would silently let one client's content post through
 * another client's connected network.
 */
export async function createContentPost(
  admin: SupabaseClient,
  input: CreatePostInput,
): Promise<CreatePostResult> {
  if (!input.socialProfileIds || input.socialProfileIds.length === 0) {
    return { error: 'At least one target social profile is required', status: 400 }
  }

  const { data: profiles, error: profilesErr } = await admin
    .from('social_profiles')
    .select('id, contact_id, account_id')
    .in('id', input.socialProfileIds)

  if (profilesErr) return { error: profilesErr.message, status: 500 }
  const rows = (profiles ?? []) as { id: string; contact_id: string; account_id: string }[]
  if (rows.length !== input.socialProfileIds.length) {
    return { error: 'One or more social profiles could not be found', status: 400 }
  }
  const mismatched = rows.some(
    (p) => p.account_id !== input.accountId || p.contact_id !== input.contactId,
  )
  if (mismatched) {
    return { error: 'All target profiles must belong to the selected client', status: 400 }
  }

  const { data: post, error: insertErr } = await admin
    .from('content_posts')
    .insert({
      account_id: input.accountId,
      contact_id: input.contactId,
      created_by: input.createdBy,
      content_type: input.contentType,
      caption: input.caption ?? null,
      hashtags: input.hashtags ?? [],
      media: input.media ?? [],
      link_url: input.linkUrl ?? null,
      cta: input.cta ?? null,
      status: input.status ?? 'draft',
    })
    .select()
    .single()

  if (insertErr || !post) return { error: insertErr?.message ?? 'insert failed', status: 500 }

  const targetRows = input.socialProfileIds.map((id) => ({
    post_id: post.id as string,
    social_profile_id: id,
  }))
  const { error: targetsErr } = await admin.from('content_post_targets').insert(targetRows)
  if (targetsErr) return { error: targetsErr.message, status: 500 }

  return { post: post as Record<string, unknown> }
}

export interface TransitionResult {
  post?: Record<string, unknown>
  error?: string
  status?: number
}

/**
 * Move a post from one of `TRANSITIONS[action]`'s allowed source
 * statuses to `toStatus`, scoped to the caller's account. Shared by
 * every workflow route (submit/approve/schedule/publish_now/cancel)
 * so the "load, check account, check current status" boilerplate
 * exists once.
 */
export async function transitionPost(
  admin: SupabaseClient,
  args: {
    id: string
    accountId: string
    action: keyof typeof TRANSITIONS
    toStatus: ContentPostStatus
    extra?: Record<string, unknown>
  },
): Promise<TransitionResult> {
  const { data: existing } = await admin
    .from('content_posts')
    .select('id, status')
    .eq('id', args.id)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (!existing) return { error: 'Not found', status: 404 }

  const allowed = TRANSITIONS[args.action]
  if (!allowed.includes(existing.status as ContentPostStatus)) {
    return {
      error: `Cannot ${args.action.replace('_', ' ')} a post with status '${existing.status}'`,
      status: 400,
    }
  }

  const { data: post, error } = await admin
    .from('content_posts')
    .update({ status: args.toStatus, ...args.extra })
    .eq('id', args.id)
    .select()
    .single()
  if (error || !post) return { error: error?.message ?? 'update failed', status: 500 }

  return { post: post as Record<string, unknown> }
}
