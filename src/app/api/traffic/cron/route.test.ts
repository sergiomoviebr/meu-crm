import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/traffic/admin-client', () => ({ supabaseAdmin: vi.fn() }))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: vi.fn() }))
vi.mock('@/lib/traffic/diagnostic', () => ({ runDiagnostic: vi.fn() }))

import { supabaseAdmin } from '@/lib/traffic/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { runDiagnostic } from '@/lib/traffic/diagnostic'

const SECRET = 'test-traffic-cron-secret'

function req(headers: Record<string, string> = {}) {
  return new Request('http://x/api/traffic/cron', { headers })
}

const config = {
  provider: 'openai' as const,
  model: 'gpt-test',
  apiKey: 'sk-test',
  systemPrompt: null,
  isActive: true,
  autoReplyEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
  embeddingsApiKey: null,
}

function makeAdmin(opts: {
  metricsAccounts?: string[]
  adAccountContacts?: string[]
  landingPageContacts?: string[]
}) {
  return {
    from(table: string) {
      if (table === 'traffic_metrics_daily') {
        return {
          select: () => ({
            gte: () => ({
              limit: async () => ({
                data: (opts.metricsAccounts ?? []).map((account_id) => ({ account_id })),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'ad_accounts') {
        return { select: () => ({ eq: async () => ({ data: (opts.adAccountContacts ?? []).map((contact_id) => ({ contact_id })) }) }) }
      }
      if (table === 'landing_pages') {
        return { select: () => ({ eq: async () => ({ data: (opts.landingPageContacts ?? []).map((contact_id) => ({ contact_id })) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TRAFFIC_CRON_SECRET = SECRET
})
afterEach(() => {
  delete process.env.TRAFFIC_CRON_SECRET
})

describe('GET /api/traffic/cron', () => {
  it('returns 503 when TRAFFIC_CRON_SECRET is not configured', async () => {
    delete process.env.TRAFFIC_CRON_SECRET
    const { GET } = await import('./route')
    const res = await GET(req())
    expect(res.status).toBe(503)
  })

  it('returns 401 when the x-cron-secret header is missing or wrong', async () => {
    const { GET } = await import('./route')
    const res = await GET(req({ 'x-cron-secret': 'wrong' }))
    expect(res.status).toBe(401)
  })

  it('returns { processed: 0 } when no account has recent metrics', async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(makeAdmin({}) as never)
    const { GET } = await import('./route')
    const res = await GET(req({ 'x-cron-secret': SECRET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 0 })
  })

  it('skips an account with no AI config configured', async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(
      makeAdmin({ metricsAccounts: ['acct-1'], adAccountContacts: ['contact-1'] }) as never,
    )
    vi.mocked(loadAiConfig).mockResolvedValue(null)
    const { GET } = await import('./route')
    const res = await GET(req({ 'x-cron-secret': SECRET }))
    expect(await res.json()).toEqual({ processed: 0 })
    expect(runDiagnostic).not.toHaveBeenCalled()
  })

  it('runs diagnostics for every distinct client of an account with an AI config', async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(
      makeAdmin({
        metricsAccounts: ['acct-1'],
        adAccountContacts: ['contact-1', 'contact-2'],
        landingPageContacts: ['contact-2'], // duplicate, should dedupe
      }) as never,
    )
    vi.mocked(loadAiConfig).mockResolvedValue(config)
    vi.mocked(runDiagnostic).mockResolvedValue({ recommendationsCreated: 1, skipped: false })

    const { GET } = await import('./route')
    const res = await GET(req({ 'x-cron-secret': SECRET }))
    expect(await res.json()).toEqual({ processed: 2 })
    expect(runDiagnostic).toHaveBeenCalledTimes(2)
  })
})
