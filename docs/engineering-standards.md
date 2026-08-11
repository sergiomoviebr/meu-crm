# Engineering standards

This is the working rulebook for this fork. It's a distillation of a
generic senior-engineering checklist, rewritten against what's actually in
this codebase — every rule below points at a real file, not a platitude. If
a rule and the code disagree, the code wins; open a PR to this doc.

Scope note: this fork's UI is localized to `pt-BR` (see
`messages/pt-BR.json`, `NEXT_PUBLIC_APP_LOCALE`). Code, comments, commit
messages, and this document stay in **English** — that's the existing
convention across `src/`, migrations, and upstream docs, and switching
mid-project would make `git blame` and future upstream merges harder to
read.

Companion docs: [`docs/adr/`](./adr) for retroactive Architecture Decision
Records on the "why" behind the choices below; [`CONTRIBUTING.md`](../CONTRIBUTING.md)
for the fork/PR workflow and the Definition of Done checklist.

---

## Architecture

Don't introduce a repository layer, CQRS, event sourcing, or a second
service — none are justified at this scale (a single Next.js app + Postgres
serving one CRM). The existing shape is a pragmatic hybrid, keep it:

- `src/lib/**` (160+ files, organized by domain: `ai/`, `whatsapp/`,
  `automations/`, `flows/`, `auth/`, `api-keys/`, `api/v1/`, `contacts/`,
  `dashboard/`, `inbox/`, `account/`) holds business logic as small, mostly
  pure, testable functions. This is where new business rules go.
- API routes (`src/app/api/**/route.ts`) are thin: resolve auth context,
  call into `src/lib`, map the result to a response.
- Client components (`src/components/**`) may query Supabase directly for
  simple reads — RLS is the safety net there, not a hidden service layer.
  Don't retrofit a repository pattern onto these; it wouldn't remove any
  real risk since RLS already gates the query.
- External integrations are separated by responsibility, not by a formal
  adapter interface, because there's exactly one implementation of each:
  `src/lib/whatsapp/{meta-api,send-message,webhook-signature,template-*,encryption}.ts`
  for Meta's Cloud API, `src/lib/ai/{types,generate,providers/*}.ts` for AI
  providers (this one *is* a real provider-agnostic interface — see below).
  Don't extract a `WhatsAppProvider` interface until a second channel
  actually exists — see [ADR 0001](./adr/0001-multi-tenant-rls.md)-style
  reasoning applies equally here (not written as an ADR since nothing has
  been decided yet, just deferred).

## Code quality

- TypeScript strict mode is already on; keep it on. No `any` without a
  comment explaining why it's unavoidable.
- Business logic lives in `src/lib`, not in components or route handlers —
  this is already the pattern (see Architecture above); new code should
  extend it, not bypass it with inline logic in a `route.ts`.
- No secrets in source. Every secret goes through `.env.local` and, for
  anything stored in the DB, through `src/lib/whatsapp/encryption.ts`'s
  AES-256-GCM helpers (`encrypt`/`decrypt`) — see Security below.

## Database

- Every tenant-scoped table gets an `account_id uuid references accounts(id)`
  FK, an index on it (`idx_<table>_account`, the convention since migration
  `017_account_sharing.sql`), and an RLS policy built on the
  `is_account_member(account_id, min_role)` SQL helper — copy the pattern
  from `017_account_sharing.sql` rather than inventing a new one.
- Migrations are additive and idempotent by convention (`IF NOT EXISTS`,
  `DROP POLICY/TRIGGER IF EXISTS` + recreate, `CREATE OR REPLACE FUNCTION`).
  Never edit a migration that's already been applied anywhere — ship a new
  numbered migration that fixes it forward, the way `032_fix_ai_knowledge_membership.sql`
  and `034_fix_profiles_update_rls.sql` did for real bugs found post-hoc.
