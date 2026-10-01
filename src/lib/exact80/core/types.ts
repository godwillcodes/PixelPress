/**
 * Core types for the Exact80 engine.
 *
 * Nothing here touches a codec or a platform: the search runs the same whether
 * the pixels are being pushed through sharp on a server or WebAssembly in a
 * browser tab. Everything is Uint8Array and plain RGBA, so there is no Buffer
 * and no Node assumption in the parts that matter.
 */

export type OutputFormat = 'webp' | 'avif';

/**
 * Decoded pixels, RGBA, 8 bits per channel.
 *
 * The buffer type is pinned to ArrayBuffer rather than ArrayBufferLike so these
 * pixels can back an ImageData directly. A full-size photo is tens of megabytes,
 * and the browser codec would otherwise have to copy it on every encode.
 */
export interface RasterImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/**
 * What the engine needs from a platform: decode, resize, encode.
 *
 * Implementations live in `codecs/`. Both are expected to apply EXIF rotation
 * while decoding and to drop metadata while encoding, so dimensions are always
 * what a viewer would see and no GPS coordinates survive.
 */
export interface Codec {
  readonly name: string;
  decode(bytes: Uint8Array): Promise<RasterImage>;
  /** Resize to exactly these dimensions. Callers preserve aspect ratio themselves. */
  resize(image: RasterImage, width: number, height: number): Promise<RasterImage>;
  /** Encode at a 1–100 quality, the same scale for both formats. */
  encode(image: RasterImage, format: OutputFormat, quality: number): Promise<Uint8Array>;
}

/** One encode the search tried, before padding. */
export interface Candidate {
  /** Longest edge in pixels. */
  edge: number;
  width: number;
  height: number;
  quality: number;
  /** Encoded size before padding. */
  bytes: number;
  data: Uint8Array;
}

/** A candidate that has been scored against the original. */
export interface ScoredCandidate extends Candidate {
  /** Perceptual similarity to the original, 0–1. Higher is better. */
  score: number;
}

/** The finished, exactly-sized image. */
export interface Exact80Result {
  /** Padded to exactly the target size. */
  data: Uint8Array;
  format: OutputFormat;
  /** Always equal to the target. */
  bytes: number;
  /** Size of the encode before padding. */
  encodedBytes: number;
  /** Bytes added by the ignorable padding chunk. */
  padBytes: number;
  width: number;
  height: number;
  quality: number;
  score: number;
  /** True when the image was downscaled to fit the budget. */
  resized: boolean;
  /** Dimensions of the input, after EXIF rotation. */
  sourceWidth: number;
  sourceHeight: number;
  /** How many encodes it took, for diagnostics. */
  encodes: number;
  ms: number;
}

export interface SearchOptions {
  /** Exact output size in bytes. Defaults to 80,000. */
  target?: number;
  /** Lowest quality the search may use. Below this, downscaling is the better trade. */
  minQuality?: number;
  /** Highest quality the search may use. */
  maxQuality?: number;
  /** Smallest longest-edge the ladder will go down to. */
  minEdge?: number;
  /** Stop searching after this long and return the best result so far. */
  budgetMs?: number;
  /** Called as the search works, for progress reporting. */
  onProgress?: (stage: SearchStage) => void;
}

export type SearchStage = 'decoding' | 'probing' | 'searching' | 'scoring' | 'done';
