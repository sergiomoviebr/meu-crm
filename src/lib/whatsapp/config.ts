// ============================================================
// Save-a-WhatsApp-config core, shared by the two ways credentials can
// arrive: the manual form (POST /api/whatsapp/config) and the Meta
// Embedded Signup exchange (POST /api/whatsapp/embedded-signup/
// exchange). Extracted verbatim from the manual route's POST handler
// — same verify → encrypt → register → subscribe → upsert sequence,
// same response shape, so this is a pure refactor, not a behavior
// change. See docs/adr/0006-meta-oauth-connections.md for why the
// two entry points share this instead of duplicating it.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
  type MetaPhoneInfo,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export interface SaveWhatsappConfigInput {
  phoneNumberId: string
  wabaId?: string | null
  accessToken: string
  verifyToken?: string | null
  pin?: string | null
}

export type SaveWhatsappConfigResult =
  | { kind: 'error'; code: string; message: string; status: number }
  | { kind: 'saved_with_registration_error'; registrationError: string; phoneInfo: MetaPhoneInfo }
  | { kind: 'saved'; registered: boolean; registrationSkipped: boolean; phoneInfo: MetaPhoneInfo }

export async function saveWhatsappConfig(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  input: SaveWhatsappConfigInput
): Promise<SaveWhatsappConfigResult> {
  const { phoneNumberId, wabaId, accessToken, verifyToken, pin } = input

  if (!accessToken || !phoneNumberId) {
    return {
      kind: 'error',
      code: 'validation_error',
      message: 'access_token and phone_number_id are required',
      status: 400,
    }
  }

  if (pin !== undefined && pin !== null && pin !== '') {
    if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return { kind: 'error', code: 'validation_error', message: 'PIN must be exactly 6 digits.', status: 400 }
    }
  }

  // Reject if another account has already claimed this phone_number_id.
  // wacrm is single-tenant-per-WhatsApp-number — letting two accounts
  // bind the same number causes the webhook's `.single()` lookup to
  // throw PGRST116 ("multiple rows"), silently dropping every
  // inbound message. See issue #136. Keyed on account_id (not
  // user_id) since teammates inside the same account all share one
  // config; the conflict is between accounts.
  const { data: claimed, error: claimedError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle()

  if (claimedError) {
    console.error('Error checking phone_number_id ownership:', claimedError)
    return { kind: 'error', code: 'db_error', message: 'Failed to validate configuration', status: 500 }
  }

  if (claimed) {
    return {
      kind: 'error',
      code: 'phone_claimed',
      message:
        'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
      status: 409,
    }
  }

  // Verify credentials with Meta BEFORE saving.
  let phoneInfo: MetaPhoneInfo
  try {
    phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error'
    console.error('Meta API verification failed during save:', message)
    return { kind: 'error', code: 'meta_verify_failed', message: `Meta API error: ${message}`, status: 400 }
  }

  // Encrypt sensitive tokens before storing.
  let encryptedAccessToken: string
  let encryptedVerifyToken: string | null
  try {
    encryptedAccessToken = encrypt(accessToken)
    encryptedVerifyToken = verifyToken ? encrypt(verifyToken) : null
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown encryption error'
    console.error('Encryption failed:', message)
    return {
      kind: 'error',
      code: 'encryption_failed',
      message:
        'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
      status: 500,
    }
  }

  // Look up any pre-existing row for this account so we know whether
  // this number is already registered with Meta — if so we can skip
  // /register when the caller didn't supply a fresh PIN this time.
  const { data: existing } = await supabase
    .from('whatsapp_config')
    .select('id, registered_at, phone_number_id')
    .eq('account_id', accountId)
    .maybeSingle()

  const sameNumber = existing?.phone_number_id === phoneNumberId && existing?.registered_at != null

  // Step 1: register the phone number for inbound webhooks. Attempted
  // on first save AND whenever a fresh PIN is supplied (e.g. rotated
  // in Meta Manager). Skipped when the same number is already
  // registered and no PIN was supplied — re-registering an
  // already-active number with a stale PIN would undo the active
  // subscription.
  let registeredAt: string | null = existing?.registered_at ?? null
  let registrationError: string | null = null
  // True when registration was deliberately skipped because no PIN
  // was supplied. Distinct from registrationError — not a failure,
  // just an incomplete-but-valid save.
  let registrationSkipped = false

  const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)
  if (needsRegistration) {
    if (!pin) {
      // No PIN provided. Meta TEST numbers (Developer Console) are
      // pre-registered by Meta and expose no two-step verification
      // PIN to set, so requiring one made them impossible to connect
      // (issue #242). The /register + PIN step only matters for
      // production numbers under a shared WABA (issue #136), so treat
      // it as best-effort: skip it, save the (already Meta-verified)
      // credentials as connected, and leave registered_at null.
      registrationSkipped = true
    } else {
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken, pin })
        registeredAt = new Date().toISOString()
      } catch (err) {
        registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('Phone number /register failed:', registrationError)
        // Deliberately fall through and still save the row so the
        // caller can retry without re-entering everything.
      }
    }
  }

  // Step 2: subscribe the WABA to this app. Idempotent on Meta's
  // side, so called on every save; skipped only when there's no
  // waba_id (legacy rows from before it was required).
  let subscribedAppsAt: string | null = null
  if (wabaId) {
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('WABA subscribed_apps failed (non-fatal):', message)
    }
  }

  // Persist everything in one shot. If /register failed we still
  // store the credentials and the error so the caller can guide the
  // user through a retry.
  const baseRow = {
    phone_number_id: phoneNumberId,
    waba_id: wabaId || null,
    access_token: encryptedAccessToken,
    verify_token: encryptedVerifyToken,
    status: registrationError ? 'disconnected' : 'connected',
    connected_at: registrationError ? null : new Date().toISOString(),
    registered_at: registrationError ? null : registeredAt,
    subscribed_apps_at: subscribedAppsAt ?? null,
    last_registration_error: registrationError,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update(baseRow)
      .eq('account_id', accountId)

    if (updateError) {
      console.error('Error updating whatsapp_config:', updateError)
      return { kind: 'error', code: 'db_error', message: 'Failed to update configuration', status: 500 }
    }
  } else {
    // `account_id` is the tenancy key (NOT NULL post-017, UNIQUE so
    // duplicates trip the constraint up-front), `user_id` is the
    // audit column identifying which member saved the config.
    const { error: insertError } = await supabase
      .from('whatsapp_config')
      .insert({ account_id: accountId, user_id: userId, ...baseRow })

    if (insertError) {
      console.error('Error inserting whatsapp_config:', insertError)
      return { kind: 'error', code: 'db_error', message: 'Failed to save configuration', status: 500 }
    }
  }

  if (registrationError) {
    return { kind: 'saved_with_registration_error', registrationError, phoneInfo }
  }

  return { kind: 'saved', registered: registeredAt != null, registrationSkipped, phoneInfo }
}
