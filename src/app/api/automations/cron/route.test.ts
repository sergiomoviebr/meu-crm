import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Route-level tests for GET /api/automations/cron — previously
// untested (Fase 3.1 of docs/engineering-standards-progress.md). This
// endpoint is hit by an external scheduler on a shared secret and drains
// automation_pending_executions; a regression here fails silently in
// production (nothing but the cron pinger ever calls it), so it's a
// higher-risk gap than most untested routes.
// ============================================================

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/automations/engine', () => ({ resumePendingExecution: vi.fn() }));

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resumePendingExecution } from '@/lib/automations/engine';

const SECRET = 'test-cron-secret';

function req(headers: Record<string, string> = {}) {
  return new Request('http://x/api/automations/cron', { headers });
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
  process.env.AUTOMATION_CRON_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
});

describe('GET /api/automations/cron', () => {
  it('returns 503 when AUTOMATION_CRON_SECRET is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;
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

  it('claims and resumes a due row, then reports it processed', async () => {
    const row = {
      id: 'pe-1',
      automation_id: 'auto-1',
      account_id: 'acct-1',
      user_id: 'user-1',
      contact_id: null,
      log_id: null,
      parent_step_id: null,
      branch: null,
      next_step_position: 2,
      context: {},
      status: 'pending',
    };
    vi.mocked(supabaseAdmin).mockReturnValue(makeSupabaseWithRows([row]) as never);
    vi.mocked(resumePendingExecution).mockResolvedValue(undefined as never);

    const { GET } = await import('./route');
    const res = await GET(req({ 'x-cron-secret': SECRET }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 1 });
    expect(resumePendingExecution).toHaveBeenCalledOnce();
    expect(vi.mocked(resumePendingExecution).mock.calls[0][0]).toMatchObject({
      id: 'pe-1',
      account_id: 'acct-1',
    });
  });
});
