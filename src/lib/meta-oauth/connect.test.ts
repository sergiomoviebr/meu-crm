import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveOrPickCandidate, saveCandidate } from './connect'
import type { MetaOAuthCandidate } from './types'

function makeAdmin(): { admin: SupabaseClient; upserts: { table: string; payload: Record<string, unknown> }[] } {
  const upserts: { table: string; payload: Record<string, unknown> }[] = []
  const admin = {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>) => {
        upserts.push({ table, payload })
        return Promise.resolve({ error: null })
      },
    }),
  } as unknown as SupabaseClient
  return { admin, upserts }
}

const BASE = { accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', userAccessToken: 'user-token' }

describe('saveCandidate', () => {
  it('upserts ad_accounts using the shared user token (no per-candidate token for ads)', async () => {
    const { admin, upserts } = makeAdmin()
    const candidate: MetaOAuthCandidate = { id: 'act_123', name: 'Sales Pipeline Ads' }

    await saveCandidate({ admin, ...BASE, product: 'ads', candidate })

    expect(upserts).toHaveLength(1)
    expect(upserts[0].table).toBe('ad_accounts')
    expect(upserts[0].payload).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      platform: 'meta',
      name: 'Sales Pipeline Ads',
      external_account_id: 'act_123',
      connection_status: 'connected',
    })
    // The user token round-trips through encrypt() — not the plaintext.
    expect(upserts[0].payload.access_token_encrypted).not.toBe('user-token')
  })

  it('upserts social_profiles for facebook using the candidate (page) access token', async () => {
    const { admin, upserts } = makeAdmin()
    const candidate: MetaOAuthCandidate = {
      id: 'page-1',
      name: 'Studio Beleza',
      handle: 'studiobeleza',
      accessToken: 'page-token-1',
    }

    await saveCandidate({ admin, ...BASE, product: 'facebook', candidate })

    expect(upserts[0].table).toBe('social_profiles')
    expect(upserts[0].payload).toMatchObject({
      platform: 'facebook',
      handle: 'studiobeleza',
      display_name: 'Studio Beleza',
      external_account_id: 'page-1',
      connection_status: 'connected',
    })
  })

  it('falls back to candidate.id as the handle when Meta has no username on file', async () => {
    const { admin, upserts } = makeAdmin()
    const candidate: MetaOAuthCandidate = { id: 'page-2', name: 'No Username Co', accessToken: 'tok' }

    await saveCandidate({ admin, ...BASE, product: 'facebook', candidate })

    expect(upserts[0].payload.handle).toBe('page-2')
  })
})

describe('resolveOrPickCandidate', () => {
  it('reports no_candidates and saves nothing when the list is empty', async () => {
    const { admin, upserts } = makeAdmin()
    const outcome = await resolveOrPickCandidate({ admin, ...BASE, product: 'ads', candidates: [] })
    expect(outcome).toEqual({ kind: 'no_candidates' })
    expect(upserts).toHaveLength(0)
  })

  it('auto-saves when exactly one candidate is found', async () => {
    const { admin, upserts } = makeAdmin()
    const candidate: MetaOAuthCandidate = { id: 'act_1', name: 'Only Account' }
    const outcome = await resolveOrPickCandidate({ admin, ...BASE, product: 'ads', candidates: [candidate] })
    expect(outcome).toEqual({ kind: 'saved', candidate })
    expect(upserts).toHaveLength(1)
  })

  it('defers to the picker (saves nothing yet) when multiple candidates are found', async () => {
    const { admin, upserts } = makeAdmin()
    const candidates: MetaOAuthCandidate[] = [
      { id: 'act_1', name: 'Account A' },
      { id: 'act_2', name: 'Account B' },
    ]
    const outcome = await resolveOrPickCandidate({ admin, ...BASE, product: 'ads', candidates })
    expect(outcome).toEqual({ kind: 'needs_pick', candidates })
    expect(upserts).toHaveLength(0)
  })
})
