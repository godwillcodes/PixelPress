/**
 * The browser backend: WebAssembly encoders, no server.
 *
 * Compression happens on the viewer's machine, which is faster than uploading,
 * costs nothing to run, and means the images never leave their device. Intended
 * to run inside a Worker — see `workers/compress.worker.ts` — because the
 * encoders are synchronous enough to freeze a tab.
 *
 * Decoding uses the browser's own image pipeline rather than a WASM decoder: it
 * is much faster, it handles every format the browser can open, and
 * `imageOrientation: 'from-image'` applies the EXIF rotation that phone photos
 * carry. Encoding goes through the pre-bundled codecs because the browser offers
 * no control over quality when writing images, and this search is entirely about
 * control.
 */

import { loadAvifEncoder, loadResizer, loadWebpEncoder } from './wasm-loader';
import type { Codec, OutputFormat, RasterImage } from '../core/types';

/**
 * Encoder effort. WebP calls it `method` and AVIF calls it `speed`, with
 * opposite directions; both are set to the middle ground the sharp backend uses,
 * so the two produce comparable sizes at the same quality.
 */
const WEBP_METHOD = 4;
const AVIF_SPEED = 8;

/** The codecs work in ImageData, which is the same RGBA layout as RasterImage. */
function toImageData(image: RasterImage): ImageData {
  return new ImageData(image.data, image.width, image.height);
}

export const browserCodec: Codec = {
  name: 'browser',

  async decode(bytes: Uint8Array): Promise<RasterImage> {
    // A fresh copy, because the bitmap decoder may detach the incoming buffer.
    const blob = new Blob([new Uint8Array(bytes)]);

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      throw new Error('This file is not an image this browser can open');
    }

    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not read the image');

      context.drawImage(bitmap, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      return { data, width, height };
    } finally {
      bitmap.close();
    }
  },

  async resize(image: RasterImage, width: number, height: number): Promise<RasterImage> {
    const resize = await loadResizer();
    const resized = await resize(toImageData(image), {
      width,
      height,
      method: 'lanczos3', // matches the sharp backend
      fitMethod: 'stretch',
      premultiply: true,
      linearRGB: true,
    });

    return { data: resized.data, width: resized.width, height: resized.height };
  },

  async encode(image: RasterImage, format: OutputFormat, quality: number): Promise<Uint8Array> {
    const data = toImageData(image);

    if (format === 'webp') {
      const encode = await loadWebpEncoder();
      return new Uint8Array(await encode(data, { quality, method: WEBP_METHOD }));
    }

    const encode = await loadAvifEncoder();
    return new Uint8Array(await encode(data, { quality, speed: AVIF_SPEED }));
  },
};
