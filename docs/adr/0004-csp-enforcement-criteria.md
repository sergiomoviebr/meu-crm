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
