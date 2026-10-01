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
 * libheif, macOS ImageIO (and so Safari) and Chromium, byte-for-byte.
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
 * Grow `data` to exactly `target` bytes. Throws if the gap cannot be filled, so
 * callers should check `canPadTo` while choosing a candidate.
 */
export function padToExact(data: Uint8Array, target: number, format: OutputFormat): Uint8Array {
  if (data.length === target) return data;

  const gap = target - data.length;
  if (gap < 0) {
    throw new Error(`Cannot pad: ${data.length} bytes already exceeds the ${target}-byte target`);
  }
  if (!canPadTo(data.length, target, format)) {
    throw new Error(
      `Cannot pad ${format} from ${data.length} to ${target} bytes: a ${gap}-byte gap is not fillable`
    );
  }

  return format === 'webp' ? padWebP(data, gap) : padAvif(data, gap);
}

/**
 * Append an unknown RIFF chunk and correct the RIFF size field.
 *
 * `gap` is the total growth, so the payload is `gap - 8`. An odd payload would
 * need a trailing alignment byte, which `canPadTo` has already ruled out by
 * requiring an even gap.
 */
function padWebP(data: Uint8Array, gap: number): Uint8Array {
  assertRiffContainer(data);

  const padded = new Uint8Array(data.length + gap);
  padded.set(data);

  const view = new DataView(padded.buffer);
  writeAscii(padded, data.length, 'PADD');
  view.setUint32(data.length + 4, gap - 8, true); // RIFF is little-endian
  view.setUint32(4, padded.length - 8, true); // RIFF size covers everything after it

  return padded;
}

/** Append a top-level ISOBMFF 'free' box, whose contents are ignored by spec. */
function padAvif(data: Uint8Array, gap: number): Uint8Array {
  const padded = new Uint8Array(data.length + gap);
  padded.set(data);

  // ISOBMFF is big-endian, and a box's size includes its own header.
  new DataView(padded.buffer).setUint32(data.length, gap);
  writeAscii(padded, data.length + 4, 'free');

  return padded;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
}

function readAscii(source: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...source.subarray(start, end));
}

function assertRiffContainer(data: Uint8Array): void {
  const isRiff =
    data.length >= 12 && readAscii(data, 0, 4) === 'RIFF' && readAscii(data, 8, 12) === 'WEBP';

  if (!isRiff) throw new Error('Not a RIFF/WEBP container');
}
