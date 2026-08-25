import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/whatsapp-personal/admin-client';
import {
  resetConnection,
  startConnection,
} from '@/lib/whatsapp-personal/connection-manager';

const MAX_CONNECTIONS = 10;

export async function POST(request?: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = request ? await request.json().catch(() => ({})) : {};
  const requestedId =
    typeof body?.connectionId === 'string' ? body.connectionId : null;
  const forceNewQr = body?.forceNewQr === true;
  const requestedLabel =
    typeof body?.label === 'string' ? body.label.trim().slice(0, 60) : '';
  const admin = supabaseAdmin();

  let connection: {
    id: string;
    label: string | null;
    is_default: boolean;
  } | null = null;

  if (requestedId) {
    const { data, error } = await admin
      .from('whatsapp_personal_sessions')
      .update({ status: 'connecting', last_error: null })
      .eq('id', requestedId)
      .eq('account_id', ctx.accountId)
      .select('id, label, is_default')
      .maybeSingle();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json(
        { error: 'Conexão não encontrada.' },
        { status: 404 }
      );
    connection = data;
  } else {
    const { count, error: countError } = await admin
      .from('whatsapp_personal_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId);
    if (countError)
      return NextResponse.json({ error: countError.message }, { status: 500 });
    if ((count ?? 0) >= MAX_CONNECTIONS) {
      return NextResponse.json(
        { error: `Limite de ${MAX_CONNECTIONS} conexões atingido.` },
        { status: 409 }
      );
    }

    const position = (count ?? 0) + 1;
    const { data, error } = await admin
      .from('whatsapp_personal_sessions')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        status: 'connecting',
        label:
          requestedLabel ||
          (position === 1 ? 'WhatsApp principal' : `WhatsApp ${position}`),
        is_default: position === 1,
      })
      .select('id, label, is_default')
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Não foi possível criar a conexão.' },
        { status: 500 }
      );
    }
    connection = data;
  }

  const snapshot = forceNewQr
    ? await resetConnection(ctx.accountId, connection.id)
    : await startConnection(ctx.accountId, connection.id);
  return NextResponse.json({
    id: connection.id,
    label: connection.label,
    isDefault: connection.is_default,
    ...snapshot,
  });
}
