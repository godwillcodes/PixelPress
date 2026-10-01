/**
 * Padding a finished image up to an exact byte count.
 *
 * No encoder can be asked for a precise file size — quality steps move the
 * output by hundreds of bytes at a time. So we encode just under the target and
 * close the remaining gap with a chunk that decoders are required to skip:
 *
 *   WebP  an unknown RIFF chunk ('PADD'), with the RIFF size field corrected.
 *         RIFF chunks are word-aligned, so a chunk always adds an even number
 *         of bytes, and never fewer than its 8-byte header.
 *   AVIF  a top-level ISOBMFF 'free' box, which the spec defines as ignorable.
 *         Any size from 8 bytes up works.
 *
 * The pixels are untouched: padded files decode identically in libwebp,
 * libheif and macOS ImageIO (and so Safari), byte-for-byte.
 */

import type { OutputFormat } from './types';

/** A chunk/box header is 8 bytes, so that is the smallest gap we can fill. */
export const MIN_PAD_BYTES = 8;

/**
 * Can an encode of `size` be padded up to exactly `target`?
 *
 * Either it already lands on the target, or the gap has to be big enough for a
 * header — and, for WebP, even, because RIFF chunks are word-aligned.
 */
export function canPadTo(size: number, target: number, format: OutputFormat): boolean {
  if (size === target) return true;

  const gap = target - size;
  if (gap < MIN_PAD_BYTES) return false;

  return format === 'avif' || gap % 2 === 0;
}

/**
 * Grow `buffer` to exactly `target` bytes. Throws if the gap cannot be filled,
 * so callers should check `canPadTo` while choosing a candidate.
 */
export function padToExact(buffer: Buffer, target: number, format: OutputFormat): Buffer {
  if (buffer.length === target) return buffer;

  const gap = target - buffer.length;
  if (gap < 0) {
    throw new Error(`Cannot pad: ${buffer.length} bytes already exceeds the ${target}-byte target`);
  }
  if (!canPadTo(buffer.length, target, format)) {
    throw new Error(
      `Cannot pad ${format} from ${buffer.length} to ${target} bytes: a ${gap}-byte gap is not fillable`
    );
  }

  return format === 'webp' ? padWebP(buffer, gap) : padAvif(buffer, gap);
}

/**
 * Append an unknown RIFF chunk and correct the RIFF size field.
 *
 * `gap` is the total growth, so the payload is `gap - 8`. An odd payload would
 * need a trailing alignment byte, which `canPadTo` has already ruled out by
 * requiring an even gap.
 */
function padWebP(buffer: Buffer, gap: number): Buffer {
  assertRiffContainer(buffer);

  const chunk = Buffer.alloc(gap);
  chunk.write('PADD', 0, 'latin1');
  chunk.writeUInt32LE(gap - 8, 4);

  const padded = Buffer.concat([buffer, chunk]);
  padded.writeUInt32LE(padded.length - 8, 4); // RIFF size covers everything after it
  return padded;
}

/** Append a top-level ISOBMFF 'free' box, whose contents are ignored by spec. */
function padAvif(buffer: Buffer, gap: number): Buffer {
  const box = Buffer.alloc(gap);
  box.writeUInt32BE(gap, 0); // box size includes the header
  box.write('free', 4, 'latin1');
  return Buffer.concat([buffer, box]);
}

function assertRiffContainer(buffer: Buffer): void {
  const isRiff =
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP';

  if (!isRiff) throw new Error('Not a RIFF/WEBP container');
}
