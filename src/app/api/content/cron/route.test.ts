import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Route-level tests for GET /api/content/cron — structural copy of
// src/app/api/automations/cron/route.test.ts. Same shape: external
// scheduler, shared secret, claim-then-process. A regression here
// fails silently in production (nothing else calls this route), so
// it's a higher-risk gap than most untested routes.
// ============================================================

vi.mock('@/lib/content/admin-client', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/content/publish-engine', () => ({ attemptDuePost: vi.fn() }));

import { supabaseAdmin } from '@/lib/content/admin-client';
import { attemptDuePost } from '@/lib/content/publish-engine';

const SECRET = 'test-content-cron-secret';

function req(headers: Record<string, string> = {}) {
  return new Request('http://x/api/content/cron', { headers });
}

function makeSupabaseWithRows(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          lte: () => ({
            order: () => ({
              limit: async () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => {
                const row = rows[0];
                if (!row) return { data: null, error: null };
                Object.assign(row, patch);
                return { data: { id: row.id }, error: null };
              },
            }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CONTENT_CRON_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.CONTENT_CRON_SECRET;
});

describe('GET /api/content/cron', () => {
  it('returns 503 when CONTENT_CRON_SECRET is not configured', async () => {
    delete process.env.CONTENT_CRON_SECRET;
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it('returns 401 when the x-cron-secret header is missing or wrong', async () => {
    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns { processed: 0 } when nothing is due', async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabaseWithRows([]) as never);
    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 0 });
  });

  it('claims and attempts a due row, then reports it processed', async () => {
    const row = {
      id: 'post-1',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      status: 'scheduled',
      scheduled_at: new Date().toISOString(),
    };
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabaseWithRows([row]) as never);
    vi.mocked(attemptDuePost).mockResolvedValue(undefined as never);

    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': SECRET }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 1 });
    expect(attemptDuePost).toHaveBeenCalledOnce();
    expect(vi.mocked(attemptDuePost).mock.calls[0][1]).toMatchObject({
      id: 'post-1',
      account_id: 'acct-1',
    });
  });
});
