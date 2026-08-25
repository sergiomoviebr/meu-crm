import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';

const columns = `pipeline_new_minutes, pipeline_attention_minutes,
  pipeline_overdue_minutes, pipeline_message_notifications`;

function responseShape(row: Record<string, unknown>) {
  return {
    newMinutes: Number(row.pipeline_new_minutes ?? 30),
    attentionMinutes: Number(row.pipeline_attention_minutes ?? 120),
    overdueMinutes: Number(row.pipeline_overdue_minutes ?? 360),
    messageNotifications: row.pipeline_message_notifications !== false,
  };
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('accounts')
      .select(columns)
      .eq('id', ctx.accountId)
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: 'Falha ao carregar configurações.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ settings: responseShape(data) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const SettingsSchema = z
  .object({
    newMinutes: z.number().int().min(5).max(1440),
    attentionMinutes: z.number().int().min(10).max(10080),
    overdueMinutes: z.number().int().min(15).max(43200),
    messageNotifications: z.boolean(),
  })
  .refine(
    (value) =>
      value.newMinutes < value.attentionMinutes &&
      value.attentionMinutes < value.overdueMinutes,
    { message: 'Os tempos devem estar em ordem crescente.' }
  );

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const parsed = SettingsSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Configuração inválida.' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('accounts')
      .update({
        pipeline_new_minutes: parsed.data.newMinutes,
        pipeline_attention_minutes: parsed.data.attentionMinutes,
        pipeline_overdue_minutes: parsed.data.overdueMinutes,
        pipeline_message_notifications: parsed.data.messageNotifications,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.accountId)
      .select(columns)
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: 'Falha ao salvar configurações.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ settings: responseShape(data) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
