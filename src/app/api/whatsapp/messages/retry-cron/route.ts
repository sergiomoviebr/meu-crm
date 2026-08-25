import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/whatsapp-personal/admin-client';
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import { logger } from '@/lib/logger';

function authorized(request: Request): boolean {
  const expected = process.env.MESSAGE_CRON_SECRET;
  const supplied = request.headers.get('x-cron-secret') ?? '';
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.MESSAGE_CRON_SECRET)
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  if (!authorized(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: due, error } = await admin
    .from('message_retry_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at')
    .limit(25);
  if (error) {
    logger.error('Message retry scan failed', {
      operation: 'whatsapp/messages/retry-cron',
      error,
    });
    return NextResponse.json(
      { error: 'Não foi possível verificar a fila.' },
      { status: 500 }
    );
  }

  let processed = 0;
  let completed = 0;
  for (const job of due ?? []) {
    const { data: claim } = await admin
      .from('message_retry_jobs')
      .update({ status: 'processing' })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claim) continue;
    processed++;

    const { data: source } = await admin
      .from('messages')
      .select('id, conversation_id, content_type, content_text')
      .eq('id', job.source_message_id)
      .maybeSingle();
    if (!source || source.content_type !== 'text' || !source.content_text) {
      await admin
        .from('message_retry_jobs')
        .update({
          status: 'dead',
          last_error: 'Mensagem original indisponível para retentativa.',
        })
        .eq('id', job.id);
      continue;
    }

    try {
      const result = await sendMessageToConversation(admin, job.account_id, {
        conversationId: source.conversation_id,
        messageType: 'text',
        contentText: source.content_text,
        scheduleRetry: false,
      });
      await admin
        .from('message_retry_jobs')
        .update({
          status: 'completed',
          result_message_id: result.messageId,
          attempt_count: Number(job.attempt_count) + 1,
          last_error: null,
        })
        .eq('id', job.id);
      completed++;
    } catch (err) {
      const attempts = Number(job.attempt_count) + 1;
      const message =
        err instanceof Error ? err.message : 'Falha temporária no provedor.';
      const retryable =
        err instanceof SendMessageError &&
        [
          'whatsapp_personal_disconnected',
          'whatsapp_personal_lookup_failed',
          'meta_temporary_error',
        ].includes(err.code);
      const dead = !retryable || attempts >= Number(job.max_attempts);
      const delayMinutes = attempts === 2 ? 15 : 60;
      await admin
        .from('message_retry_jobs')
        .update({
          status: dead ? 'dead' : 'pending',
          attempt_count: attempts,
          next_attempt_at: new Date(
            Date.now() + delayMinutes * 60_000
          ).toISOString(),
          last_error: message,
        })
        .eq('id', job.id);
      logger.warn('Message retry failed', {
        operation: 'whatsapp/messages/retry-cron',
        accountId: job.account_id,
        jobId: job.id,
        attempts,
        retryable,
      });
    }
  }

  return NextResponse.json({
    processed,
    completed,
    failed: processed - completed,
  });
}
