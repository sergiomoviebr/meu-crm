import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  startConnection: vi.fn(),
  countResult: { count: 0, error: null as { message: string } | null },
  insert: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))

vi.mock('@/lib/whatsapp-personal/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => Promise.resolve(mocks.countResult) }),
      insert: (value: unknown) => {
        mocks.insert(value)
        return {
          select: () => ({
            single: () => Promise.resolve({
              data: { id: 'session-1', label: 'WhatsApp principal', is_default: true },
              error: null,
            }),
          }),
        }
      },
    }),
  }),
}))

vi.mock('@/lib/whatsapp-personal/connection-manager', () => ({
  startConnection: mocks.startConnection,
}))

import { POST } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.startConnection.mockReset()
  mocks.insert.mockReset()
  mocks.countResult.count = 0
  mocks.countResult.error = null
})

describe('POST /api/whatsapp-personal/connect', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'))
    const res = await POST()
    expect(res.status).toBe(403)
    expect(mocks.startConnection).not.toHaveBeenCalled()
  })

  it('creates an independent first session and starts it by id', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    mocks.startConnection.mockResolvedValue({
      status: 'connecting', qrDataUrl: null, phoneNumber: null, lastError: null,
    })

    const res = await POST(new Request('http://localhost/api/whatsapp-personal/connect', {
      method: 'POST', body: JSON.stringify({}),
    }))
    const body = await res.json()

    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      account_id: 'acct-1', user_id: 'user-1', is_default: true,
    }))
    expect(mocks.startConnection).toHaveBeenCalledWith('acct-1', 'session-1')
    expect(body).toMatchObject({ id: 'session-1', isDefault: true, status: 'connecting' })
  })

  it('stops when counting existing connections fails', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    mocks.countResult.error = { message: 'db down' }
    const res = await POST()
    expect(res.status).toBe(500)
    expect(mocks.startConnection).not.toHaveBeenCalled()
  })
})
