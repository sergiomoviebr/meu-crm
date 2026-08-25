import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class ForbiddenError extends Error {
    status = 403 as const;
  }
  return {
    requireRole: vi.fn(),
    createContentPost: vi.fn(),
    ForbiddenError,
  };
});

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
  ForbiddenError: mocks.ForbiddenError,
}));

vi.mock('@/lib/content/admin-client', () => ({ supabaseAdmin: vi.fn(() => ({})) }));

vi.mock('@/lib/content/posts', () => ({
  createContentPost: mocks.createContentPost,
}));

import { POST } from './route';

const context = {
  supabase: {},
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

function request(body: unknown) {
  return new Request('http://localhost/api/content/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  contact_id: 'contact-1',
  content_type: 'image',
  caption: 'Hello',
  social_profile_ids: ['profile-1'],
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.createContentPost.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('POST /api/content/posts', () => {
  it('rejects callers below agent (viewer) via requireRole', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Insufficient role'));

    const res = await POST(request(validBody));

    expect(res.status).toBe(403);
    expect(mocks.createContentPost).not.toHaveBeenCalled();
  });

  it('400s on missing contact_id', async () => {
    const res = await POST(request({ ...validBody, contact_id: undefined }));
    expect(res.status).toBe(400);
  });

  it('400s on an invalid content_type', async () => {
    const res = await POST(request({ ...validBody, content_type: 'tweet' }));
    expect(res.status).toBe(400);
  });

  it('400s on an empty social_profile_ids array', async () => {
    const res = await POST(request({ ...validBody, social_profile_ids: [] }));
    expect(res.status).toBe(400);
  });

  it('creates the post with the caller account/user stamped in and returns 201', async () => {
    mocks.createContentPost.mockResolvedValue({ post: { id: 'post-1' } });

    const res = await POST(request(validBody));

    expect(res.status).toBe(201);
    expect(mocks.createContentPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'account-1', createdBy: 'user-1', contactId: 'contact-1' }),
    );
  });

  it('surfaces a lib-layer validation error with its own status', async () => {
    mocks.createContentPost.mockResolvedValue({ error: 'All target profiles must belong to the selected client', status: 400 });
    const res = await POST(request(validBody));
    expect(res.status).toBe(400);
  });
});
