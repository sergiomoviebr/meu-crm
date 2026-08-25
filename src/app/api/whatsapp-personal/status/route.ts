import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getConnectionSnapshot } from '@/lib/whatsapp-personal/connection-manager'

export async function GET() {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { data, error } = await ctx.supabase
    .from('whatsapp_personal_sessions')
    .select('id, label, is_default, client_contact_id, created_at')
    .eq('account_id', ctx.accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const connections = await Promise.all((data ?? []).map(async (row) => ({
    id: row.id,
    label: row.label,
    isDefault: row.is_default,
    clientContactId: row.client_contact_id,
    ...(await getConnectionSnapshot(ctx.accountId, row.id)),
  })))

  // Traffic module "clients" are just the contacts ad_accounts are
  // registered under (src/app/(dashboard)/traffic/page.tsx uses the
  // same derivation) — no separate client table exists.
  const { data: adAccountRows } = await ctx.supabase
    .from('ad_accounts')
    .select('contact:contacts(id, name, phone)')
    .eq('account_id', ctx.accountId)

  const clientsById = new Map<string, { id: string; name: string | null; phone: string | null }>()
  for (const row of (adAccountRows ?? []) as unknown as { contact: { id: string; name: string | null; phone: string | null } | null }[]) {
    if (row.contact) clientsById.set(row.contact.id, row.contact)
  }

  return NextResponse.json({ connections, clients: [...clientsById.values()] })
}
