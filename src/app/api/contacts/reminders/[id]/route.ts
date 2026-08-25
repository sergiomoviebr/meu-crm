import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

const UpdateSchema = z.object({
  completed: z.boolean().optional(),
  snooze_until: z.string().datetime({ offset: true }).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const parsed = UpdateSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (
      !parsed.success ||
      (parsed.data.completed == null && !parsed.data.snooze_until)
    ) {
      return NextResponse.json(
        { error: 'Atualização inválida.' },
        { status: 400 }
      );
    }
    const patch = parsed.data.snooze_until
      ? {
          remind_at: parsed.data.snooze_until,
          notified_at: null,
          completed_at: null,
        }
      : {
          completed_at: parsed.data.completed ? new Date().toISOString() : null,
        };
    const { data, error } = await ctx.supabase
      .from('contact_reminders')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Falha ao atualizar lembrete.' },
        { status: 500 }
      );
    if (!data)
      return NextResponse.json(
        { error: 'Lembrete não encontrado.' },
        { status: 404 }
      );
    return NextResponse.json({ reminder: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
