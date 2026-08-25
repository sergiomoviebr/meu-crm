# 0005 — A persistent in-memory Baileys connection for the personal WhatsApp (QR) channel

## Status

Accepted. First-of-its-kind exception to the project's usual
no-persistent-process bias (see ADR 0003 and `src/lib/rate-limit.ts`'s
top comment) — read that context before touching
`src/lib/whatsapp-personal/connection-manager.ts`.

## Context

The app's only WhatsApp channel was the official Meta Cloud API — a
stateless webhook plus outbound HTTP calls, no long-lived connection
anywhere. The account owner asked for a second, unofficial channel:
connect their real personal WhatsApp by scanning a QR code (the
WhatsApp Web protocol), so those conversations show up in the same
Inbox.

This was accepted **knowingly, at the account owner's explicit
request and risk**, after being told directly:

- It uses an unofficial library (`@whiskeysockets/baileys`) that
  automates the WhatsApp Web protocol — this **violates WhatsApp's
  Terms of Service** and carries a real risk of the connected number
  being banned, especially under CRM-style usage.
- It's the account owner's own number, their own risk — not something
  imposed on a third party.

That product decision is out of scope for this ADR. What this ADR
documents is the _architectural_ consequence: unlike every other
integration in this codebase, WhatsApp Web's protocol requires a live,
long-held WebSocket connection with in-memory Signal-protocol state —
there is no stateless request/response shape available, the way Meta's
Cloud API or a `GET /cron` polling route are.

That's a direct conflict with the project's established stance:

- ADR 0003 chose a polling table + external cron over a job queue
  specifically because the deployment target doesn't assume a
  long-running background process.
- `src/lib/rate-limit.ts`'s top comment documents the in-memory
  rate-limiter as **request-scoped**, explicitly avoiding background
  timers to stay serverless-compatible, and calls out that it silently
  breaks under horizontal scale.

Until this feature, nothing in the app held state across requests
beyond that ephemeral, timer-free rate-limit `Map`.

## Decision

### Multiple connected numbers

Since migration 052, one CRM account can own multiple rows in
`whatsapp_personal_sessions`. Every row has its own encrypted Baileys auth state and
the in-memory socket registry is keyed by the session UUID, not by `account_id`.
Personal conversations store `whatsapp_personal_session_id`, so inbound messages,
outbound sends, edits, delivery receipts and reconnects always use the number that
owns that thread. The pre-existing connection is migrated as the default and existing
personal conversations are attached to it without rewriting message history.

Hold one live Baileys `WASocket` per personal session in a
`Map<sessionId, ...>` inside `src/lib/whatsapp-personal/
connection-manager.ts`, for the lifetime of the Node process. In the
Next.js development server this map is stored on `globalThis`, so a
hot reload cannot orphan the old socket and open a second connection
with the same credentials.

This is viable — not reckless — specifically because of how this app
is deployed: `next.config.ts` sets `output: "standalone"` and the
`Dockerfile`'s final stage is `CMD ["node", "server.js"]` — one
long-running Node process, not a horizontally-scaled or serverless
fleet. A persistent in-memory socket survives for exactly as long as
that one process does, which is the deployment's normal operating
assumption already (see `docs/docker.md`).

Credentials (Baileys' `{creds, keys}` auth state) are persisted to
`whatsapp_personal_sessions.auth_state_encrypted`
(`supabase/migrations/045_whatsapp_personal.sql`), AES-256-GCM
encrypted via the existing `src/lib/whatsapp/encryption.ts` helper —
not Baileys' default `useMultiFileAuthState`, which writes to local
disk and wouldn't survive a container redeploy or serve multiple
accounts. This is what makes the process boundary survivable: a
restart loses the in-memory socket, but not the ability to resume one.

Cold start (the Map is empty right after every restart) is handled
lazily, not with a background reconnect loop: the next call to
`getConnectionSnapshot()` — driven by the Settings page polling
`GET /api/whatsapp-personal/status` — resumes any session whose last
known DB status was `connected` or `error` (both imply valid stored
credentials), silently, no new QR needed unless WhatsApp itself logged
the session out (`DisconnectReason.loggedOut`), in which case the
stored credentials are cleared and the user must scan again.

## Consequences

- A fresh QR pairing requests the full one-to-one chat history made available
  by the primary phone. The import is idempotent and marked as historical, so
  it does not replay lead automations or generate live-message notifications.
  Existing sessions created before this behavior must be paired once again;
  WhatsApp only offers the complete initial history during device pairing.
- Group, status and newsletter threads remain outside the CRM data model. The
  Inbox imports individual customer conversations, including archived chats,
  which is the addressable contact scope used by pipelines and broadcasts.

- **Breaks under horizontal scaling**, the same way
  `src/lib/rate-limit.ts` does and for the identical reason: a second
  Node instance would hold its own, independent, empty connection Map.
  Two instances behind a load balancer could each think they own a
  given account's connection, or neither could actually have it live
  depending on which instance last got the resume-triggering request.
  **Do not** deploy this app to multiple instances without first
  moving this connection manager to a dedicated worker process that
  every web instance talks to over an internal API/queue — the DB
  schema (one row per personal session, encrypted auth state) doesn't need to
  change, only what holds the live socket.
- **No automatic reconnect loop on a transient drop.** A `close` event
  that isn't a deliberate logout sets `status='error'` and drops the
  in-memory entry; the next `/status` poll (opening Settings, or the
  UI's existing 2.5s poll while a connection is in a transient state)
  triggers the resume — recovery is "reasonably prompt on next
  interaction," not "instant and unattended." Given this channel is
  explicitly best-effort/unofficial, an unattended retry-with-backoff
  loop was judged not worth the added complexity for v1.
- **ToS/ban risk is real and was accepted knowingly** by the account
  owner, not discovered later — the connect UI
  (`src/components/settings/whatsapp-personal-connect.tsx`) surfaces
  the same warning persistently, not just at setup time, so any
  teammate who later sees this screen understands the tradeoff too.
- **Reconsider this decision if**: the app is ever deployed across
  multiple instances (see above — this breaks first), or WhatsApp's
  protocol/ToS enforcement makes the unofficial channel unreliable
  enough that it's not worth the maintenance burden, at which point
  removing `src/lib/whatsapp-personal/**` and the `channel` column's
  second value is a clean, additive-only revert (the Meta channel
  never depended on any of this).
