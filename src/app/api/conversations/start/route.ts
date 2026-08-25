import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  resolveConversationByPhone,
  type ResolvedConversation,
} from '@/lib/whatsapp/resolve-conversation';
import { SendMessageError } from '@/lib/whatsapp/send-message';

const StartConversationSchema = z
  .object({
    contactId: z.string().uuid().optional(),
    phone: z.string().trim().max(40).optional(),
    name: z.string().trim().max(120).optional(),
    channel: z.enum(['meta_cloud_api', 'whatsapp_personal']),
    personalSessionId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.contactId && !value.phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['contactId'],
        message: 'Selecione um contato ou informe um telefone.',
      });
    }
    if (value.channel === 'whatsapp_personal' && !value.personalSessionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['personalSessionId'],
        message: 'Selecione o número de WhatsApp que fará o atendimento.',
      });
    }
  });

/** Connected transports available to the caller's account. */
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const [metaResult, personalResult] = await Promise.all([
      ctx.supabase
        .from('whatsapp_config')
        .select('id, status')
        .eq('account_id', ctx.accountId)
        .eq('status', 'connected')
        .maybeSingle(),
      ctx.supabase
        .from('whatsapp_personal_sessions')
        .select('id, label, phone_number, is_default')
        .eq('account_id', ctx.accountId)
        .eq('status', 'connected')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true }),
    ]);

    if (metaResult.error || personalResult.error) {
      return NextResponse.json(
        { error: 'Não foi possível carregar os números conectados.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      channels: [
        ...(metaResult.data
          ? [
              {
                id: 'meta_cloud_api',
                channel: 'meta_cloud_api' as const,
                personalSessionId: null,
                label: 'WhatsApp oficial',
                phoneNumber: null,
                isDefault: true,
              },
            ]
          : []),
        ...(personalResult.data ?? []).map((session) => ({
          id: `personal:${session.id}`,
          channel: 'whatsapp_personal' as const,
          personalSessionId: session.id,
          label: session.label || 'WhatsApp pessoal',
          phoneNumber: session.phone_number,
          isDefault: session.is_default,
        })),
      ],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Find-or-create a thread and return the fully hydrated Inbox row. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const parsed = StartConversationSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ??
            'Revise os dados da nova conversa.',
        },
        { status: 400 }
      );
    }

    const input = parsed.data;
    let phone = input.phone ?? '';
    let name = input.name ?? null;

    if (input.contactId) {
      const { data: contact, error } = await ctx.supabase
        .from('contacts')
        .select('id, phone, whatsapp, name, preferred_name')
        .eq('id', input.contactId)
        .eq('account_id', ctx.accountId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error || !contact) {
        return NextResponse.json(
          { error: 'Contato não encontrado.' },
          { status: 404 }
        );
      }
      phone = contact.whatsapp || contact.phone || '';
      name = contact.preferred_name || contact.name || null;
    }

    const normalizedPhone = sanitizePhoneForMeta(phone);
    if (!isValidE164(normalizedPhone)) {
      return NextResponse.json(
        {
          error:
            'Informe o telefone com código do país e DDD, por exemplo +55 11 99999-9999.',
        },
        { status: 400 }
      );
    }

    let resolved: ResolvedConversation;
    try {
      resolved = await resolveConversationByPhone(
        ctx.supabase,
        ctx.accountId,
        normalizedPhone,
        name,
        input.channel,
        input.personalSessionId ?? null
      );
    } catch (error) {
      if (error instanceof SendMessageError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      throw error;
    }

    const { data: conversation, error: conversationError } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', resolved.conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (conversationError || !conversation) {
      return NextResponse.json(
        { error: 'A conversa foi criada, mas não pôde ser carregada.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      conversation: normalizeConversation(conversation),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
