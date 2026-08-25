import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { exchangeEmbeddedSignupCode } from '@/lib/meta-oauth/client'
import { MetaOAuthError } from '@/lib/meta-oauth/types'
import { saveWhatsappConfig } from '@/lib/whatsapp/config'

/**
 * POST /api/whatsapp/embedded-signup/exchange
 *
 * Body: { code, wabaId, phoneNumberId, pin? } — `code` comes back
 * from Meta's Embedded Signup popup via the SDK's `FB.login`
 * callback; `wabaId`/`phoneNumberId` arrive separately via the
 * `WA_EMBEDDED_SIGNUP` `window.postMessage` event Meta fires during
 * the same flow (see whatsapp-config.tsx). The frontend forwards all
 * three here together.
 *
 * From the token exchange onward this reuses the EXACT same
 * verify → encrypt → register → subscribe → upsert sequence the
 * manual form uses (`saveWhatsappConfig`, shared with
 * POST /api/whatsapp/config) — only how the access_token was
 * obtained differs.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const body = await request.json().catch(() => null)
    const code = typeof body?.code === 'string' ? body.code : null
    const wabaId = typeof body?.wabaId === 'string' ? body.wabaId : null
    const phoneNumberId = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId : null
    const pin = typeof body?.pin === 'string' ? body.pin : null

    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json(
        { error: 'code, wabaId, and phoneNumberId are required' },
        { status: 400 }
      )
    }

    const { accessToken } = await exchangeEmbeddedSignupCode(code)

    const result = await saveWhatsappConfig(ctx.supabase, ctx.accountId, ctx.userId, {
      phoneNumberId,
      wabaId,
      accessToken,
      pin,
    })

    if (result.kind === 'error') {
      return NextResponse.json({ error: result.message }, { status: result.status })
    }
    if (result.kind === 'saved_with_registration_error') {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: result.registrationError,
        phone_info: result.phoneInfo,
      })
    }
    return NextResponse.json({
      success: true,
      saved: true,
      registered: result.registered,
      registration_skipped: result.registrationSkipped,
      phone_info: result.phoneInfo,
    })
  } catch (error) {
    if (error instanceof MetaOAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in WhatsApp embedded-signup exchange:', error)
    return toErrorResponse(error)
  }
}
