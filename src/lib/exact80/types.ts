/** Core types for the Exact80 engine. */

export type OutputFormat = 'webp' | 'avif';

/** One encode the search tried, before padding. */
export interface Candidate {
  /** Longest edge in pixels. */
  edge: number;
  width: number;
  height: number;
  quality: number;
  /** Encoded size before padding. */
  bytes: number;
  buffer: Buffer;
}

/** A candidate that has been scored against the original. */
export interface ScoredCandidate extends Candidate {
  /** Perceptual similarity to the original, 0–1. Higher is better. */
  score: number;
}

/** The finished, exactly-sized image. */
export interface Exact80Result {
  /** Padded to exactly the target size. */
  buffer: Buffer;
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
  /** How many encodes it took, for diagnostics. */
  encodes: number;
  ms: number;
}

export interface SearchOptions {
  /** Exact output size in bytes. Defaults to 80,000. */
  target?: number;
  /** Lowest quality the search may use. Below this an image looks bad enough that downscaling wins. */
  minQuality?: number;
  /** Highest quality the search may use. */
  maxQuality?: number;
  /** Smallest longest-edge the ladder will go down to. */
  minEdge?: number;
  /** Stop searching after this long and return the best result so far. */
  budgetMs?: number;
}