- Prefer `ON DELETE SET NULL` over `ON DELETE CASCADE` when the child row
  has audit/reporting value that should survive the parent's deletion —
  see `004_contact_delete_set_null.sql`'s comment for the reasoning
  (`deals`/`broadcast_recipients` keep existing after a contact is deleted).
  There's no `deleted_at` soft-delete column anywhere in the schema — this
  FK-action approach is the project's soft-delete equivalent; don't add a
  parallel `deleted_at` convention without removing this one.
- New base tables need to actually be queryable: `supabase/config.toml`
  has `auto_expose_new_tables = true` because no migration grants
  table-level privileges explicitly (only narrow `GRANT EXECUTE` on RPCs).
  If that config flag is ever removed, every migration needs an explicit
  `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO authenticated, anon;`
  or every new table 42501s despite correct RLS.
- Index deliberately, not by default: the codebase already treats missing
  indexes/constraints as bugs to fix forward (`013_whatsapp_config_phone_number_id_unique.sql`,
  `022_contact_phone_dedup.sql`, `036_conversation_contact_dedup.sql`).
  Add the index when you add the query that needs it, not speculatively.

## Security

- **Authorization**: dashboard routes call `requireRole(min)` from
  `src/lib/auth/account.ts` at the top; the public API calls
  `requireApiKey(request, scope)` from `src/lib/auth/api-context.ts`. Never
  write a new ad hoc auth check — both throw typed errors
  (`UnauthorizedError`/`ForbiddenError`/`ApiError`) that a single
  `toErrorResponse`/`toApiErrorResponse` call turns into the right HTTP
  status. Role capability checks (UI and server) go through the predicates
  in `src/lib/auth/roles.ts` (`canEditSettings`, `canSendMessages`, …), not
  inline `role === 'admin'` comparisons.
- **The one place RLS doesn't cover**: `/api/v1/*` routes authenticate via
  `requireApiKey`, which returns a **service-role** Supabase client (no
  user session exists for RLS to key off). Every query in
  `src/lib/api/v1/*.ts` must filter by `ctx.accountId` explicitly — this is
  the single spot in the app where tenant isolation is an application-code
  discipline instead of a database guarantee. See Testing below for the
  isolation-test requirement this implies.
- **Secrets at rest**: WhatsApp access tokens and AI provider keys are
  AES-256-GCM encrypted via `src/lib/whatsapp/encryption.ts`
  (`encrypt`/`decrypt`), keyed by `ENCRYPTION_KEY`. Any new secret stored
  in the DB reuses this helper, not a new encryption scheme. A legacy
  AES-256-CBC decrypt-only path exists for pre-GCM rows — don't remove it
  without confirming no rows still use it.
- **Webhook verification**: `src/lib/whatsapp/webhook-signature.ts`
  verifies Meta's HMAC-SHA256 signature with `crypto.timingSafeEqual` and
  fails closed if `META_APP_SECRET` is unset. Any new inbound webhook
  (a second channel, a payment provider, etc.) must fail closed the same
  way — never accept an unsigned or unverifiable webhook "just for now."
  The `x-cron-secret` check in `src/app/api/automations/cron/route.ts` and
  `flows/cron/route.ts` follows the same `timingSafeEqual` pattern for a
  shared-secret (not HMAC) scheme.
- **Security headers**: set in `next.config.ts` (HSTS, X-Content-Type-Options,
  X-Frame-Options, Referrer-Policy, Permissions-Policy) and already
  enforced. CSP currently ships as `Content-Security-Policy-Report-Only`
  — not yet blocking anything. See [ADR 0004](./adr/0004-csp-enforcement-criteria.md)
  (once written — Phase 1 item) for the exact criteria to flip it to
  enforcing.
