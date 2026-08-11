# E2E smoke tests

One Playwright suite, one browser (Chromium), one test: the golden path
that's actually exercisable without a real WhatsApp Business API
connection (sign up → dashboard → create a contact). See the comment at
the top of `smoke.spec.ts` for why it stops there.

## Run locally

Needs both the local Supabase stack and the dev server running — unlike
a typical Playwright setup, `playwright.config.ts` does **not**
auto-start `next dev` for you, because Supabase can't be auto-started
the same way and a half-up stack produces confusing failures instead of
a clean "server not running" error.

```bash
npx supabase start   # if not already running
npm run dev           # in a separate terminal, if not already running
npx playwright test   # runs against http://localhost:3000
```

First run only: `npx playwright install chromium` to fetch the browser
binary (not committed, downloaded into the Playwright cache).

## CI

Not wired into `.github/workflows/ci.yml` yet — it would need a
Supabase-in-CI step (start the CLI's local stack, wait for it to be
healthy) that the current CI job doesn't have. Add it as a separate,
non-blocking job when that's set up, then promote it to blocking once
it's proven stable — see `docs/engineering-standards-progress.md`.
