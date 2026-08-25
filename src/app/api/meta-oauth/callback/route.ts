import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  adAccountsToCandidates,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
  listPages,
  pagesToCandidates,
} from '@/lib/meta-oauth/client'
import { resolveOrPickCandidate } from '@/lib/meta-oauth/connect'
import { getMetaOAuthRedirectUri } from '@/lib/meta-oauth/redirect-uri'
import { signPickerPayload, verifyState } from '@/lib/meta-oauth/state'
import { MetaOAuthError, type MetaOAuthCandidate } from '@/lib/meta-oauth/types'
import { supabaseAdmin } from '@/lib/content/admin-client'

/** Where the destination settings page lives per product, and what
 *  query param it reads back the outcome from. */
function destinationUrl(
  origin: string,
  product: 'facebook' | 'instagram' | 'ads',
  contactId: string
): URL {
  const path = product === 'ads' ? '/traffic/accounts' : '/content/social-profiles'
  const url = new URL(path, origin)
  url.searchParams.set('contact_id', contactId)
  if (product !== 'ads') url.searchParams.set('view', 'contact')
  return url
}

/**
 * GET /api/meta-oauth/callback
 *
 * Meta redirects the browser here after the consent screen. Never a
 * fetch target — always a full-page navigation, so every outcome
 * (success, "pick one", error) is communicated via a redirect with a
 * query param, not a JSON body.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)

  try {
    const ctx = await requireRole('admin')

    // The user can decline consent on Meta's screen — that comes back
    // as `error`/`error_description`, not `code`.
    const metaError = searchParams.get('error_description') ?? searchParams.get('error')
    const stateParam = searchParams.get('state')
    const code = searchParams.get('code')

    if (!stateParam) {
      return NextResponse.json({ error: 'Missing OAuth state' }, { status: 400 })
    }
    const state = verifyState(stateParam)
    if (state.accountId !== ctx.accountId) {
      // A state signed for a different account landing on this
      // session — refuse rather than silently connecting into the
      // wrong account.
      return NextResponse.json({ error: 'This connection attempt belongs to a different account.' }, { status: 403 })
    }

    const dest = destinationUrl(origin, state.product, state.contactId)

    if (metaError || !code) {
      dest.searchParams.set('meta_oauth', 'denied')
      return NextResponse.redirect(dest)
    }

    const redirectUri = getMetaOAuthRedirectUri()
    const { accessToken: shortLivedToken } = await exchangeCodeForToken({ code, redirectUri })
    const { accessToken: longLivedToken } = await exchangeForLongLivedToken(shortLivedToken)

    let candidates: MetaOAuthCandidate[]
    if (state.product === 'ads') {
      candidates = adAccountsToCandidates(await listAdAccounts(longLivedToken))
    } else {
      candidates = pagesToCandidates(await listPages(longLivedToken), state.product)
    }

    const outcome = await resolveOrPickCandidate({
      admin: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId: state.contactId,
      product: state.product,
      candidates,
      userAccessToken: longLivedToken,
    })

    if (outcome.kind === 'no_candidates') {
      dest.searchParams.set('meta_oauth', state.product === 'ads' ? 'no_ad_accounts' : 'no_pages')
      return NextResponse.redirect(dest)
    }

    if (outcome.kind === 'needs_pick') {
      const pickerToken = signPickerPayload({
        accountId: ctx.accountId,
        userId: ctx.userId,
        product: state.product,
        contactId: state.contactId,
        candidates: outcome.candidates,
        userAccessToken: longLivedToken,
      })
      dest.searchParams.set('meta_oauth_picker', pickerToken)
      return NextResponse.redirect(dest)
    }

    dest.searchParams.set('meta_oauth', 'connected')
    return NextResponse.redirect(dest)
  } catch (error) {
    if (error instanceof MetaOAuthError) {
      // Best-effort redirect back with an error flag; falls back to a
      // plain JSON error if we don't even have a valid state to know
      // where "back" is.
      const stateParam = searchParams.get('state')
      try {
        const state = verifyState(stateParam ?? '')
        const dest = destinationUrl(origin, state.product, state.contactId)
        dest.searchParams.set('meta_oauth', 'error')
        return NextResponse.redirect(dest)
      } catch {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
    }
    console.error('Error in meta-oauth callback:', error)
    return toErrorResponse(error)
  }
}
