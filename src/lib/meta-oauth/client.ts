// ============================================================
// Thin Graph API wrappers for the standard Meta OAuth
// authorization-code flow (Instagram / Facebook / Meta Ads).
// Mirrors src/lib/whatsapp/meta-api.ts's conventions: named-params
// functions, one shared error-throwing helper, same API version.
// ============================================================

import type { MetaOAuthCandidate, MetaOAuthProduct } from './types'
import { MetaOAuthError } from './types'

const META_API_VERSION = 'v21.0'
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`
const META_DIALOG_BASE = `https://www.facebook.com/${META_API_VERSION}`

/**
 * Scopes requested per product. Deliberately minimal — `ads_management`/
 * `instagram_content_publish` are sensitive scopes that require Meta App
 * Review beyond Standard Access; requesting less here means less to
 * justify in that review, not a technical limitation.
 */
export const PRODUCT_SCOPES: Record<MetaOAuthProduct, string[]> = {
  facebook: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
  instagram: [
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_content_publish',
  ],
  ads: ['ads_management', 'ads_read', 'business_management'],
}

interface MetaGraphErrorBody {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaOAuthError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaGraphErrorBody
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new MetaOAuthError('meta_api_error', message, 502)
}

function requireAppCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    throw new MetaOAuthError(
      'not_configured',
      'META_APP_ID and META_APP_SECRET must be set to use "Connect with Meta".',
      503
    )
  }
  return { appId, appSecret }
}

export function buildAuthorizeUrl(args: {
  product: MetaOAuthProduct
  state: string
  redirectUri: string
}): string {
  const { appId } = requireAppCredentials()
  const url = new URL(`${META_DIALOG_BASE}/dialog/oauth`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('state', args.state)
  url.searchParams.set('scope', PRODUCT_SCOPES[args.product].join(','))
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

export interface MetaOAuthToken {
  accessToken: string
  expiresIn?: number
}

export async function exchangeCodeForToken(args: {
  code: string
  redirectUri: string
}): Promise<MetaOAuthToken> {
  const { appId, appSecret } = requireAppCredentials()
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('code', args.code)

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) await throwMetaOAuthError(response, 'Failed to exchange OAuth code')
  const data = (await response.json()) as { access_token: string; expires_in?: number }
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

/**
 * Code exchange for Meta's WhatsApp **Embedded Signup** popup (SDK
 * `FB.login`, not the redirect `dialog/oauth` flow the rest of this
 * file wraps) — no `redirect_uri` in the request, since there's no
 * page redirect to match one against.
 *
 * ⚠️ Highest-uncertainty call in this module: Meta's Embedded Signup
 * wire format shifts across API versions and isn't fully verifiable
 * without a live popup to test against (see docs/adr/0006). Confirm
 * this still matches Meta's current docs before relying on it in
 * production, and adjust here (not by hand-rolling parallel logic in
 * the calling route) if it's changed.
 */
export async function exchangeEmbeddedSignupCode(code: string): Promise<MetaOAuthToken> {
  const { appId, appSecret } = requireAppCredentials()
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('code', code)

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) await throwMetaOAuthError(response, 'Failed to exchange Embedded Signup code')
  const data = (await response.json()) as { access_token: string; expires_in?: number }
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

/**
 * Short-lived user tokens expire in ~1-2h; exchanging for a long-lived
 * token (~60 days) is what actually gets stored (encrypted) in
 * social_profiles/ad_accounts.access_token_encrypted.
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaOAuthToken> {
  const { appId, appSecret } = requireAppCredentials()
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('fb_exchange_token', shortLivedToken)

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) await throwMetaOAuthError(response, 'Failed to obtain a long-lived token')
  const data = (await response.json()) as { access_token: string; expires_in?: number }
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export interface MetaPage {
  id: string
  name: string
  /** Page vanity username. Not every Page has one — falls back to the
   *  numeric id as social_profiles.handle when absent (see
   *  pagesToCandidates), since that column is NOT NULL. */
  username?: string
  access_token: string
  instagram_business_account?: { id: string; username?: string }
}

/** GET /me/accounts — every Facebook Page the authenticated user manages. */
export async function listPages(accessToken: string): Promise<MetaPage[]> {
  const url = `${META_GRAPH_BASE}/me/accounts?fields=id,name,username,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(accessToken)}`
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) await throwMetaOAuthError(response, 'Failed to list Facebook Pages')
  const data = (await response.json()) as { data: MetaPage[] }
  return data.data ?? []
}

export interface MetaAdAccount {
  id: string
  name: string
  currency: string
}

/** GET /me/adaccounts — every ad account the authenticated user can manage. */
export async function listAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  const url = `${META_GRAPH_BASE}/me/adaccounts?fields=id,name,currency&access_token=${encodeURIComponent(accessToken)}`
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) await throwMetaOAuthError(response, 'Failed to list ad accounts')
  const data = (await response.json()) as { data: MetaAdAccount[] }
  return data.data ?? []
}

/**
 * Maps raw Graph API results onto the product-agnostic candidate
 * shape the OAuth callback/picker/finalize routes work with. Pure —
 * no network — so it's unit-testable without mocking fetch.
 */
export function pagesToCandidates(pages: MetaPage[], product: 'facebook' | 'instagram'): MetaOAuthCandidate[] {
  if (product === 'facebook') {
    return pages.map((p) => ({ id: p.id, name: p.name, handle: p.username ?? p.id, accessToken: p.access_token }))
  }
  // instagram: only pages that actually have a linked IG Business
  // Account are connectable — the ones without one can't publish.
  return pages
    .filter((p): p is MetaPage & { instagram_business_account: { id: string; username?: string } } =>
      Boolean(p.instagram_business_account?.id)
    )
    .map((p) => {
      const ig = p.instagram_business_account
      return {
        id: ig.id,
        name: ig.username ? `@${ig.username}` : p.name,
        handle: ig.username ?? ig.id,
        instagramBusinessAccountId: ig.id,
        accessToken: p.access_token,
      }
    })
}

export function adAccountsToCandidates(accounts: MetaAdAccount[]): MetaOAuthCandidate[] {
  // No per-account token — see the doc comment on MetaOAuthCandidate.
  return accounts.map((a) => ({ id: a.id, name: a.name }))
}
