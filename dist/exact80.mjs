#!/usr/bin/env node

// src/cli/index.ts
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

// src/lib/exact80/core/pad.ts
var MIN_PAD_BYTES = 8;
function canPadTo(size, target, format) {
  if (size === target) return true;
  const gap = target - size;
  if (gap < MIN_PAD_BYTES) return false;
  return format === "avif" || gap % 2 === 0;
}
function padToExact(data, target, format) {
  if (data.length === target) return data;
  const gap = target - data.length;
  if (gap < 0) {
    throw new Error(`Cannot pad: ${data.length} bytes already exceeds the ${target}-byte target`);
  }
  if (!canPadTo(data.length, target, format)) {
    throw new Error(
      `Cannot pad ${format} from ${data.length} to ${target} bytes: a ${gap}-byte gap is not fillable`
    );
  }
  return format === "webp" ? padWebP(data, gap) : padAvif(data, gap);
}
function padWebP(data, gap) {
  assertRiffContainer(data);
  const padded = new Uint8Array(data.length + gap);
  padded.set(data);
  const view = new DataView(padded.buffer);
  writeAscii(padded, data.length, "PADD");
  view.setUint32(data.length + 4, gap - 8, true);
  view.setUint32(4, padded.length - 8, true);
  return padded;
}
function padAvif(data, gap) {
  const padded = new Uint8Array(data.length + gap);
  padded.set(data);
  new DataView(padded.buffer).setUint32(data.length, gap);
  writeAscii(padded, data.length + 4, "free");
  return padded;
}
function writeAscii(target, offset, text) {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
}
function readAscii(source, start, end) {
  return String.fromCharCode(...source.subarray(start, end));
}
function assertRiffContainer(data) {
  const isRiff = data.length >= 12 && readAscii(data, 0, 4) === "RIFF" && readAscii(data, 8, 12) === "WEBP";
  if (!isRiff) throw new Error("Not a RIFF/WEBP container");
}

