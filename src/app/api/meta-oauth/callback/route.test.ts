import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  exchangeForLongLivedToken: vi.fn(),
  listPages: vi.fn(),
  listAdAccounts: vi.fn(),
  pagesToCandidates: vi.fn(),
  adAccountsToCandidates: vi.fn(),
  resolveOrPickCandidate: vi.fn(),
  signPickerPayload: vi.fn(() => 'picker-token'),
  getMetaOAuthRedirectUri: vi.fn(() => 'https://x.test/api/meta-oauth/callback'),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))
vi.mock('@/lib/meta-oauth/client', () => ({
  exchangeCodeForToken: mocks.exchangeCodeForToken,
  exchangeForLongLivedToken: mocks.exchangeForLongLivedToken,
  listPages: mocks.listPages,
  listAdAccounts: mocks.listAdAccounts,
  pagesToCandidates: mocks.pagesToCandidates,
  adAccountsToCandidates: mocks.adAccountsToCandidates,
}))
vi.mock('@/lib/meta-oauth/connect', () => ({ resolveOrPickCandidate: mocks.resolveOrPickCandidate }))
vi.mock('@/lib/meta-oauth/redirect-uri', () => ({ getMetaOAuthRedirectUri: mocks.getMetaOAuthRedirectUri }))
vi.mock('@/lib/meta-oauth/state', () => ({
  verifyState: mocks.verifyState,
  signPickerPayload: mocks.signPickerPayload,
}))
vi.mock('@/lib/content/admin-client', () => ({ supabaseAdmin: () => ({}) }))

import { GET } from './route'

const STATE = { accountId: 'acct-1', userId: 'user-1', product: 'facebook' as const, contactId: 'contact-1' }

function req(qs: string) {
  return new Request(`http://localhost/api/meta-oauth/callback${qs}`)
}

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
  mocks.verifyState.mockReset().mockReturnValue(STATE)
  mocks.exchangeCodeForToken.mockReset().mockResolvedValue({ accessToken: 'short-token' })
  mocks.exchangeForLongLivedToken.mockReset().mockResolvedValue({ accessToken: 'long-token' })
  mocks.listPages.mockReset().mockResolvedValue([])
  mocks.pagesToCandidates.mockReset().mockReturnValue([])
  mocks.resolveOrPickCandidate.mockReset()
})

describe('GET /api/meta-oauth/callback', () => {
  it('requires a state param', async () => {
    const res = await GET(req('?code=abc'))
    expect(res.status).toBe(400)
  })

  it('refuses a state signed for a different account', async () => {
    mocks.verifyState.mockReturnValue({ ...STATE, accountId: 'other-acct' })
    const res = await GET(req('?code=abc&state=s'))
    expect(res.status).toBe(403)
  })

  it('redirects with meta_oauth=denied when the user declines consent', async () => {
    const res = await GET(req('?state=s&error=access_denied&error_description=User%20denied'))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('meta_oauth')).toBe('denied')
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled()
  })

  it('redirects with meta_oauth=connected when exactly one candidate is auto-saved', async () => {
    mocks.resolveOrPickCandidate.mockResolvedValue({ kind: 'saved', candidate: { id: 'p1', name: 'Page' } })
    const res = await GET(req('?code=abc&state=s'))
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/content/social-profiles')
    expect(location.searchParams.get('meta_oauth')).toBe('connected')
  })

  it('redirects with meta_oauth=no_pages for facebook/instagram with zero candidates', async () => {
    mocks.resolveOrPickCandidate.mockResolvedValue({ kind: 'no_candidates' })
    const res = await GET(req('?code=abc&state=s'))
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('meta_oauth')).toBe('no_pages')
  })

  it('redirects with meta_oauth=no_ad_accounts for the ads product with zero candidates', async () => {
    mocks.verifyState.mockReturnValue({ ...STATE, product: 'ads' })
    mocks.adAccountsToCandidates.mockReturnValue([])
    mocks.listAdAccounts.mockResolvedValue([])
    mocks.resolveOrPickCandidate.mockResolvedValue({ kind: 'no_candidates' })
    const res = await GET(req('?code=abc&state=s'))
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/traffic/accounts')
    expect(location.searchParams.get('meta_oauth')).toBe('no_ad_accounts')
  })

  it('redirects to the picker with a signed token when multiple candidates are found', async () => {
    const candidates = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }]
    mocks.resolveOrPickCandidate.mockResolvedValue({ kind: 'needs_pick', candidates })
    const res = await GET(req('?code=abc&state=s'))
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('meta_oauth_picker')).toBe('picker-token')
    expect(mocks.signPickerPayload).toHaveBeenCalledWith(
      expect.objectContaining({ candidates, userAccessToken: 'long-token' })
    )
  })

  it('redirects with meta_oauth=error when the token exchange throws but the state was valid', async () => {
    const { MetaOAuthError } = await import('@/lib/meta-oauth/types')
    mocks.exchangeCodeForToken.mockRejectedValue(new MetaOAuthError('meta_api_error', 'boom', 502))
    const res = await GET(req('?code=abc&state=s'))
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('meta_oauth')).toBe('error')
  })
})
