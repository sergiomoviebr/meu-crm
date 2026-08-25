import { describe, it, expect } from 'vitest'
import { pullMetricsFor } from './dispatch'
import type { PullMetricsArgs } from './types'
import type { AdPlatform } from '@/types'

function args(overrides: Partial<PullMetricsArgs> = {}): PullMetricsArgs {
  return {
    account: { platform: 'meta', externalAccountId: null, accessToken: null },
    entityType: 'campaign',
    externalEntityId: 'ext-1',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-07',
    timeoutMs: 5000,
    ...overrides,
  }
}

describe('pullMetricsFor', () => {
  it('fails not_configured for meta/google when disconnected', async () => {
    for (const platform of ['meta', 'google'] as AdPlatform[]) {
      await expect(
        pullMetricsFor(platform, args({ account: { platform, externalAccountId: null, accessToken: null } })),
      ).rejects.toMatchObject({ code: 'provider_not_configured', status: 422 })
    }
  })

  it('reaches not_implemented once connected (no real API wired up yet)', async () => {
    await expect(
      pullMetricsFor('meta', args({ account: { platform: 'meta', externalAccountId: 'acct-1', accessToken: 'tok' } })),
    ).rejects.toMatchObject({ code: 'not_implemented', status: 501 })
  })

  it('rejects "other" platform as unsupported for automatic pulls', async () => {
    await expect(pullMetricsFor('other', args())).rejects.toMatchObject({ code: 'unsupported_platform', status: 400 })
  })
})
