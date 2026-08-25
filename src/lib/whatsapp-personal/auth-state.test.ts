import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadDbAuthState } from './auth-state';

function makeAdmin(initialEncrypted: string | null): {
  admin: SupabaseClient;
  getStored: () => string | null;
} {
  let stored = initialEncrypted;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () =>
      Promise.resolve({
        data: stored ? { auth_state_encrypted: stored } : null,
        error: null,
      }),
    update: (patch: { auth_state_encrypted: string }) => {
      stored = patch.auth_state_encrypted;
      return builder;
    },
    then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
  };
  return {
    admin: { from: () => builder } as unknown as SupabaseClient,
    getStored: () => stored,
  };
}

describe('loadDbAuthState', () => {
  it('starts a fresh session when no row exists', async () => {
    const { admin } = makeAdmin(null);
    const { state } = await loadDbAuthState(admin, 'acct-1', 'session-1');
    expect(state.creds.registered).toBe(false);
    expect(state.creds.nextPreKeyId).toBe(1);
  });

  it('saveCreds persists an encrypted blob that round-trips the creds', async () => {
    const { admin, getStored } = makeAdmin(null);
    const { saveCreds } = await loadDbAuthState(admin, 'acct-1', 'session-1');

    await saveCreds();

    const stored = getStored();
    expect(stored).toBeTruthy();
    // AES-256-GCM format from encryption.ts: iv:ciphertext:authTag.
    expect(stored?.split(':').length).toBe(3);
  });

  it('keys.set then keys.get round-trips a value within the same session', async () => {
    const { admin } = makeAdmin(null);
    const { state } = await loadDbAuthState(admin, 'acct-1', 'session-1');

    await state.keys.set({ 'pre-key': { '1': { some: 'value' } } as never });
    const result = await state.keys.get('pre-key', ['1']);

    expect(result['1']).toEqual({ some: 'value' });
  });

  it('a second loadDbAuthState call loads the previously persisted creds + keys', async () => {
    const { admin } = makeAdmin(null);
    const first = await loadDbAuthState(admin, 'acct-1', 'session-1');
    await first.state.keys.set({ session: { 'device-1': 'session-bytes' } as never });
    await first.saveCreds();

    const second = await loadDbAuthState(admin, 'acct-1', 'session-1');
    expect(second.state.creds.registered).toBe(first.state.creds.registered);
    const loadedKey = await second.state.keys.get('session', ['device-1']);
    expect(loadedKey['device-1']).toBe('session-bytes');
  });

  it('falls back to a fresh session instead of throwing on a corrupted stored blob', async () => {
    const { admin } = makeAdmin('not-a-valid-encrypted-blob');
    const { state } = await loadDbAuthState(admin, 'acct-1', 'session-1');
    expect(state.creds.registered).toBe(false);
  });
});
