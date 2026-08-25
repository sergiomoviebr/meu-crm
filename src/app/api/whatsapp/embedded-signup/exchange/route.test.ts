import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  exchangeEmbeddedSignupCode: vi.fn(),
  saveWhatsappConfig: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))
vi.mock('@/lib/meta-oauth/client', () => ({ exchangeEmbeddedSignupCode: mocks.exchangeEmbeddedSignupCode }))
vi.mock('@/lib/whatsapp/config', () => ({ saveWhatsappConfig: mocks.saveWhatsappConfig }))

import { POST } from './route'

function postReq(body: unknown) {
  return new Request('http://localhost/api/whatsapp/embedded-signup/exchange', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.requireRole
    .mockReset()
    .mockResolvedValue({ supabase: {}, accountId: 'acct-1', userId: 'user-1' })
  mocks.exchangeEmbeddedSignupCode.mockReset().mockResolvedValue({ accessToken: 'exchanged-token' })
  mocks.saveWhatsappConfig.mockReset()
})

describe('POST /api/whatsapp/embedded-signup/exchange', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'))
    const res = await POST(postReq({ code: 'c', wabaId: 'w', phoneNumberId: 'p' }))
    expect(res.status).toBe(403)
  })

  it('requires code, wabaId, and phoneNumberId', async () => {
    const res = await POST(postReq({ code: 'c' }))
    expect(res.status).toBe(400)
    expect(mocks.exchangeEmbeddedSignupCode).not.toHaveBeenCalled()
  })

  it('exchanges the code, then saves via the shared saveWhatsappConfig core', async () => {
    mocks.saveWhatsappConfig.mockResolvedValue({
      kind: 'saved',
      registered: true,
      registrationSkipped: false,
      phoneInfo: { id: 'p', display_phone_number: '+1...' },
    })

    const res = await POST(postReq({ code: 'raw-code', wabaId: 'WABA-1', phoneNumberId: 'PNID-1', pin: '123456' }))
    const body = await res.json()

    expect(mocks.exchangeEmbeddedSignupCode).toHaveBeenCalledWith('raw-code')
    expect(mocks.saveWhatsappConfig).toHaveBeenCalledWith({}, 'acct-1', 'user-1', {
      phoneNumberId: 'PNID-1',
      wabaId: 'WABA-1',
      accessToken: 'exchanged-token',
      pin: '123456',
    })
    expect(body).toMatchObject({ success: true, saved: true, registered: true })
  })

  it('maps a saveWhatsappConfig error result onto the matching HTTP status', async () => {
    mocks.saveWhatsappConfig.mockResolvedValue({
      kind: 'error',
      code: 'meta_verify_failed',
      message: 'Meta API error: bad token',
      status: 400,
    })
    const res = await POST(postReq({ code: 'c', wabaId: 'w', phoneNumberId: 'p' }))
    expect(res.status).toBe(400)
  })

  it('reports a registration error without failing the whole request', async () => {
    mocks.saveWhatsappConfig.mockResolvedValue({
      kind: 'saved_with_registration_error',
      registrationError: 'bad pin',
      phoneInfo: { id: 'p', display_phone_number: '+1...' },
    })
    const res = await POST(postReq({ code: 'c', wabaId: 'w', phoneNumberId: 'p' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: false, saved: true, registered: false, registration_error: 'bad pin' })
  })
})