- **Input validation**: there is no schema-validation library
  (`package.json` has no zod/yup) — validation is hand-rolled per route
  (e.g. `validateSendMessageParams` in `src/lib/whatsapp/send-message.ts`,
  manual `typeof` checks in `src/app/api/v1/contacts/route.ts`, which also
  has a hand-written regex sanitizer against PostgREST filter injection).
  New public-facing routes (`/api/v1/*` especially) should use `zod` once
  it's added (Phase 1 backlog item) rather than hand-rolling another ad hoc
  validator — see the engineering-standards backlog in this repo's plan
  history for the rollout order.
- **Rate limiting**: `src/lib/rate-limit.ts` is a real, tested, in-memory
  fixed-window limiter with per-purpose budgets in `RATE_LIMITS`. It is
  explicitly single-process (documented at the top of the file) — fine for
  the single-VPS deploy this template targets. If you deploy multiple
  instances behind a load balancer, swap `checkRateLimit`'s internals for
  Redis/Upstash; the call sites (`checkRateLimit(key, RATE_LIMITS.x)`)
  don't need to change.
- Never log a secret. `console.error` call sites that log an error object
  should log `err.message`/a redacted summary, not a raw request body that
  might contain a token.

## Testing

- Vitest is the only test runner (`vitest.config.ts`, node environment,
  dummy `ENCRYPTION_KEY`/`META_APP_SECRET` injected for tests that touch
  encryption). No Playwright/Cypress yet (Phase 3 backlog item).
- Business-critical modules already have strong coverage — match this bar
  for new engine/crypto/webhook code: `src/lib/automations/*.test.ts`,
  `src/lib/flows/*.test.ts`, `src/lib/whatsapp/{send-message,broadcast-core,
  template-*,meta-api,webhook-signature}.test.ts`, `src/lib/webhooks/{deliver,
  ssrf,sign}.test.ts`, `src/lib/rate-limit.test.ts`, `src/lib/auth/*.test.ts`.
- API route handlers (`src/app/api/**/route.ts`) are the weak spot — most
  are untested at the route-wiring level even when the `src/lib` logic
  they call is well tested. New routes should get a route-level test
  following `src/app/api/whatsapp/send/route.test.ts` as the template.
- Any route reachable via `requireApiKey` (i.e. anything under
  `/api/v1/*`) needs a cross-tenant isolation test: create two accounts,
  assert account A's key cannot read or write account B's rows. This is
  the one layer where RLS isn't the safety net (see Security above), so
  the test is the safety net.
- Don't test only the happy path. At minimum, cover: missing/invalid auth,
  malformed input, the specific external-failure modes each integration
  actually has (Meta API error responses — see `meta-api.test.ts` for the
  existing pattern — webhook signature mismatch, AI provider timeout/`AiError`
  codes in `src/lib/ai/**`).

## API conventions

Two consistent, deliberately distinct conventions — don't blend them:

- **Dashboard routes** (`/api/*`, cookie session): `requireRole(min)` →
  `{ error: string }` on failure via `toErrorResponse()` in
  `src/lib/auth/account.ts`. Internal, not versioned, wording can change
  freely.
- **Public API** (`/api/v1/*`, bearer key): `requireApiKey(request, scope)`
  → the versioned envelope in `src/lib/api/v1/respond.ts`
  (`ok`/`okList`/`fail`/`ApiError`/`toApiErrorResponse`), with cursor
  pagination via `src/lib/api/v1/pagination.ts`. This contract is external
  and versioned — don't change response shape without a version bump plan.
- Rate limit every write-capable route (dashboard or public) using the
  matching bucket in `RATE_LIMITS` (`src/lib/rate-limit.ts`) — add a new
  bucket there, don't inline a limit at the call site.
- Timeouts on outbound calls: the AI layer uses `AbortSignal.timeout()`
  (see `src/lib/ai/generate.ts` / `providers/*`) — new outbound HTTP calls
  (a second AI provider, a second webhook target) should do the same
  rather than hanging on a slow external service.

## External integrations

