import { describe, it, expect, vi, beforeEach } from 'vitest'
import { attemptDuePost } from './publish-engine'
import type { ContentPost } from '@/types'

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => `plain:${v}`),
}))

function post(overrides: Partial<ContentPost> = {}): ContentPost {
  return {
    id: 'post-1',
    account_id: 'acct-1',
    contact_id: 'contact-1',
    created_by: 'user-1',
    content_type: 'image',
    caption: 'Hello',
    hashtags: [],
    media: [],
    link_url: null,
    cta: null,
    status: 'publishing',
    scheduled_at: null,
    published_at: null,
    approved_by: null,
    approved_at: null,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function target(id: string, platform: 'instagram' | 'facebook' | 'linkedin', connected: boolean) {
  return {
    id,
    status: 'pending',
    social_profile: {
      id: `profile-${id}`,
      platform,
      external_account_id: connected ? 'ext-1' : null,
      access_token_encrypted: connected ? 'enc-token' : null,
    },
  }
}

/** A minimal fake Supabase query builder covering the chain shapes
 *  publish-engine.ts calls: select().eq().eq() for the targets load,
 *  update().eq() for target/post writes. Records every update call so
 *  tests can assert on final state without a real database. */
function fakeAdmin(targetRows: ReturnType<typeof target>[]) {
  const updates: { table: string; payload: Record<string, unknown>; id: string }[] = []

  const admin = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                eq: async () => ({ data: targetRows, error: null }),
              }
            },
          }
        },
        update(payload: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string) => {
              updates.push({ table, payload, id })
              return { data: null, error: null }
            },
          }
        },
      }
    },
  }

  return { admin: admin as never, updates }
}

beforeEach(() => vi.clearAllMocks())

describe('attemptDuePost', () => {
  it('marks the post failed with no error queries when there are no pending targets', async () => {
    const { admin, updates } = fakeAdmin([])
    await attemptDuePost(admin, post())
    expect(updates).toEqual([
      {
        table: 'content_posts',
        payload: { status: 'failed', error_message: 'No target platforms remain for this post.' },
        id: 'post-1',
      },
    ])
  })

  it('rolls up to failed when every target is unconfigured', async () => {
    const { admin, updates } = fakeAdmin([target('t1', 'instagram', false)])
    await attemptDuePost(admin, post())

    const targetUpdates = updates.filter((u) => u.table === 'content_post_targets')
    expect(targetUpdates[0].payload).toMatchObject({ status: 'publishing' })
    expect(targetUpdates[1].payload).toMatchObject({
      status: 'failed',
      error_code: 'provider_not_configured',
    })

    const postUpdate = updates.find((u) => u.table === 'content_posts')
    expect(postUpdate?.payload).toMatchObject({ status: 'failed' })
  })

  it('rolls up to failed (all-fail) across multiple unconfigured targets, not a partial state', async () => {
    const { admin, updates } = fakeAdmin([
      target('t1', 'instagram', false),
      target('t2', 'facebook', false),
    ])
    await attemptDuePost(admin, post())

    const postUpdate = updates.find((u) => u.table === 'content_posts')
    expect(postUpdate?.payload).toMatchObject({
      status: 'failed',
      error_message: 'Publishing failed on all 2 platform(s).',
    })
  })
})
