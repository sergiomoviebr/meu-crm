import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { CONTACT_RELATIONSHIP_STATUSES } from '@/lib/contacts/profile';

const BulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum([
    'delete',
    'archive',
    'unarchive',
    'status',
    'owner',
    'add_tag',
    'remove_tag',
    'export',
  ]),
  value: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const parsed = BulkSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Operação em massa inválida.' },
        { status: 400 }
      );
    }
    const { ids, action, value } = parsed.data;

    const { data: scopedContacts, error: scopeError } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('account_id', ctx.accountId)
      .is('deleted_at', null)
      .in('id', ids);
    if (scopeError)
      return NextResponse.json(
        { error: 'Falha ao validar contatos.' },
        { status: 500 }
      );
    const scopedIds = (scopedContacts ?? []).map((row) => row.id);
    if (scopedIds.length !== ids.length) {
      return NextResponse.json(
        { error: 'Um ou mais contatos são inválidos.' },
        { status: 409 }
      );
    }

    if (action === 'export') {
      const { data, error } = await ctx.supabase
        .from('contacts')
        .select(
          `name, preferred_name, company, job_title, cpf, cnpj, email, phone,
          whatsapp, secondary_phone, birth_day, birth_month, birth_year,
          relationship_type, relationship_status, source, address_zip,
          address_street, address_number, address_complement,
          address_neighborhood, address_city, address_state, address_country,
          first_contact_at, last_contact_at, next_follow_up_at, created_at`
        )
        .eq('account_id', ctx.accountId)
        .in('id', scopedIds)
        .order('name');
      if (error)
        return NextResponse.json(
          { error: 'Falha ao exportar contatos.' },
          { status: 500 }
        );
      return NextResponse.json({ rows: data ?? [] });
    }

    if (action === 'delete' || action === 'archive' || action === 'unarchive') {
      const now = new Date().toISOString();
      const patch =
        action === 'delete'
          ? { deleted_at: now, archived_at: null, updated_at: now }
          : { archived_at: action === 'archive' ? now : null, updated_at: now };
      const { data, error } = await ctx.supabase
        .from('contacts')
        .update(patch)
        .eq('account_id', ctx.accountId)
        .in('id', scopedIds)
        .select('id');
      if (error || (data?.length ?? 0) !== scopedIds.length) {
        return NextResponse.json(
          { error: 'A operação não foi concluída.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
    }

    if (action === 'status') {
      if (!CONTACT_RELATIONSHIP_STATUSES.includes(value as never)) {
        return NextResponse.json(
          { error: 'Status inválido.' },
          { status: 400 }
        );
      }
      const { data, error } = await ctx.supabase
        .from('contacts')
        .update({
          relationship_status: value,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId)
        .in('id', scopedIds)
        .select('id');
      if (error || (data?.length ?? 0) !== scopedIds.length) {
        return NextResponse.json(
          { error: 'A alteração de status não foi concluída.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
    }

    if (action === 'owner') {
      if (value) {
        const { data: owner } = await ctx.supabase
          .from('profiles')
          .select('user_id')
          .eq('account_id', ctx.accountId)
          .eq('user_id', value)
          .maybeSingle();
        if (!owner)
          return NextResponse.json(
            { error: 'Responsável inválido.' },
            { status: 400 }
          );
      }
      const { data, error } = await ctx.supabase
        .from('contacts')
        .update({
          owner_user_id: value || null,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId)
        .in('id', scopedIds)
        .select('id');
      if (error || (data?.length ?? 0) !== scopedIds.length) {
        return NextResponse.json(
          { error: 'A alteração de responsável não foi concluída.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
    }

    if (!value)
      return NextResponse.json(
        { error: 'Selecione uma tag.' },
        { status: 400 }
      );
    const { data: tag } = await ctx.supabase
      .from('tags')
      .select('id')
      .eq('id', value)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!tag)
      return NextResponse.json({ error: 'Tag inválida.' }, { status: 400 });

    if (action === 'add_tag') {
      const rows = scopedIds.map((contactId) => ({
        contact_id: contactId,
        tag_id: value,
      }));
      const { error } = await ctx.supabase
        .from('contact_tags')
        .upsert(rows, {
          onConflict: 'contact_id,tag_id',
          ignoreDuplicates: true,
        });
      if (error)
        return NextResponse.json(
          { error: 'Falha ao adicionar tag.' },
          { status: 500 }
        );
    } else {
      const { error } = await ctx.supabase
        .from('contact_tags')
        .delete()
        .eq('tag_id', value)
        .in('contact_id', scopedIds);
      if (error)
        return NextResponse.json(
          { error: 'Falha ao remover tag.' },
          { status: 500 }
        );
    }
    return NextResponse.json({ ok: true, updated: scopedIds.length });
  } catch (error) {
    return toErrorResponse(error);
  }
}
