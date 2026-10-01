/**
 * Encoding at a fixed resolution.
 *
 * The search tries many qualities at the same resolution, so resizing once and
 * keeping the raw pixels makes every later encode cheap — resizing is the
 * expensive half of the work. Encoder effort stays fixed across a search so that
 * size differences come only from quality, which is what the binary search
 * assumes.
 */

import sharp from 'sharp';
import type { Candidate, OutputFormat } from './types';

/** Encoder effort: the best speed/size trade-off for an interactive tool. */
const EFFORT = 4;

export interface SourceImage {
  /** Pixels with EXIF rotation applied, so width/height are display dimensions. */
  buffer: Buffer;
  width: number;
  height: number;
  channels: number;
  hasAlpha: boolean;
}

/**
 * Decode the input once: apply EXIF rotation, drop metadata, and keep raw pixels.
 *
 * Rotating first means every downstream dimension is what a viewer would see,
 * and dropping metadata removes the GPS coordinates a phone photo carries.
 */
export async function loadSource(input: Buffer): Promise<SourceImage> {
  const { data, info } = await sharp(input)
    .rotate()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    hasAlpha: info.channels === 2 || info.channels === 4,
  };
}

/** Re-encodes one resolution at any quality. */
export class ResolutionEncoder {
  readonly edge: number;
  readonly width: number;
  readonly height: number;

  private pixels: Buffer | null = null;
  private encodes = 0;

  constructor(
    private readonly source: SourceImage,
    edge: number
  ) {
    const longest = Math.max(source.width, source.height);
    const scale = Math.min(1, edge / longest);

    this.edge = Math.min(edge, longest);
    this.width = Math.max(1, Math.round(source.width * scale));
    this.height = Math.max(1, Math.round(source.height * scale));
  }

  get encodeCount(): number {
    return this.encodes;
  }

  /** Resize once, then reuse the pixels for every quality we try. */
  private async getPixels(): Promise<Buffer> {
    if (this.pixels) return this.pixels;

    const raw = {
      width: this.source.width,
      height: this.source.height,
      channels: this.source.channels as 1 | 2 | 3 | 4,
    };

    this.pixels =
      this.width === this.source.width && this.height === this.source.height
        ? this.source.buffer
        : await sharp(this.source.buffer, { raw })
            .resize({ width: this.width, height: this.height, kernel: sharp.kernel.lanczos3 })
            .raw()
            .toBuffer();

    return this.pixels;
  }

  async encode(quality: number, format: OutputFormat): Promise<Candidate> {
    const pixels = await this.getPixels();
    const pipeline = sharp(pixels, {
      raw: { width: this.width, height: this.height, channels: this.source.channels as 1 | 2 | 3 | 4 },
    });

    const buffer =
      format === 'webp'
        ? await pipeline.webp({ quality, effort: EFFORT, smartSubsample: true }).toBuffer()
        : await pipeline.avif({ quality, effort: EFFORT, chromaSubsampling: '4:2:0' }).toBuffer();

    this.encodes++;

    return {
      edge: this.edge,
      width: this.width,
      height: this.height,
      quality,
      bytes: buffer.length,
      buffer,
    };
  }

  /** Free the resized pixels once this resolution is no longer a contender. */
  release(): void {
    if (this.pixels !== this.source.buffer) this.pixels = null;
  }
}
