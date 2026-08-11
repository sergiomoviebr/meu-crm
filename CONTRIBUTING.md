# Using this template

This is a **template repository**, not a collaborative product. The
expected flow is:

1. **Fork** it to your own GitHub account or organisation.
2. **Deploy** the fork — see [`docs/`](./docs/README.md).
3. **Customise** your fork. Rebrand, add the features you need, remove
   the ones you don't, swap hosting, change the schema.

You **don't** need to send changes back upstream. The fact that your
fork diverges is the whole point — the upstream is deliberately
opinionated about stack, UX, and scope, and your fork is where those
opinions become yours.

## Fork and run

```bash
# 1. Fork on GitHub: https://github.com/ArnasDon/wacrm → Fork
# 2. Clone your fork
git clone https://github.com/<your-username>/wacrm.git
cd wacrm

cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm install
npm run dev
```

Full setup (Supabase migrations, WhatsApp Business API, deploy) lives in
[`docs/`](./docs/README.md).

## Keeping your fork up to date

Pull in upstream bug fixes and security patches periodically:

```bash
git remote add upstream https://github.com/ArnasDon/wacrm.git  # once
git fetch upstream
git checkout main
git merge upstream/main     # or: git rebase upstream/main
# Resolve any conflicts (likely in areas you've customised), then push
git push origin main
```

If you've made heavy local customisations, rebasing can surface
conflicts every time you pull. Pinning to a specific upstream tag and
updating on your schedule is a valid alternative.

## Reporting bugs in the upstream template

If you find a bug in the upstream code — not one you introduced in your
fork — please file it using the
[bug report](https://github.com/ArnasDon/wacrm/issues/new?template=bug_report.yml)
template. Including the commit SHA, the runtime (Hostinger / Vercel /
local / other), and logs will get to a fix fastest.

## Reporting security issues

**Do not file security issues publicly.** Follow the private flow in
[SECURITY.md](./.github/SECURITY.md).

## Upstream pull requests

Not the primary flow, but welcome in specific cases:

- **Security fixes** — always welcome, please follow SECURITY.md first
  for disclosure.
- **Bug fixes** that match upstream intent (crash, correctness,
  documentation errors, typos) — land quickly.
- **Small improvements** (accessibility, obvious UX nits) — usually
  welcome, open an issue first to check alignment.

Less likely to land:

- **New features.** The template's scope is intentionally narrow. A
  "great idea for a CRM" is often a great idea for *your* CRM — i.e.
  your fork — but would dilute the template for the next forker.
- **Stack changes** (different ORM, different UI kit, different auth
  provider). These belong in a fork, not upstream.
- **Opinionated refactors** without a concrete correctness or
  performance motivation.

If you do send a PR, the usual rules apply:

- Branch off the latest `main` (don't push to a merged branch — commits
  end up orphaned).
- Run `npm run typecheck` and `npm run format` locally first.
- Fill in the PR template, especially the **Test plan**.
- One logical change per PR.
- Commit-message first line is imperative + terse; the body explains
  the *why*, the diff shows the *what*.

Expect a review within a few days. PRs opened without an issue may be
closed — open the issue first to align.

## If you maintain a public fork

- Rebrand. The "CRM Template for WhatsApp" name, favicon, and
  `wacrm.tech` URL belong to the upstream project; please swap them
  for your own before putting your deployment in front of users.
- Keep the MIT [`LICENSE`](./LICENSE) file — that's how the template's
  permissions travel with the code. Attribution in a `README` section
  is appreciated but not required.
- You are free to re-license additions to your fork however you like.

## Definition of Done

A change isn't done because it works in the happy path. Before you
consider a feature/fix finished in this fork, check it against this list —
it's the concrete, tool-backed version of the reasoning in
[`docs/engineering-standards.md`](./docs/engineering-standards.md):

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` all
      pass locally (this is exactly `.github/workflows/ci.yml`'s gate).
- [ ] New tenant-scoped table → `account_id` FK + `idx_<table>_account`
      index + an `is_account_member(...)`-based RLS policy, following
      `supabase/migrations/017_account_sharing.sql`'s pattern (see
      [ADR 0001](./docs/adr/0001-multi-tenant-rls.md)).
- [ ] New secret stored in the DB → goes through
      `src/lib/whatsapp/encryption.ts`'s `encrypt()`/`decrypt()`, never
      plaintext, never logged.
- [ ] New API route → `requireRole()` (dashboard) or `requireApiKey()`
      (public `/api/v1`) at the top; a rate-limit bucket in
      `src/lib/rate-limit.ts` if it's write-capable; a route-level test
      following `src/app/api/whatsapp/send/route.test.ts`.
- [ ] New `/api/v1/*` route specifically → a cross-tenant isolation test
      (two accounts, assert no leakage) — this is the one layer without
      an RLS safety net.
- [ ] New inbound webhook → signature/secret verification that fails
      closed, matching `src/lib/whatsapp/webhook-signature.ts`.
- [ ] New user-facing string → added to **all** locale files
      (`messages/en.json`, `messages/ko.json`, `messages/pt-BR.json`);
      `npx vitest run src/i18n/messages.test.ts` catches a missed one.
- [ ] New date/time display → `date-fns` call passes
      `{ locale: getDateFnsLocale(useLocale()) }`
      (`src/lib/date-fns-locale.ts`), not the bare English default.
- [ ] Loading, empty, and error states exist for anything that fetches
      data — not just the populated-happy-path render.
- [ ] Failure paths tested, not just success: invalid input, missing
      auth, the external API actually erroring (see existing
      `meta-api.test.ts` / `webhook-signature.test.ts` for the pattern),
      not only the 200 case.
- [ ] No `console.log`/`console.error` of a secret, decrypted token, or
      raw `Authorization` header.
- [ ] No new abstraction (adapter interface, queue, service layer) added
      without a second concrete implementation or a measured problem it
      solves — see `docs/engineering-standards.md`'s Architecture section
      and the linked ADRs for what's already been deliberately deferred.

## Dev-loop reference

Even if you never send a PR upstream, these are the scripts you'll use
in your fork:

| Command | What it does |
| --- | --- |
| `npm run dev` | Turbopack dev server on port 3000. |
| `npm run build` | Production build. Next also runs its own typecheck here. |
| `npm run typecheck` | `tsc --noEmit`. Fast TS-only pass. |
| `npm run lint` | ESLint. |
| `npm run format` | Prettier write. |
| `npm run format:check` | Prettier in check-only mode. Useful in CI. |

## Licensing

This template is MIT ([`LICENSE`](./LICENSE)). Anything you contribute
upstream is assumed to be MIT too. Your fork's additions are yours to
license however you like.
