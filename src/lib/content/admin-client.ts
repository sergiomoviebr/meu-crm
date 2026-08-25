import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the content publish engine.
// Mirrors src/lib/automations/admin-client.ts — the cron route that
// drains due posts has no user session for RLS to key off.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
