import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { classifySalesIntent } from '@/lib/sales/intent-classifier';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`qualification-sim:${ctx.userId}`, RATE_LIMITS.aiDraft);
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const currentScore = Number.isFinite(body?.current_score) ? Number(body.current_score) : 0;
    if (!message || message.length > 2000) return NextResponse.json({ error: 'Informe uma mensagem de até 2.000 caracteres.' }, { status: 400 });
    return NextResponse.json({ result: classifySalesIntent(message, currentScore) });
  } catch (error) { return toErrorResponse(error); }
}
