/**
 * How close does a candidate look to the original?
 *
 * The budget is fixed, so the only question worth asking is which encode looks
 * best at that size. Comparing byte counts cannot answer it: a full-resolution
 * image at quality 30 and a half-resolution image at quality 75 can weigh the
 * same and look nothing alike.
 *
 * We score with SSIM, which tracks structure rather than per-pixel error, so it
 * notices the smearing that low-quality encodes produce.
 *
 * Scoring happens at the ORIGINAL image's size: each candidate is scaled back up
 * to it before comparison. That matters, and getting it wrong inverts the
 * result. Comparing at some small shared size instead would judge a 512px
 * candidate on 512px worth of detail and score it near-perfect, so the search
 * would shrink every image as far as it could. Measuring against the full-size
 * original asks the question a viewer would: how much of this image survives?
 * Detail a small candidate cannot reproduce counts against it, exactly as
 * artifacts count against a large, over-compressed one.
 *
 * SSIMULACRA2 is the better metric and is where this should end up, but it
 * needs a WASM build; SSIM is close enough to rank candidates today.
 */

import sharp from 'sharp';

/**
 * Scoring is capped at this longest edge to bound the cost on huge originals.
 * It sits far above the resolutions an 80,000-byte budget can hold, so in
 * practice candidates are still compared against more detail than they contain.
 */
const MAX_REFERENCE_EDGE = 1600;

/** Window size and stride for the SSIM pass. */
const WINDOW = 8;
const STRIDE = 4;

// Stabilizing constants from the SSIM paper, for 8-bit data.
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** Either an encoded image, or raw pixels with the shape needed to read them. */
export type ImageInput =
  | Buffer
  | { buffer: Buffer; raw: { width: number; height: number; channels: 1 | 2 | 3 | 4 } };

interface GrayImage {
  data: Buffer;
  width: number;
  height: number;
}

function open(input: ImageInput): sharp.Sharp {
  return Buffer.isBuffer(input) ? sharp(input) : sharp(input.buffer, { raw: input.raw });
}

/**
 * Reduce an image to grayscale on the reference pixel grid.
 *
 * `fit: 'fill'` is deliberate: a candidate that was downscaled gets scaled back
 * up here, putting both images on an identical grid so SSIM compares like with
 * like — and so the detail the candidate lost shows up as a lower score.
 */
async function toReferenceGray(input: ImageInput, width: number, height: number): Promise<GrayImage> {
  const { data, info } = await open(input)
    .resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

/** The grid both images are compared on: the original's size, capped for cost. */
export function referenceDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_REFERENCE_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Mean SSIM over a sliding window. 1.0 means identical.
 */
function ssim(a: GrayImage, b: GrayImage): number {
  const { width, height } = a;
  let total = 0;
  let windows = 0;

  for (let top = 0; top + WINDOW <= height; top += STRIDE) {
    for (let left = 0; left + WINDOW <= width; left += STRIDE) {
      let sumA = 0;
      let sumB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let sumAB = 0;

      for (let y = top; y < top + WINDOW; y++) {
        const row = y * width;
        for (let x = left; x < left + WINDOW; x++) {
          const pa = a.data[row + x];
          const pb = b.data[row + x];
          sumA += pa;
          sumB += pb;
          sumAA += pa * pa;
          sumBB += pb * pb;
          sumAB += pa * pb;
        }
      }

      const n = WINDOW * WINDOW;
      const meanA = sumA / n;
      const meanB = sumB / n;
      const varA = sumAA / n - meanA * meanA;
      const varB = sumBB / n - meanB * meanB;
      const covAB = sumAB / n - meanA * meanB;

      const numerator = (2 * meanA * meanB + C1) * (2 * covAB + C2);
      const denominator = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2);

      total += numerator / denominator;
      windows++;
    }
  }

  // An image smaller than one window has nothing to compare; treat it as a match.
  return windows === 0 ? 1 : total / windows;
}

/**
 * Prepare the original once, then score any number of candidates against it.
 */
export async function createScorer(
  original: ImageInput,
  width: number,
  height: number
): Promise<(candidate: Buffer) => Promise<number>> {
  const reference = referenceDimensions(width, height);
  const originalGray = await toReferenceGray(original, reference.width, reference.height);

  return async (candidate: Buffer) => {
    const candidateGray = await toReferenceGray(candidate, reference.width, reference.height);
    return ssim(originalGray, candidateGray);
  };
}
