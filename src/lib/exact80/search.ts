/**
 * The Exact80 search: the best-looking image that fits in the budget, padded to
 * exactly the target size.
 *
 * At a fixed byte budget there is one real trade-off — resolution against
 * quality. Dropping quality alone is what makes "compressed to 80KB" look bad:
 * a 2400px photo squeezed into 80KB is a smear, while the same photo at 1200px
 * and quality 70 fits the same budget and looks fine. So the search explores
 * both axes and lets the perceptual score decide:
 *
 *   1. One cheap probe predicts roughly which resolution the budget allows.
 *   2. Around that prediction, each candidate resolution is binary-searched for
 *      the highest quality that still fits.
 *   3. Each resolution's winner is scored against the original; best score wins.
 *   4. The winner is padded up to exactly the target.
 *
 * Step 3 is the part that matters. Steps 1 and 2 only keep the work bounded.
 */

import { canPadTo, padToExact } from './pad';
import { loadSource, ResolutionEncoder, type SourceImage } from './encode';
import { createScorer } from './score';
import type { Candidate, Exact80Result, OutputFormat, ScoredCandidate, SearchOptions } from './types';

/** The one number this product is about. */
export const EXACT80_BYTES = 80_000;

const DEFAULTS = {
  target: EXACT80_BYTES,
  /**
   * The quality floor, and the one setting here with real taste in it.
   *
   * Below roughly this, both encoders start producing blocking and banding that
   * SSIM scores generously — it rewards retained detail and is forgiving of
   * artifacts — but which look obviously broken. Spending the budget on fewer,
   * cleaner pixels is the better trade, so the floor stops the search from
   * trading quality any further and forces it to downscale instead.
   */
  minQuality: 45,
  /** Above this, both formats grow fast for gains nobody sees. */
  maxQuality: 95,
  minEdge: 64,
  budgetMs: 15_000,
} as const;

/**
 * Round longest-edge steps. Fixed values rather than ratios of the input, so the
 * same photo always lands on the same output dimensions, and those dimensions
 * are ones people recognize.
 */
const EDGE_LADDER = [
  3840, 3200, 2560, 2400, 2048, 1920, 1600, 1440, 1280, 1200, 1024, 900, 800, 700, 600, 512, 440,
  360, 300, 240, 180, 128, 96, 64,
];

/** The probe runs here: cheap to encode, still large enough to extrapolate from. */
const PROBE_EDGE = 1024;
const PROBE_QUALITY = 70;

