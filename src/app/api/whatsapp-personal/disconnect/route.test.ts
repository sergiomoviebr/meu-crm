import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  disconnectConnection: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))
vi.mock('@/lib/whatsapp-personal/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: mocks.maybeSingle,
      }
      return builder
    },
  }),
}))
vi.mock('@/lib/whatsapp-personal/connection-manager', () => ({
  disconnectConnection: mocks.disconnectConnection,
}))

import { POST } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.disconnectConnection.mockReset()
  mocks.maybeSingle.mockReset()
})

describe('POST /api/whatsapp-personal/disconnect', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'))
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it('disconnects only the requested account-owned session', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'session-2' }, error: null })
    mocks.disconnectConnection.mockResolvedValue(undefined)
    const request = new Request('http://localhost/api/whatsapp-personal/disconnect', {
      method: 'POST', body: JSON.stringify({ connectionId: 'session-2' }),
    })

    const res = await POST(request)
    const body = await res.json()

    expect(mocks.disconnectConnection).toHaveBeenCalledWith('acct-1', 'session-2')
    expect(body).toEqual({ id: 'session-2', status: 'disconnected' })
  })
})
