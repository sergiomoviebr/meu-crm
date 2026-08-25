import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  resolveConversationByPhone: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'Forbidden' }, { status: 403 })
  ),
}));
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: mocks.resolveConversationByPhone,
}));

import { GET, POST } from './route';

interface FakeData {
  contact?: Record<string, unknown> | null;
  conversation?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  personal?: Record<string, unknown>[];
}

function fakeSupabase(data: FakeData) {
  return {
    from: (table: string) => {
      const result =
        table === 'whatsapp_personal_sessions'
          ? { data: data.personal ?? [], error: null }
          : table === 'whatsapp_config'
            ? { data: data.meta ?? null, error: null }
            : table === 'contacts'
              ? { data: data.contact ?? null, error: null }
              : { data: data.conversation ?? null, error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => void) => resolve(result),
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/conversations/start', () => {
  it('lists the official channel and every connected personal number', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: fakeSupabase({
        meta: { id: 'meta-1', status: 'connected' },
        personal: [
          {
            id: 'session-1',
            label: 'Comercial',
            phone_number: '5511999990000',
            is_default: true,
          },
          {
            id: 'session-2',
            label: 'Suporte',
            phone_number: '5511888880000',
            is_default: false,
          },
        ],
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.channels).toHaveLength(3);
    expect(body.channels[1]).toMatchObject({
      channel: 'whatsapp_personal',
      personalSessionId: 'session-1',
      label: 'Comercial',
    });
  });

  it('opens a selected contact on the chosen personal number', async () => {
    const conversation = {
      id: 'conv-1',
      account_id: 'acct-1',
      user_id: 'user-1',
      contact_id: 'contact-1',
      status: 'open',
      channel: 'whatsapp_personal',
      unread_count: 0,
      created_at: '2026-08-19T00:00:00.000Z',
      updated_at: '2026-08-19T00:00:00.000Z',
      contact: {
        id: 'contact-1',
        phone: '+5511999990000',
        name: 'Maria',
        contact_tags: [],
      },
    };
    const supabase = fakeSupabase({
      contact: {
        id: 'contact-1',
        phone: '+5511999990000',
        whatsapp: '+5511999990000',
        name: 'Maria',
        preferred_name: null,
      },
      conversation,
    });
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase,
    });
    mocks.resolveConversationByPhone.mockResolvedValue({
      conversationId: 'conv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });

    const response = await POST(
      new Request('http://localhost/api/conversations/start', {
        method: 'POST',
        body: JSON.stringify({
          contactId: '123e4567-e89b-42d3-a456-426614174000',
          channel: 'whatsapp_personal',
          personalSessionId: '123e4567-e89b-42d3-a456-426614174001',
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.resolveConversationByPhone).toHaveBeenCalledWith(
      supabase,
      'acct-1',
      '5511999990000',
      'Maria',
      'whatsapp_personal',
      '123e4567-e89b-42d3-a456-426614174001'
    );
    expect(body.conversation).toMatchObject({
      id: 'conv-1',
      contact: { id: 'contact-1', name: 'Maria', tags: [] },
    });
  });

  it('rejects an incomplete phone before creating anything', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: fakeSupabase({}),
    });

    const response = await POST(
      new Request('http://localhost/api/conversations/start', {
        method: 'POST',
        body: JSON.stringify({ phone: '123', channel: 'meta_cloud_api' }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
  });
});
