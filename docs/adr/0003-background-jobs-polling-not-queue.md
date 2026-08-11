# 0003 — Polling table + external cron for delayed work, not a queue/worker system

## Status

Accepted (retroactive — documents `automation_pending_executions` +
`GET /api/automations/cron` / `GET /api/flows/cron` as they exist today).
Revisit if the threshold in Consequences is actually hit.

## Context

Two kinds of "not right now" work exist in the product:

- An automation's `Wait` step (e.g. "wait 2 hours, then send a follow-up").
- A flow run that should time out if a customer never replies.

Immediate-trigger automation/flow steps (an inbound message arrives, run
the matching automation) already execute synchronously inside the webhook
request — that's fine, they're fast. The `Wait`/timeout cases need
something to fire *later*, after the triggering request has long since
returned.

Options considered:

1. A real job queue (BullMQ/pg-boss + Redis, or a hosted queue service) —
   workers pull jobs, retry with backoff, dead-letter on repeated failure.
2. A plain Postgres table of pending work (`run_at`, `status`), drained by
   an endpoint that something external pings on a schedule.

## Decision

Went with (2). `automation_pending_executions` stores each delayed step
(`run_at`, `status: 'pending'`, the context needed to resume). Two `GET`
routes, gated by a shared secret compared with `timingSafeEqual`
(`AUTOMATION_CRON_SECRET`), do the draining:

- `src/app/api/automations/cron/route.ts` — selects due rows
  (`status = 'pending' AND run_at <= now()`), claims each with a
  status-guarded `UPDATE` (a cheap lock — avoids `SELECT ... FOR UPDATE`),
  then calls `resumePendingExecution()` from
  `src/lib/automations/engine.ts`.
- `src/app/api/flows/cron/route.ts` — sweeps stale `flow_runs` to
  `timed_out`.

Nothing runs these on its own; the operator points an external
scheduler (Vercel Cron, a GitHub Actions scheduled workflow, `cron` on a
VPS, an uptime-pinger service) at both endpoints. This is documented
behavior, not a gap — see `docs/automations-and-cron.md`.

This was chosen over a real queue because:

- The target deployment is a single self-hosted instance (Docker on a VPS,
  or Hostinger's managed Node.js) — the operational cost of running Redis
  (or a hosted queue) plus a separate worker process is disproportionate
  to a CRM's automation volume for a small team.
- A plain table is trivially inspectable (`SELECT * FROM
  automation_pending_executions WHERE status = 'pending'`) — no queue UI,
  no separate monitoring surface to build.
- The claim-via-UPDATE lock is good enough at this volume; it's not
  linearizable under high contention, but a CRM's automation `Wait` steps
  aren't a high-throughput workload.

## Consequences

- **Not free of trade-offs.** If the external scheduler is misconfigured
  or stops pinging, delayed steps silently pile up with no alert — this is
  a real observability gap (see the Phase 2 logging work in
  `docs/engineering-standards.md` → Observability). The endpoints return
  503 with a clear message when `AUTOMATION_CRON_SECRET` is unset, at
  least, so misconfiguration fails loud on the first call.
- **No automatic retry with backoff** on a resumed step that itself fails
  — `resumePendingExecution` either succeeds or the row is stuck in
  `running`/logged as an error, without a dead-letter queue.
- **Reconsider this decision if**: automation volume grows enough that
  claim contention becomes measurable, delayed-step failures need
  retry-with-backoff instead of manual investigation, or the app moves to
  a genuinely multi-instance/horizontally-scaled deployment (which also
  breaks the in-memory rate limiter — see `src/lib/rate-limit.ts` — for
  the same underlying reason: single-process assumptions). At that point,
  swap the cron-drained table for a real queue; the trigger points
  (`resumePendingExecution`, the engine's step dispatch) don't need to
  change shape, only what calls them and when.
