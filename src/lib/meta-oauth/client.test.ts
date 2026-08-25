import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  adAccountsToCandidates,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
  listPages,
  pagesToCandidates,
  PRODUCT_SCOPES,
} from './client'
import { MetaOAuthError } from './types'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubEnv('META_APP_ID', 'app-1')
  vi.stubEnv('META_APP_SECRET', 'secret-1')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('buildAuthorizeUrl', () => {
  it('builds a dialog URL with the right scope per product', () => {
    const url = new URL(
      buildAuthorizeUrl({ product: 'instagram', state: 'signed-state', redirectUri: 'https://x.test/cb' })
    )
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth')
    expect(url.searchParams.get('client_id')).toBe('app-1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.test/cb')
    expect(url.searchParams.get('state')).toBe('signed-state')
    expect(url.searchParams.get('scope')).toBe(PRODUCT_SCOPES.instagram.join(','))
  })

  it('throws not_configured when META_APP_ID is unset', () => {
    vi.unstubAllEnvs()
    expect(() =>
      buildAuthorizeUrl({ product: 'facebook', state: 's', redirectUri: 'https://x.test/cb' })
    ).toThrow(MetaOAuthError)
  })
})

describe('exchangeCodeForToken', () => {
  it('returns the access token on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ access_token: 'short-token', expires_in: 3600 }))
    )
    const result = await exchangeCodeForToken({ code: 'abc', redirectUri: 'https://x.test/cb' })
    expect(result).toEqual({ accessToken: 'short-token', expiresIn: 3600 })
  })

  it('throws a MetaOAuthError on a Meta API error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'Invalid code' } }, false, 400))
    )
    await expect(exchangeCodeForToken({ code: 'bad', redirectUri: 'https://x.test/cb' })).rejects.toThrow(
      /Invalid code/
    )
  })
})

describe('exchangeForLongLivedToken', () => {
  it('requests the fb_exchange_token grant', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      void url
      return jsonResponse({ access_token: 'long-token', expires_in: 5184000 })
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await exchangeForLongLivedToken('short-token')
    expect(result.accessToken).toBe('long-token')
    const calledUrl = new URL(fetchSpy.mock.calls[0][0])
    expect(calledUrl.searchParams.get('grant_type')).toBe('fb_exchange_token')
    expect(calledUrl.searchParams.get('fb_exchange_token')).toBe('short-token')
  })
})

describe('listPages / pagesToCandidates', () => {
  const pages = [
    { id: 'page-1', name: 'Studio Beleza', username: 'studiobeleza', access_token: 'page-token-1' },
    {
      id: 'page-2',
      name: 'Clínica Bella Vita',
      access_token: 'page-token-2',
      instagram_business_account: { id: 'ig-2', username: 'bellavita.clinic' },
    },
  ]

  it('lists pages from the Graph API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: pages })))
    const result = await listPages('user-token')
    expect(result).toEqual(pages)
  })

  it('facebook candidates include every page, using the page username as handle', () => {
    expect(pagesToCandidates(pages, 'facebook')).toEqual([
      { id: 'page-1', name: 'Studio Beleza', handle: 'studiobeleza', accessToken: 'page-token-1' },
      { id: 'page-2', name: 'Clínica Bella Vita', handle: 'page-2', accessToken: 'page-token-2' },
    ])
  })

  it('instagram candidates only include pages with a linked IG Business Account', () => {
    expect(pagesToCandidates(pages, 'instagram')).toEqual([
      {
        id: 'ig-2',
        name: '@bellavita.clinic',
        handle: 'bellavita.clinic',
        instagramBusinessAccountId: 'ig-2',
        accessToken: 'page-token-2',
      },
    ])
  })
})

describe('listAdAccounts / adAccountsToCandidates', () => {
  it('lists ad accounts and maps them to candidates with no per-account token', async () => {
    const accounts = [{ id: 'act_123', name: 'Sales Pipeline Ads', currency: 'BRL' }]
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: accounts })))
    const result = await listAdAccounts('user-token')
    expect(result).toEqual(accounts)
    expect(adAccountsToCandidates(accounts)).toEqual([{ id: 'act_123', name: 'Sales Pipeline Ads' }])
  })
})
