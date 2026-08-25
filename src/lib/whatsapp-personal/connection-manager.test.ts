import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ------------------------------------------------------------
// Fake Baileys socket: captures event handlers registered via
// `sock.ev.on(event, handler)` so tests can fire them directly,
// mirroring how the real library drives connection.update/
// messages.upsert/creds.update.
// ------------------------------------------------------------
function makeFakeSocket() {
  const handlers: Record<string, ((payload: unknown) => void)[]> = {};
  return {
    user: { id: '5511999990000:1@s.whatsapp.net' },
    ev: {
      on: (event: string, handler: (payload: unknown) => void) => {
        (handlers[event] ??= []).push(handler);
      },
    },
    logout: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => ({ key: { id: 'wa-outbound-1' } })),
    emit: (event: string, payload: unknown) => {
      for (const h of handlers[event] ?? []) h(payload);
    },
  };
}

const { makeSocketMock } = vi.hoisted(() => ({ makeSocketMock: vi.fn() }));
const deliveryMocks = vi.hoisted(() => ({
  applyPersonalDeliveryStatus: vi.fn(async () => {}),
  personalAckToStatus: vi.fn((status: number) =>
    status === 3 ? 'delivered' : null
  ),
  receiptToStatus: vi.fn(() => ({
    status: 'read',
    occurredAt: '2026-08-18T12:00:00.000Z',
  })),
}));
const historyMocks = vi.hoisted(() => ({
  importPersonalHistorySet: vi.fn(async () => ({
    chatsImported: 1,
    chatJidsImported: ['5511999990000@s.whatsapp.net'],
    messagesImported: 2,
    messagesSeen: 2,
  })),
}));
vi.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: (...args: unknown[]) => makeSocketMock(...args),
  Browsers: { macOS: (name: string) => ['Mac OS', name, '0.1'] },
  proto: {
    HistorySync: { HistorySyncType: { RECENT: 1, FULL: 2 } },
  },
  DisconnectReason: { loggedOut: 401, restartRequired: 515 },
  fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 3000, 0] })),
  jidDecode: (jid?: string) =>
    jid
      ? {
          user: jid.split('@')[0].split(':')[0],
          server: jid.split('@')[1] ?? '',
        }
      : undefined,
  makeCacheableSignalKeyStore: (keys: unknown) => keys,
}));

vi.mock('@/lib/whatsapp-personal/auth-state', () => ({
  loadDbAuthState: vi.fn(async () => ({
    state: { creds: {}, keys: { get: vi.fn(), set: vi.fn() } },
    saveCreds: vi.fn(),
  })),
}));

vi.mock('@/lib/whatsapp-personal/ingest', () => ({
  ingestPersonalMessage: vi.fn(async () => {}),
}));

vi.mock('@/lib/whatsapp-personal/delivery-status', () => deliveryMocks);
vi.mock('@/lib/whatsapp-personal/history-sync', () => historyMocks);

// Fake admin client: `select().eq().maybeSingle()` returns a
// configurable row; `update()` records the patch for assertions.
const sessionRow: { current: Record<string, unknown> | null } = {
  current: null,
};
const updatePatches: Record<string, unknown>[] = [];

vi.mock('@/lib/whatsapp-personal/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          updatePatches.push(patch);
          return builder;
        },
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: sessionRow.current, error: null }),
        then: (resolve: (v: { data: null; error: null }) => void) =>
          resolve({ data: null, error: null }),
      };
      return builder;
    },
  }),
}));

