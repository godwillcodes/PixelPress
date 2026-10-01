/**
 * Loads the WASM codecs from /codecs at runtime, deliberately out of reach of
 * the app bundler.
 *
 * The codecs are pre-bundled by `scripts/build-codecs.mjs`. They cannot go
 * through Turbopack or webpack: the Emscripten glue declares a top-level
 * `Module`, and two of those in one scope fail at runtime with "Identifier
 * 'Module' has already been declared". The paths below are built at runtime and
 * marked ignore, so no bundler tries to follow them.
 *
 * Each codec is fetched once, on first use, and the ~300KB–3MB of WebAssembly
 * that implies never loads for someone who does not compress anything.
 */

const CODEC_BASE = '/codecs';

export interface WebpEncodeOptions {
  quality: number;
  method: number;
}

export interface AvifEncodeOptions {
  quality: number;
  speed: number;
}

export interface ResizeOptions {
  width: number;
  height: number;
  method: 'lanczos3' | 'catrom' | 'mitchell' | 'triangle';
  fitMethod: 'stretch' | 'contain';
  premultiply: boolean;
  linearRGB: boolean;
}

type WebpEncoder = (data: ImageData, options?: Partial<WebpEncodeOptions>) => Promise<ArrayBuffer>;
type AvifEncoder = (data: ImageData, options?: Partial<AvifEncodeOptions>) => Promise<ArrayBuffer>;
type Resizer = (data: ImageData, options: Partial<ResizeOptions> & { width: number; height: number }) => Promise<ImageData>;

/** Built at runtime so the bundler cannot resolve it statically. */
const codecUrl = (file: string) => `${CODEC_BASE}/${file}`;

async function loadDefault<T>(file: string): Promise<T> {
  const module = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ codecUrl(file))) as {
    default: T;
  };
  return module.default;
}

let webp: Promise<WebpEncoder> | undefined;
let avif: Promise<AvifEncoder> | undefined;
let resize: Promise<Resizer> | undefined;

export const loadWebpEncoder = (): Promise<WebpEncoder> =>
  (webp ??= loadDefault<WebpEncoder>('webp-encode.js'));

export const loadAvifEncoder = (): Promise<AvifEncoder> =>
  (avif ??= loadDefault<AvifEncoder>('avif-encode.js'));

export const loadResizer = (): Promise<Resizer> => (resize ??= loadDefault<Resizer>('resize.js'));
