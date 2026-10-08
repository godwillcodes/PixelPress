/**
 * Builds the gallery: real engine output for a handful of representative
 * images, committed so the page is static and the numbers cannot drift from
 * what the engine actually does.
 *
 * Everything here is produced by the same search the app runs — nothing is
 * hand-picked or touched up. Re-run with `pnpm build:gallery` after changing
 * the engine, and commit the result.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { compressToExactSize, EXACT80_BYTES } from '../src/lib/exact80/core/search';
import { sharpCodec } from '../src/lib/exact80/codecs/sharp';
import type { OutputFormat } from '../src/lib/exact80/core/types';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'public', 'gallery');
const manifestPath = join(root, 'src', 'app', 'gallery', 'samples.json');

/** The original shown in the comparison, kept small enough to load quickly. */
const PREVIEW_EDGE = 1400;

interface Sample {
  slug: string;
  title: string;
  /** What kind of image this stands in for, and why it is interesting. */
  note: string;
  credit?: string;
  source: () => Promise<Buffer>;
}

/** A page of text: the hardest thing to compress without turning it to mush. */
async function screenshotSource(): Promise<Buffer> {
  const lines = [
    'const result = await compressToExactSize(input, "avif", codec);',
    '',
    '// Every candidate resolution is binary-searched for the highest',
    '// quality that still fits, then scored against the original.',
    'console.log(result.bytes);       // 80000',
    'console.log(result.width);       // 800',
    'console.log(result.quality);     // 56',
    'console.log(result.padBytes);    // 3672',
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1600">
    <rect width="2560" height="1600" fill="#ffffff"/>
    <rect x="0" y="0" width="2560" height="72" fill="#f4f4f5"/>
    <text x="48" y="46" font-family="Helvetica, Arial" font-size="24" fill="#52525b">search.ts</text>
    ${lines
      .map(
        (line, i) =>
          `<text x="48" y="${150 + i * 54}" font-family="Menlo, monospace" font-size="30" fill="${
            line.startsWith('//') ? '#15803d' : '#18181b'
          }">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
      )
      .join('')}
    ${Array.from({ length: 22 }, (_, i) => `<rect x="48" y="${700 + i * 40}" width="${400 + ((i * 137) % 1800)}" height="14" rx="7" fill="#e4e4e7"/>`).join('')}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Flat colour and hard edges, where banding shows up first. */
async function illustrationSource(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1e3a8a"/><stop offset="60%" stop-color="#7c3aed"/>
        <stop offset="100%" stop-color="#f97316"/>
      </linearGradient>
    </defs>
    <rect width="2400" height="1600" fill="url(#sky)"/>
    <circle cx="1800" cy="380" r="180" fill="#fde68a"/>
    <path d="M0 1200 L600 680 L1040 1200 Z" fill="#0f172a"/>
    <path d="M800 1200 L1460 600 L2130 1200 Z" fill="#1e293b"/>
    <rect x="0" y="1200" width="2400" height="400" fill="#020617"/>
    ${Array.from({ length: 900 }, (_, i) => `<circle cx="${(i * 577) % 2400}" cy="${1200 + ((i * 331) % 400)}" r="${1 + (i % 3)}" fill="#334155" opacity="0.7"/>`).join('')}
    ${Array.from({ length: 260 }, (_, i) => `<circle cx="${(i * 211) % 2400}" cy="${(i * 97) % 560}" r="${2 + (i % 3)}" fill="#ffffff" opacity="0.85"/>`).join('')}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Transparency, which both formats have to carry through the budget. */
async function transparencySource(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000">
    <circle cx="1000" cy="1000" r="700" fill="#0ea5e9" opacity="0.85"/>
    ${Array.from({ length: 600 }, (_, i) => `<circle cx="${(i * 419) % 2000}" cy="${(i * 263) % 2000}" r="${3 + (i % 7)}" fill="#ffffff" opacity="${0.1 + ((i % 9) / 20)}"/>`).join('')}
    <circle cx="720" cy="780" r="430" fill="#f43f5e" opacity="0.7"/>
    <circle cx="1300" cy="1200" r="500" fill="#22c55e" opacity="0.6"/>
    <text x="1000" y="1070" font-family="Helvetica, Arial" font-size="260" font-weight="bold"
      fill="#ffffff" text-anchor="middle">80</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

const SAMPLES: Sample[] = [
  {
    slug: 'photograph',
    title: 'Photograph',
    note: 'A 2400×3600 beach scene, 2.0 MB. Far more detail than the budget holds, so the search trades resolution for a clean image.',
    credit: 'Photo by Merve Kalafat Yılmaz on Unsplash',
    source: () => readFile(join(root, 'public', 'merve-kalafat-yilmaz-7B3TPCkHhYw-unsplash.jpg')),
  },
  {
    slug: 'screenshot',
    title: 'Screenshot',
    note: 'A 2560×1600 capture. Text is the hardest thing to keep legible on a budget, and the two formats disagree about how to spend the bytes.',
    source: screenshotSource,
  },
  {
    slug: 'illustration',
    title: 'Illustration',
    note: 'Flat colour and a long gradient — the case where over-compression shows up as banding across the sky.',
    source: illustrationSource,
  },
  {
    slug: 'transparency',
    title: 'Transparency',
    note: 'An alpha channel has to survive the budget too, and it is not free: both formats spend bytes on it.',
    source: transparencySource,
  },
];

interface Output {
  width: number;
  height: number;
  quality: number;
  score: number;
  encodes: number;
  ms: number;
  file: string;
}

await mkdir(outDir, { recursive: true });

const manifest = [];

for (const sample of SAMPLES) {
  const input = await sample.source();
  const meta = await sharp(input).metadata();
  const hasAlpha = Boolean(meta.hasAlpha);

  // The "before" image: the original, shrunk only enough to load quickly, at a
  // quality high enough that it is not itself the thing you are judging.
  const previewFile = `${sample.slug}-original.${hasAlpha ? 'png' : 'jpg'}`;
  const preview = sharp(input).resize({
    width: PREVIEW_EDGE,
    height: PREVIEW_EDGE,
    fit: 'inside',
    withoutEnlargement: true,
  });
  await (hasAlpha ? preview.png({ compressionLevel: 9 }) : preview.jpeg({ quality: 92 })).toFile(
    join(outDir, previewFile)
  );

  const outputs: Partial<Record<OutputFormat, Output>> = {};
  for (const format of ['avif', 'webp'] as const) {
    const result = await compressToExactSize(input, format, sharpCodec);
    const file = `${sample.slug}.${format}`;
    await writeFile(join(outDir, file), result.data);

    outputs[format] = {
      width: result.width,
      height: result.height,
      quality: result.quality,
      score: Number(result.score.toFixed(4)),
      encodes: result.encodes,
      ms: result.ms,
      file: `/gallery/${file}`,
    };
    console.log(
      `${sample.slug} ${format}: ${result.bytes}B ${result.width}x${result.height} q${result.quality} ssim=${result.score.toFixed(3)} ${result.ms}ms`
    );
  }

  manifest.push({
    slug: sample.slug,
    title: sample.title,
    note: sample.note,
    credit: sample.credit ?? null,
    sourceBytes: input.length,
    sourceWidth: meta.width ?? 0,
    sourceHeight: meta.height ?? 0,
    previewFile: `/gallery/${previewFile}`,
    outputs,
  });
}

await writeFile(
  manifestPath,
  JSON.stringify({ targetBytes: EXACT80_BYTES, generated: new Date().toISOString(), samples: manifest }, null, 2) + '\n'
);

console.log(`\ngallery: ${manifest.length} samples -> public/gallery/ and ${manifestPath}`);
