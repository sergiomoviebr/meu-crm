// ============================================================
// Structured logging — a thin wrapper over console.*, not a new
// service dependency.
//
// Why this exists: failures were logged as free-text strings
// (`console.error('[api/v1] uncategorized error:', err)`) with no
// consistent way to grep/filter by account, request, or operation once
// they reach whatever log aggregation the operator's host provides (or
// doesn't). This wraps every call in one JSON shape —
// `{ level, message, timestamp, ...context }` — so a self-hoster who
// pipes stdout into any log tool (or just `grep`s a file) can filter on
// `accountId`/`operation` without parsing prose.
//
// Deliberately NOT a new dependency (no pino/winston) and NOT a
// replacement for every console.* call in the codebase — see
// docs/engineering-standards.md → Observability for which call sites
// were migrated and why the rest weren't, yet.
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  /** Account the operation was scoped to, when known. */
  accountId?: string;
  /** Per-request correlation id, when the caller has one. */
  requestId?: string;
  /** Short machine tag for where this came from, e.g. "whatsapp/webhook",
   *  mirroring the `[bracketed]` tags already used in console.* calls
   *  across the codebase — kept as a field instead of message prose so
   *  it's filterable. */
  operation?: string;
  /** Anything else worth keeping — contactId, conversationId, a status
   *  code, etc. Merged directly into the log line. */
  [key: string]: unknown;
}

/** Normalize an Error (or anything thrown) into a loggable shape.
 *  Error instances don't JSON.stringify their own message/stack (they're
 *  non-enumerable getters), so logging `err` directly silently drops
 *  them — this fixes that without callers needing to remember. */
function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

function write(level: LogLevel, message: string, context?: LogContext) {
  const entry: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      entry[key] = key === 'error' ? serializeError(value) : value;
    }
  }
  const line = JSON.stringify(entry);
  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
      break;
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => write('debug', message, context),
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
};
