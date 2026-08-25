import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  transitionPost: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}));

vi.mock('@/lib/content/admin-client', () => ({ supabaseAdmin: vi.fn(() => ({})) }));

vi.mock('@/lib/content/posts', () => ({
  transitionPost: mocks.transitionPost,
}));

import { POST } from './route';

const params = { params: Promise.resolve({ id: 'post-1' }) };

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.transitionPost.mockReset();
});

describe('POST /api/content/posts/[id]/approve', () => {
  it('requires admin, not just agent', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'));

    const res = await POST(new Request('http://x'), params);

    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(res.status).toBe(403);
    expect(mocks.transitionPost).not.toHaveBeenCalled();
  });

  it('stamps approved_by/approved_at and transitions to approved for an admin caller', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'account-1',
      userId: 'admin-1',
      role: 'admin',
      account: { id: 'account-1', name: 'Acme' },
    });
    mocks.transitionPost.mockResolvedValue({ post: { id: 'post-1', status: 'approved' } });

    const res = await POST(new Request('http://x'), params);

    expect(res.status).toBe(200);
    expect(mocks.transitionPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'post-1',
        accountId: 'account-1',
        action: 'approve',
        toStatus: 'approved',
        extra: expect.objectContaining({ approved_by: 'admin-1' }),
      }),
    );
  });

  it('surfaces a bad-transition error from the lib layer', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'account-1',
      userId: 'admin-1',
      role: 'admin',
      account: { id: 'account-1', name: 'Acme' },
    });
    mocks.transitionPost.mockResolvedValue({
      error: "Cannot approve a post with status 'draft'",
      status: 400,
    });

    const res = await POST(new Request('http://x'), params);
    expect(res.status).toBe(400);
  });
});
