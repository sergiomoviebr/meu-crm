import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!contact)
      return NextResponse.json(
        { error: 'Contato não encontrado.' },
        { status: 404 }
      );

    const tables = [
      ['conversations', 'conversations'],
      ['deals', 'deals'],
      ['contact_notes', 'notes'],
      ['contact_reminders', 'reminders'],
      ['social_profiles', 'filesAndProfiles'],
      ['content_posts', 'content'],
    ] as const;
    const counts = await Promise.all(
      tables.map(async ([table, key]) => {
        const { count } = await ctx.supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('contact_id', id);
        return [key, count ?? 0] as const;
      })
    );
    return NextResponse.json({
      impact: Object.fromEntries(counts),
      softDelete: true,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
