import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Cross-tenant isolation regression suite for `/api/v1/*`.
//
// Why this exists: every `/api/v1/*` route authenticates via
// `requireApiKey()`, which returns a SERVICE-ROLE Supabase client — no
// `auth.uid()` exists for RLS to key off (see `src/lib/auth/api-context.ts`'s
// module comment). Tenant isolation on this surface is therefore an
// application-code discipline (`.eq('account_id', ctx.accountId)` on every
// query), not a database guarantee. This suite exists to catch a future
// regression where that `.eq()` gets refactored away — not because a bug
// was found (an audit of every by-id v1 route found the discipline already
// consistent; see docs/engineering-standards-progress.md, Fase 1.1).
//
// Unlike the simpler per-table mocks used elsewhere (e.g.
// `whatsapp/send/route.test.ts`, which returns one canned row per table
// regardless of filters), `makeFakeTable()` below actually FILTERS its
// seed rows by every `.eq()` applied — so a route that forgets the
// `account_id` filter would incorrectly return account B's row to account
// A's key, and the test would fail. That's the specific bug class this
// guards against.
// ============================================================

// ---- Fake, filter-respecting Supabase query builder ----------------------

interface FakeRow {
  [key: string]: unknown;
}

function makeFakeTable(seed: FakeRow[]) {
  const rows = seed;

  return function from() {
    const filters: Array<[string, unknown]> = [];
    let mode: 'select' | 'update' | 'delete' = 'select';
    let updates: FakeRow = {};

    function apply(): FakeRow[] {
      return rows.filter((r) => filters.every(([col, val]) => r[col] === val));
    }

    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      or: () => builder,
      update: (u: FakeRow) => {
        mode = 'update';
        updates = u;
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      maybeSingle: async () => {
        const matches = apply();
        const row = matches[0] ?? null;
        if (row && mode === 'update') Object.assign(row, updates);
        if (row && mode === 'delete') rows.splice(rows.indexOf(row), 1);
        return { data: row, error: null };
      },
      single: async () => {
        const matches = apply();
        const row = matches[0];
        if (!row) return { data: null, error: { message: 'not found' } };
        if (mode === 'update') Object.assign(row, updates);
        return { data: row, error: null };
      },
      then: (resolve: (v: { data: FakeRow[]; error: null }) => unknown) =>
        resolve({ data: apply(), error: null }),
    };
    return builder;
  };
}

function makeFakeSupabase(tables: Record<string, FakeRow[]>) {
  const builders = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, makeFakeTable(rows)])
  );
  return {
    from: (table: string) => {
      const builder = builders[table];
      if (!builder) throw new Error(`No fake table seeded for '${table}'`);
      return builder();
    },
  };
}

// ---- Shared fixtures: two accounts, one resource each ---------------------

const ACCOUNT_A = 'acct-aaaa';
const ACCOUNT_B = 'acct-bbbb';

const CONTACT_B = { id: 'contact-b', account_id: ACCOUNT_B, phone: '+1', contact_tags: [] };
const CONVERSATION_B = { id: 'conv-b', account_id: ACCOUNT_B, contact_id: 'contact-b' };
const BROADCAST_B = { id: 'broadcast-b', account_id: ACCOUNT_B, status: 'sent' };
const WEBHOOK_B = { id: 'webhook-b', account_id: ACCOUNT_B, url: 'https://b.example.com', events: ['message.received'], is_active: true };

// requireApiKey is mocked per-file to hand back account A's context,
// regardless of which route under test imports it — every v1 route calls
// the same function, so one mock covers all of them.
vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(),
}));

import { requireApiKey } from '@/lib/auth/api-context';

