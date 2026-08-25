import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { verifyPickerPayload } from '@/lib/meta-oauth/state'
import { MetaOAuthError } from '@/lib/meta-oauth/types'

/**
 * GET /api/meta-oauth/picker?token=<signed>
 *
 * Decodes the signed picker payload from the callback and returns
 * ONLY what's safe to show in the UI — id + display name. The
 * candidates' access tokens (and the shared user token) stay inside
 * the encrypted blob; they never leave this route's response.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 })
    }

    const payload = verifyPickerPayload(token)
    if (payload.accountId !== ctx.accountId) {
      return NextResponse.json({ error: 'This selection belongs to a different account.' }, { status: 403 })
    }

    return NextResponse.json({
      product: payload.product,
      contactId: payload.contactId,
      candidates: payload.candidates.map((c) => ({ id: c.id, name: c.name })),
    })
  } catch (error) {
    if (error instanceof MetaOAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in meta-oauth picker:', error)
    return toErrorResponse(error)
  }
}
