import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateSummary } from './summarize'
import type { AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('generateSummary', () => {
  it('calls the configured provider and returns the summary text + usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [
          {
            message: {
              content:
                '- Customer wants a refund for order #123\n- Sentiment: frustrated\n- Next step: escalate to billing',
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSummary({
      config: config(),
      messages: [
        { role: 'user', content: 'I want a refund for order #123' },
        { role: 'assistant', content: 'Let me look into that for you.' },
      ],
    })

    expect(result.summary).toContain('refund for order #123')
    expect(result.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    })
  })

  it('sends a summarization-specific system prompt, not the reply-drafting one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'summary' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateSummary({
      config: config(),
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const systemMessage = body.messages.find((m: { role: string }) => m.role === 'system')
    expect(systemMessage.content).toMatch(/[Ss]ummarize/)
    // Must NOT be the draft-reply prompt's "write the next reply" framing.
    expect(systemMessage.content).not.toMatch(/[Ww]rite the next reply/)
  })

  it('works with the Anthropic provider too (reuses generateReply dispatch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          content: [{ type: 'text', text: '- All good here' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
    )

    const result = await generateSummary({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.summary).toBe('- All good here')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
  })
})
