import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { saveCandidate } from '@/lib/meta-oauth/connect'
import { verifyPickerPayload } from '@/lib/meta-oauth/state'
import { MetaOAuthError } from '@/lib/meta-oauth/types'
import { supabaseAdmin } from '@/lib/content/admin-client'

/**
 * POST /api/meta-oauth/finalize
 *
 * Body: { token, selectedId }. Re-verifies the same signed picker
 * payload the GET /picker route read from, pulls out the chosen
 * candidate's token, and does the actual social_profiles/ad_accounts
 * write — the one place in this flow a long-lived token actually
 * gets persisted.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const body = await request.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token : null
    const selectedId = typeof body?.selectedId === 'string' ? body.selectedId : null
    if (!token || !selectedId) {
      return NextResponse.json({ error: 'token and selectedId are required' }, { status: 400 })
    }

    const payload = verifyPickerPayload(token)
    if (payload.accountId !== ctx.accountId) {
      return NextResponse.json({ error: 'This selection belongs to a different account.' }, { status: 403 })
    }

    const candidate = payload.candidates.find((c) => c.id === selectedId)
    if (!candidate) {
      return NextResponse.json({ error: 'Unknown selection' }, { status: 400 })
    }

    await saveCandidate({
      admin: supabaseAdmin(),
      accountId: payload.accountId,
      userId: payload.userId,
      contactId: payload.contactId,
      product: payload.product,
      candidate,
      userAccessToken: payload.userAccessToken,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof MetaOAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in meta-oauth finalize:', error)
    return toErrorResponse(error)
  }
}
