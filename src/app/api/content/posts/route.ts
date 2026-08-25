import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/content/admin-client'
import { createContentPost } from '@/lib/content/posts'
import type { PostContentType } from '@/types'

const CONTENT_TYPES: PostContentType[] = ['image', 'video', 'carousel', 'text', 'story', 'reel']

// Creating a content post is a write — the RLS content_posts_insert
// policy requires 'agent', but this route inserts via the service-role
// client (content_post_targets needs the same account_id/contact_id
// cross-check regardless of RLS), so the role must be enforced here.
export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { contact_id, content_type, caption, hashtags, media, link_url, cta, social_profile_ids } = body

  if (!contact_id || typeof contact_id !== 'string') {
    return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  }
  if (!CONTENT_TYPES.includes(content_type)) {
    return NextResponse.json({ error: `content_type must be one of ${CONTENT_TYPES.join(', ')}` }, { status: 400 })
  }
  if (!Array.isArray(social_profile_ids) || social_profile_ids.length === 0) {
    return NextResponse.json({ error: 'social_profile_ids must be a non-empty array' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const result = await createContentPost(admin, {
    accountId: ctx.accountId,
    createdBy: ctx.userId,
    contactId: contact_id,
    contentType: content_type,
    caption: caption ?? null,
    hashtags: Array.isArray(hashtags) ? hashtags : [],
    media: Array.isArray(media) ? media : [],
    linkUrl: link_url ?? null,
    cta: cta ?? null,
    socialProfileIds: social_profile_ids,
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
  }
  return NextResponse.json({ post: result.post }, { status: 201 })
}
