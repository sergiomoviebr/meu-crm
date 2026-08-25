import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getConnectionSnapshot: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))
vi.mock('@/lib/whatsapp-personal/connection-manager', () => ({
  getConnectionSnapshot: mocks.getConnectionSnapshot,
}))

import { GET } from './route'

function listDb(rows: unknown[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
  }
  return { from: () => builder }
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.getConnectionSnapshot.mockReset()
})

describe('GET /api/whatsapp-personal/status', () => {
  it('lists every account connection with its independent live status', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      supabase: listDb([
        { id: 'session-1', label: 'Comercial', is_default: true, created_at: '2026-01-01' },
        { id: 'session-2', label: 'Suporte', is_default: false, created_at: '2026-01-02' },
      ]),
    })
    mocks.getConnectionSnapshot
      .mockResolvedValueOnce({ status: 'connected', qrDataUrl: null, phoneNumber: '5511', lastError: null })
      .mockResolvedValueOnce({ status: 'qr_pending', qrDataUrl: 'data:image/png,x', phoneNumber: null, lastError: null })

    const res = await GET()
    const body = await res.json()

    expect(mocks.getConnectionSnapshot).toHaveBeenNthCalledWith(1, 'acct-1', 'session-1')
    expect(mocks.getConnectionSnapshot).toHaveBeenNthCalledWith(2, 'acct-1', 'session-2')
    expect(body.connections).toHaveLength(2)
  })

  it('rejects an unauthenticated caller', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Unauthorized'))
    const res = await GET()
    expect(res.status).toBe(403)
    expect(mocks.getConnectionSnapshot).not.toHaveBeenCalled()
  })
})
