import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

function saoPauloDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('days') ?? 30);
    const days = Number.isFinite(requested)
      ? Math.max(0, Math.min(366, requested))
      : 30;
    const { data, error } = await ctx.supabase.rpc(
      'get_upcoming_contact_birthdays',
      {
        p_account_id: ctx.accountId,
        p_days: days,
        p_from: saoPauloDate(),
      }
    );
    if (error) {
      return NextResponse.json(
        { error: 'Falha ao carregar aniversários.' },
        { status: 500 }
      );
    }
    const { data: profile } = await ctx.supabase
      .from('profiles')
      .select('birthday_notice_days')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    return NextResponse.json({
      birthdays: data ?? [],
      noticeDays: profile?.birthday_notice_days ?? [0, 1, 3, 7],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Idempotently materialize the signed-in user's configured birthday alerts. */
export async function POST() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await supabaseAdmin().rpc(
      'create_contact_birthday_notifications',
      {
        p_account_id: ctx.accountId,
        p_user_id: ctx.userId,
        p_reference_date: saoPauloDate(),
      }
    );
    if (error) {
      return NextResponse.json(
        { error: 'Falha ao atualizar alertas de aniversário.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ created: Number(data ?? 0) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => null);
    const values = Array.isArray(body?.noticeDays)
      ? [
          ...new Set(
            body.noticeDays.filter(
              (value: unknown) =>
                Number.isInteger(value) &&
                [0, 1, 3, 7].includes(value as number)
            )
          ),
        ].sort((a, b) => Number(a) - Number(b))
      : null;
    if (!values)
      return NextResponse.json(
        { error: 'Preferências inválidas.' },
        { status: 400 }
      );
    const { error } = await ctx.supabase
      .from('profiles')
      .update({ birthday_notice_days: values })
      .eq('user_id', ctx.userId)
      .eq('account_id', ctx.accountId);
    if (error)
      return NextResponse.json(
        { error: 'Falha ao salvar preferências.' },
        { status: 500 }
      );
    return NextResponse.json({ noticeDays: values });
  } catch (error) {
    return toErrorResponse(error);
  }
}
