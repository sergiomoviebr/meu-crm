# 0001 — Multi-tenant isolation via RLS + `is_account_member`, not app-layer only

## Status

Accepted (retroactive — documents migration `017_account_sharing.sql` and
its follow-ups `018`–`020`, `032`, `034`).

## Context

The schema started single-tenant-per-user (`001_initial_schema.sql`): every
table had `user_id` and a policy `USING (auth.uid() = user_id)`. Teams
needed shared access to one inbox/pipeline (multiple agents on one WhatsApp
number), which single-user ownership can't express.

Two ways to add multi-tenancy:

1. Keep authorization purely in application code (every query manually
   filtered by `account_id`, checked in each API route).
2. Add an `accounts` table and enforce isolation at the database layer via
   Row Level Security, with application code as a second, defense-in-depth
   layer rather than the only layer.

## Decision

Went with (2). `017_account_sharing.sql` added `accounts`,
`account_role_enum` (`owner`/`admin`/`agent`/`viewer`), `account_id` on
every tenant table, and a `SECURITY DEFINER` helper function
`is_account_member(account_id, min_role)` that every RLS policy calls:

```sql
CREATE POLICY contacts_select ON contacts
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY contacts_insert ON contacts
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
```

Child tables that don't carry `account_id` directly join up to a parent
that does:

```sql
CREATE POLICY messages_select ON messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id
            AND is_account_member(c.account_id))
  );
```

Application code (`requireRole()` in `src/lib/auth/account.ts`,
`src/lib/auth/roles.ts`) enforces the same rules a second time, in two
cases where RLS alone isn't enough:

- **Side effects that happen before the DB write.** Sending a WhatsApp
  message calls Meta's API before inserting the message row — RLS can't
  stop an unauthorized Meta send, only an unauthorized insert. The route
  checks `requireRole` first.
- **Privileged mutations.** Role changes, member removal, and ownership
  transfer go through `SECURITY DEFINER` RPCs (`018_account_member_rpcs.sql`,
  `019_invitation_rpcs.sql`) that re-check caller authority inside the
  function body, because the mutation touches rows the caller wouldn't
  normally be allowed to write directly.

This dual-layer approach earned its keep twice already:

- `032_fix_ai_knowledge_membership.sql` fixed a cross-tenant data leak in
  `030_ai_knowledge.sql`'s RPCs, caused by those functions being
  `SECURITY DEFINER` without re-checking membership — flipped to
  `SECURITY INVOKER` so RLS applied as intended.
- `034_fix_profiles_update_rls.sql` fixed a privilege-escalation gap
  (a user could `UPDATE` their own `profiles.account_role`) that RLS's
  `USING (auth.uid() = user_id)` policy didn't catch, because it checked
  *which row* but not *which columns*. Fixed with a `BEFORE UPDATE`
  trigger rejecting changes to privilege columns. Tracked as
  GHSA-fg5p-2qc3-jmxr.

## Consequences

- Every new tenant-scoped table must get an `account_id` FK, an index on
  it, and an `is_account_member`-based policy — this is now a checklist
  item (see `docs/engineering-standards.md` → Database, and
  `CONTRIBUTING.md`'s Definition of Done).
- The one surface where this guarantee doesn't apply is the public API
  (`/api/v1/*`), which authenticates via API key and uses a service-role
  client with no `auth.uid()` for RLS to match — see
  `docs/engineering-standards.md` → Security for the explicit
  `ctx.accountId` filtering discipline that surface requires instead.
- One account per user profile (not a many-to-many membership table) was
  a deliberate simplification, not an oversight — revisit only if a real
  requirement for one user belonging to multiple accounts shows up.