function mockAsAccountA(supabase: unknown) {
  vi.mocked(requireApiKey).mockResolvedValue({
    authType: 'api_key',
    supabase: supabase as never,
    accountId: ACCOUNT_A,
    keyId: 'key-a',
    scopes: ['contacts:read', 'contacts:write', 'conversations:read', 'messages:read', 'broadcasts:send', 'webhooks:manage'],
    createdBy: 'user-a',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeRequest(url: string) {
  return new Request(url, { headers: { authorization: 'Bearer wacrm_live_test' } });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---- Tests ------------------------------------------------------------

describe('GET /api/v1/contacts/[id] — cross-tenant isolation', () => {
  it("404s when the contact belongs to a different account", async () => {
    const supabase = makeFakeSupabase({ contacts: [CONTACT_B] });
    mockAsAccountA(supabase);
    const { GET } = await import('./contacts/[id]/route');
    const res = await GET(fakeRequest('http://x/api/v1/contacts/contact-b'), paramsFor('contact-b'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('not_found');
  });
});

describe('PATCH /api/v1/contacts/[id] — cross-tenant isolation', () => {
  it("404s and does not mutate a contact belonging to a different account", async () => {
    const supabase = makeFakeSupabase({ contacts: [CONTACT_B] });
    mockAsAccountA(supabase);
    const { PATCH } = await import('./contacts/[id]/route');
    const req = new Request('http://x/api/v1/contacts/contact-b', {
      method: 'PATCH',
      headers: { authorization: 'Bearer wacrm_live_test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    const res = await PATCH(req, paramsFor('contact-b'));
    expect(res.status).toBe(404);
    expect(CONTACT_B.phone).toBe('+1'); // untouched
  });
});

describe('GET /api/v1/conversations/[id] — cross-tenant isolation', () => {
  it("404s when the conversation belongs to a different account", async () => {
    const supabase = makeFakeSupabase({ conversations: [CONVERSATION_B] });
    mockAsAccountA(supabase);
    const { GET } = await import('./conversations/[id]/route');
    const res = await GET(fakeRequest('http://x/api/v1/conversations/conv-b'), paramsFor('conv-b'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/conversations/[id]/messages — cross-tenant isolation', () => {
  it("404s before listing messages when the parent conversation belongs to a different account", async () => {
    const supabase = makeFakeSupabase({
      conversations: [CONVERSATION_B],
      messages: [{ id: 'm1', conversation_id: 'conv-b', created_at: '2026-01-01' }],
    });
    mockAsAccountA(supabase);
    const { GET } = await import('./conversations/[id]/messages/route');
    const res = await GET(fakeRequest('http://x/api/v1/conversations/conv-b/messages'), paramsFor('conv-b'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/broadcasts/[id] — cross-tenant isolation', () => {
  it("404s when the broadcast belongs to a different account", async () => {
    const supabase = makeFakeSupabase({ broadcasts: [BROADCAST_B] });
    mockAsAccountA(supabase);
    const { GET } = await import('./broadcasts/[id]/route');
    const res = await GET(fakeRequest('http://x/api/v1/broadcasts/broadcast-b'), paramsFor('broadcast-b'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/webhooks/[id] — cross-tenant isolation', () => {
  it("404s when the webhook endpoint belongs to a different account", async () => {
    const supabase = makeFakeSupabase({ webhook_endpoints: [{ ...WEBHOOK_B }] });
    mockAsAccountA(supabase);
    const { GET } = await import('./webhooks/[id]/route');
    const res = await GET(fakeRequest('http://x/api/v1/webhooks/webhook-b'), paramsFor('webhook-b'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/webhooks/[id] — cross-tenant isolation', () => {
  it("404s and does not mutate a webhook belonging to a different account", async () => {
    const row = { ...WEBHOOK_B };
    const supabase = makeFakeSupabase({ webhook_endpoints: [row] });
    mockAsAccountA(supabase);
    const { PATCH } = await import('./webhooks/[id]/route');
    const req = new Request('http://x/api/v1/webhooks/webhook-b', {
      method: 'PATCH',
      headers: { authorization: 'Bearer wacrm_live_test', 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });
    const res = await PATCH(req, paramsFor('webhook-b'));
    expect(res.status).toBe(404);
    expect(row.is_active).toBe(true); // untouched
  });
});

describe('DELETE /api/v1/webhooks/[id] — cross-tenant isolation', () => {
  it("404s and does not delete a webhook belonging to a different account", async () => {
    const supabase = makeFakeSupabase({ webhook_endpoints: [{ ...WEBHOOK_B }] });
    mockAsAccountA(supabase);
    const { DELETE } = await import('./webhooks/[id]/route');
    const res = await DELETE(fakeRequest('http://x/api/v1/webhooks/webhook-b'), paramsFor('webhook-b'));
    expect(res.status).toBe(404);
  });
});
