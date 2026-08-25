import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { buildAuthorizeUrl } from '@/lib/meta-oauth/client'
import { signState } from '@/lib/meta-oauth/state'
import { getMetaOAuthRedirectUri } from '@/lib/meta-oauth/redirect-uri'
import { MetaOAuthError, type MetaOAuthProduct } from '@/lib/meta-oauth/types'
import { supabaseAdmin } from '@/lib/content/admin-client'

const VALID_PRODUCTS: MetaOAuthProduct[] = ['facebook', 'instagram', 'ads']

/**
 * GET /api/meta-oauth/start?product=facebook|instagram|ads&contact_id=<uuid>
 *
 * Redirects the browser to Meta's OAuth consent screen. A full-page
 * navigation, not a fetch — the settings UI links here directly.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(`meta-oauth-start:${ctx.userId}`, RATE_LIMITS.metaOauthStart)
    if (!limit.success) return rateLimitResponse(limit)

    const { searchParams } = new URL(request.url)
    const product = searchParams.get('product')
    const contactId = searchParams.get('contact_id')

    if (!product || !VALID_PRODUCTS.includes(product as MetaOAuthProduct)) {
      return NextResponse.json(
        { error: `product must be one of ${VALID_PRODUCTS.join(', ')}` },
        { status: 400 }
      )
    }
    if (!contactId) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
    }

    // Confirm the contact actually belongs to this account before
    // baking it into the state — the callback trusts this id later
    // without re-checking, since re-deriving it from a fresh query at
    // that point wouldn't catch a forged contact_id any more safely
    // than checking once, up front, here.
    const { data: contact } = await supabaseAdmin()
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const state = signState({
      accountId: ctx.accountId,
      userId: ctx.userId,
      product: product as MetaOAuthProduct,
      contactId,
    })
    const authorizeUrl = buildAuthorizeUrl({
      product: product as MetaOAuthProduct,
      state,
      redirectUri: getMetaOAuthRedirectUri(),
    })

    return NextResponse.redirect(authorizeUrl)
  } catch (error) {
    if (error instanceof MetaOAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in meta-oauth start:', error)
    return toErrorResponse(error)
  }
}
