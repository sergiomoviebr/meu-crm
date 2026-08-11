import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Route-level tests for GET /api/flows/cron — previously untested
// (Fase 3.1 of docs/engineering-standards-progress.md). Sweeps
// abandoned active flow runs to `timed_out`; without this cron actually
// running, a stale run blocks `idx_one_active_run_per_contact` forever
// for that contact (see the route's own docstring).
// ============================================================

vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from '@/lib/flows/admin-client';

const SECRET = 'test-cron-secret';

function req(headers: Record<string, string> = {}) {
  return new Request('http://x/api/flows/cron', { headers });
}

function makeSupabase(opts: {
  runs?: Record<string, unknown>[] | null;
  scanError?: { message: string } | null;
  updatedIds?: string[];
}) {
  const inserts: Record<string, unknown>[] = [];
  return {
    from: (table: string) => {
      if (table === 'flow_runs') {
        return {
          select: () => ({
            eq: async () => ({
              data: opts.runs ?? null,
              error: opts.scanError ?? null,
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => ({
                  data: (opts.updatedIds ?? []).map((id) => ({ id })),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'flow_run_events') {
        return { insert: async (row: Record<string, unknown>) => (inserts.push(row), { error: null }) };
      }
      throw new Error(`No fake table for '${table}'`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTOMATION_CRON_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
});

describe('GET /api/flows/cron', () => {
  it('returns 503 when AUTOMATION_CRON_SECRET is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it('returns 401 when the x-cron-secret header is missing or wrong', async () => {
    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': 'nope' }));
    expect(res.status).toBe(401);
  });

  it('returns 500 and does not throw when the active-run scan errors', async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(
      makeSupabase({ scanError: { message: 'db down' } }) as never
    );
    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(500);
  });

  it('returns { swept: 0 } when there are no active runs', async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabase({ runs: [] }) as never);
    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 0 });
  });

  it('sweeps a run that is past its fallback timeout', async () => {
    const staleRun = {
      id: 'run-1',
      flow_id: 'flow-1',
      user_id: 'user-1',
      contact_id: 'contact-1',
      // 48h ago — well past the 24h default on_timeout_hours.
      last_advanced_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      flows: { fallback_policy: null },
    };
    vi.mocked(supabaseAdmin).mockReturnValue(
      makeSupabase({ runs: [staleRun], updatedIds: ['run-1'] }) as never
    );
    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 1 });
  });

  it('does not sweep a run that is still within its fallback timeout', async () => {
    const freshRun = {
      id: 'run-2',
      flow_id: 'flow-1',
      user_id: 'user-1',
      contact_id: 'contact-1',
      last_advanced_at: new Date(Date.now() - 60 * 1000).toISOString(), // 1 min ago
      flows: { fallback_policy: null },
    };
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabase({ runs: [freshRun] }) as never);
    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': SECRET }));
    expect(await res.json()).toEqual({ swept: 0 });
  });
});
