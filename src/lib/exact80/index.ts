export { compressToExactSize, EXACT80_BYTES } from './search';
export { canPadTo, padToExact, MIN_PAD_BYTES } from './pad';
export { createScorer } from './score';
export { loadSource } from './encode';
export type {
  Candidate,
  Exact80Result,
  OutputFormat,
  ScoredCandidate,
  SearchOptions,
} from './types';