export async function compressToExactSize(
  input: Buffer,
  format: OutputFormat,
  options: SearchOptions = {}
): Promise<Exact80Result> {
  const { target, minQuality, maxQuality, minEdge, budgetMs } = { ...DEFAULTS, ...options };
  const startedAt = Date.now();

  const source = await loadSource(input);
  const longestEdge = Math.max(source.width, source.height);
  const ladder = buildLadder(longestEdge, minEdge);

  const encoders = new Map<number, ResolutionEncoder>();
  const encoderFor = (edge: number) => {
    let encoder = encoders.get(edge);
    if (!encoder) {
      encoder = new ResolutionEncoder(source, edge);
      encoders.set(edge, encoder);
    }
    return encoder;
  };
  const totalEncodes = () => [...encoders.values()].reduce((sum, e) => sum + e.encodeCount, 0);

  const finish = (winner: ScoredCandidate): Exact80Result => {
    const padded = padToExact(winner.buffer, target, format);
    return {
      buffer: padded,
      format,
      bytes: padded.length,
      encodedBytes: winner.bytes,
      padBytes: padded.length - winner.bytes,
      width: winner.width,
      height: winner.height,
      quality: winner.quality,
      score: winner.score,
      resized: winner.edge < longestEdge,
      encodes: totalEncodes(),
      ms: Date.now() - startedAt,
    };
  };

  // Fast path: a small image may already fit at full resolution and top quality,
  // and nothing can beat that, so there is no need to score anything.
  const fullRes = encoderFor(ladder[0]);
  const best = await fullRes.encode(maxQuality, format);
  if (canPadTo(best.bytes, target, format)) {
    return finish({ ...best, score: 1 });
  }

  const scorer = await createScorer(
    { buffer: source.buffer, raw: { width: source.width, height: source.height, channels: source.channels as 1 | 2 | 3 | 4 } },
    source.width,
    source.height
  );

  // Step 1: predict the resolution the budget allows. Bytes scale with pixel
  // area, so the edge scales with the square root of the size ratio.
  const probe = await encoderFor(nearestLadderEdge(ladder, PROBE_EDGE)).encode(PROBE_QUALITY, format);
  const predictedEdge = clamp(
    Math.round(probe.edge * Math.sqrt(target / probe.bytes)),
    minEdge,
    longestEdge
  );

  // Step 2 and 3: binary-search quality at the predicted resolution and its
  // neighbours, score each winner, keep the best-looking one.
  const scored: ScoredCandidate[] = [];
  for (const edge of candidateEdges(ladder, predictedEdge)) {
    if (Date.now() - startedAt > budgetMs && scored.length > 0) break;

    const winner = await highestQualityThatFits(encoderFor(edge), format, minQuality, maxQuality, target);
    if (!winner) {
      encoderFor(edge).release(); // too big even at the quality floor
      continue;
    }

    scored.push({ ...winner, score: await scorer(winner.buffer) });
  }

  // Nothing fit near the prediction, so walk the ladder down until something does.
  if (scored.length === 0) {
    for (const edge of ladder.filter((e) => e < predictedEdge)) {
      const winner = await highestQualityThatFits(encoderFor(edge), format, minQuality, maxQuality, target);
      if (winner) {
        scored.push({ ...winner, score: await scorer(winner.buffer) });
        break;
      }
    }
  }

  if (scored.length === 0) {
    throw new Error(
      `Could not fit this image into ${target} bytes as ${format} without going below ${minEdge}px`
    );
  }

  return finish(scored.reduce((a, b) => (b.score > a.score ? b : a)));
}

/**
 * Highest quality whose encode leaves a paddable gap, or null if even the
 * quality floor overshoots.
 *
 * Size is near-monotonic in quality but not perfectly so, hence keeping the best
 * fitting candidate seen rather than trusting the final bounds.
 */
async function highestQualityThatFits(
  encoder: ResolutionEncoder,
  format: OutputFormat,
  minQuality: number,
  maxQuality: number,
  target: number
): Promise<Candidate | null> {
  let low = minQuality;
  let high = maxQuality;
  let best: Candidate | null = null;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = await encoder.encode(mid, format);

    if (canPadTo(candidate.bytes, target, format)) {
      if (!best || candidate.quality > best.quality) best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

/** Ladder steps that apply to this image, largest first, starting at its own size. */
function buildLadder(longestEdge: number, minEdge: number): number[] {
  const steps = EDGE_LADDER.filter((edge) => edge < longestEdge && edge >= minEdge);
  return [longestEdge, ...steps];
}

function nearestLadderEdge(ladder: number[], wanted: number): number {
  return ladder.reduce((best, edge) =>
    Math.abs(edge - wanted) < Math.abs(best - wanted) ? edge : best
  );
}

/**
 * The prediction, plus two rungs either side.
 *
 * The score curve across resolutions is bumpy rather than a clean peak, so a
 * narrow window can settle next to the best answer rather than on it. Two rungs
 * of slack cover the noise; scoring is cheap, and the encodes are bounded by the
 * binary search and the time budget.
 */
function candidateEdges(ladder: number[], predictedEdge: number): number[] {
  const center = ladder.indexOf(nearestLadderEdge(ladder, predictedEdge));
  return [center - 2, center - 1, center, center + 1, center + 2]
    .filter((i) => i >= 0 && i < ladder.length)
    .map((i) => ladder[i]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type { Exact80Result, OutputFormat, SearchOptions, SourceImage };
