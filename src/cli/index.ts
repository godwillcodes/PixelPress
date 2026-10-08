/**
 * exact80 — compress images to exactly 80,000 bytes from the command line.
 *
 * The same engine the website runs, on the sharp backend. Built to a single
 * file by `pnpm build:cli`, which is what the `exact80` bin and the GitHub
 * Action both execute.
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { compressToExactSize, EXACT80_BYTES } from '../lib/exact80/core/search';
import { sharpCodec } from '../lib/exact80/codecs/sharp';
import type { OutputFormat } from '../lib/exact80/core/types';
import { uniqueName } from '../lib/exact80/core/names';

const INPUT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.gif']);

/**
 * Where output goes. Injected rather than written straight to process.stdout so
 * tests can read it without hijacking the streams the test runner is using.
 */
export interface CliIO {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIO: CliIO = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
};

interface Options {
  inputs: string[];
  outDir: string;
  format: OutputFormat;
  target: number;
  json: boolean;
  quiet: boolean;
}

const USAGE = `exact80 — compress images to an exact byte size

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

function parseArgs(argv: string[]): Options | null {
  const options: Options = {
    inputs: [],
    outDir: 'exact80-out',
    format: 'avif',
    target: EXACT80_BYTES,
    json: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--help':
      case '-h':
        return null;
      case '--out':
        options.outDir = argv[++i];
        break;
      case '--format': {
        const value = argv[++i];
        if (value !== 'avif' && value !== 'webp') {
          throw new Error(`--format must be avif or webp, got "${value}"`);
        }
        options.format = value;
        break;
      }
      case '--target': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 1024) {
          throw new Error('--target must be a whole number of bytes, at least 1024');
        }
        options.target = value;
        break;
      }
      case '--json':
        options.json = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option "${arg}"`);
        options.inputs.push(arg);
    }
  }

  return options.inputs.length > 0 ? options : null;
}

/** Every image under a path, whether that path is a file or a directory. */
async function collect(path: string): Promise<string[]> {
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

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

export async function run(argv: string[], io: CliIO = defaultIO): Promise<number> {
  let options: Options | null;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : error}\n\n${USAGE}`);
    return 2;
  }

  if (!options) {
    io.out(USAGE);
    return argv.includes('--help') || argv.includes('-h') ? 0 : 2;
  }

  const files = (await Promise.all(options.inputs.map(collect))).flat();
  if (files.length === 0) {
    io.err('No images found.\n');
    return 1;
  }

  await mkdir(options.outDir, { recursive: true });

  let failures = 0;
  let savedBytes = 0;
  // A directory walk can turn a/logo.png and b/logo.png into one output name,
  // as can photo.jpg and photo.png side by side. Without this the second write
  // replaces the first and the run still reports both as done.
  const written = new Set<string>();

  for (const file of files) {
    const started = Date.now();

    try {
      const input = await readFile(file);
      const result = await compressToExactSize(input, options.format, sharpCodec, {
        target: options.target,
      });

      const name = uniqueName(written, `${basename(file, extname(file))}.${options.format}`);
      written.add(name);
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
            ms: Date.now() - started,
          }) + '\n'
        );
      } else if (!options.quiet) {
        io.out(
          `${relative(process.cwd(), file)} → ${outPath}  ` +
            `${result.bytes} bytes  ${result.width}×${result.height}  q${result.quality}  ` +
            `${Date.now() - started}ms\n`
        );
      }
    } catch (error) {
      failures++;
      io.err(
        `${relative(process.cwd(), file)}: ${error instanceof Error ? error.message : error}\n`
      );
    }
  }

  if (!options.json && !options.quiet) {
    const done = files.length - failures;
    io.out(
      `\n${done}/${files.length} image${files.length === 1 ? '' : 's'} at exactly ${options.target} bytes` +
        (savedBytes > 0 ? `, ${formatBytes(savedBytes)} saved\n` : '\n')
    );
  }

  return failures > 0 ? 1 : 0;
}

/** Resolve paths relative to the caller, so the bin works from anywhere. */
export const resolveInput = (path: string) => resolve(process.cwd(), path);
