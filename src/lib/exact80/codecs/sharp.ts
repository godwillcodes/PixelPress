/**
 * The sharp backend: Node only.
 *
 * This is what the tests run against and what any server-side use would use. The
 * browser gets the same search through `codecs/browser.ts`; both answer to the
 * `Codec` interface, so nothing in `core/` knows which one it is talking to.
 */

import sharp from 'sharp';
import type { Codec, OutputFormat, RasterImage } from '../core/types';

/** Encoder effort: the best speed/size trade-off for an interactive tool. */
const EFFORT = 4;

/** Everything is RGBA so the two backends agree on pixel layout. */
const CHANNELS = 4;

function fromRaster(image: RasterImage): sharp.Sharp {
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: CHANNELS },
  });
}

async function toRaster(pipeline: sharp.Sharp): Promise<RasterImage> {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

export const sharpCodec: Codec = {
  name: 'sharp',

  /**
   * Decode once, applying EXIF rotation so every dimension downstream is what a
   * viewer would see. Metadata is not carried through raw pixels, so the GPS
   * coordinates in a phone photo are dropped here.
   */
  async decode(bytes: Uint8Array): Promise<RasterImage> {
    return toRaster(sharp(bytes).rotate().ensureAlpha());
  },

  async resize(image: RasterImage, width: number, height: number): Promise<RasterImage> {
    return toRaster(
      fromRaster(image).resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    );
  },

  async encode(image: RasterImage, format: OutputFormat, quality: number): Promise<Uint8Array> {
    const pipeline = fromRaster(image);

    const encoded =
      format === 'webp'
        ? await pipeline.webp({ quality, effort: EFFORT, smartSubsample: true }).toBuffer()
        : await pipeline.avif({ quality, effort: EFFORT, chromaSubsampling: '4:2:0' }).toBuffer();

    return new Uint8Array(encoded);
  },
};
