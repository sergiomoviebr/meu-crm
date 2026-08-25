import { describe, expect, it } from 'vitest'

import { signPickerPayload, signState, verifyPickerPayload, verifyState } from './state'
import { MetaOAuthError } from './types'

describe('signState / verifyState', () => {
  const input = { accountId: 'acct-1', userId: 'user-1', product: 'facebook' as const, contactId: 'contact-1' }

  it('round-trips the payload', () => {
    const token = signState(input)
    const verified = verifyState(token)
    expect(verified).toMatchObject(input)
    expect(verified.nonce).toBeTruthy()
    expect(verified.iat).toBeTypeOf('number')
  })

  it('two signings of the same input produce different tokens (nonce + fresh IV)', () => {
    const a = signState(input)
    const b = signState(input)
    expect(a).not.toBe(b)
  });

  it('rejects a garbage token', () => {
    expect(() => verifyState('not-a-real-token')).toThrow(MetaOAuthError)
  })

  it('rejects a tampered token', () => {
    const token = signState(input)
    const tampered = token.slice(0, -4) + '0000'
    expect(() => verifyState(tampered)).toThrow(MetaOAuthError)
  })

  it('rejects an expired token', () => {
    const token = signState(input)
    // The encrypted payload isn't reachable from outside the module, so
    // "expired" is simulated by moving the clock forward past the TTL
    // rather than crafting a payload with an old `iat` directly.
    const originalNow = Date.now
    try {
      Date.now = () => originalNow() + 11 * 60 * 1000 // 11 minutes later (TTL is 10)
      expect(() => verifyState(token)).toThrow(MetaOAuthError)
    } finally {
      Date.now = originalNow
    }
  })
})

describe('signPickerPayload / verifyPickerPayload', () => {
  const input = {
    accountId: 'acct-1',
    userId: 'user-1',
    product: 'instagram' as const,
    contactId: 'contact-1',
    candidates: [{ id: 'ig-1', name: 'Studio Beleza', accessToken: 'page-token-1' }],
    userAccessToken: 'long-lived-user-token',
  }

  it('round-trips candidates and the shared user token', () => {
    const token = signPickerPayload(input)
    const verified = verifyPickerPayload(token)
    expect(verified).toMatchObject(input)
  })

  it('never leaks the token in plaintext — the signed blob does not contain it', () => {
    const token = signPickerPayload(input)
    expect(token).not.toContain('long-lived-user-token')
    expect(token).not.toContain('page-token-1')
  })

  it('rejects an expired picker token', () => {
    const token = signPickerPayload(input)
    const originalNow = Date.now
    try {
      Date.now = () => originalNow() + 11 * 60 * 1000
      expect(() => verifyPickerPayload(token)).toThrow(MetaOAuthError)
    } finally {
      Date.now = originalNow
    }
  })

  it('rejects a tampered picker token', () => {
    const token = signPickerPayload(input)
    expect(() => verifyPickerPayload(token.slice(0, -4) + '0000')).toThrow(MetaOAuthError)
  })
})
