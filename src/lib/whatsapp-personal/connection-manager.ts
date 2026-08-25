// ============================================================
// In-memory singleton holding one live Baileys WebSocket connection
// per personal-WhatsApp session. Multiple sessions may belong to the
// same CRM account without sharing sockets or credentials. This is the
// first long-lived, persistent-process
// state in the codebase — see docs/adr/0005-personal-whatsapp-
// persistent-connection.md for why that's an intentional departure
// from the project's usual "assume a single ephemeral request" bias
// (docs/adr/0003, src/lib/rate-limit.ts's top comment).
//
// Single-process only, same caveat as src/lib/rate-limit.ts: this
// Map lives in one Node process's memory. It works because the
// deployment target (Dockerfile: `CMD ["node", "server.js"]`,
// next.config.ts: `output: "standalone"`) is one long-running
// process, not a horizontally-scaled/serverless fleet. If this app
// is ever scaled to multiple instances, this needs to move to a
// dedicated worker process — a Map here would silently only serve
// whichever instance happens to hold the socket.
//
// Cold start: the Map is empty after every process restart even
// though a session may still be valid on WhatsApp's side. Rather
// than a background reconnect loop, resumption is lazy — the next
// call to getConnectionSnapshot() (driven by the Settings page
// polling GET /api/whatsapp-personal/status) resumes any session
// whose last known DB status was 'connected' or 'error' silently, no
// new QR needed unless the phone actually logged the session out.
// ============================================================

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  makeCacheableSignalKeyStore,
  proto,
  type WASocket,
} from '@whiskeysockets/baileys';
import { pino } from 'pino';
import QRCode from 'qrcode';

import { loadDbAuthState } from '@/lib/whatsapp-personal/auth-state';
import { supabaseAdmin } from '@/lib/whatsapp-personal/admin-client';
import {
  applyPersonalDeliveryStatus,
  personalAckToStatus,
  receiptToStatus,
} from '@/lib/whatsapp-personal/delivery-status';
import { ingestPersonalMessage } from '@/lib/whatsapp-personal/ingest';
import { importPersonalHistorySet } from '@/lib/whatsapp-personal/history-sync';
import { logger } from '@/lib/logger';
import type {
  WhatsAppPersonalHistorySyncStatus,
  WhatsAppPersonalStatus,
} from '@/types';

const baileysLogger = pino({ level: 'silent' });

interface ConnectionEntry {
  sock: WASocket | null;
  status: WhatsAppPersonalStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  lastError: string | null;
  /** Guards against two concurrent startConnection() calls for the same session. */
  starting: boolean;
  historySyncStatus: WhatsAppPersonalHistorySyncStatus;
  historySyncProgress: number;
  historySyncChats: number;
  historySyncMessages: number;
  historySyncError: string | null;
  historySyncedJids: Set<string>;
}

export interface ConnectionSnapshot {
  status: WhatsAppPersonalStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  lastError: string | null;
  historySyncStatus: WhatsAppPersonalHistorySyncStatus;
  historySyncProgress: number;
  historySyncChats: number;
  historySyncMessages: number;
  historySyncError: string | null;
}

/**
 * Keyed by whatsapp_personal_sessions.id, never by account_id.
 *
 * Next.js reloads server modules during development. Keeping this map on
 * globalThis in that environment prevents the old Baileys socket from being
 * orphaned while a freshly evaluated module opens a competing connection for
 * the same WhatsApp credentials.
 */
const developmentGlobal = globalThis as typeof globalThis & {
  __crmPersonalWhatsappConnections?: Map<string, ConnectionEntry>;
};
const connections =
  process.env.NODE_ENV === 'development'
    ? (developmentGlobal.__crmPersonalWhatsappConnections ??= new Map<
        string,
        ConnectionEntry
      >())
    : new Map<string, ConnectionEntry>();

function toSnapshot(entry: ConnectionEntry): ConnectionSnapshot {
  return {
    status: entry.status,
    qrDataUrl: entry.qrDataUrl,
    phoneNumber: entry.phoneNumber,
    lastError: entry.lastError,
    // Development HMR can keep an entry created by the previous module shape
    // on globalThis. Defaults make that live socket safe until it is paired
    // again through the new history-enabled flow.
    historySyncStatus: entry.historySyncStatus ?? 'idle',
    historySyncProgress: entry.historySyncProgress ?? 0,
    historySyncChats: entry.historySyncChats ?? 0,
    historySyncMessages: entry.historySyncMessages ?? 0,
    historySyncError: entry.historySyncError ?? null,
  };
}

