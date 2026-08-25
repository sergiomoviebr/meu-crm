// ============================================================
// Shared "Connect with Meta" OAuth flow — Instagram, Facebook, and
// Meta Ads all go through the same standard authorization-code
// redirect flow, only the requested scopes and what happens after
// the token differ. WhatsApp is deliberately NOT one of these
// products: it uses Meta's Embedded Signup (a client-side popup, no
// page redirect) — see src/app/api/whatsapp/embedded-signup/.
// ============================================================

export type MetaOAuthProduct = 'facebook' | 'instagram' | 'ads'

export class MetaOAuthError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'MetaOAuthError'
    this.code = code
    this.status = status
  }
}

/**
 * Signed, opaque `state` payload — round-trips through Meta's
 * redirect unmodified, so it's how we recover which account/contact/
 * product a callback belongs to without a server-side session table.
 */
export interface MetaOAuthState {
  accountId: string
  userId: string
  product: MetaOAuthProduct
  /** Required for facebook/instagram/ads — social_profiles and
   *  ad_accounts are both per-client (contact_id NOT NULL). */
  contactId: string
  /** Random per-request value; not currently cross-checked against
   *  anything stored server-side (there is no session table), but
   *  keeps two `start` calls from ever producing byte-identical
   *  signed blobs. */
  nonce: string
  /** Unix seconds. Verified against a fixed TTL, not stored. */
  iat: number
}

/**
 * One Facebook Page or ad account discovered after exchanging the
 * OAuth code, before the user has picked which one to connect.
 *
 * `accessToken` is only meaningful for facebook/instagram — each
 * Page genuinely has its own page-scoped access token. Ad accounts
 * have no such per-account token; Meta Ads API calls are authorized
 * with the *user's* token plus the ad account id in the URL, so the
 * `ads` product reuses the shared `userAccessToken` on
 * PickerPayload/DirectConnection instead (see state.ts).
 */
export interface MetaOAuthCandidate {
  id: string
  /** Display name shown in the picker UI. */
  name: string
  /** Vanity username — becomes social_profiles.handle (NOT NULL;
   *  falls back to `id` when Meta has no username on file). Not
   *  meaningful for the `ads` product. */
  handle?: string
  /** Only present for the `instagram` product — the linked IG
   *  Business Account id, if the page has one. */
  instagramBusinessAccountId?: string
  /** Page access token — present for facebook/instagram candidates
   *  only, absent (undefined) for ads candidates. Never sent to the
   *  browser un-encrypted (see state.ts's signPickerPayload). */
  accessToken?: string
}
