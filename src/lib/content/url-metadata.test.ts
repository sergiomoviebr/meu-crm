import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  extractMetadata,
  isPrivateHostname,
  parsePublicUrl,
} from './url-metadata';

describe('content URL metadata', () => {
  it('accepts public HTTP URLs and rejects unsafe schemes or credentials', () => {
    expect(parsePublicUrl('https://example.com/post')?.hostname).toBe(
      'example.com'
    );
    expect(parsePublicUrl('file:///etc/passwd')).toBeNull();
    expect(parsePublicUrl('https://user:pass@example.com')).toBeNull();
  });

  it('blocks local and private destinations', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('192.168.1.8')).toBe(true);
    expect(isPrivateHostname('172.20.0.2')).toBe(true);
    expect(isPrivateHostname('example.com')).toBe(false);
  });

  it('detects platforms and extracts open graph metadata', () => {
    const url = new URL('https://www.instagram.com/p/abc');
    expect(detectPlatform(url.hostname)).toBe('instagram');
    expect(
      extractMetadata(
        '<meta property="og:title" content="Uma ideia"><meta property="og:image" content="/cover.jpg">',
        url
      )
    ).toMatchObject({
      title: 'Uma ideia',
      thumbnailUrl: 'https://www.instagram.com/cover.jpg',
      platform: 'instagram',
    });
  });
});
