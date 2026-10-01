/**
 * Platform-neutral engine entry point: safe to import anywhere, including client
 * components. The codec backends are imported directly from `codecs/`, since one
 * of them pulls in sharp and the other pulls in WebAssembly.
 */

export { compressToExactSize, EXACT80_BYTES } from './core/search';
export { canPadTo, padToExact, MIN_PAD_BYTES } from './core/pad';
export { createScorer, referenceDimensions, ssim, toGrayscale } from './core/ssim';
export type {
  Candidate,
  Codec,
  Exact80Result,
  OutputFormat,
  RasterImage,
  ScoredCandidate,
  SearchOptions,
  SearchStage,
} from './core/types';
