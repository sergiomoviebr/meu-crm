import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  editPersonalTextMessage: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))

vi.mock('@/lib/whatsapp-personal/send', () => ({
  editPersonalTextMessage: mocks.editPersonalTextMessage,
}))

import { PATCH } from './route'

interface Script {
  message?: Record<string, unknown> | null
  conversation?: Record<string, unknown> | null
  updateError?: { message: string } | null
}

function makeSupabase(script: Script) {
  const updateCalls: Record<string, unknown>[] = []
  const builder = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      update: (payload: Record<string, unknown>) => {
        if (table === 'messages') updateCalls.push(payload)
        return b
      },
      maybeSingle: () => {
        if (table === 'messages') return Promise.resolve({ data: script.message ?? null, error: null })
        if (table === 'conversations')
          return Promise.resolve({ data: script.conversation ?? null, error: null })
        return Promise.resolve({ data: null, error: null })
      },
      then: (resolve: (v: { error: { message: string } | null }) => void) =>
        resolve({ error: script.updateError ?? null }),
    }
    return b
  }
  return { supabase: { from: (t: string) => builder(t) }, updateCalls }
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/whatsapp/messages/msg-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
const params = { params: Promise.resolve({ id: 'msg-1' }) }

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.editPersonalTextMessage.mockReset()
})

const AGENT_TEXT_MESSAGE = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  content_type: 'text',
  message_id: 'wamid-1',
}

describe('PATCH /api/whatsapp/messages/[id]', () => {
  it('requires the agent role', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Unauthorized'))
    const res = await PATCH(patchRequest({ content_text: 'fixed' }), params)
    expect(res.status).toBe(403)
  })

  it('rejects an empty content_text', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: {}, accountId: 'acct-1' })
    const res = await PATCH(patchRequest({ content_text: '   ' }), params)
    expect(res.status).toBe(400)
  })

  it('404s when the message does not exist', async () => {
    const { supabase } = makeSupabase({ message: null })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' })
    const res = await PATCH(patchRequest({ content_text: 'fixed' }), params)
    expect(res.status).toBe(404)
  })

  it('refuses to edit a message the customer sent', async () => {
    const { supabase } = makeSupabase({ message: { ...AGENT_TEXT_MESSAGE, sender_type: 'customer' } })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' })
    const res = await PATCH(patchRequest({ content_text: 'fixed' }), params)
    expect(res.status).toBe(400)
    expect(mocks.editPersonalTextMessage).not.toHaveBeenCalled()
  })

  it('refuses to edit a non-text message', async () => {
    const { supabase } = makeSupabase({ message: { ...AGENT_TEXT_MESSAGE, content_type: 'image' } })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' })
    const res = await PATCH(patchRequest({ content_text: 'fixed' }), params)
    expect(res.status).toBe(400)
  })

  it('404s when the conversation is not found (or belongs to another account)', async () => {
    const { supabase } = makeSupabase({ message: AGENT_TEXT_MESSAGE, conversation: null })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' })
    const res = await PATCH(patchRequest({ content_text: 'fixed' }), params)
    expect(res.status).toBe(404)
  })

  it('is a CRM-only correction on the meta_cloud_api channel (never calls the personal-channel editor)', async () => {
    const { supabase, updateCalls } = makeSupabase({
      message: AGENT_TEXT_MESSAGE,
      conversation: { id: 'conv-1', channel: 'meta_cloud_api', contact: { phone: '+15551234567' } },
    })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' })

    const res = await PATCH(patchRequest({ content_text: 'fixed text' }), params)
    const body = await res.json()

    expect(mocks.editPersonalTextMessage).not.toHaveBeenCalled()
    expect(body).toEqual({ editedOnWhatsapp: false })
    expect(updateCalls[0]).toMatchObject({ content_text: 'fixed text' })
    expect(updateCalls[0].edited_at).toBeTruthy()
  })

  it('attempts a real WhatsApp edit on the whatsapp_personal channel and reports success', async () => {
    const { supabase } = makeSupabase({
      message: AGENT_TEXT_MESSAGE,
      conversation: { id: 'conv-1', channel: 'whatsapp_personal', whatsapp_personal_session_id: 'session-1', contact: { phone: '+15551234567' } },
    })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' })
    mocks.editPersonalTextMessage.mockResolvedValue(undefined)

    const res = await PATCH(patchRequest({ content_text: 'fixed text' }), params)
    const body = await res.json()

    expect(mocks.editPersonalTextMessage).toHaveBeenCalledWith(
      'acct-1',
      'session-1',
      '+15551234567',
      'wamid-1',
      'fixed text',
      undefined,
    )
    expect(body).toEqual({ editedOnWhatsapp: true })
  })

  it('falls back to a CRM-only correction when the real WhatsApp edit fails (expired window, etc.)', async () => {
    const { supabase, updateCalls } = makeSupabase({
      message: AGENT_TEXT_MESSAGE,
      conversation: { id: 'conv-1', channel: 'whatsapp_personal', whatsapp_personal_session_id: 'session-1', contact: { phone: '+15551234567' } },
    })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1' })
    mocks.editPersonalTextMessage.mockRejectedValue(new Error('edit window expired'))

    const res = await PATCH(patchRequest({ content_text: 'fixed text' }), params)
    const body = await res.json()

    expect(body).toEqual({ editedOnWhatsapp: false })
    expect(updateCalls[0]).toMatchObject({ content_text: 'fixed text' })
  })
})
