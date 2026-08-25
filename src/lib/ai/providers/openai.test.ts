import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateOpenAi } from './openai'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

function baseArgs(overrides: Partial<Parameters<typeof generateOpenAi>[0]> = {}) {
  return {
    apiKey: 'sk-test',
    model: 'gpt-test',
    systemPrompt: 'sys',
    messages: [{ role: 'user' as const, content: 'hi' }],
    timeoutMs: 5000,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '{}' } }] })),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('generateOpenAi — response_format / max tokens (additive, regression guard)', () => {
  it('omits response_format when not requested (existing reply-assistant behavior unaffected)', async () => {
    const fetchMock = vi.mocked(fetch)
    await generateOpenAi(baseArgs())
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.response_format).toBeUndefined()
    expect(body.max_completion_tokens).toBe(1024)
  })

  it('includes response_format:json_object when requested', async () => {
    const fetchMock = vi.mocked(fetch)
    await generateOpenAi(baseArgs({ responseFormat: 'json_object', maxOutputTokens: 4096 }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_completion_tokens).toBe(4096)
  })
})
