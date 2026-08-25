export interface UrlMetadata {
  url: string;
  platform: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  author: string | null;
  publishedAt: string | null;
}

const PLATFORM_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/i, 'instagram'],
  [/(^|\.)pinterest\./i, 'pinterest'],
  [/(^|\.)linkedin\.com$/i, 'linkedin'],
  [/(^|\.)tiktok\.com$/i, 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, 'youtube'],
  [/(^|\.)(twitter\.com|x\.com)$/i, 'x'],
  [/(^|\.)reddit\.com$/i, 'reddit'],
];

export function detectPlatform(hostname: string): string {
  return (
    PLATFORM_HOSTS.find(([pattern]) => pattern.test(hostname))?.[1] ?? 'website'
  );
}

export function parsePublicUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  )
    return true;
  if (/^(127|10)\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^(0\.0\.0\.0|169\.254\.|::1$|fc|fd|fe80:)/i.test(host)) return true;
  return false;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code))
    )
    .trim();
}

function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      'i'
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return null;
}

export function extractMetadata(html: string, url: URL): UrlMetadata {
  const titleTag = html
    .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, '');
  const title =
    meta(html, 'og:title') ??
    meta(html, 'twitter:title') ??
    (titleTag ? decodeEntities(titleTag) : null);
  const rawImage = meta(html, 'og:image') ?? meta(html, 'twitter:image');
  let thumbnailUrl: string | null = null;
  if (rawImage) {
    try {
      thumbnailUrl = new URL(rawImage, url).toString();
    } catch {
      /* ignore invalid metadata */
    }
  }
  return {
    url: url.toString(),
    platform: detectPlatform(url.hostname),
    title: (title ?? url.hostname).slice(0, 300),
    description:
      (meta(html, 'og:description') ?? meta(html, 'description'))?.slice(
        0,
        2000
      ) ?? null,
    thumbnailUrl,
    author:
      (meta(html, 'author') ?? meta(html, 'article:author'))?.slice(0, 300) ??
      null,
    publishedAt: meta(html, 'article:published_time') ?? null,
  };
}
