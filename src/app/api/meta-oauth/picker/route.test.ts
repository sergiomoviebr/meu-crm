import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  verifyPickerPayload: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))
vi.mock('@/lib/meta-oauth/state', () => ({ verifyPickerPayload: mocks.verifyPickerPayload }))

import { GET } from './route'

const PAYLOAD = {
  accountId: 'acct-1',
  userId: 'user-1',
  product: 'facebook' as const,
  contactId: 'contact-1',
  candidates: [
    { id: 'p1', name: 'Page One', accessToken: 'secret-token-1' },
    { id: 'p2', name: 'Page Two', accessToken: 'secret-token-2' },
  ],
  userAccessToken: 'secret-user-token',
}

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
  mocks.verifyPickerPayload.mockReset().mockReturnValue(PAYLOAD)
})

describe('GET /api/meta-oauth/picker', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'))
    const res = await GET(new Request('http://localhost/api/meta-oauth/picker?token=t'))
    expect(res.status).toBe(403)
  })

  it('requires a token', async () => {
    const res = await GET(new Request('http://localhost/api/meta-oauth/picker'))
    expect(res.status).toBe(400)
  })

  it('refuses a payload signed for a different account', async () => {
    mocks.verifyPickerPayload.mockReturnValue({ ...PAYLOAD, accountId: 'other-acct' })
    const res = await GET(new Request('http://localhost/api/meta-oauth/picker?token=t'))
    expect(res.status).toBe(403)
  })

  it('returns only id/name — never the access tokens', async () => {
    const res = await GET(new Request('http://localhost/api/meta-oauth/picker?token=t'))
    const body = await res.json()
    expect(body).toEqual({
      product: 'facebook',
      contactId: 'contact-1',
      candidates: [
        { id: 'p1', name: 'Page One' },
        { id: 'p2', name: 'Page Two' },
      ],
    })
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('secret-token')
    expect(raw).not.toContain('secret-user-token')
  })
})
