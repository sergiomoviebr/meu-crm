import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { logger } from '@/lib/logger';
import {
  extractMetadata,
  isPrivateHostname,
  parsePublicUrl,
} from '@/lib/content/url-metadata';

const MAX_HTML_BYTES = 1_000_000;

async function assertPublicDestination(url: URL) {
  if (isPrivateHostname(url.hostname)) throw new Error('private_destination');
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => isIP(address) && isPrivateHostname(address))
  ) {
    throw new Error('private_destination');
  }
}

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole('agent');
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request.json().catch(() => null);
  const url = parsePublicUrl(body?.url);
  if (!url)
    return NextResponse.json(
      { error: 'Informe uma URL HTTP ou HTTPS válida.' },
      { status: 400 }
    );

  try {
    await assertPublicDestination(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: 'error',
        headers: {
          'user-agent': 'ContentIntelligenceBot/1.0',
          accept: 'text/html,application/xhtml+xml',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html'))
      throw new Error('unsupported_content');
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_HTML_BYTES) throw new Error('content_too_large');
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const metadata = extractMetadata(html, url);

    const { data, error } = await ctx.supabase
      .from('content_references')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        contact_id:
          typeof body.contact_id === 'string' && body.contact_id
            ? body.contact_id
            : null,
        source_url: metadata.url,
        platform: metadata.platform,
        title:
          typeof body.title === 'string' && body.title.trim()
            ? body.title.trim()
            : metadata.title,
        description: metadata.description,
        thumbnail_url: metadata.thumbnailUrl,
        author: metadata.author,
        published_at: metadata.publishedAt,
        notes:
          typeof body.notes === 'string' ? body.notes.trim() || null : null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505')
        return NextResponse.json(
          { error: 'Essa referência já está no Swipe File.' },
          { status: 409 }
        );
      throw error;
    }
    return NextResponse.json({ reference: data }, { status: 201 });
  } catch (error) {
    logger.warn('Content URL capture failed', {
      operation: 'content/references/capture',
      url: url.origin,
      error,
    });
    if (error instanceof Error && error.message === 'private_destination') {
      return NextResponse.json(
        { error: 'Endereços locais ou privados não podem ser importados.' },
        { status: 400 }
      );
    }
    if (typeof body?.title === 'string' && body.title.trim()) {
      const { data, error: insertError } = await ctx.supabase
        .from('content_references')
        .insert({
          account_id: ctx.accountId,
          created_by: ctx.userId,
          contact_id:
            typeof body.contact_id === 'string' && body.contact_id
              ? body.contact_id
              : null,
          source_url: url.toString(),
          platform:
            url.hostname.replace(/^www\./, '').split('.')[0] || 'website',
          title: body.title.trim().slice(0, 300),
          notes:
            typeof body.notes === 'string' ? body.notes.trim() || null : null,
          metadata: { capture: 'manual_fallback' },
        })
        .select()
        .single();
      if (!insertError)
        return NextResponse.json(
          { reference: data, fallback: true },
          { status: 201 }
        );
      if (insertError.code === '23505')
        return NextResponse.json(
          { error: 'Essa referência já está no Swipe File.' },
          { status: 409 }
        );
    }
    return NextResponse.json(
      {
        error:
          'Não foi possível ler os dados públicos dessa página. Você ainda pode salvá-la preenchendo um título.',
      },
      { status: 422 }
    );
  }
}
