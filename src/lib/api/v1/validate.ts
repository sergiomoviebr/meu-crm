// ============================================================
// Shared request-body validation for `/api/v1/*` routes.
//
// zod handles SHAPE and presence (required vs optional, string vs
// array, etc.) — the boilerplate every route used to hand-roll with
// `typeof body.x === 'string'` checks. Domain-specific rules (E.164
// phone validity, recipient count caps, known event names, template
// existence, …) stay where they already lived, in
// src/lib/whatsapp/*, src/lib/webhooks/*, src/lib/api/v1/contacts.ts
// — this module is intentionally thin so it doesn't duplicate that
// business logic (see docs/engineering-standards.md → Security).
// ============================================================

import type { ZodType } from 'zod';
import { badRequest } from './respond';

/**
 * Parse a request's JSON body against `schema`. Throws the same
 * `ApiError` (via `badRequest`) every v1 route already maps through
 * `toApiErrorResponse` in its catch block — callers don't need a new
 * error-handling path.
 *
 * On a malformed/absent body: "Request body must be a JSON object".
 * On a schema mismatch: the first issue's path + message, e.g.
 * "'phone': Required" — enough for an API caller to fix their
 * request without leaking internal schema shape.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<T> {
  const raw: unknown = await request.json().catch(() => null);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('Request body must be a JSON object');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    throw badRequest(path ? `'${path}': ${issue.message}` : issue.message);
  }
  return result.data;
}