// src/lib/exact80/core/ssim.ts
var MAX_REFERENCE_EDGE = 1600;
var WINDOW = 8;
var STRIDE = 4;
var C1 = (0.01 * 255) ** 2;
var C2 = (0.03 * 255) ** 2;
function referenceDimensions(width, height) {
  const scale = Math.min(1, MAX_REFERENCE_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}
function toGrayscale(image) {
  const gray = new Uint8Array(image.width * image.height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = (image.data[p] * 299 + image.data[p + 1] * 587 + image.data[p + 2] * 114) / 1e3;
  }
  return { data: gray, width: image.width, height: image.height };
}
function ssim(a, b) {
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
  return windows === 0 ? 1 : total / windows;
}
async function createScorer(codec, original) {
  const reference = referenceDimensions(original.width, original.height);
  const originalGray = toGrayscale(await codec.resize(original, reference.width, reference.height));
  return async (candidate) => {
    const resized = await codec.resize(candidate, reference.width, reference.height);
    return ssim(originalGray, toGrayscale(resized));
  };
}

// src/lib/exact80/core/search.ts
var EXACT80_BYTES = 8e4;
var DEFAULTS = {
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
  budgetMs: 15e3
};
var EDGE_LADDER = [
  3840,
  3200,
  2560,
  2400,
  2048,
  1920,
  1600,
  1440,
  1280,
  1200,
  1024,
  900,
  800,
  700,
  600,
  512,
  440,
  360,
  300,
  240,
  180,
  128,
  96,
  64
];
var PROBE_EDGE = 1024;
var PROBE_QUALITY = 70;
async function compressToExactSize(input, format, codec, options = {}) {
  const { target, minQuality, maxQuality, minEdge, budgetMs, onProgress } = {
    ...DEFAULTS,
    ...options
  };
  const startedAt = Date.now();
  onProgress?.("decoding");
  const source = await codec.decode(input);
  const longestEdge = Math.max(source.width, source.height);
  const ladder = buildLadder(longestEdge, minEdge);
  const resolutions = /* @__PURE__ */ new Map();
  const resolutionFor = (edge) => {
    let resolution = resolutions.get(edge);
    if (!resolution) {
      resolution = new Resolution(codec, source, edge);
      resolutions.set(edge, resolution);
    }
    return resolution;
  };
  const totalEncodes = () => [...resolutions.values()].reduce((sum, r) => sum + r.encodeCount, 0);
  const finish = (winner) => {
    const padded = padToExact(winner.data, target, format);
    onProgress?.("done");
    return {
      data: padded,
      format,
      bytes: padded.length,
      encodedBytes: winner.bytes,
      padBytes: padded.length - winner.bytes,
      width: winner.width,
      height: winner.height,
      quality: winner.quality,
      score: winner.score,
      resized: winner.edge < longestEdge,
      sourceWidth: source.width,
      sourceHeight: source.height,
      encodes: totalEncodes(),
      ms: Date.now() - startedAt
    };
  };
  const scorer = await createScorer(codec, source);
  onProgress?.("probing");
  const full = await resolutionFor(ladder[0]).encode(maxQuality, format);
  if (canPadTo(full.bytes, target, format)) {
    return finish({ ...full, score: await scorer(await codec.decode(full.data)) });
  }
  const probe = await resolutionFor(nearestLadderEdge(ladder, PROBE_EDGE)).encode(
    PROBE_QUALITY,
    format
  );
  const predictedEdge = clamp(
    Math.round(probe.edge * Math.sqrt(target / probe.bytes)),
    minEdge,
    longestEdge
  );
  onProgress?.("searching");
  const scored = [];
  for (const edge of candidateEdges(ladder, predictedEdge)) {
    if (Date.now() - startedAt > budgetMs && scored.length > 0) break;
    const winner = await highestQualityThatFits(
      resolutionFor(edge),
      format,
      minQuality,
      maxQuality,
      target
    );
    if (!winner) {
      resolutionFor(edge).release();
      continue;
    }
    onProgress?.("scoring");
    scored.push({ ...winner, score: await scorer(await codec.decode(winner.data)) });
  }
  if (scored.length === 0) {
    for (const edge of ladder.filter((e) => e < predictedEdge)) {
      const winner = await highestQualityThatFits(
        resolutionFor(edge),
        format,
        minQuality,
        maxQuality,
        target
      );
      if (winner) {
        scored.push({ ...winner, score: await scorer(await codec.decode(winner.data)) });
        break;
      }
    }
  }
  if (scored.length === 0) {
    throw new Error(
      `Could not fit this image into ${target} bytes as ${format} without going below ${minEdge}px`
    );
  }
  return finish(scored.reduce((a, b) => b.score > a.score ? b : a));
}
var Resolution = class {
  constructor(codec, source, edge) {
    this.codec = codec;
    this.source = source;
    this.pixels = null;
    this.encodes = 0;
    const longest = Math.max(source.width, source.height);
    const scale = Math.min(1, edge / longest);
    this.edge = Math.min(edge, longest);
    this.width = Math.max(1, Math.round(source.width * scale));
    this.height = Math.max(1, Math.round(source.height * scale));
  }
  get encodeCount() {
    return this.encodes;
  }
  async getPixels() {
    if (!this.pixels) {
      this.pixels = this.width === this.source.width && this.height === this.source.height ? this.source : await this.codec.resize(this.source, this.width, this.height);
    }
    return this.pixels;
  }
  async encode(quality, format) {
    const data = await this.codec.encode(await this.getPixels(), format, quality);
    this.encodes++;
    return {
      edge: this.edge,
      width: this.width,
      height: this.height,
      quality,
      bytes: data.length,
      data
    };
  }
  /** Free the resized pixels once this resolution is no longer a contender. */
  release() {
    if (this.pixels !== this.source) this.pixels = null;
  }
};
async function highestQualityThatFits(resolution, format, minQuality, maxQuality, target) {
  let low = minQuality;
  let high = maxQuality;
  let best = null;
  while (low <= high) {
    const mid = low + high >> 1;
    const candidate = await resolution.encode(mid, format);
    if (canPadTo(candidate.bytes, target, format)) {
      if (!best || candidate.quality > best.quality) best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}
function buildLadder(longestEdge, minEdge) {
  const steps = EDGE_LADDER.filter((edge) => edge < longestEdge && edge >= minEdge);
  return [longestEdge, ...steps];
}
function nearestLadderEdge(ladder, wanted) {
  return ladder.reduce(
    (best, edge) => Math.abs(edge - wanted) < Math.abs(best - wanted) ? edge : best
  );
}
function candidateEdges(ladder, predictedEdge) {
  const center = ladder.indexOf(nearestLadderEdge(ladder, predictedEdge));
  return [center - 2, center - 1, center, center + 1, center + 2].filter((i) => i >= 0 && i < ladder.length).map((i) => ladder[i]);
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// src/lib/exact80/codecs/sharp.ts
import sharp from "sharp";
var EFFORT = 4;
var CHANNELS = 4;
function fromRaster(image) {
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: CHANNELS }
  });
}
async function toRaster(pipeline) {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}
var sharpCodec = {
  name: "sharp",
  /**
   * Decode once, applying EXIF rotation so every dimension downstream is what a
   * viewer would see. Metadata is not carried through raw pixels, so the GPS
   * coordinates in a phone photo are dropped here.
   */
  async decode(bytes) {
    return toRaster(sharp(bytes).rotate().ensureAlpha());
  },
  async resize(image, width, height) {
    return toRaster(
      fromRaster(image).resize({ width, height, fit: "fill", kernel: sharp.kernel.lanczos3 })
    );
  },
  async encode(image, format, quality) {
    const pipeline = fromRaster(image);
    const encoded = format === "webp" ? await pipeline.webp({ quality, effort: EFFORT, smartSubsample: true }).toBuffer() : await pipeline.avif({ quality, effort: EFFORT, chromaSubsampling: "4:2:0" }).toBuffer();
    return new Uint8Array(encoded);
  }
};

// src/cli/index.ts
var INPUT_EXTENSIONS = /* @__PURE__ */ new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff", ".gif"]);
var defaultIO = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text)
};
var USAGE = `exact80 \u2014 compress images to an exact byte size

Usage
  exact80 <files or directories...> [options]

Options
  --out <dir>        Where to write results (default: exact80-out)
  --format <fmt>     avif or webp (default: avif)
  --target <bytes>   Exact output size (default: ${EXACT80_BYTES})
  --json             Print one JSON object per image, for scripts
  --quiet            Only report failures
  --help             Show this

Examples
  exact80 photo.jpg
  exact80 ./images --format webp --out dist/images
  exact80 ./images --json > results.json
`;
function parseArgs(argv) {
  const options = {
    inputs: [],
    outDir: "exact80-out",
    format: "avif",
    target: EXACT80_BYTES,
    json: false,
    quiet: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        return null;
      case "--out":
        options.outDir = argv[++i];
        break;
      case "--format": {
        const value = argv[++i];
        if (value !== "avif" && value !== "webp") {
          throw new Error(`--format must be avif or webp, got "${value}"`);
        }
        options.format = value;
        break;
      }
      case "--target": {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 1024) {
          throw new Error("--target must be a whole number of bytes, at least 1024");
        }
        options.target = value;
        break;
      }
      case "--json":
        options.json = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option "${arg}"`);
        options.inputs.push(arg);
    }
  }
  return options.inputs.length > 0 ? options : null;
}
async function collect(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) return collect(child);
      return INPUT_EXTENSIONS.has(extname(entry.name).toLowerCase()) ? [child] : [];
    })
  );
  return found.flat();
}
var formatBytes = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
async function run(argv, io = defaultIO) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : error}

${USAGE}`);
    return 2;
  }
  if (!options) {
    io.out(USAGE);
    return argv.includes("--help") || argv.includes("-h") ? 0 : 2;
  }
  const files = (await Promise.all(options.inputs.map(collect))).flat();
  if (files.length === 0) {
    io.err("No images found.\n");
    return 1;
  }
  await mkdir(options.outDir, { recursive: true });
  let failures = 0;
  let savedBytes = 0;
  for (const file of files) {
    const started = Date.now();
    try {
      const input = await readFile(file);
      const result = await compressToExactSize(input, options.format, sharpCodec, {
        target: options.target
      });
      const name = `${basename(file, extname(file))}.${options.format}`;
      const outPath = join(options.outDir, name);
      await writeFile(outPath, result.data);
      savedBytes += input.length - result.bytes;
      if (options.json) {
        io.out(
          JSON.stringify({
            input: relative(process.cwd(), file),
            output: relative(process.cwd(), outPath),
            bytes: result.bytes,
            inputBytes: input.length,
            width: result.width,
            height: result.height,
            quality: result.quality,
            score: Number(result.score.toFixed(4)),
            ms: Date.now() - started
          }) + "\n"
        );
      } else if (!options.quiet) {
        io.out(
          `${relative(process.cwd(), file)} \u2192 ${outPath}  ${result.bytes} bytes  ${result.width}\xD7${result.height}  q${result.quality}  ${Date.now() - started}ms
`
        );
      }
    } catch (error) {
      failures++;
      io.err(
        `${relative(process.cwd(), file)}: ${error instanceof Error ? error.message : error}
`
      );
    }
  }
  if (!options.json && !options.quiet) {
    const done = files.length - failures;
    io.out(
      `
${done}/${files.length} image${files.length === 1 ? "" : "s"} at exactly ${options.target} bytes` + (savedBytes > 0 ? `, ${formatBytes(savedBytes)} saved
` : "\n")
    );
  }
  return failures > 0 ? 1 : 0;
}

// src/cli/bin.ts
run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}
`);
    process.exit(1);
  }
);
