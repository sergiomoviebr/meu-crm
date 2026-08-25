// ============================================================
// DB-backed replacement for Baileys' `useMultiFileAuthState`.
//
// Baileys' built-in helper persists credentials + Signal keys as one
// file per key on local disk — wrong here because (a) the container
// filesystem doesn't survive a redeploy and (b) each connected number
// needs its own isolated session. This stores the exact same
// `{ creds, keys }` shape as a single JSON blob, AES-256-GCM
// encrypted via the project's existing `encrypt`/`decrypt`
// (src/lib/whatsapp/encryption.ts — the same helper used for Meta
// access tokens; no new crypto), in
// `whatsapp_personal_sessions.auth_state_encrypted`.
//
// The row itself is created by the /connect route before this is
// called, so persistence here is always an UPDATE keyed by
// session id, never an insert.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys'

import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { logger } from '@/lib/logger'

type KeysBlob = Record<string, Record<string, unknown>>

export interface DbAuthState {
  state: AuthenticationState
  saveCreds: () => Promise<void>
}

export async function loadDbAuthState(
  admin: SupabaseClient,
  accountId: string,
  sessionId: string,
): Promise<DbAuthState> {
  const { data: row } = await admin
    .from('whatsapp_personal_sessions')
    .select('auth_state_encrypted')
    .eq('id', sessionId)
    .eq('account_id', accountId)
    .maybeSingle()

  let creds = initAuthCreds()
  let keysBlob: KeysBlob = {}

  if (row?.auth_state_encrypted) {
    try {
      const parsed = JSON.parse(decrypt(row.auth_state_encrypted), BufferJSON.reviver) as {
        creds: typeof creds
        keys: KeysBlob
      }
      creds = parsed.creds
      keysBlob = parsed.keys ?? {}
    } catch (err) {
      logger.error('Failed to decrypt/parse stored WhatsApp personal auth state — starting a fresh session', {
        operation: 'whatsapp-personal.auth-state',
        accountId,
        error: err instanceof Error ? err : new Error(String(err)),
      })
    }
  }

  // Serializes writes so a `creds.update` firing back-to-back with a
  // `keys.set` (both trigger a persist) can't interleave into a torn
  // blob — a plain promise chain is enough for one account's session,
  // no need for a general-purpose mutex dependency.
  let writeChain: Promise<void> = Promise.resolve()
  const persist = () => {
    writeChain = writeChain
      .then(async () => {
        const serialized = JSON.stringify({ creds, keys: keysBlob }, BufferJSON.replacer)
        const { error } = await admin
          .from('whatsapp_personal_sessions')
          .update({ auth_state_encrypted: encrypt(serialized) })
          .eq('id', sessionId)
          .eq('account_id', accountId)
        if (error) {
          logger.error('Failed to persist WhatsApp personal auth state', {
            operation: 'whatsapp-personal.auth-state',
            accountId,
            sessionId,
            error: new Error(error.message),
          })
        }
      })
      .catch((err) => {
        logger.error('WhatsApp personal auth state persist threw', {
          operation: 'whatsapp-personal.auth-state',
          accountId,
          sessionId,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      })
    return writeChain
  }

  return {
    state: {
      creds,
      keys: {
        // Explicit generic method (not an arrow function) so the return
        // type lines up with Baileys' `SignalKeyStore.get`'s per-call
        // `SignalDataTypeMap[T]` — the stored shape is genuinely dynamic
        // (loaded from JSON), so the cast at the end is unavoidable.
        async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
          const data: Record<string, SignalDataTypeMap[T]> = {}
          for (const id of ids) {
            let value = keysBlob[type]?.[id]
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object)
            }
            if (value !== undefined) {
              data[id] = value as SignalDataTypeMap[T]
            }
          }
          return data
        },
        set: async (data) => {
          for (const category of Object.keys(data)) {
            const forCategory = keysBlob[category] ?? {}
            const updates = data[category as keyof typeof data] as Record<string, unknown> | undefined
            for (const id of Object.keys(updates ?? {})) {
              const value = updates?.[id]
              if (value) forCategory[id] = value
              else delete forCategory[id]
            }
            keysBlob[category] = forCategory
          }
          await persist()
        },
      },
    },
    saveCreds: async () => {
      await persist()
    },
  }
}
