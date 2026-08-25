import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiConfig: vi.fn(),
  runDiagnostic: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: mocks.loadAiConfig }))
vi.mock('@/lib/traffic/diagnostic', () => ({ runDiagnostic: mocks.runDiagnostic }))

const context = {
  supabase: {},
  accountId: 'acct-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'acct-1', name: 'Acme' },
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

function makeSupabaseAdmin(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    from(table: string) {
      const builder = {
        select() {
          return builder
        },
        eq() {
          return builder
        },
        gte() {
          return builder
        },
        maybeSingle: async () => {
          if (table === 'contacts') {
            return { data: 'contact' in overrides ? overrides.contact : { id: 'contact-1' }, error: null }
          }
          return { data: null, error: null }
        },
        then: undefined,
      }
      if (table === 'traffic_metrics_daily') {
        return { ...builder, select: () => ({ ...builder, eq: () => ({ ...builder, gte: async () => ({ data: overrides.metricsRows ?? [], error: null }) }) }) }
      }
      if (table === 'ad_accounts' || table === 'landing_pages') {
        return { ...builder, select: () => ({ ...builder, eq: async () => ({ data: overrides[table] ?? [], error: null }) }) }
      }
      return builder
    },
  }
}

vi.mock('@/lib/traffic/admin-client', () => ({ supabaseAdmin: vi.fn() }))

function request(body: unknown) {
  return new Request('http://localhost/api/traffic/diagnostics/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.loadAiConfig.mockReset()
  mocks.runDiagnostic.mockReset()
  mocks.requireRole.mockResolvedValue(context)
})

describe('POST /api/traffic/diagnostics/run', () => {
  it('rejects callers below agent', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'))
    const { POST } = await import('./route')
    const res = await POST(request({}))
    expect(res.status).toBe(403)
  })

  it('422s when the account has no AI config yet', async () => {
    const { supabaseAdmin } = await import('@/lib/traffic/admin-client')
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabaseAdmin() as never)
    mocks.loadAiConfig.mockResolvedValue(null)

    const { POST } = await import('./route')
    const res = await POST(request({}))
    expect(res.status).toBe(422)
    expect(mocks.runDiagnostic).not.toHaveBeenCalled()
  })

  it('runs a single client when contact_id is given', async () => {
    const { supabaseAdmin } = await import('@/lib/traffic/admin-client')
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabaseAdmin({ contact: { id: 'contact-1' } }) as never)
    mocks.loadAiConfig.mockResolvedValue(config)
    mocks.runDiagnostic.mockResolvedValue({ recommendationsCreated: 2, skipped: false })

    const { POST } = await import('./route')
    const res = await POST(request({ contact_id: 'contact-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ processed: 1, recommendationsCreated: 2 })
    expect(mocks.runDiagnostic).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acct-1', contactId: 'contact-1', config }),
    )
  })

  it('404s when contact_id does not belong to this account', async () => {
    const { supabaseAdmin } = await import('@/lib/traffic/admin-client')
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabaseAdmin({ contact: null }) as never)
    mocks.loadAiConfig.mockResolvedValue(config)

    const { POST } = await import('./route')
    const res = await POST(request({ contact_id: 'not-mine' }))
    expect(res.status).toBe(404)
  })

  it('surfaces a provider failure as a 502 for a single-client run', async () => {
    const { supabaseAdmin } = await import('@/lib/traffic/admin-client')
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabaseAdmin({ contact: { id: 'contact-1' } }) as never)
    mocks.loadAiConfig.mockResolvedValue(config)
    mocks.runDiagnostic.mockRejectedValue(new Error('Provider timed out'))

    const { POST } = await import('./route')
    const res = await POST(request({ contact_id: 'contact-1' }))
    expect(res.status).toBe(502)
  })
})
