import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * Links (or unlinks, with contactId: null) a personal WhatsApp
 * connection to the Traffic-module client it's dedicated to, so leads
 * landing there without a resolvable ad referral still get attributed
 * to the right client (see src/lib/traffic/attribution.ts). Same
 * admin tier as connect/disconnect — this table holds session
 * credentials (whatsapp_personal_sessions RLS, migration 045).
 */
export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => ({}));
  const connectionId =
    typeof body?.connectionId === 'string' ? body.connectionId : null;
  const contactId =
    typeof body?.contactId === 'string' && body.contactId.length > 0
      ? body.contactId
      : null;

  if (!connectionId) {
    return NextResponse.json(
      { error: 'connectionId é obrigatório.' },
      { status: 400 }
    );
  }

  if (contactId) {
    const { data: contact, error: contactError } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactError)
      return NextResponse.json(
        { error: contactError.message },
        { status: 500 }
      );
    if (!contact)
      return NextResponse.json(
        { error: 'Cliente não encontrado.' },
        { status: 404 }
      );
  }

  const { data, error } = await ctx.supabase
    .from('whatsapp_personal_sessions')
    .update({ client_contact_id: contactId })
    .eq('id', connectionId)
    .eq('account_id', ctx.accountId)
    .select('id, client_contact_id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json(
      { error: 'Conexão não encontrada.' },
      { status: 404 }
    );

  return NextResponse.json({
    id: data.id,
    clientContactId: data.client_contact_id,
  });
}
