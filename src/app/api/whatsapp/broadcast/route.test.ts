import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Route-level tests for POST /api/whatsapp/broadcast — previously
// untested (Fase 3.2 of docs/engineering-standards-progress.md).
//
// This route's own comment documents a real, previously-fixed bug: it
// writes NOTHING to the database (template sends go straight to Meta),
// so unlike most of the app there is no RLS policy backstopping a
// missing role check — resolving account_id off the profile (which only
// needs 'viewer') used to be the ONLY gate, letting a viewer blast a
// template to arbitrary phone numbers. `requireRole('agent')` fixed it.
// The first test below is a permanent regression guard for exactly that.
// ============================================================

let callerRole = 'agent';
let rateLimited = false;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ['select', 'eq']) builder[m] = vi.fn(chain);
      const terminal = async () => {
        switch (table) {
          case 'profiles':
            return { data: { account_id: 'acct-1', account_role: callerRole }, error: null };
          case 'accounts':
            return { data: { id: 'acct-1', name: 'Acme' }, error: null };
          case 'whatsapp_config':
            return {
              data: {
                account_id: 'acct-1',
                phone_number_id: 'PNID-1',
                access_token: 'enc-token',
              },
              error: null,
            };
          case 'message_templates':
            return { data: null, error: null };
          default:
            return { data: null, error: null };
        }
      };
      builder.single = vi.fn(terminal);
      builder.maybeSingle = vi.fn(terminal);
      return builder;
    },
  })),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return {
    ...actual,
    checkRateLimit: vi.fn(() =>
      rateLimited
        ? { success: false, remaining: 0, reset: Date.now() + 60_000, limit: 60 }
        : { success: true, remaining: 59, reset: Date.now() + 60_000, limit: 60 }
    ),
  };
});

const sendTemplateMessage = vi.fn();
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: (...args: unknown[]) => sendTemplateMessage(...args),
}));

beforeEach(() => {
  callerRole = 'agent';
  rateLimited = false;
  sendTemplateMessage.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function postJson(body: unknown) {
  return new Request('http://x/api/whatsapp/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/whatsapp/broadcast — role gate', () => {
  it('rejects a viewer (403) before any send happens — regression test for the fixed viewer-can-broadcast bug', async () => {
    callerRole = 'viewer';
    const { POST } = await import('./route');
    const res = await POST(
      postJson({ phone_numbers: ['+14155550123'], template_name: 'promo', template_params: [] })
    );
    expect(res.status).toBe(403);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('allows an agent to broadcast', async () => {
    callerRole = 'agent';
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' });
    const { POST } = await import('./route');
    const res = await POST(
      postJson({ phone_numbers: ['+14155550123'], template_name: 'promo', template_params: [] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
  });
});

describe('POST /api/whatsapp/broadcast — validation', () => {
  it('400s when neither recipients nor phone_numbers is provided', async () => {
    const { POST } = await import('./route');
    const res = await POST(postJson({ template_name: 'promo' }));
    expect(res.status).toBe(400);
  });

  it('400s when template_name is missing', async () => {
    const { POST } = await import('./route');
    const res = await POST(postJson({ phone_numbers: ['+14155550123'] }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/whatsapp/broadcast — rate limiting', () => {
  it('429s once the per-user broadcast budget is exhausted', async () => {
    rateLimited = true;
    const { POST } = await import('./route');
    const res = await POST(
      postJson({ phone_numbers: ['+14155550123'], template_name: 'promo', template_params: [] })
    );
    expect(res.status).toBe(429);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/whatsapp/broadcast — send outcomes', () => {
  it('marks an invalid phone number as failed without calling Meta for it', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      postJson({ phone_numbers: ['not-a-phone'], template_name: 'promo', template_params: [] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.sent).toBe(0);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('reports a per-recipient Meta failure without failing the whole request', async () => {
    sendTemplateMessage.mockRejectedValue(new Error('Meta rejected the send'));
    const { POST } = await import('./route');
    const res = await POST(
      postJson({ phone_numbers: ['+14155550123'], template_name: 'promo', template_params: [] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.results[0].error).toContain('Meta rejected the send');
  });
});
