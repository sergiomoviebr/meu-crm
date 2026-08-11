import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonBody } from './validate';
import { ApiError } from './respond';

const Schema = z.object({
  phone: z.string().trim().min(1),
  name: z.string().optional(),
});

function jsonRequest(body: unknown) {
  return new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('parseJsonBody', () => {
  it('returns the parsed data on a valid body', async () => {
    const out = await parseJsonBody(jsonRequest({ phone: '+1', name: 'Jane' }), Schema);
    expect(out).toEqual({ phone: '+1', name: 'Jane' });
  });

  it('omits an optional field the caller left out (partial-update semantics)', async () => {
    const out = await parseJsonBody(jsonRequest({ phone: '+1' }), Schema);
    expect('name' in out).toBe(false);
  });

  it('rejects a non-object body', async () => {
    await expect(parseJsonBody(jsonRequest('just a string'), Schema)).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
    });
  });

  it('rejects an array body', async () => {
    await expect(parseJsonBody(jsonRequest([1, 2, 3]), Schema)).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('rejects malformed JSON without throwing a raw parse error', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    await expect(parseJsonBody(req, Schema)).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects a missing required field with a path-anchored message', async () => {
    await expect(parseJsonBody(jsonRequest({}), Schema)).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('rejects the wrong type for a field', async () => {
    await expect(
      parseJsonBody(jsonRequest({ phone: 123 }), Schema)
    ).rejects.toMatchObject({ code: 'bad_request' });
  });
});
