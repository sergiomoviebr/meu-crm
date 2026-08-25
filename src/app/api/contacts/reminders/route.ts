import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';

const ReminderSchema = z.object({
  contact_id: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  remind_at: z.string().datetime({ offset: true }),
});

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const contactId = new URL(request.url).searchParams.get('contact_id');
    if (!contactId)
      return NextResponse.json(
        { error: 'contact_id obrigatório.' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase
      .from('contact_reminders')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .order('remind_at', { ascending: true });
    if (error)
      return NextResponse.json(
        { error: 'Falha ao carregar lembretes.' },
        { status: 500 }
      );
    return NextResponse.json({ reminders: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const parsed = ReminderSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Revise o lembrete.' },
        { status: 400 }
      );
    }
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', parsed.data.contact_id)
      .eq('account_id', ctx.accountId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!contact)
      return NextResponse.json(
        { error: 'Contato não encontrado.' },
        { status: 404 }
      );

    const { data, error } = await ctx.supabase
      .from('contact_reminders')
      .insert({
        ...parsed.data,
        account_id: ctx.accountId,
        user_id: ctx.userId,
      })
      .select('*')
      .single();
    if (error || !data)
      return NextResponse.json(
        { error: 'Falha ao criar lembrete.' },
        { status: 500 }
      );
    await ctx.supabase.from('contact_events').insert({
      account_id: ctx.accountId,
      contact_id: parsed.data.contact_id,
      actor_user_id: ctx.userId,
      event_type: 'FOLLOWUP_CREATED',
      metadata: { reminder_id: data.id, remind_at: data.remind_at },
    });
    return NextResponse.json({ reminder: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