const EMPTY_HISTORY_SYNC = {
  historySyncStatus: 'idle' as WhatsAppPersonalHistorySyncStatus,
  historySyncProgress: 0,
  historySyncChats: 0,
  historySyncMessages: 0,
  historySyncError: null,
};

/** Extracts the plain phone-number-shaped statusCode out of a Baileys/Boom-style disconnect error, without importing @hapi/boom directly (a transitive dep, not one of ours). */
function disconnectStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'output' in error) {
    const output = (error as { output?: { statusCode?: number } }).output;
    return output?.statusCode;
  }
  return undefined;
}

async function updateSessionRow(
  accountId: string,
  sessionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('whatsapp_personal_sessions')
    .update(patch)
    .eq('id', sessionId)
    .eq('account_id', accountId);
  if (error) {
    logger.error('Failed to update whatsapp_personal_sessions row', {
      operation: 'whatsapp-personal.connection-manager',
      accountId,
      sessionId,
      error: new Error(error.message),
    });
  }
}

/**
 * Returns the current connection state, resuming a session from the
 * database if the process was restarted since the last connect and
 * the stored session still looks viable (status 'connected' or
 * 'error' — both imply valid credentials, just no live socket right
 * now). A stale 'connecting'/'qr_pending' row with no live socket
 * means a previous attempt was interrupted mid-handshake — reported
 * as 'disconnected' since its QR is long expired; the user needs to
 * hit "Conectar" again.
 */
