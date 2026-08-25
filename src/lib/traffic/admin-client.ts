import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the Traffic & Performance
// module. Mirrors src/lib/content/admin-client.ts — routes that write
// across the ad_accounts/campaigns/ad_sets/ads hierarchy re-check
// ownership manually since this client bypasses RLS.
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
