import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { salesTaskPatchSchema } from '@/lib/tasks/validate';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const parsed = salesTaskPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Atualização inválida.' }, { status: 400 });
    const patch = { ...parsed.data } as Record<string, unknown>;
    if (parsed.data.status === 'done') patch.completed_at = new Date().toISOString();
    else if (parsed.data.status) patch.completed_at = null;
    const { data, error } = await ctx.supabase.from('sales_tasks').update(patch)
      .eq('id', id).eq('account_id', ctx.accountId).select('*').maybeSingle();
    if (error) return NextResponse.json({ error: 'Falha ao atualizar tarefa.' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 });
    return NextResponse.json({ task: data });
  } catch (error) { return toErrorResponse(error); }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { data, error } = await ctx.supabase.from('sales_tasks').delete()
      .eq('id', id).eq('account_id', ctx.accountId).select('id').maybeSingle();
    if (error) return NextResponse.json({ error: 'Falha ao excluir tarefa.' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) { return toErrorResponse(error); }
}
