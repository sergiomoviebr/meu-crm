// ============================================================
// Opaque, tamper-proof `state`/picker payloads for the Meta OAuth
// flow — no server-side session table. Both round-trip through
// AES-256-GCM `encrypt`/`decrypt` (src/lib/whatsapp/encryption.ts,
// the project's one encryption primitive — GCM's auth tag already
// gives tamper-detection for free, so no separate HMAC layer is
// needed on top). The picker payload additionally carries real
// page/ad-account access tokens between the callback and the
// finalize step, which is exactly why it goes through the same
// *encrypting* primitive rather than a signature-only scheme — it
// must never be readable from the URL/logs, not just unforgeable.
// ============================================================

import crypto from 'node:crypto'

import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { MetaOAuthError, type MetaOAuthCandidate, type MetaOAuthProduct, type MetaOAuthState } from './types'

// Long enough to cover the Meta consent screen (the state round-trips
// through Meta's redirect); short enough that a leaked/replayed URL
// goes stale fast.
const STATE_TTL_SECONDS = 10 * 60
const PICKER_TTL_SECONDS = 10 * 60

export function signState(input: {
  accountId: string
  userId: string
  product: MetaOAuthProduct
  contactId: string
}): string {
  const payload: MetaOAuthState = {
    ...input,
    nonce: crypto.randomBytes(12).toString('hex'),
    iat: Math.floor(Date.now() / 1000),
  }
  return encrypt(JSON.stringify(payload))
}

export function verifyState(token: string): MetaOAuthState {
  let payload: MetaOAuthState
  try {
    payload = JSON.parse(decrypt(token)) as MetaOAuthState
  } catch {
    throw new MetaOAuthError('invalid_state', 'Invalid or corrupted OAuth state', 400)
  }
  if (!payload.accountId || !payload.product || !payload.iat) {
    throw new MetaOAuthError('invalid_state', 'Invalid or corrupted OAuth state', 400)
  }
  if (Math.floor(Date.now() / 1000) - payload.iat > STATE_TTL_SECONDS) {
    throw new MetaOAuthError('state_expired', 'This connection attempt expired — please try again.', 400)
  }
  return payload
}

export interface PickerPayload {
  accountId: string
  userId: string
  product: MetaOAuthProduct
  contactId: string
  candidates: MetaOAuthCandidate[]
  /** The long-lived user token itself — the `ads` product's finalize
   *  step uses this directly (ad accounts have no per-account page
   *  token, see MetaOAuthCandidate's doc comment); facebook/instagram
   *  use each candidate's own `accessToken` instead. */
  userAccessToken: string
  iat: number
}

export function signPickerPayload(input: Omit<PickerPayload, 'iat'>): string {
  const payload: PickerPayload = { ...input, iat: Math.floor(Date.now() / 1000) }
  return encrypt(JSON.stringify(payload))
}

export function verifyPickerPayload(token: string): PickerPayload {
  let payload: PickerPayload
  try {
    payload = JSON.parse(decrypt(token)) as PickerPayload
  } catch {
    throw new MetaOAuthError('invalid_picker_token', 'Invalid or corrupted selection', 400)
  }
  if (!payload.accountId || !Array.isArray(payload.candidates) || !payload.iat) {
    throw new MetaOAuthError('invalid_picker_token', 'Invalid or corrupted selection', 400)
  }
  if (Math.floor(Date.now() / 1000) - payload.iat > PICKER_TTL_SECONDS) {
    throw new MetaOAuthError(
      'picker_token_expired',
      'This selection expired — reconnect and try again.',
      400
    )
  }
  return payload
}
