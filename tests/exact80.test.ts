/**
 * The product's one promise, asserted: whatever goes in, exactly 80,000 bytes
 * of decodable WebP or AVIF comes out, and it still looks like the original.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { compressToExactSize, EXACT80_BYTES } from '../src/lib/exact80/search';
import type { Exact80Result, OutputFormat } from '../src/lib/exact80/types';

const PHOTO = 'public/merve-kalafat-yilmaz-7B3TPCkHhYw-unsplash.jpg';

/** Every result must satisfy these, no matter the input. */
async function assertExactAndDecodable(result: Exact80Result, format: OutputFormat) {
  assert.equal(result.bytes, EXACT80_BYTES, 'output must be exactly 80,000 bytes');
  assert.equal(result.buffer.length, EXACT80_BYTES, 'buffer length must match the reported size');
  assert.equal(result.encodedBytes + result.padBytes, EXACT80_BYTES);

  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, result.width, 'decoded width must match the reported width');
  assert.equal(meta.height, result.height, 'decoded height must match the reported height');

  // sharp reports every AVIF as its container family, heif.
  assert.equal(meta.format, format === 'webp' ? 'webp' : 'heif');

  // A decode of all pixels proves the padding did not corrupt the bitstream.
  const pixels = await sharp(result.buffer).raw().toBuffer();
  assert.ok(pixels.length > 0);
}

/** A detailed photograph: far more data than 80,000 bytes can hold. */
describe('a large photograph', () => {
  let input: Buffer;

  before(async () => {
    input = await readFile(PHOTO);
  });

  for (const format of ['webp', 'avif'] as const) {
    test(`${format}: lands on the target and stays recognizable`, async () => {
      const result = await compressToExactSize(input, format);

      await assertExactAndDecodable(result, format);

      assert.ok(result.resized, 'a 2400x3600 photo cannot stay full size inside 80,000 bytes');
      assert.ok(result.quality >= 45, `quality ${result.quality} fell below the floor`);
      assert.ok(result.score > 0.6, `perceptual score ${result.score.toFixed(3)} is too low`);
    });
  }

  test('chooses resolution and quality together, not quality alone', async () => {
    const result = await compressToExactSize(input, 'webp');

    // The failure this guards against: squeezing a full-size photo into the
    // budget by collapsing quality, which is what makes 80KB images look bad.
    assert.ok(
      result.width < 2400,
      `expected a downscale, got ${result.width}x${result.height} at quality ${result.quality}`
    );
    assert.ok(
      result.quality > 45,
      `quality ${result.quality} suggests it is still trading quality instead of resolution`
    );
  });

  test('is deterministic', async () => {
    const [first, second] = await Promise.all([
      compressToExactSize(input, 'webp'),
      compressToExactSize(input, 'webp'),
    ]);

    assert.ok(first.buffer.equals(second.buffer), 'same input must produce the same bytes');
  });
});

describe('images that are already small', () => {
  test('a tiny image is padded up without being upscaled', async () => {
    const input = await sharp({
      create: { width: 160, height: 120, channels: 3, background: '#c33' },
    })
      .png()
      .toBuffer();

    const result = await compressToExactSize(input, 'webp');

    await assertExactAndDecodable(result, 'webp');
    assert.equal(result.width, 160, 'must not upscale');
    assert.equal(result.height, 120);
    assert.equal(result.resized, false);
    assert.ok(result.padBytes > 0, 'the gap should be closed by padding');
    assert.ok(result.encodedBytes < EXACT80_BYTES);
  });
});

describe('awkward inputs', () => {
  test('transparency survives', async () => {
    const input = await sharp({
      create: { width: 900, height: 900, channels: 4, background: { r: 0, g: 120, b: 255, alpha: 0.4 } },
    })
      .png()
      .toBuffer();

    const result = await compressToExactSize(input, 'webp');
    const meta = await sharp(result.buffer).metadata();

    await assertExactAndDecodable(result, 'webp');
    assert.equal(meta.hasAlpha, true, 'alpha channel was dropped');
  });

  test('a noisy image, the hardest thing to compress, still fits', async () => {
    const noise = Buffer.alloc(1200 * 1200 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);

    const input = await sharp(noise, { raw: { width: 1200, height: 1200, channels: 3 } })
      .png()
      .toBuffer();

    const result = await compressToExactSize(input, 'webp');
    await assertExactAndDecodable(result, 'webp');
  });

  test('an extreme aspect ratio keeps its proportions', async () => {
    const input = await sharp({
      create: { width: 4000, height: 200, channels: 3, background: '#2d6a4f' },
    })
      .jpeg()
      .toBuffer();

    const result = await compressToExactSize(input, 'webp');

    await assertExactAndDecodable(result, 'webp');
    const ratio = result.width / result.height;
    assert.ok(Math.abs(ratio - 20) < 0.5, `aspect ratio drifted to ${ratio.toFixed(2)}`);
  });

  test('EXIF rotation is applied, so reported dimensions are what a viewer sees', async () => {
    // A portrait image stored as landscape with "rotate 90°" in its EXIF, which
    // is how phones save photos. Orientation has to be set through
    // withMetadata — withExif writes the tag but sharp does not read it back.
    const input = await sharp({
      create: { width: 1200, height: 600, channels: 3, background: '#555' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const result = await compressToExactSize(input, 'webp');

    await assertExactAndDecodable(result, 'webp');
    assert.ok(result.height > result.width, 'rotation was not applied before sizing');
  });

  test('metadata, including GPS, is stripped', async () => {
    const input = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#777' },
    })
      .withExif({ IFD0: { Copyright: 'test' }, GPS: { GPSLatitudeRef: 'N' } })
      .jpeg()
      .toBuffer();

    const result = await compressToExactSize(input, 'webp');
    const meta = await sharp(result.buffer).metadata();

    assert.equal(meta.exif, undefined, 'EXIF survived into the output');
  });
});

describe('the search stays cheap', () => {
  test('a photo needs only a handful of encodes', async () => {
    const input = await readFile(PHOTO);
    const result = await compressToExactSize(input, 'webp');

    assert.ok(result.encodes <= 40, `${result.encodes} encodes is more work than expected`);
  });
});
