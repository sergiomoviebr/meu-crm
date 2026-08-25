import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  verifyPickerPayload: vi.fn(),
  saveCandidate: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))
vi.mock('@/lib/meta-oauth/state', () => ({ verifyPickerPayload: mocks.verifyPickerPayload }))
vi.mock('@/lib/meta-oauth/connect', () => ({ saveCandidate: mocks.saveCandidate }))
vi.mock('@/lib/content/admin-client', () => ({ supabaseAdmin: () => ({}) }))

import { POST } from './route'

const PAYLOAD = {
  accountId: 'acct-1',
  userId: 'user-1',
  product: 'facebook' as const,
  contactId: 'contact-1',
  candidates: [
    { id: 'p1', name: 'Page One', accessToken: 'token-1' },
    { id: 'p2', name: 'Page Two', accessToken: 'token-2' },
  ],
  userAccessToken: 'user-token',
}

function postReq(body: unknown) {
  return new Request('http://localhost/api/meta-oauth/finalize', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
  mocks.verifyPickerPayload.mockReset().mockReturnValue(PAYLOAD)
  mocks.saveCandidate.mockReset().mockResolvedValue(undefined)
})

describe('POST /api/meta-oauth/finalize', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'))
    const res = await POST(postReq({ token: 't', selectedId: 'p1' }))
    expect(res.status).toBe(403)
  })

  it('requires token and selectedId', async () => {
    const res = await POST(postReq({ token: 't' }))
    expect(res.status).toBe(400)
  })

  it('refuses a payload signed for a different account', async () => {
    mocks.verifyPickerPayload.mockReturnValue({ ...PAYLOAD, accountId: 'other-acct' })
    const res = await POST(postReq({ token: 't', selectedId: 'p1' }))
    expect(res.status).toBe(403)
  })

  it('rejects a selectedId not present in the signed candidate list', async () => {
    const res = await POST(postReq({ token: 't', selectedId: 'not-a-real-id' }))
    expect(res.status).toBe(400)
    expect(mocks.saveCandidate).not.toHaveBeenCalled()
  })

  it('saves the chosen candidate and returns success', async () => {
    const res = await POST(postReq({ token: 't', selectedId: 'p2' }))
    expect(res.status).toBe(200)
    expect(mocks.saveCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'contact-1',
        product: 'facebook',
        candidate: PAYLOAD.candidates[1],
        userAccessToken: 'user-token',
      })
    )
  })
})
