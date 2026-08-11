# 0004 — Enforce CSP now, while this fork has no production traffic

## Status

Accepted (2026-08-11).

## Context

`next.config.ts` shipped a `Content-Security-Policy-Report-Only` header
from the start — every directive already reasoned through (script/style/
img/media/font/connect sources, `frame-ancestors 'none'`, etc.), but only
observing violations in the browser console, never blocking anything.
The original comment deferred flipping to enforcing until "two deploys, a
pass on every route" — a criterion aimed at a fork already serving real
users, where an untested directive breaking a legitimate asset is a
user-facing incident.

This fork (`meu crm`) is currently a **local development environment
only** — no production deploy, no real users, no traffic besides the
person building it. That changes the cost/benefit: a CSP violation here
shows up immediately in the browser console during normal development
(clicking around the dashboard, testing a feature), gets fixed on the
spot, and never reaches a user. Waiting for a hypothetical future
production deploy to start finding these gains nothing and defers real
security coverage for no reason.

## Decision

Enforce CSP now: `next.config.ts`'s security header is
`Content-Security-Policy` (not `-Report-Only`). No directive values were
changed — the policy that had been running in observe-only mode for a
while is the one now enforced.

## Consequences

- If a legitimate script/style/image/connection gets blocked, it fails
  loudly (browser console + broken feature) instead of quietly
  logging a violation. Given this is caught during active local
  development, that's the intended trade — surface it immediately, fix
  the specific directive, don't relax the whole policy.
- Before any future **production** deploy of a fork descended from this
  one, re-verify the policy against that deployment's actual asset
  origins (CDN, analytics, embeds, etc. added later) — this ADR's
  reasoning ("no traffic to break") stops applying the moment real users
  show up. Re-confirm the header is still `Content-Security-Policy`,
  not accidentally reverted to Report-Only during a merge/rebase.
- If a specific directive proves too strict for a legitimate need
  (e.g. embedding a new widget), widen exactly that directive in
  `next.config.ts`'s `SECURITY_HEADERS` — don't drop back to
  Report-Only as a workaround.

## Addendum (2026-08-11): local Supabase broke on first real test

Enforcing CSP immediately broke signup/auth in local dev: `connect-src`
only allowed `https://*.supabase.co`, but a local Supabase instance
(`supabase start`) serves plain HTTP on `http://127.0.0.1:54321` — every
auth/REST/realtime call failed with a bare "Failed to fetch" and no CSP
violation message in the console, making it easy to miss. This was
caught by `e2e/smoke.spec.ts` (Fase 3.3) on its very first run, not by
manual testing — a concrete argument for the E2E suite existing at all.

Fixed in `next.config.ts`: `connect-src` now conditionally includes the
local Supabase origin (derived from `NEXT_PUBLIC_SUPABASE_URL`), gated
on `NODE_ENV !== "production"` so a production build keeps the original,
tighter hosted-only policy. This doesn't change the enforcement decision
above — it's exactly the kind of "widen the specific directive that
failed" response the original ADR text already called for, just
documenting that it happened and why.
