import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export interface GlobalSearchResult { id: string; type: 'contact' | 'deal' | 'task' | 'content'; title: string; subtitle?: string; href: string }

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const raw = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (raw.length < 2) return NextResponse.json({ results: [] });
    const term = raw.replace(/[%,()]/g, ' ').slice(0, 80);
    const pattern = `%${term}%`;
    const [contactNames, contactCompanies, contactPhones, deals, tasks, content] = await Promise.all([
      ctx.supabase.from('contacts').select('id,name,company,phone').eq('account_id', ctx.accountId).is('deleted_at', null).ilike('name', pattern).limit(5),
      ctx.supabase.from('contacts').select('id,name,company,phone').eq('account_id', ctx.accountId).is('deleted_at', null).ilike('company', pattern).limit(5),
      ctx.supabase.from('contacts').select('id,name,company,phone').eq('account_id', ctx.accountId).is('deleted_at', null).ilike('phone', pattern).limit(5),
      ctx.supabase.from('deals').select('id,title,status').eq('account_id', ctx.accountId).ilike('title', pattern).limit(5),
      ctx.supabase.from('sales_tasks').select('id,title,status').eq('account_id', ctx.accountId).ilike('title', pattern).limit(5),
      ctx.supabase.from('content_posts').select('id,title,status').eq('account_id', ctx.accountId).ilike('title', pattern).limit(5),
    ]);
    const contactMap = new Map<string, { id: string; name: string | null; company: string | null; phone: string | null }>();
    for (const row of [...(contactNames.data ?? []), ...(contactCompanies.data ?? []), ...(contactPhones.data ?? [])]) contactMap.set(row.id, row);
    const results: GlobalSearchResult[] = [
      ...[...contactMap.values()].slice(0, 6).map((row) => ({ id: row.id, type: 'contact' as const, title: row.name || row.phone || 'Contato', subtitle: row.company || row.phone || undefined, href: `/contacts?contact=${row.id}` })),
      ...(deals.data ?? []).map((row) => ({ id: row.id, type: 'deal' as const, title: row.title, subtitle: `Negócio · ${row.status}`, href: `/pipelines?deal=${row.id}` })),
      ...(tasks.data ?? []).map((row) => ({ id: row.id, type: 'task' as const, title: row.title, subtitle: `Tarefa · ${row.status}`, href: `/tasks?task=${row.id}` })),
      ...(content.data ?? []).map((row) => ({ id: row.id, type: 'content' as const, title: row.title || 'Conteúdo sem título', subtitle: `Conteúdo · ${row.status}`, href: `/content/${row.id}/edit` })),
    ].slice(0, 15);
    return NextResponse.json({ results });
  } catch (error) { return toErrorResponse(error); }
}
