// ============================================================
// Shared "1 candidate found → save directly, N found → let the user
// pick" logic for the standard OAuth flow (facebook/instagram/ads).
// Used by both the callback route (first pass) and the finalize
// route (after a pick) — same save path either way.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { encrypt } from '@/lib/whatsapp/encryption'
import type { MetaOAuthCandidate, MetaOAuthProduct } from './types'

export type ResolveOutcome =
  | { kind: 'saved'; candidate: MetaOAuthCandidate }
  | { kind: 'no_candidates' }
  | { kind: 'needs_pick'; candidates: MetaOAuthCandidate[] }

export interface SaveCandidateArgs {
  admin: SupabaseClient
  accountId: string
  userId: string
  contactId: string
  product: MetaOAuthProduct
  candidate: MetaOAuthCandidate
  /** The long-lived user token — used directly for `ads` (no
   *  per-account token exists); ignored for facebook/instagram,
   *  which use `candidate.accessToken` (the page token) instead. */
  userAccessToken: string
}

export async function saveCandidate(args: SaveCandidateArgs): Promise<void> {
  const { admin, accountId, userId, contactId, product, candidate, userAccessToken } = args

  if (product === 'ads') {
    const { error } = await admin.from('ad_accounts').upsert(
      {
        account_id: accountId,
        contact_id: contactId,
        user_id: userId,
        platform: 'meta',
        name: candidate.name,
        external_account_id: candidate.id,
        access_token_encrypted: encrypt(userAccessToken),
        connection_status: 'connected',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,contact_id,platform,name' }
    )
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await admin.from('social_profiles').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      user_id: userId,
      platform: product,
      handle: candidate.handle ?? candidate.id,
      display_name: candidate.name,
      external_account_id: candidate.id,
      access_token_encrypted: encrypt(candidate.accessToken ?? userAccessToken),
      connection_status: 'connected',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,contact_id,platform,handle' }
  )
  if (error) throw new Error(error.message)
}

export async function resolveOrPickCandidate(
  args: Omit<SaveCandidateArgs, 'candidate'> & { candidates: MetaOAuthCandidate[] }
): Promise<ResolveOutcome> {
  const { candidates, ...rest } = args
  if (candidates.length === 0) return { kind: 'no_candidates' }
  if (candidates.length === 1) {
    await saveCandidate({ ...rest, candidate: candidates[0] })
    return { kind: 'saved', candidate: candidates[0] }
  }
  return { kind: 'needs_pick', candidates }
}