export async function getConnectionSnapshot(
  accountId: string,
  sessionId: string
): Promise<ConnectionSnapshot> {
  const inMemory = connections.get(sessionId);
  if (inMemory) return toSnapshot(inMemory);

  const { data: row } = await supabaseAdmin()
    .from('whatsapp_personal_sessions')
    .select(
      'status, phone_number, last_error, auth_state_encrypted, history_sync_status, history_sync_progress, history_sync_chats, history_sync_messages, history_sync_error'
    )
    .eq('id', sessionId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (!row) {
    return {
      status: 'disconnected',
      qrDataUrl: null,
      phoneNumber: null,
      lastError: null,
      ...EMPTY_HISTORY_SYNC,
    };
  }

  if (
    (row.status === 'connected' ||
      row.status === 'error' ||
      row.status === 'connecting') &&
    row.auth_state_encrypted
  ) {
    void startConnection(accountId, sessionId);
    return {
      status: 'connecting',
      qrDataUrl: null,
      phoneNumber: row.phone_number ?? null,
      lastError: null,
      historySyncStatus:
        (row.history_sync_status as WhatsAppPersonalHistorySyncStatus | null) ??
        'idle',
      historySyncProgress: row.history_sync_progress ?? 0,
      historySyncChats: row.history_sync_chats ?? 0,
      historySyncMessages: row.history_sync_messages ?? 0,
      historySyncError: row.history_sync_error ?? null,
    };
  }

  if (row.status === 'connecting' || row.status === 'qr_pending') {
    return {
      status: 'disconnected',
      qrDataUrl: null,
      phoneNumber: null,
      lastError: null,
      historySyncStatus:
        (row.history_sync_status as WhatsAppPersonalHistorySyncStatus | null) ??
        'idle',
      historySyncProgress: row.history_sync_progress ?? 0,
      historySyncChats: row.history_sync_chats ?? 0,
      historySyncMessages: row.history_sync_messages ?? 0,
      historySyncError: row.history_sync_error ?? null,
    };
  }

  return {
    status: row.status as WhatsAppPersonalStatus,
    qrDataUrl: null,
    phoneNumber: row.phone_number ?? null,
    lastError: row.last_error ?? null,
    historySyncStatus:
      (row.history_sync_status as WhatsAppPersonalHistorySyncStatus | null) ??
      'idle',
    historySyncProgress: row.history_sync_progress ?? 0,
    historySyncChats: row.history_sync_chats ?? 0,
    historySyncMessages: row.history_sync_messages ?? 0,
    historySyncError: row.history_sync_error ?? null,
  };
}

/** Idempotent — a second call while a connection is already starting/live is a no-op. */
export async function startConnection(
  accountId: string,
  sessionId: string
): Promise<ConnectionSnapshot> {
  const existing = connections.get(sessionId);
  if (existing?.sock || existing?.starting) return toSnapshot(existing);

  const entry: ConnectionEntry = {
    sock: null,
    status: 'connecting',
    qrDataUrl: null,
    phoneNumber: null,
    lastError: null,
    starting: true,
    ...EMPTY_HISTORY_SYNC,
    historySyncedJids: new Set<string>(),
  };
  connections.set(sessionId, entry);
  await updateSessionRow(accountId, sessionId, {
    status: 'connecting',
    last_error: null,
  });

  const admin = supabaseAdmin();
  const { data: persistedHistory } = await admin
    .from('whatsapp_personal_sessions')
    .select(
      'history_sync_status, history_sync_progress, history_sync_chats, history_sync_messages, history_sync_error'
    )
    .eq('id', sessionId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (persistedHistory) {
    entry.historySyncStatus =
      (persistedHistory.history_sync_status as WhatsAppPersonalHistorySyncStatus | null) ??
      'idle';
    entry.historySyncProgress = persistedHistory.history_sync_progress ?? 0;
    entry.historySyncChats = persistedHistory.history_sync_chats ?? 0;
    entry.historySyncMessages = persistedHistory.history_sync_messages ?? 0;
    entry.historySyncError = persistedHistory.history_sync_error ?? null;
  }
  const { state, saveCreds } = await loadDbAuthState(
    admin,
    accountId,
    sessionId
  );

  let version: [number, number, number] | undefined;
  try {
    version = (await fetchLatestBaileysVersion()).version;
  } catch {
    // Fall back to the version bundled with Baileys — a stale version
    // still works most of the time, this is only a courtesy update.
  }

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger: baileysLogger,
    connectTimeoutMs: 15_000,
    defaultQueryTimeoutMs: 15_000,
    browser: Browsers.macOS('Desktop'),
    ...(version ? { version } : {}),
    // Match WhatsApp Web's linked-device setup: ask the phone for its full
    // available one-to-one history. Historical rows are imported through a
    // dedicated path that suppresses live notifications and automations.
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    shouldIgnoreJid: (jid) =>
      jid.endsWith('@g.us') ||
      jid.endsWith('status@broadcast') ||
      jid.endsWith('@newsletter'),
  });
  entry.sock = sock;
  entry.starting = false;

  sock.ev.on('creds.update', saveCreds);

  if (!state.creds.registered) {
    entry.historySyncStatus = 'pending';
    entry.historySyncProgress = 0;
    entry.historySyncChats = 0;
    entry.historySyncMessages = 0;
    entry.historySyncError = null;
    await updateSessionRow(accountId, sessionId, {
      history_sync_status: 'pending',
      history_sync_progress: 0,
      history_sync_chats: 0,
      history_sync_messages: 0,
      history_sync_started_at: null,
      history_sync_completed_at: null,
      history_sync_error: null,
    });
  }

  sock.ev.on('connection.update', (update) => {
    void (async () => {
      const current = connections.get(sessionId);
      if (!current) return;

      if (update.qr) {
        current.qrDataUrl = await QRCode.toDataURL(update.qr);
        current.status = 'qr_pending';
        await updateSessionRow(accountId, sessionId, { status: 'qr_pending' });
      }

      if (update.connection === 'open') {
        const phoneNumber = jidDecode(sock.user?.id)?.user ?? null;
        current.status = 'connected';
        current.qrDataUrl = null;
        current.phoneNumber = phoneNumber;
        current.lastError = null;
        await updateSessionRow(accountId, sessionId, {
          status: 'connected',
          phone_number: phoneNumber,
          connected_at: new Date().toISOString(),
          last_error: null,
        });
      }

      if (update.connection === 'close') {
        const statusCode = disconnectStatusCode(update.lastDisconnect?.error);
        connections.delete(sessionId);

        if (statusCode === DisconnectReason.loggedOut) {
          await updateSessionRow(accountId, sessionId, {
            status: 'disconnected',
            auth_state_encrypted: null,
            phone_number: null,
            connected_at: null,
            last_error: null,
          });
          logger.warn('WhatsApp personal connection logged out', {
            operation: 'whatsapp-personal.connection-manager',
            accountId,
            sessionId,
          });
          return;
        }

        // Every other close is reconnectable, and reconnecting must not
        // wait for someone to reopen Settings — the socket needs to
        // heal itself in the background, or sends silently fail while
        // nobody's watching the status page. restartRequired (515) in
        // particular is a NORMAL, expected part of every fresh pairing
        // (WhatsApp closes once right after the QR scan and expects an
        // immediate reconnect with the now-saved creds) — reconnect
        // right away and don't surface it as an error. Anything else
        // (network blip, 503 unavailable, …) gets a short delay so a
        // truly dead session doesn't spin in a tight reconnect loop.
        const isRestartRequired =
          statusCode === DisconnectReason.restartRequired;
        if (!isRestartRequired) {
          await updateSessionRow(accountId, sessionId, {
            status: 'error',
            last_error: 'Conexão perdida — reconectando automaticamente…',
          });
        }
        logger.warn('WhatsApp personal connection closed, reconnecting', {
          operation: 'whatsapp-personal.connection-manager',
          accountId,
          sessionId,
          statusCode,
        });
        setTimeout(
          () => {
            startConnection(accountId, sessionId).catch((err) =>
              logger.error('WhatsApp personal reconnect failed', {
                operation: 'whatsapp-personal.connection-manager',
                accountId,
                sessionId,
                error: err instanceof Error ? err : new Error(String(err)),
              })
            );
          },
          isRestartRequired ? 0 : 3000
        );
      }
    })().catch((err) => {
      logger.error('Error handling WhatsApp personal connection.update', {
        operation: 'whatsapp-personal.connection-manager',
        accountId,
        sessionId,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    });
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    void (async () => {
      for (const message of messages) {
        try {
          await ingestPersonalMessage(
            admin,
            accountId,
            sessionId,
            message,
            sock
          );
        } catch (err) {
          logger.error('Failed to ingest personal WhatsApp message', {
            operation: 'whatsapp-personal.ingest',
            accountId,
            sessionId,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    })();
  });

  // History chunks may arrive close together. Serializing them prevents two
  // chunks for the same chat racing to create its contact/conversation row.
  let historyImportChain = Promise.resolve();
  sock.ev.on('messaging-history.set', (history) => {
    historyImportChain = historyImportChain
      .then(async () => {
        const current = connections.get(sessionId);
        if (!current) return;
        current.historySyncStatus = 'syncing';
        current.historySyncProgress = Math.max(
          current.historySyncProgress,
          Math.min(99, Math.max(0, Number(history.progress ?? 0)))
        );
        current.historySyncError = null;
        await updateSessionRow(accountId, sessionId, {
          history_sync_status: 'syncing',
          history_sync_progress: current.historySyncProgress,
          history_sync_started_at: new Date().toISOString(),
          history_sync_error: null,
        });

        const imported = await importPersonalHistorySet(
          admin,
          accountId,
          sessionId,
          history,
          sock
        );
        for (const jid of imported.chatJidsImported) {
          current.historySyncedJids.add(jid);
        }
        current.historySyncChats = current.historySyncedJids.size;
        current.historySyncMessages += imported.messagesImported;

        const completed =
          Number(history.progress) === 100 &&
          (history.syncType === proto.HistorySync.HistorySyncType.RECENT ||
            history.syncType === proto.HistorySync.HistorySyncType.FULL);
        if (completed) {
          current.historySyncStatus = 'completed';
          current.historySyncProgress = 100;
        }
        await updateSessionRow(accountId, sessionId, {
          history_sync_status: current.historySyncStatus,
          history_sync_progress: current.historySyncProgress,
          history_sync_chats: current.historySyncChats,
          history_sync_messages: current.historySyncMessages,
          history_sync_completed_at: completed
            ? new Date().toISOString()
            : null,
        });
      })
      .catch(async (err) => {
        const current = connections.get(sessionId);
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (current) {
          current.historySyncStatus = 'error';
          current.historySyncError = errorMessage;
        }
        await updateSessionRow(accountId, sessionId, {
          history_sync_status: 'error',
          history_sync_error: errorMessage,
        });
        logger.error('Failed to import personal WhatsApp history', {
          operation: 'whatsapp-personal.history-sync',
          accountId,
          sessionId,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
  });

  sock.ev.on('messaging-history.status', ({ status }) => {
    if (status !== 'paused') return;
    const current = connections.get(sessionId);
    if (!current || current.historySyncStatus === 'completed') return;
    current.historySyncStatus = 'paused';
    void updateSessionRow(accountId, sessionId, {
      history_sync_status: 'paused',
    });
  });

  // Baileys resolves sendMessage() once WhatsApp accepts the message for
  // processing. Delivery and read confirmation arrive later through these
  // socket events; without them every outbound row stays optimistically
  // "sent" forever even when the recipient never receives it.
  sock.ev.on('messages.update', (updates) => {
    void Promise.all(
      updates.map(async ({ key, update }) => {
        if (!key.id || !key.fromMe) return;
        const status = personalAckToStatus(
          update.status == null ? null : Number(update.status)
        );
        if (status)
          await applyPersonalDeliveryStatus(
            admin,
            accountId,
            sessionId,
            key.id,
            status
          );
      })
    ).catch((err) =>
      logger.error('Failed to process personal WhatsApp acknowledgements', {
        operation: 'whatsapp-personal.delivery-status',
        accountId,
        sessionId,
        error: err instanceof Error ? err : new Error(String(err)),
      })
    );
  });

  sock.ev.on('message-receipt.update', (updates) => {
    void Promise.all(
      updates.map(async ({ key, receipt }) => {
        if (!key.id || !key.fromMe) return;
        const mapped = receiptToStatus(receipt);
        if (mapped)
          await applyPersonalDeliveryStatus(
            admin,
            accountId,
            sessionId,
            key.id,
            mapped.status,
            mapped.occurredAt
          );
      })
    ).catch((err) =>
      logger.error('Failed to process personal WhatsApp receipts', {
        operation: 'whatsapp-personal.delivery-status',
        accountId,
        sessionId,
        error: err instanceof Error ? err : new Error(String(err)),
      })
    );
  });

  return toSnapshot(entry);
}

export async function disconnectConnection(
  accountId: string,
  sessionId: string
): Promise<void> {
  const entry = connections.get(sessionId);
  if (entry?.sock) {
    try {
      await entry.sock.logout();
    } catch {
      // Socket may already be closed — logout is best-effort cleanup.
    }
  }
  connections.delete(sessionId);
  await updateSessionRow(accountId, sessionId, {
    status: 'disconnected',
    auth_state_encrypted: null,
    phone_number: null,
    connected_at: null,
    last_error: null,
  });
}

/** Used by the outbound send path (src/lib/whatsapp-personal/send.ts). Null if not currently connected. */
export function getLiveSocket(sessionId: string): WASocket | null {
  const entry = connections.get(sessionId);
  return entry?.status === 'connected' ? entry.sock : null;
}

/**
 * Returns a live socket, lazily restoring the encrypted session after a
 * process restart when necessary. Sending must use this helper instead of
 * reading the in-memory Map directly: the database can truthfully say the
 * session is connected while a freshly-started Node process has not rebuilt
 * its WebSocket yet.
 */
export async function getRestoredLiveSocket(
  accountId: string,
  sessionId: string,
  timeoutMs = 12_000
): Promise<WASocket | null> {
  const current = getLiveSocket(sessionId);
  if (current) return current;

  const snapshot = await getConnectionSnapshot(accountId, sessionId);
  if (snapshot.status === 'disconnected' || snapshot.status === 'qr_pending')
    return null;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const socket = getLiveSocket(sessionId);
    if (socket) return socket;

    const entry = connections.get(sessionId);
    if (
      !entry ||
      entry.status === 'disconnected' ||
      entry.status === 'qr_pending'
    )
      return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const timedOut = connections.get(sessionId);
  if (timedOut) {
    connections.delete(sessionId);
    try {
      await timedOut.sock?.end(new Error('CRM connection timeout'));
    } catch {
      // Best-effort socket cleanup; the DB status below is authoritative.
    }
    await updateSessionRow(accountId, sessionId, {
      status: 'error',
      last_error:
        'O WhatsApp não concluiu a conexão. Tente reconectar ou gerar um novo QR Code.',
    });
  }
  return null;
}

/** Clears a stale/corrupted auth state and starts a genuinely fresh QR flow. */
export async function resetConnection(
  accountId: string,
  sessionId: string
): Promise<ConnectionSnapshot> {
  const entry = connections.get(sessionId);
  connections.delete(sessionId);

  if (entry?.sock) {
    try {
      await Promise.race([
        entry.sock.logout(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('WhatsApp logout timeout')), 5_000)
        ),
      ]);
    } catch {
      try {
        await entry.sock.end(undefined);
      } catch {
        // The stale socket may already be closed.
      }
    }
  }

  await updateSessionRow(accountId, sessionId, {
    status: 'connecting',
    auth_state_encrypted: null,
    phone_number: null,
    connected_at: null,
    last_error: null,
    history_sync_status: 'pending',
    history_sync_progress: 0,
    history_sync_chats: 0,
    history_sync_messages: 0,
    history_sync_started_at: null,
    history_sync_completed_at: null,
    history_sync_error: null,
  });
  return startConnection(accountId, sessionId);
}
