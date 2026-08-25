import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  verifyPhoneNumber: vi.fn(),
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
}))
vi.mock('@/lib/whatsapp/meta-api', () => mocks)

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => adminMock,
}))

import { saveWhatsappConfig } from './config'

let adminMock: SupabaseClient

interface Script {
  claimedByOther?: { account_id: string } | null
  existing?: { id: string; registered_at: string | null; phone_number_id: string } | null
  updateError?: { message: string } | null
  insertError?: { message: string } | null
}

function makeSupabase(script: Script): SupabaseClient {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    insert: (payload: Record<string, unknown>) => {
      void payload
      return { then: (r: (v: unknown) => void) => r({ error: script.insertError ?? null }) }
    },
    update: (payload: Record<string, unknown>) => {
      void payload
      return { eq: () => ({ then: (r: (v: unknown) => void) => r({ error: script.updateError ?? null }) }) }
    },
    maybeSingle: () => Promise.resolve({ data: script.existing ?? null, error: null }),
  }
  return { from: () => builder } as unknown as SupabaseClient
}

function makeAdmin(script: Script): SupabaseClient {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    maybeSingle: () => Promise.resolve({ data: script.claimedByOther ?? null, error: null }),
  }
  return { from: () => builder } as unknown as SupabaseClient
}

const VALID_INPUT = { phoneNumberId: 'PNID-1', wabaId: 'WABA-1', accessToken: 'tok', pin: '123456' }

beforeEach(() => {
  mocks.verifyPhoneNumber.mockReset().mockResolvedValue({ id: 'PNID-1', display_phone_number: '+1...' })
  mocks.registerPhoneNumber.mockReset().mockResolvedValue(undefined)
  mocks.subscribeWabaToApp.mockReset().mockResolvedValue(undefined)
  adminMock = makeAdmin({})
})

describe('saveWhatsappConfig', () => {
  it('rejects a missing access_token/phone_number_id', async () => {
    const supabase = makeSupabase({})
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', { phoneNumberId: '', accessToken: '' })
    expect(result).toMatchObject({ kind: 'error', code: 'validation_error', status: 400 })
  })

  it('rejects a malformed PIN', async () => {
    const supabase = makeSupabase({})
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', { ...VALID_INPUT, pin: '12' })
    expect(result).toMatchObject({ kind: 'error', code: 'validation_error', status: 400 })
  })

  it('refuses a phone_number_id already claimed by another account', async () => {
    adminMock = makeAdmin({ claimedByOther: { account_id: 'other-acct' } })
    const supabase = makeSupabase({})
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', VALID_INPUT)
    expect(result).toMatchObject({ kind: 'error', code: 'phone_claimed', status: 409 })
  })

  it('surfaces a Meta verification failure without saving', async () => {
    mocks.verifyPhoneNumber.mockRejectedValue(new Error('Invalid token'))
    const supabase = makeSupabase({})
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', VALID_INPUT)
    expect(result).toMatchObject({ kind: 'error', code: 'meta_verify_failed', status: 400 })
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled()
  })

  it('registers + subscribes + saves on a first-time connect with a PIN', async () => {
    const supabase = makeSupabase({ existing: null })
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', VALID_INPUT)
    expect(mocks.registerPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: 'PNID-1',
      accessToken: 'tok',
      pin: '123456',
    })
    expect(mocks.subscribeWabaToApp).toHaveBeenCalledWith({ wabaId: 'WABA-1', accessToken: 'tok' })
    expect(result).toMatchObject({ kind: 'saved', registered: true, registrationSkipped: false })
  })

  it('skips registration (not an error) when no PIN is supplied on first connect — e.g. a Meta test number', async () => {
    const supabase = makeSupabase({ existing: null })
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', { ...VALID_INPUT, pin: undefined })
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'saved', registered: false, registrationSkipped: true })
  })

  it('reports saved_with_registration_error when /register fails, but still saves the row', async () => {
    mocks.registerPhoneNumber.mockRejectedValue(new Error('bad pin'))
    const supabase = makeSupabase({ existing: null })
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', VALID_INPUT)
    expect(result).toMatchObject({ kind: 'saved_with_registration_error', registrationError: 'bad pin' })
  })

  it('skips re-registration when the same already-registered number is saved again without a fresh PIN', async () => {
    const supabase = makeSupabase({
      existing: { id: 'row-1', registered_at: '2026-01-01T00:00:00Z', phone_number_id: 'PNID-1' },
    })
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', { ...VALID_INPUT, pin: undefined })
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'saved', registered: true, registrationSkipped: false })
  })

  it('surfaces a DB error on insert', async () => {
    const supabase = makeSupabase({ existing: null, insertError: { message: 'db down' } })
    const result = await saveWhatsappConfig(supabase, 'acct-1', 'user-1', VALID_INPUT)
    expect(result).toMatchObject({ kind: 'error', code: 'db_error', status: 500 })
  })
})
