/**
 * The API handler, called directly.
 *
 * What matters here is the contract a caller depends on: exact bytes back, the
 * headers that describe the result, and refusals that say what went wrong with
 * the right status rather than a 500.
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { NextRequest } from 'next/server';
import { POST, GET } from '../src/app/api/compress/route';
import { resetRateLimit, rateLimit } from '../src/app/api/compress/rate-limit';

const EXACT = 80_000;

let image: Buffer;

/** A request as the route sees it, with a caller address for the rate limit. */
function postRequest(form: FormData, ip = '203.0.113.1'): NextRequest {
  return new Request('https://exact80.test/api/compress', {
    method: 'POST',
    body: form,
    headers: { 'x-forwarded-for': ip },
  }) as unknown as NextRequest;
}

function formWith(file: Buffer, name = 'photo.jpg', type = 'image/jpeg', extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set('image', new File([new Uint8Array(file)], name, { type }));
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

before(async () => {
  const noise = Buffer.alloc(1200 * 900 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
  image = await sharp(noise, { raw: { width: 1200, height: 900, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
});

beforeEach(() => resetRateLimit());

describe('POST /api/compress', () => {
  test('returns exactly 80,000 bytes, and says what it did', async () => {
    const response = await POST(postRequest(formWith(image)));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/avif');
    assert.equal(response.headers.get('X-Exact80-Bytes'), String(EXACT));

    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, EXACT);
    assert.equal(response.headers.get('Content-Length'), String(EXACT));

    // The headers must describe the image that actually came back.
    const meta = await sharp(body).metadata();
    assert.equal(String(meta.width), response.headers.get('X-Exact80-Width'));
    assert.equal(String(meta.height), response.headers.get('X-Exact80-Height'));

    assert.match(response.headers.get('Content-Disposition') ?? '', /filename="photo\.avif"/);
  });

  test('honours the requested format and target', async () => {
    const response = await POST(
      postRequest(formWith(image, 'photo.jpg', 'image/jpeg', { format: 'webp', target: '30000' }))
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/webp');
    assert.equal((await response.arrayBuffer()).byteLength, 30_000);
  });

  test('refuses a request with no image', async () => {
    const response = await POST(postRequest(new FormData()));

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Missing "image"/);
  });

  test('refuses a format it cannot write', async () => {
    const response = await POST(
      postRequest(formWith(image, 'photo.jpg', 'image/jpeg', { format: 'jpeg' }))
    );

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /must be one of/);
  });

  test('refuses a target outside the allowed range', async () => {
    for (const target of ['100', '99999999', 'banana']) {
      const response = await POST(
        postRequest(formWith(image, 'photo.jpg', 'image/jpeg', { target }))
      );
      assert.equal(response.status, 400, `target=${target}`);
    }
  });

  test('answers 415 for a file that is not an image, not 500', async () => {
    const response = await POST(
      postRequest(formWith(Buffer.from('definitely not an image'), 'notes.png', 'image/png'))
    );

    assert.equal(response.status, 415);
  });

  test('refuses an empty file', async () => {
    const response = await POST(postRequest(formWith(Buffer.alloc(0))));

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /empty/);
  });
});

describe('rate limiting', () => {
  test('lets a caller through up to the limit, then asks them to wait', async () => {
    const request = () =>
      ({ headers: new Headers({ 'x-forwarded-for': '198.51.100.7' }) }) as NextRequest;

    for (let i = 0; i < rateLimit.perMinute; i++) {
      assert.equal(rateLimit(request()).allowed, true, `request ${i + 1} should be allowed`);
    }

    const blocked = rateLimit(request());
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0, 'a blocked caller is told when to come back');
  });

  test('tracks callers separately', async () => {
    const from = (ip: string) => ({ headers: new Headers({ 'x-forwarded-for': ip }) }) as NextRequest;

    for (let i = 0; i < rateLimit.perMinute; i++) rateLimit(from('198.51.100.8'));

    assert.equal(rateLimit(from('198.51.100.8')).allowed, false);
    assert.equal(rateLimit(from('198.51.100.9')).allowed, true, 'a different caller is unaffected');
  });

  test('a limited caller gets 429 with Retry-After', async () => {
    // The limit is checked before the body is read, so these requests need no
    // image — which keeps the test inside the one-minute window it is testing.
    for (let i = 0; i < rateLimit.perMinute; i++) {
      const allowed = await POST(postRequest(new FormData(), '198.51.100.20'));
      assert.equal(allowed.status, 400, 'still reaching validation, not the limit');
    }

    const response = await POST(postRequest(new FormData(), '198.51.100.20'));

    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('Retry-After')) > 0);
  });
});

describe('GET /api/compress', () => {
  test('documents itself', async () => {
    const body = await GET().json();

    assert.match(body.endpoint, /POST \/api\/compress/);
    assert.ok(body.fields.image);
    assert.equal(body.limits.requestsPerMinute, rateLimit.perMinute);
  });
});
