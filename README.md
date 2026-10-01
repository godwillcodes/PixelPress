# PixelPress

**Every image, exactly 80 KB.**

Drop an image, get it back as WebP or AVIF at exactly 80,000 bytes — the best-looking version that fits. Compression runs in your browser; nothing is uploaded.

[pixelpress.vercel.app](https://pixelpress.vercel.app)

## Why exactly 80,000 bytes

Upload limits are real: a CMS field, an email, a marketplace listing, a performance budget. Most tools give you a quality slider and leave you to guess. This one takes the limit as the input.

The size is exact, not approximate. Encoders cannot be asked for a precise file size — a quality step moves the output by hundreds of bytes — so the engine encodes just under the target and closes the gap with a chunk decoders are required to skip:

| Format | Padding | Constraint |
|---|---|---|
| WebP | An unknown `PADD` RIFF chunk, with the RIFF size field corrected | RIFF chunks are word-aligned, so the gap must be even |
| AVIF | A top-level ISOBMFF `free` box | Any gap from 8 bytes up |

The pixels are untouched. Padded files decode identically in libwebp, libheif, macOS ImageIO (and so Safari) and Chromium — all four are verified, and the test suite asserts it.

## How it picks what fits

At a fixed budget there is one real trade-off: resolution against quality. Dropping quality alone is what makes "compressed to 80KB" look bad. A 2400×3600 photo forced into 80 KB at full size lands at quality 37 and the sky goes blotchy; the same photo at 800×1200 and quality 59 fits the same budget and looks clean.

So the search explores both axes:

1. One cheap probe predicts which resolution the budget allows.
2. Around that prediction, each candidate resolution is binary-searched for the highest quality that still fits.
3. Each resolution's winner is scored against the **full-size original** with SSIM, so detail a small candidate cannot reproduce counts against it.
4. The best-scoring candidate is padded up to exactly 80,000 bytes.

Step 3 is the one that matters. Two findings from building it are worth knowing:

- **Scoring at a small shared size inverts the result.** It judges a 512px candidate on 512px of detail, scores it near-perfect, and the search shrinks every image as far as it can.
- **SSIM under-penalizes blocking.** It ranks a noisy 1600px/q37 encode above a clean 1200px/q59 one. The quality floor of 45 is the guard against that, and is the one setting with taste rather than math behind it. SSIMULACRA2 would settle it properly and needs a WASM build.

Both formats are always encoded, because which one holds up better at 80 KB changes per image — AVIF usually wins on photographs, WebP often wins on screenshots and text.

## Running it

```bash
pnpm install
pnpm dev
```

```bash
pnpm test
```

The tests cover byte-exactness and decodability on every path, plus the inputs that break naive engines: tiny images, transparency, pure noise, extreme aspect ratios, EXIF-rotated phone photos, and GPS metadata stripping.

## How it is put together

| Path | What it does |
|---|---|
| `src/lib/exact80/core/` | The engine: search, padding, SSIM. No codec, no platform. |
| `src/lib/exact80/codecs/` | Two backends behind one `Codec` interface: sharp (tests, any server use) and the browser's WASM codecs. |
| `src/lib/exact80/pool.ts` | A worker per image, so a batch uses every core and the page stays responsive. |
| `src/workers/` | Where a search actually runs in the browser. |
| `scripts/build-codecs.mjs` | Pre-bundles the WASM codecs into `public/codecs/`. |

The codecs are deliberately kept out of the app bundler. jSquash ships Emscripten glue that declares a top-level `Module`, and two of those in one scope fail at runtime with *"Identifier 'Module' has already been declared"* — which is what Turbopack does with them. They are bundled separately by `pnpm build:codecs` (which `dev` and `build` run first) and loaded at runtime from `/codecs`, so roughly 4 MB of WebAssembly never loads for someone who does not compress anything.

Decoding uses the browser's own pipeline rather than a WASM decoder: it is faster, it opens every format the browser supports, and it applies the EXIF rotation phone photos carry. Encoding needs WASM because browsers offer no control over quality, and this is entirely about control.

## Limits

- HEIC works only where the browser can decode it, which today means Safari.
- Animated GIFs are not supported; only the first frame would survive.
- An image already under 80,000 bytes is padded up to the number rather than left small, because the exact size is the point.

## License

MIT
