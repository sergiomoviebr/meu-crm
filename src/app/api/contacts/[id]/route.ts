import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  cleanContactProfile,
  ContactProfileSchema,
} from '@/lib/contacts/profile';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Falha ao carregar contato.' },
        { status: 500 }
      );
    if (!data)
      return NextResponse.json(
        { error: 'Contato não encontrado.' },
        { status: 404 }
      );
    const contact =
      ctx.role === 'viewer' ? { ...data, cpf: null, cnpj: null } : data;
    return NextResponse.json({ contact });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const raw = await request.json().catch(() => null);

    if (raw?.restore === true) {
      const { data, error } = await ctx.supabase
        .from('contacts')
        .update({ deleted_at: null })
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .select('*')
        .maybeSingle();
      if (error?.code === '23505') {
        return NextResponse.json(
          {
            error:
              'Outro contato ativo já utiliza um dos identificadores deste contato.',
          },
          { status: 409 }
        );
      }
      if (error)
        return NextResponse.json(
          { error: 'Falha ao restaurar contato.' },
          { status: 500 }
        );
      if (!data)
        return NextResponse.json(
          { error: 'Contato não encontrado.' },
          { status: 404 }
        );
      return NextResponse.json({ contact: data });
    }

    const parsed = ContactProfileSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Revise os campos informados.',
          fields: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }
    const input = cleanContactProfile(parsed.data);
    if (input.owner_user_id) {
      const { data: owner } = await ctx.supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', ctx.accountId)
        .eq('user_id', input.owner_user_id)
        .maybeSingle();
      if (!owner) {
        return NextResponse.json(
          { error: 'Responsável inválido.' },
          { status: 400 }
        );
      }
    }

    const { data, error } = await ctx.supabase
      .from('contacts')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle();
    if (error?.code === '23505') {
      return NextResponse.json(
        {
          error:
            'Já existe um contato ativo com o mesmo telefone, WhatsApp, CPF ou CNPJ.',
        },
        { status: 409 }
      );
    }
    if (error)
      return NextResponse.json(
        { error: 'Falha ao atualizar contato.' },
        { status: 500 }
      );
    if (!data)
      return NextResponse.json(
        { error: 'Contato não encontrado.' },
        { status: 404 }
      );
    return NextResponse.json({ contact: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const now = new Date().toISOString();
    const { data, error } = await ctx.supabase
      .from('contacts')
      .update({ deleted_at: now, archived_at: null, updated_at: now })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Falha ao excluir contato.' },
        { status: 500 }
      );
    if (!data)
      return NextResponse.json(
        { error: 'Contato não encontrado.' },
        { status: 404 }
      );
    return NextResponse.json({ ok: true, recoverable: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
