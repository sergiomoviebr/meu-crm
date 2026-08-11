# 0002 — Provider-agnostic AI layer, BYO key, no platform-wide provider lock-in

## Status

Accepted (retroactive — documents `src/lib/ai/**` as it exists today).

## Context

The AI reply assistant needs to call an LLM to draft replies and, in
auto-reply mode, generate them unattended. Two ways to shape that:

1. Hardcode one provider's SDK/API shape directly into the inbox draft
   route and the auto-reply worker.
2. Define a small provider-agnostic interface once, with one adapter file
   per provider, and make every caller depend on the interface, not a
   specific SDK.

The product also commits to "bring your own key" (no platform-hosted LLM
key, no per-seat AI fee) — every account supplies its own OpenAI or
Anthropic key. That alone makes (1) awkward: two call sites (draft route,
auto-reply) would each need provider-branching logic duplicated.

## Decision

Went with (2), scoped to exactly the two providers actually supported —
not a speculative N-provider plugin system:

- `src/lib/ai/types.ts` — `AiProvider = 'openai' | 'anthropic'`, plus the
  shared `AiConfig`, `ChatMessage`, `AiUsage`, `GenerateResult`, `AiError`
  types every caller and every provider adapter shares.
- `src/lib/ai/providers/openai.ts` and `anthropic.ts` — one file per
  provider, each exposing a matching `generate*(args): Promise<ProviderResult>`.
  No shared base class; the contract is the function signature, kept
  honest by TypeScript rather than an abstract class hierarchy.
- `src/lib/ai/generate.ts` — `generateReply()` is the single call site
  every consumer uses; it dispatches on `config.provider` via a plain
  `switch`. Adding a third provider is one new file + one new `case`, not
  a refactor.
- Keys are decrypted per-call from the account's stored config
  (`src/lib/ai/config.ts`, reusing the AES-256-GCM primitives in
  `src/lib/whatsapp/encryption.ts` rather than inventing a second
  encryption scheme) — no `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` env var
  exists anywhere, by design.
- Usage/cost is normalized across providers' differing token-count shapes
  (`prompt`/`completion` vs `input`/`output`) into one `AiUsage` shape,
  logged to `ai_usage_log` (`029_ai_reply.sql`) regardless of provider.

## Consequences

- A third provider (e.g. a future Gemini/local-model option) is additive:
  new `providers/*.ts` file, new `case` in `generate.ts`, no changes to
  callers.
- AI output is never trusted as final: `parseGeneration()` strips a
  handoff sentinel the model can emit to bail to a human, and auto-reply
  has both a per-conversation cap and an account-wide rate bucket
  (`RATE_LIMITS.aiAutoReplyAccount`) so a misbehaving model or a prompt-
  injection attempt from customer text can't spam a whole account.
- Retry is currently timeout-only (`AbortSignal.timeout`), no
  exponential-backoff loop. This was a deliberate scope cut, not an
  oversight — add backoff when a specific provider's transient-error rate
  actually justifies the complexity, not preemptively for both providers.
