import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { salesTaskInputSchema } from '@/lib/tasks/validate';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);
    let query = ctx.supabase.from('sales_tasks').select('*')
      .eq('account_id', ctx.accountId).order('due_at', { ascending: true, nullsFirst: false });
    const scope = url.searchParams.get('scope');
    if (scope === 'mine') query = query.eq('assigned_to', ctx.userId);
    if (scope === 'open') query = query.in('status', ['todo', 'in_progress']);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: 'Falha ao carregar tarefas.' }, { status: 500 });
    return NextResponse.json({ tasks: data ?? [] });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const parsed = salesTaskInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Revise os dados da tarefa.' }, { status: 400 });
    const payload = { ...parsed.data, account_id: ctx.accountId, created_by: ctx.userId,
      completed_at: parsed.data.status === 'done' ? new Date().toISOString() : null };
    const { data, error } = await ctx.supabase.from('sales_tasks').insert(payload).select('*').single();
    if (error || !data) return NextResponse.json({ error: 'Falha ao criar tarefa.' }, { status: 500 });
    return NextResponse.json({ task: data }, { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
