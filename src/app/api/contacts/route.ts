import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  cleanContactProfile,
  ContactProfileSchema,
  onlyDigits,
} from '@/lib/contacts/profile';

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const SAFE_LIST_COLUMNS = `
  id, user_id, account_id, phone, phone_normalized, name, preferred_name,
  email, company, job_title, whatsapp, secondary_phone, avatar_url,
  birth_day, birth_month, birth_year, relationship_type, source,
  owner_user_id, relationship_status, address_city, address_state,
  first_contact_at, last_contact_at, next_follow_up_at, archived_at,
  created_at, updated_at,
  contact_tags(tag_id, tags(id, user_id, name, color, created_at))
`;

function numberParam(
  value: string | null,
  fallback: number,
  max: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

function safeSearch(value: string): string {
  return value
    .replace(/[^\p{L}\p{N} @.+_\-]/gu, '')
    .trim()
    .slice(0, 100);
}

function listItem(row: Record<string, unknown>) {
  const joins = (row.contact_tags ?? []) as Array<{
    tags?: Record<string, unknown> | null;
  }>;
  const contact = { ...row };
  delete contact.contact_tags;
  return {
    ...contact,
    tags: joins.map((join) => join.tags).filter(Boolean),
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);
    const page = numberParam(url.searchParams.get('page'), 1, 100_000);
    const pageSize = numberParam(
      url.searchParams.get('page_size'),
      PAGE_SIZE,
      MAX_PAGE_SIZE
    );
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const search = safeSearch(url.searchParams.get('search') ?? '');
    const tagIds = url.searchParams.getAll('tag').filter(Boolean).slice(0, 20);
    const relationshipType = url.searchParams.get('relationship_type');
    const relationshipStatus = url.searchParams.get('status');
    const ownerId = url.searchParams.get('owner');
    const city = safeSearch(url.searchParams.get('city') ?? '');
    const state = safeSearch(url.searchParams.get('state') ?? '');
    const birthday = url.searchParams.get('birthday');
    const includeArchived = url.searchParams.get('archived') === 'true';
    const trash = url.searchParams.get('trash') === 'true';

    const select = tagIds.length
      ? `${SAFE_LIST_COLUMNS}, tag_filter:contact_tags!inner(tag_id)`
      : SAFE_LIST_COLUMNS;
    let query = ctx.supabase
      .from('contacts')
      .select(select, { count: 'exact' })
      .eq('account_id', ctx.accountId);

    query = trash
      ? query.not('deleted_at', 'is', null)
      : query.is('deleted_at', null);

    if (!includeArchived && !trash) query = query.is('archived_at', null);
    if (relationshipType)
      query = query.eq('relationship_type', relationshipType);
    if (relationshipStatus)
      query = query.eq('relationship_status', relationshipStatus);
    if (ownerId) query = query.eq('owner_user_id', ownerId);
    if (city) query = query.ilike('address_city', `%${city}%`);
    if (state) query = query.ilike('address_state', `%${state}%`);
    if (tagIds.length) query = query.in('tag_filter.tag_id', tagIds);

    if (birthday && ['today', '7', '30'].includes(birthday)) {
      const days = birthday === 'today' ? 0 : Number(birthday);
      const { data: birthdays, error: birthdayError } = await ctx.supabase.rpc(
        'get_upcoming_contact_birthdays',
        { p_account_id: ctx.accountId, p_days: days }
      );
      if (birthdayError) {
        return NextResponse.json(
          { error: 'Falha ao filtrar aniversários.' },
          { status: 500 }
        );
      }
      const ids = (birthdays ?? []).map((item: { id: string }) => item.id);
      if (ids.length === 0) {
        return NextResponse.json({ contacts: [], total: 0, page, pageSize });
      }
      query = query.in('id', ids);
    }

    if (search) {
      const digits = onlyDigits(search);
      const parts = [
        `name.ilike.%${search}%`,
        `preferred_name.ilike.%${search}%`,
        `company.ilike.%${search}%`,
        `email.ilike.%${search}%`,
        `phone.ilike.%${search}%`,
        `whatsapp.ilike.%${search}%`,
      ];
      if (digits) {
        parts.push(
          `phone_normalized.ilike.%${digits}%`,
          `whatsapp_normalized.ilike.%${digits}%`,
          `cpf_normalized.ilike.%${digits}%`,
          `cnpj_normalized.ilike.%${digits}%`
        );
      }
      query = query.or(parts.join(','));
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) {
      return NextResponse.json(
        { error: 'Falha ao carregar contatos.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      contacts: ((data ?? []) as unknown as Record<string, unknown>[]).map(
        listItem
      ),
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const raw = await request.json().catch(() => null);
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
    const { data, error } = await ctx.supabase
      .from('contacts')
      .insert({
        ...input,
        account_id: ctx.accountId,
        user_id: ctx.userId,
      })
      .select('*')
      .single();

    if (error?.code === '23505') {
      return NextResponse.json(
        {
          error:
            'Já existe um contato ativo com o mesmo telefone, WhatsApp, CPF ou CNPJ.',
        },
        { status: 409 }
      );
    }
    if (error || !data) {
      return NextResponse.json(
        { error: 'Não foi possível criar o contato.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ contact: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