describe('whatsapp-personal connection-manager', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionRow.current = null;
    updatePatches.length = 0;
    makeSocketMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('getConnectionSnapshot reports disconnected when no session row exists', async () => {
    const { getConnectionSnapshot } = await import('./connection-manager');
    const snapshot = await getConnectionSnapshot('acct-none', 'session-none');
    expect(snapshot.status).toBe('disconnected');
  });

  it('getConnectionSnapshot normalizes a stale qr_pending row (no live socket) to disconnected', async () => {
    sessionRow.current = {
      status: 'qr_pending',
      phone_number: null,
      last_error: null,
      auth_state_encrypted: null,
    };
    const { getConnectionSnapshot } = await import('./connection-manager');
    const snapshot = await getConnectionSnapshot('acct-stale', 'session-stale');
    expect(snapshot.status).toBe('disconnected');
  });

  it('getConnectionSnapshot silently resumes a connected session with stored credentials', async () => {
    sessionRow.current = {
      status: 'connected',
      phone_number: '+5511999990000',
      last_error: null,
      auth_state_encrypted: 'encrypted-blob',
    };
    makeSocketMock.mockReturnValue(makeFakeSocket());
    const { getConnectionSnapshot } = await import('./connection-manager');
    const snapshot = await getConnectionSnapshot(
      'acct-resume',
      'session-resume'
    );
    // The synchronous part of the snapshot call is deterministic...
    expect(snapshot.status).toBe('connecting');
    // ...the actual resume (loadDbAuthState -> fetchLatestBaileysVersion
    // -> makeWASocket) is fired-and-forgotten, so poll for it rather
    // than assuming a fixed number of microtask ticks.
    await vi.waitFor(() => expect(makeSocketMock).toHaveBeenCalled());
  });

  it('restores the persisted session when a send needs a socket after process restart', async () => {
    sessionRow.current = {
      status: 'connected',
      phone_number: '+5511999990000',
      last_error: null,
      auth_state_encrypted: 'encrypted-blob',
    };
    const fakeSocket = makeFakeSocket();
    makeSocketMock.mockReturnValue(fakeSocket);
    const { getRestoredLiveSocket } = await import('./connection-manager');

    const restoring = getRestoredLiveSocket(
      'acct-cold-send',
      'session-cold-send',
      2_000
    );
    await vi.waitFor(() => expect(makeSocketMock).toHaveBeenCalled());
    fakeSocket.emit('connection.update', { connection: 'open' });

    await expect(restoring).resolves.toBe(fakeSocket);
  });

  it('startConnection wires connection.update: qr -> qr_pending, open -> connected', async () => {
    const fakeSocket = makeFakeSocket();
    makeSocketMock.mockReturnValue(fakeSocket);
    const { startConnection, getConnectionSnapshot } =
      await import('./connection-manager');

    await startConnection('acct-1', 'session-1');
    fakeSocket.emit('connection.update', { qr: 'raw-qr-string' });

    await vi.waitFor(async () => {
      const snapshot = await getConnectionSnapshot('acct-1', 'session-1');
      expect(snapshot.status).toBe('qr_pending');
      expect(snapshot.qrDataUrl).toBeTruthy();
    });

    fakeSocket.emit('connection.update', { connection: 'open' });

    await vi.waitFor(async () => {
      const snapshot = await getConnectionSnapshot('acct-1', 'session-1');
      expect(snapshot.status).toBe('connected');
      expect(snapshot.phoneNumber).toBe('5511999990000');
    });
  });

  it('requests full linked-device history and reports imported progress', async () => {
    const fakeSocket = makeFakeSocket();
    makeSocketMock.mockReturnValue(fakeSocket);
    const { startConnection, getConnectionSnapshot } =
      await import('./connection-manager');

    await startConnection('acct-history', 'session-history');
    expect(makeSocketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        syncFullHistory: true,
        shouldSyncHistoryMessage: expect.any(Function),
      })
    );

    fakeSocket.emit('messaging-history.set', {
      chats: [],
      contacts: [],
      messages: [],
      progress: 100,
      syncType: 1,
    });

    await vi.waitFor(async () => {
      const snapshot = await getConnectionSnapshot(
        'acct-history',
        'session-history'
      );
      expect(snapshot.historySyncStatus).toBe('completed');
      expect(snapshot.historySyncProgress).toBe(100);
      expect(snapshot.historySyncChats).toBe(1);
      expect(snapshot.historySyncMessages).toBe(2);
    });
  });

  it('keeps two WhatsApp sockets in the same account isolated by session id', async () => {
    const firstSocket = makeFakeSocket();
    const secondSocket = makeFakeSocket();
    secondSocket.user.id = '5511888880000:1@s.whatsapp.net';
    makeSocketMock
      .mockReturnValueOnce(firstSocket)
      .mockReturnValueOnce(secondSocket);
    const {
      startConnection,
      getConnectionSnapshot,
      getLiveSocket,
      disconnectConnection,
    } = await import('./connection-manager');

    await startConnection('acct-multi', 'session-a');
    await startConnection('acct-multi', 'session-b');
    firstSocket.emit('connection.update', { connection: 'open' });
    secondSocket.emit('connection.update', { connection: 'open' });

    await vi.waitFor(async () => {
      expect(
        (await getConnectionSnapshot('acct-multi', 'session-a')).status
      ).toBe('connected');
      expect(
        (await getConnectionSnapshot('acct-multi', 'session-b')).status
      ).toBe('connected');
    });
    expect(getLiveSocket('session-a')).toBe(firstSocket);
    expect(getLiveSocket('session-b')).toBe(secondSocket);

    await disconnectConnection('acct-multi', 'session-a');
    expect(getLiveSocket('session-a')).toBeNull();
    expect(getLiveSocket('session-b')).toBe(secondSocket);
  });

  it('persists delivery and read acknowledgements emitted by Baileys', async () => {
    const fakeSocket = makeFakeSocket();
    makeSocketMock.mockReturnValue(fakeSocket);
    const { startConnection } = await import('./connection-manager');
    await startConnection('acct-receipts', 'session-receipts');

    fakeSocket.emit('messages.update', [
      { key: { id: 'wa-1', fromMe: true }, update: { status: 3 } },
    ]);
    fakeSocket.emit('message-receipt.update', [
      { key: { id: 'wa-1', fromMe: true }, receipt: { readTimestamp: 1 } },
    ]);

    await vi.waitFor(() => {
      expect(deliveryMocks.applyPersonalDeliveryStatus).toHaveBeenCalledWith(
        expect.anything(),
        'acct-receipts',
        'session-receipts',
        'wa-1',
        'delivered'
      );
      expect(deliveryMocks.applyPersonalDeliveryStatus).toHaveBeenCalledWith(
        expect.anything(),
        'acct-receipts',
        'session-receipts',
        'wa-1',
        'read',
        '2026-08-18T12:00:00.000Z'
      );
    });
  });

  it('close with loggedOut clears the stored session (must re-scan)', async () => {
    const fakeSocket = makeFakeSocket();
    makeSocketMock.mockReturnValue(fakeSocket);
    const { startConnection, getConnectionSnapshot } =
      await import('./connection-manager');

    await startConnection('acct-2', 'session-2');
    fakeSocket.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });

    await vi.waitFor(() => {
      expect(updatePatches).toContainEqual(
        expect.objectContaining({
          status: 'disconnected',
          auth_state_encrypted: null,
        })
      );
    });
    // No live socket left in memory, and the DB row was never
    // re-primed to 'connected' — the next snapshot must be
    // 'disconnected', not silently resumed.
    sessionRow.current = {
      status: 'disconnected',
      phone_number: null,
      last_error: null,
      auth_state_encrypted: null,
    };
    const snapshot = await getConnectionSnapshot('acct-2', 'session-2');
    expect(snapshot.status).toBe('disconnected');
  });

  it('close for any other reason marks the session as error, not disconnected', async () => {
    const fakeSocket = makeFakeSocket();
    makeSocketMock.mockReturnValue(fakeSocket);
    const { startConnection } = await import('./connection-manager');

    await startConnection('acct-3', 'session-3');
    fakeSocket.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 428 } } },
    });

    await vi.waitFor(() => {
      expect(updatePatches).toContainEqual(
        expect.objectContaining({ status: 'error' })
      );
    });
    expect(updatePatches.some((p) => 'auth_state_encrypted' in p)).toBe(false);
  });

  it('restartRequired (515) reconnects immediately without surfacing an error', async () => {
    vi.useFakeTimers();
    try {
      const fakeSocket = makeFakeSocket();
      makeSocketMock.mockReturnValue(fakeSocket);
      const { startConnection } = await import('./connection-manager');

      await startConnection('acct-5', 'session-5');
      expect(makeSocketMock).toHaveBeenCalledTimes(1);

      fakeSocket.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 515 } } },
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();

      // Benign, expected part of every fresh pairing — must not read as
      // a user-facing error on the Settings page.
      expect(updatePatches.some((p) => p.status === 'error')).toBe(false);

      await vi.advanceTimersByTimeAsync(0);
      expect(makeSocketMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a non-restart close auto-reconnects after a short delay, without needing a status poll', async () => {
    vi.useFakeTimers();
    try {
      const fakeSocket = makeFakeSocket();
      makeSocketMock.mockReturnValue(fakeSocket);
      const { startConnection } = await import('./connection-manager');

      await startConnection('acct-6', 'session-6');
      expect(makeSocketMock).toHaveBeenCalledTimes(1);

      fakeSocket.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 503 } } },
      });
      // The handler's own DB-update awaits are plain microtasks (the
      // mocked Supabase client resolves immediately), not real timers,
      // so a handful of ticks is enough to reach the setTimeout call —
      // avoids mixing vi.waitFor's polling with fake timers.
      for (let i = 0; i < 10; i++) await Promise.resolve();

      expect(updatePatches).toContainEqual(
        expect.objectContaining({ status: 'error' })
      );
      expect(makeSocketMock).toHaveBeenCalledTimes(1); // not yet — still waiting out the delay

      await vi.advanceTimersByTimeAsync(3000);
      expect(makeSocketMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disconnectConnection logs out the live socket and clears the session row', async () => {
    const fakeSocket = makeFakeSocket();
    makeSocketMock.mockReturnValue(fakeSocket);
    const { startConnection, disconnectConnection, getConnectionSnapshot } =
      await import('./connection-manager');

    await startConnection('acct-4', 'session-4');
    await disconnectConnection('acct-4', 'session-4');

    expect(fakeSocket.logout).toHaveBeenCalled();
    expect(updatePatches).toContainEqual(
      expect.objectContaining({
        status: 'disconnected',
        auth_state_encrypted: null,
      })
    );

    sessionRow.current = {
      status: 'disconnected',
      phone_number: null,
      last_error: null,
      auth_state_encrypted: null,
    };
    const snapshot = await getConnectionSnapshot('acct-4', 'session-4');
    expect(snapshot.status).toBe('disconnected');
  });

  it('resetConnection clears stale credentials and starts a fresh QR socket', async () => {
    const oldSocket = makeFakeSocket();
    const freshSocket = makeFakeSocket();
    makeSocketMock
      .mockReturnValueOnce(oldSocket)
      .mockReturnValueOnce(freshSocket);
    const { startConnection, resetConnection } =
      await import('./connection-manager');

    await startConnection('acct-reset', 'session-reset');
    await resetConnection('acct-reset', 'session-reset');

    expect(oldSocket.logout).toHaveBeenCalled();
    expect(updatePatches).toContainEqual(
      expect.objectContaining({
        auth_state_encrypted: null,
        phone_number: null,
        status: 'connecting',
      })
    );
    expect(makeSocketMock).toHaveBeenCalledTimes(2);
  });
});
