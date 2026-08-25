import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(() => ({ success: true })),
  buildAuthorizeUrl: vi.fn(() => 'https://www.facebook.com/v21.0/dialog/oauth?mock=1'),
  signState: vi.fn(() => 'signed-state-token'),
  getMetaOAuthRedirectUri: vi.fn(() => 'https://x.test/api/meta-oauth/callback'),
  contactMaybeSingle: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(() => Response.json({ error: 'Rate limited' }, { status: 429 })),
  RATE_LIMITS: { metaOauthStart: { limit: 10, windowMs: 60_000 } },
}))
vi.mock('@/lib/meta-oauth/client', () => ({ buildAuthorizeUrl: mocks.buildAuthorizeUrl }))
vi.mock('@/lib/meta-oauth/state', () => ({ signState: mocks.signState }))
vi.mock('@/lib/meta-oauth/redirect-uri', () => ({ getMetaOAuthRedirectUri: mocks.getMetaOAuthRedirectUri }))
vi.mock('@/lib/content/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.contactMaybeSingle }) }) }),
    }),
  }),
}))

import { GET } from './route'

function req(qs: string) {
  return new Request(`http://localhost/api/meta-oauth/start${qs}`)
}

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
  mocks.checkRateLimit.mockReturnValue({ success: true })
  mocks.contactMaybeSingle.mockReset().mockResolvedValue({ data: { id: 'contact-1' } })
})

describe('GET /api/meta-oauth/start', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'))
    const res = await GET(req('?product=facebook&contact_id=contact-1'))
    expect(res.status).toBe(403)
  })

  it('rejects an unknown product', async () => {
    const res = await GET(req('?product=twitter&contact_id=contact-1'))
    expect(res.status).toBe(400)
  })

  it('requires contact_id', async () => {
    const res = await GET(req('?product=facebook'))
    expect(res.status).toBe(400)
  })

  it('404s when the contact does not belong to this account', async () => {
    mocks.contactMaybeSingle.mockResolvedValue({ data: null })
    const res = await GET(req('?product=facebook&contact_id=contact-1'))
    expect(res.status).toBe(404)
  })

  it('redirects to the Meta authorize URL on success', async () => {
    const res = await GET(req('?product=instagram&contact_id=contact-1'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://www.facebook.com/v21.0/dialog/oauth?mock=1')
    expect(mocks.signState).toHaveBeenCalledWith({
      accountId: 'acct-1',
      userId: 'user-1',
      product: 'instagram',
      contactId: 'contact-1',
    })
  })
})
