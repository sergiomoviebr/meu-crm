# 0006 — One shared Meta OAuth module for three products, WhatsApp handled separately

## Status

Accepted. First OAuth authorization-code flow in the app — no
internal precedent existed before this (no redirect_uri handling,
no signed-state pattern anywhere else in `src/app/api/**`).

## Context

Three places asked the user to paste Meta credentials by hand:
Settings → WhatsApp (Phone Number ID, WABA ID, access token, PIN),
Content → Redes Sociais (Instagram/Facebook — `social_profiles`
existed but had no real connect path, its providers were stubs), and
Tráfego → Contas de Anúncio (Meta Ads — same story, `ad_accounts`
existed but nothing populated it beyond manual entry/CSV). The ask
was "Connect with Meta," one click, for all three.

Two of those three (Instagram/Facebook, Meta Ads) use Meta's standard
OAuth authorization-code redirect flow — only the requested scopes and
what happens after the token differ. The third (WhatsApp) uses Meta's
**Embedded Signup**, a client-side SDK popup with no page redirect at
all. Treating all three identically would have meant either forcing
WhatsApp's popup-and-postMessage shape through a redirect callback it
doesn't use, or building three near-duplicate redirect flows for
Instagram/Facebook/Ads. Neither was right.

## Decision

**One shared module, `src/lib/meta-oauth/`, for the standard flow**
(`facebook`/`instagram`/`ads`):
- `state.ts` — a signed, opaque `state` param and a signed "picker"
  payload, both via the project's existing `encrypt`/`decrypt`
  (`src/lib/whatsapp/encryption.ts`, AES-256-GCM). No new crypto
  primitive, and no new database table for OAuth session state — GCM's
  auth tag already gives tamper-detection, so the state/picker blobs
  are self-contained and verifiable without a server-side lookup.
- `client.ts` — thin Graph API wrappers (authorize URL, code exchange,
  long-lived token exchange, list Pages/ad accounts), scoped minimally
  per product (`PRODUCT_SCOPES`) so App Review only has to justify what's
  actually requested.
- `connect.ts` — `resolveOrPickCandidate`: exactly one Page/ad account
  found → save directly; zero → a clear "nothing found" outcome; more
  than one → defer to a picker UI. One function, reused by both the
  callback route (first pass) and the finalize route (after a pick),
  instead of three near-identical per-product implementations.
- Four routes: `start` (redirect to Meta) → `callback` (token exchange
  + resolve-or-pick) → `picker` (read-only, returns id/name only,
  never a token) → `finalize` (POST, saves the chosen candidate). The
  picker/finalize split exists specifically so a long-lived access
  token is **never** exposed to the browser in plaintext at any point
  — it only ever lives inside the encrypted state/picker blob or,
  post-finalize, encrypted at rest in `social_profiles`/`ad_accounts`.

**WhatsApp is a second, separate entry point**, not forced into the
same callback: `src/lib/meta-oauth/fb-sdk-client.ts` loads Meta's JS
SDK client-side for the Embedded Signup popup;
`POST /api/whatsapp/embedded-signup/exchange` receives the `code` (from
the SDK callback) and `wabaId`/`phoneNumberId` (from a separate
`window.postMessage` event) together, then reuses the **exact** same
verify → encrypt → register → subscribe → upsert sequence the manual
form already used — extracted verbatim into
`src/lib/whatsapp/config.ts`'s `saveWhatsappConfig()`, called by both
the manual route and the new one. The manual form stays in the UI as
a fallback (e.g. for Meta test numbers, which Embedded Signup doesn't
cover the same way).

`ad_accounts` has no per-account access token (Meta Ads API calls are
authorized with the user's token plus the ad account id in the URL,
unlike a Facebook Page's own page-scoped token) — so the picker
payload carries one shared `userAccessToken` alongside the per-Page
tokens on `facebook`/`instagram` candidates, rather than forcing every
candidate shape to carry a token that doesn't exist for ads.

## Consequences

- **Real external dependency, not fully verifiable from here.**
  Nothing in this flow works until the account owner creates a Meta
  App with the right products, sets `META_APP_ID`/`META_APP_SECRET`/
  `NEXT_PUBLIC_META_APP_ID`/`NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID`,
  registers the exact `redirect_uri`, and — for
  `instagram_content_publish`/`ads_management`/
  `whatsapp_business_management` — passes Meta's App Review. See
  `.env.local.example`.
- **Embedded Signup's wire format
  (`exchangeEmbeddedSignupCode` in `client.ts`, the `postMessage`
  handling in `whatsapp-config.tsx`) is the least-verified part of
  this change** — built from Meta's documented pattern, but there's no
  live popup to test against here. Confirm against Meta's current
  docs and a real connection attempt before trusting it in production;
  if the wire format has shifted, fix it in these two spots, not by
  hand-rolling a parallel path elsewhere.
- **Reconsider the "no session table" choice** if a picker step ever
  needs to survive longer than ~10 minutes (e.g. an async admin
  approval step between discovery and connect) — the current design
  deliberately keeps the picker payload's TTL short and stateless;
  anything requiring a longer-lived pending-connection concept should
  get a real table at that point, not a longer TTL on a token-bearing
  blob sitting in browser history.
