import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Rejection tests for the zod schemas introduced on /api/v1/* write
// routes (Fase 1.3 of docs/engineering-standards-progress.md). Each
// route already has coverage elsewhere for its happy path / domain
// rules (src/lib/api/v1/contacts.test.ts, send-message.test.ts,
// broadcast-core.test.ts, webhooks/endpoints tests, …) — this file only
// checks that a malformed request body now 400s through parseJsonBody
// instead of reaching business logic with garbage data.
// ============================================================

vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: vi.fn() }));
import { requireApiKey } from '@/lib/auth/api-context';

const NOOP_SUPABASE = {
  from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  }),
} as never;

function mockCtx(scopes: string[]) {
  vi.mocked(requireApiKey).mockResolvedValue({
    authType: 'api_key',
    supabase: NOOP_SUPABASE,
    accountId: 'acct-a',
    keyId: 'key-a',
    scopes,
    createdBy: 'user-a',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

function postJson(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { authorization: 'Bearer wacrm_live_test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchJson(url: string, body: unknown) {
  return new Request(url, {
    method: 'PATCH',
    headers: { authorization: 'Bearer wacrm_live_test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/contacts — rejects a missing phone', () => {
  it('400s with a bad_request code', async () => {
    mockCtx(['contacts:write']);
    const { POST } = await import('./contacts/route');
    const res = await POST(postJson('http://x/api/v1/contacts', { name: 'no phone' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bad_request');
  });
});

describe('PATCH /api/v1/contacts/[id] — rejects a non-string name', () => {
  it('400s before touching the database', async () => {
    mockCtx(['contacts:write']);
    const { PATCH } = await import('./contacts/[id]/route');
    const res = await PATCH(patchJson('http://x/api/v1/contacts/c1', { name: 42 }), {
      params: Promise.resolve({ id: 'c1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/messages — rejects a missing `to`', () => {
  it('400s with a bad_request code', async () => {
    mockCtx(['messages:send']);
    const { POST } = await import('./messages/route');
    const res = await POST(postJson('http://x/api/v1/messages', { text: 'hi' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bad_request');
  });
});

describe('POST /api/v1/broadcasts — rejects a malformed recipients entry', () => {
  it('400s when a recipient is not an object', async () => {
    mockCtx(['broadcasts:send']);
    const { POST } = await import('./broadcasts/route');
    const res = await POST(
      postJson('http://x/api/v1/broadcasts', {
        template_name: 'promo',
        recipients: ['+14155550123'], // should be [{ to: '+...' }]
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/webhooks — rejects a non-array events field', () => {
  it('400s with a bad_request code', async () => {
    mockCtx(['webhooks:manage']);
    const { POST } = await import('./webhooks/route');
    const res = await POST(
      postJson('http://x/api/v1/webhooks', {
        url: 'https://example.com/hook',
        events: 'message.received', // should be an array
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bad_request');
  });
});

describe('PATCH /api/v1/webhooks/[id] — rejects a non-boolean is_active', () => {
  it('400s before touching the database', async () => {
    mockCtx(['webhooks:manage']);
    const { PATCH } = await import('./webhooks/[id]/route');
    const res = await PATCH(patchJson('http://x/api/v1/webhooks/w1', { is_active: 'yes' }), {
      params: Promise.resolve({ id: 'w1' }),
    });
    expect(res.status).toBe(400);
  });
});
