/**
 * POST /api/compress — one image in, exactly 80,000 bytes out.
 *
 * The browser does this work for people using the site; this endpoint exists for
 * everything else: build steps, CMS hooks, scripts. It runs the same search on
 * the sharp backend.
 *
 *   curl -X POST https://exact80.vercel.app/api/compress \
 *     -F image=@photo.jpg -F format=avif -o photo.avif
 *
 * Limits are deliberately modest and enforced per instance — see `rate-limit.ts`
 * for what that does and does not guarantee. Anyone who needs more should run
 * the CLI, which has no limits because it runs on their own machine.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { compressToExactSize, EXACT80_BYTES } from '@/lib/exact80/core/search';
import { sharpCodec } from '@/lib/exact80/codecs/sharp';
import type { OutputFormat } from '@/lib/exact80/core/types';
import { rateLimit } from './rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The engine gives up at 15s; this leaves room for decoding a large input. */
export const maxDuration = 60;

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MIN_TARGET_BYTES = 1024;
const MAX_TARGET_BYTES = 10 * 1024 * 1024;
const FORMATS: OutputFormat[] = ['avif', 'webp'];

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

export async function POST(request: NextRequest) {
  const limit = rateLimit(request);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Run the CLI locally for bulk work.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'Send multipart/form-data with an "image" field');
  }

  const file = form.get('image');
  if (!(file instanceof File)) {
    return fail(400, 'Missing "image" field');
  }
  if (file.size === 0) {
    return fail(400, 'The image is empty');
  }
  if (file.size > MAX_INPUT_BYTES) {
    return fail(413, `Image is larger than the ${MAX_INPUT_BYTES / 1024 / 1024} MB limit`, {
      bytes: file.size,
    });
  }

  const format = (form.get('format') as string | null) ?? 'avif';
  if (!FORMATS.includes(format as OutputFormat)) {
    return fail(400, `"format" must be one of: ${FORMATS.join(', ')}`);
  }

  const targetValue = form.get('target');
  const target = targetValue == null ? EXACT80_BYTES : Number(targetValue);
  if (!Number.isInteger(target) || target < MIN_TARGET_BYTES || target > MAX_TARGET_BYTES) {
    return fail(
      400,
      `"target" must be a whole number of bytes between ${MIN_TARGET_BYTES} and ${MAX_TARGET_BYTES}`
    );
  }

  try {
    const input = new Uint8Array(await file.arrayBuffer());
    const result = await compressToExactSize(input, format as OutputFormat, sharpCodec, { target });

    const name = `${file.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') || 'image'}.${format}`;

    return new NextResponse(result.data as BodyInit, {
      headers: {
        'Content-Type': `image/${format}`,
        'Content-Length': String(result.bytes),
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
        // The numbers behind the result, for callers that want to log them.
        'X-Exact80-Bytes': String(result.bytes),
        'X-Exact80-Width': String(result.width),
        'X-Exact80-Height': String(result.height),
        'X-Exact80-Quality': String(result.quality),
        'X-Exact80-Score': result.score.toFixed(4),
        'X-Exact80-Resized': result.resized ? '1' : '0',
        'X-Exact80-Ms': String(result.ms),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compression failed';

    // The engine throws this when even the smallest size overshoots the target,
    // which is the caller's problem to fix, not a server fault.
    if (message.includes('Could not fit')) return fail(422, message);
    if (message.includes('unsupported image format') || message.includes('Input buffer')) {
      return fail(415, 'That file is not an image this server can read');
    }

    // Anything unrecognised may carry internal paths or library detail, so it
    // goes to the server log and the caller gets the fact, not the trace.
    console.error('exact80: compression failed', error);
    return fail(500, 'Compression failed');
  }
}

export function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/compress',
    body: 'multipart/form-data',
    fields: {
      image: 'required — the image file',
      format: `optional — ${FORMATS.join(' or ')} (default avif)`,
      target: `optional — exact output size in bytes (default ${EXACT80_BYTES})`,
    },
    limits: {
      maxInputBytes: MAX_INPUT_BYTES,
      requestsPerMinute: rateLimit.perMinute,
    },
    cli: 'npx exact80 ./images — no limits, runs locally',
  });
}
