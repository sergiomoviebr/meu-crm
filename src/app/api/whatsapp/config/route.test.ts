import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage for the POST handler after extracting its body
// into src/lib/whatsapp/config.ts's saveWhatsappConfig — this route
// is now a thin adapter (auth -> call the shared core -> map the
// result onto a Response), so these tests focus on that mapping, not
// re-testing business logic already covered by config.test.ts.

const mocks = vi.hoisted(() => ({
  saveWhatsappConfig: vi.fn(),
}))
vi.mock('@/lib/whatsapp/config', () => ({ saveWhatsappConfig: mocks.saveWhatsappConfig }))

const supabaseMock = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
  },
  from: (table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { account_id: 'acct-1' }, error: null }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  },
}
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseMock) }))

import { POST } from './route'

function postReq(body: unknown) {
  return new Request('http://localhost/api/whatsapp/config', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.saveWhatsappConfig.mockReset()
})

describe('POST /api/whatsapp/config', () => {
  it('maps a saved result onto the success response shape', async () => {
    mocks.saveWhatsappConfig.mockResolvedValue({
      kind: 'saved',
      registered: true,
      registrationSkipped: false,
      phoneInfo: { id: 'PNID-1', display_phone_number: '+1...' },
    })

    const res = await POST(postReq({ phone_number_id: 'PNID-1', access_token: 'tok' }))
    const body = await res.json()

    expect(mocks.saveWhatsappConfig).toHaveBeenCalledWith(supabaseMock, 'acct-1', 'user-1', {
      phoneNumberId: 'PNID-1',
      wabaId: undefined,
      accessToken: 'tok',
      verifyToken: undefined,
      pin: undefined,
    })
    expect(body).toEqual({
      success: true,
      saved: true,
      registered: true,
      registration_skipped: false,
      phone_info: { id: 'PNID-1', display_phone_number: '+1...' },
    })
  })

  it('maps an error result onto {error} with the matching status', async () => {
    mocks.saveWhatsappConfig.mockResolvedValue({
      kind: 'error',
      code: 'phone_claimed',
      message: 'already linked to another account',
      status: 409,
    })
    const res = await POST(postReq({ phone_number_id: 'PNID-1', access_token: 'tok' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already linked to another account' })
  })

  it('maps a saved_with_registration_error result onto success:false', async () => {
    mocks.saveWhatsappConfig.mockResolvedValue({
      kind: 'saved_with_registration_error',
      registrationError: 'bad pin',
      phoneInfo: { id: 'PNID-1', display_phone_number: '+1...' },
    })
    const res = await POST(postReq({ phone_number_id: 'PNID-1', access_token: 'tok' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: false, saved: true, registered: false, registration_error: 'bad pin' })
  })
})