Meta WhatsApp Cloud API and the AI providers are the only two external
integrations today. Keep new integration code inside `src/lib/<domain>/`,
separated by responsibility (client calls / signing / validation / business
logic in separate files, following the WhatsApp module's layout) — but
don't build a formal `Adapter`/`Provider` interface until there's a second
implementation to abstract over. One implementation behind an interface is
speculative generality, not architecture.

## AI

The provider-agnostic layer already exists — extend it, don't replace it:

- `src/lib/ai/types.ts` — `AiProvider = 'openai' | 'anthropic'`, `AiConfig`,
  `ChatMessage`, `AiUsage`, `GenerateResult`, `AiError`.
- `src/lib/ai/providers/{openai,anthropic}.ts` — one file per provider,
  same `generate*(args): Promise<ProviderResult>` shape.
- `src/lib/ai/generate.ts` — `generateReply()` dispatches on
  `config.provider` via `switch`; adding a third provider means one new
  file in `providers/` plus one new `case`.
- Usage/cost tracking: `src/lib/ai/usage.ts`, logged to `ai_usage_log`
  (migration `029_ai_reply.sql`).
- Keys are BYO (bring-your-own), stored AES-256-GCM encrypted
  (`src/lib/ai/config.ts`, reusing `src/lib/whatsapp/encryption.ts`'s
  primitives) — no platform-wide provider key exists or should exist.
- Retries: currently timeout-only (`AbortSignal.timeout`), no
  exponential-backoff retry loop. Add one if a provider's transient-error
  rate justifies it — don't add generic retry infrastructure speculatively.
- AI output is never trusted blindly: the handoff sentinel
  (`HANDOFF_SENTINEL`) is parsed out explicitly (`parseGeneration()`), and
  auto-reply has a per-conversation cap (`auto_reply_max_per_conversation`)
  plus an account-wide rate bucket (`RATE_LIMITS.aiAutoReplyAccount`) so a
  runaway model can't spam a whole account's inbound queue.

## Background processing

There is no queue/worker system (no BullMQ, no Redis, no pg-boss) — see
[ADR 0003](./adr/0003-background-jobs-polling-not-queue.md) for why, and
the concrete threshold for reconsidering. The existing pattern:

- Automations/flows execute **synchronously** inside the request that
  triggers them (`src/lib/automations/engine.ts`, `src/lib/flows/engine.ts`).
- A `Wait` step doesn't block the request — it writes a row to
  `automation_pending_executions` (`run_at`, `status: 'pending'`) and
  returns. `GET /api/automations/cron` (`src/app/api/automations/cron/route.ts`),
  hit by an external scheduler on a shared secret, claims due rows with a
  `status`-guarded `UPDATE` (a lock, not `SELECT ... FOR UPDATE`) and
  resumes them via `resumePendingExecution()`.
- `GET /api/flows/cron` only sweeps stale `flow_runs` to `timed_out` — flow
  steps themselves run synchronously per inbound webhook, same as
  automations.
- New delayed/background work should follow this same
  polling-table-plus-external-cron shape, not introduce a new mechanism,
  unless the volume genuinely outgrows it (see the ADR's threshold).

## DevOps

- `.github/workflows/ci.yml` runs `npm ci` → `lint` → `typecheck` → `test`
  → `build` on every PR/push to `main`. Keep it green — this is the actual
  gate, not a suggestion.
- No deploy workflow exists in CI; deployment is manual/self-hosted
  (Docker — see `docs/docker.md` — or Hostinger's Git-connected Node.js
  hosting). Don't assume a CD pipeline exists when writing docs or code
  that references "the deploy."
- `supabase/migrations/*.sql` is the only migration mechanism — apply with
  the Supabase CLI (`npx supabase db reset` locally, or the CLI's push
  command against a hosted project). Never hand-edit a hosted database's
  schema outside a migration file.

## Observability

Current state: `console.log`/`console.error`/`console.warn` scattered
across the codebase (~230 call sites), no structured logger, no error
tracking service. This is the main real gap versus the ideal — see the
Phase 2 backlog (structured `src/lib/logger.ts`, optional BYO Sentry DSN)
for the planned fix. Until that lands:

- Every `console.error` in a failure path should include enough context to
  find the record later: which account, which entity id, which operation —
  follow the existing bracketed-tag convention (`[toErrorResponse]`,
  `[api/v1]`, `[AuthProvider]`) so failures are at least `grep`-able by
  origin.
- Never log a decrypted secret, a full request body that might contain
  one, or a raw `Authorization` header.

## Performance

- Pagination is already required on public-API list endpoints
  (`src/lib/api/v1/pagination.ts`, cursor-based). Any new list endpoint —
  dashboard or public — needs pagination before it needs anything else.
- Don't add caching, CDN rules, or query-optimization machinery
  speculatively. The existing `Cache-Control` strategy in `next.config.ts`
  (documented inline — `/api/*` is `no-store`, everything else gets a
  short `s-maxage` with `stale-while-revalidate`) was added to fix a real
  stale-deploy bug, not preemptively; follow that same "fix the measured
  problem" bar for new performance work.

## Frontend

- Design tokens, spacing, and component primitives live under
  `src/components/ui/**` — reuse them; don't hand-roll a one-off button or
  input style.
- Every user-facing string goes through `next-intl` (`useTranslations`) and
  gets added to **all** locale files (`messages/en.json`, `messages/ko.json`,
  `messages/pt-BR.json`) — `src/i18n/messages.test.ts` enforces exact key
  parity across locales and fails CI if one is missing a key the others
  have.
- Dates/relative-times use `date-fns` with the locale resolved via
  `getDateFnsLocale(useLocale())` (`src/lib/date-fns-locale.ts`) — don't
  call `format()`/`formatDistanceToNow()` without passing `{ locale }`,
  or the string comes out in English regardless of the active app locale.

## Multi-tenant architecture

- `accounts` + `profiles.account_id`/`account_role` is the tenancy model
  (one account per user profile — not a many-to-many membership table,
  a deliberate simplification from migration `017_account_sharing.sql`).
  Roles: `owner > admin > agent > viewer`, ranked in
  `src/lib/auth/roles.ts` (`roleRank`) to mirror the SQL-side
  `is_account_member` hierarchy exactly.
- RLS (`is_account_member(account_id, min_role)`, defined in `017`) is the
  primary tenant-isolation guarantee for every dashboard-facing query.
  Privileged mutations (role changes, ownership transfer, member removal)
  go through `SECURITY DEFINER` RPCs that re-check caller authority
  themselves (`018_account_member_rpcs.sql`, `019_invitation_rpcs.sql`) —
  this defense-in-depth existed for a reason: RLS alone missed a
  privilege-escalation path once (`034_fix_profiles_update_rls.sql`,
  GHSA-fg5p-2qc3-jmxr). Don't add a new `SECURITY DEFINER` function
  without the same self-check discipline.
- The one place tenant isolation is **not** RLS-backed is the public API's
  service-role client (see Security above) — treat `ctx.accountId`
  filtering there as security-critical code, not a formality.

## Maintainability

- Comments explain *why*, matching the existing style throughout
  `src/lib` (see `src/lib/auth/account.ts`'s comment on why account
  lookup uses a point query instead of an embedded FK join — that's the
  bar: a comment earns its place by preventing someone from "fixing" a
  non-obvious workaround back into a bug).
- Retroactive and future architectural decisions go in
  [`docs/adr/`](./adr) as short, numbered files — see that folder's
  existing entries for the format.

## Development workflow & Definition of Done

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the fork/PR process and the
concrete, tool-backed Definition of Done checklist (lint/typecheck/test/build
commands, RLS/index checklist for new tables, encryption checklist for new
secrets). This document explains the *why*; that one is the *checklist*.
