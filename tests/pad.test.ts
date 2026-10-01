/**
 * Padding has to be invisible: the file grows to an exact size, and the pixels
 * that come back out are bit-for-bit what the encoder produced.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { canPadTo, padToExact, MIN_PAD_BYTES } from '../src/lib/exact80/pad';

const TARGET = 80_000;

let webp: Buffer;
let avif: Buffer;

before(async () => {
  const source = sharp({
    create: { width: 320, height: 240, channels: 3, background: '#3a7bd5' },
  });
  webp = await source.clone().webp({ quality: 80 }).toBuffer();
  avif = await source.clone().avif({ quality: 50 }).toBuffer();
});

describe('canPadTo', () => {
  test('a gap smaller than a chunk header cannot be filled', () => {
    for (let gap = 1; gap < MIN_PAD_BYTES; gap++) {
      assert.equal(canPadTo(TARGET - gap, TARGET, 'webp'), false, `gap of ${gap}`);
      assert.equal(canPadTo(TARGET - gap, TARGET, 'avif'), false, `gap of ${gap}`);
    }
  });

  test('landing exactly on the target needs no padding', () => {
    assert.equal(canPadTo(TARGET, TARGET, 'webp'), true);
    assert.equal(canPadTo(TARGET, TARGET, 'avif'), true);
  });

  test('WebP needs an even gap, because RIFF chunks are word-aligned', () => {
    assert.equal(canPadTo(TARGET - 9, TARGET, 'webp'), false);
    assert.equal(canPadTo(TARGET - 10, TARGET, 'webp'), true);
    // AVIF boxes have no such restriction.
    assert.equal(canPadTo(TARGET - 9, TARGET, 'avif'), true);
  });

  test('overshooting the target can never be padded', () => {
    assert.equal(canPadTo(TARGET + 1, TARGET, 'webp'), false);
    assert.equal(canPadTo(TARGET + 1, TARGET, 'avif'), false);
  });
});

describe('padToExact', () => {
  test('WebP reaches the target exactly and keeps a valid RIFF size field', () => {
    const padded = padToExact(webp, TARGET, 'webp');

    assert.equal(padded.length, TARGET);
    assert.equal(padded.readUInt32LE(4), TARGET - 8, 'RIFF size must cover everything after it');
    assert.equal(padded.toString('latin1', 0, 4), 'RIFF');
  });

  test('AVIF reaches the target exactly and ends in a free box', () => {
    const padded = padToExact(avif, TARGET, 'avif');
    const boxStart = avif.length;

    assert.equal(padded.length, TARGET);
    assert.equal(padded.readUInt32BE(boxStart), TARGET - boxStart, 'box size includes its header');
    assert.equal(padded.toString('latin1', boxStart + 4, boxStart + 8), 'free');
  });

  test('padded files decode to identical pixels', async () => {
    for (const [format, buffer] of [
      ['webp', webp],
      ['avif', avif],
    ] as const) {
      const padded = padToExact(buffer, TARGET, format);

      const before = await sharp(buffer).raw().toBuffer();
      const after = await sharp(padded).raw().toBuffer();
      const meta = await sharp(padded).metadata();

      assert.ok(after.equals(before), `${format}: pixels changed`);
      assert.equal(meta.width, 320, `${format}: width changed`);
      assert.equal(meta.height, 240, `${format}: height changed`);
    }
  });

  test('a file already at the target is returned untouched', () => {
    const exact = padToExact(webp, webp.length, 'webp');
    assert.ok(exact.equals(webp));
  });

  test('an unfillable gap throws rather than guessing', () => {
    assert.throws(() => padToExact(webp, webp.length + 3, 'webp'), /not fillable/);
    assert.throws(() => padToExact(webp, webp.length - 1, 'webp'), /exceeds/);
  });
});
