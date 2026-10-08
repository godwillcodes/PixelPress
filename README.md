# Exact80

**Every image, exactly 80 KB.**

Drop an image, get it back as WebP or AVIF at exactly 80,000 bytes — the best-looking version that fits. In the browser, from a terminal, over HTTP, or in a pull request.

[exact80.vercel.app](https://exact80.vercel.app) · [See what 80 KB looks like](https://exact80.vercel.app/gallery)

```bash
npx exact80 ./images --format webp
```

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

Both formats are always encoded, because which one holds up at 80 KB changes per image. AVIF usually wins on photographs; WebP often wins on screenshots, where it keeps more resolution for text.

## The website

Compression runs in Web Workers on the viewer's machine. Nothing is uploaded, there is no queue, and the page is static. Drop or paste images, compare each result against the original, download the one that looks better, or take the lot as a ZIP.

## The command line

```bash
npx exact80 <files or directories...> [options]
```

| Option | Default | What it does |
|---|---|---|
| `--out <dir>` | `exact80-out` | Where to write results |
| `--format <fmt>` | `avif` | `avif` or `webp` |
| `--target <bytes>` | `80000` | A different exact size |
| `--json` | off | One JSON object per image, for scripts |
| `--quiet` | off | Only report failures |

```bash
exact80 ./images --format webp --out dist/images
exact80 ./images --json > results.json
```

Exit codes: `0` all good, `1` some image failed, `2` bad usage.

## The API

```bash
curl -X POST https://exact80.vercel.app/api/compress \
  -F image=@photo.jpg \
  -F format=avif \
  -o photo.avif
```

| Field | Required | Default |
|---|---|---|
| `image` | yes | — |
| `format` | no | `avif` |
| `target` | no | `80000` |

The response is the image itself, with `X-Exact80-Bytes`, `-Width`, `-Height`, `-Quality`, `-Score` and `-Ms` headers describing it. `GET /api/compress` returns the same summary as JSON.

Inputs are capped at 25 MB and callers at 12 requests a minute — enforced per serverless instance, so it is a courtesy limit, not a quota. For anything bigger, use the CLI: it runs on your machine with no limits.

## The GitHub Action

Compress the images in a pull request and comment with what it saved.

```yaml
name: Images
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  exact80:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: godwillcodes/PixelPress@main
        with:
          paths: public/images
          format: avif
          comment: 'true'
```

| Input | Default | |
|---|---|---|
| `paths` | `images` | Files or directories, space separated |
| `format` | `avif` | `avif` or `webp` |
| `target` | `80000` | Exact output size |
| `out` | `exact80-out` | Where results are written |
| `comment` | `false` | Comment the table on the PR |
| `fail-on-error` | `true` | Fail the job if an image could not be compressed |

Outputs: `saved-bytes`, `count`, `results` (a JSON Lines file).

## Running it yourself

```bash
pnpm install
pnpm dev
```

```bash
pnpm test           # 38 tests: engine, padding, CLI, API
pnpm build:gallery  # regenerate the gallery from the engine
pnpm build:cli      # rebuild dist/exact80.mjs
```

The tests cover byte-exactness and decodability on every path, plus the inputs that break naive engines: tiny images, transparency, pure noise, extreme aspect ratios, EXIF-rotated phone photos, and GPS metadata stripping.

## How it is put together

| Path | What it does |
|---|---|
| `src/lib/exact80/core/` | The engine: search, padding, SSIM. No codec, no platform. |
| `src/lib/exact80/codecs/` | Two backends behind one `Codec` interface: sharp (CLI, API, tests) and the browser's WASM codecs. |
| `src/lib/exact80/pool.ts` | A worker per image, so a batch uses every core and the page stays responsive. |
| `src/cli/` | The command line, bundled to `dist/exact80.mjs`. |
| `src/app/api/compress/` | The HTTP endpoint and its rate limit. |
| `scripts/` | Codec bundling, gallery generation, the Action's report. |

The codecs are deliberately kept out of the app bundler. jSquash ships Emscripten glue that declares a top-level `Module`, and two of those in one scope fail at runtime with *"Identifier 'Module' has already been declared"* — which is what Turbopack does with them. They are bundled separately by `pnpm build:codecs` (which `dev` and `build` run first) and loaded at runtime from `/codecs`, so roughly 4 MB of WebAssembly never loads for someone who does not compress anything.

Decoding in the browser uses the browser's own pipeline rather than a WASM decoder: it is faster, it opens every format the browser supports, and it applies the EXIF rotation phone photos carry. Encoding needs WASM because browsers offer no control over quality, and this is entirely about control.

`dist/exact80.mjs` is committed, because the GitHub Action runs it straight from the repository — as JavaScript actions must. CI fails if it drifts from the source.

## Limits

- HEIC works only where the browser can decode it, which today means Safari. The CLI and API handle whatever sharp supports.
- Animated GIFs are not supported; only the first frame would survive.
- An image already under 80,000 bytes is padded up to the number rather than left small, because the exact size is the point.

## License

MIT
