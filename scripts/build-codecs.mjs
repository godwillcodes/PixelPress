/**
 * Pre-bundle the WASM codecs into standalone ES modules under public/codecs/.
 *
 * The app bundler cannot be trusted with them. jSquash ships Emscripten glue
 * that declares a top-level `Module`, and more than one of those files in a
 * single scope produces "Identifier 'Module' has already been declared" at
 * runtime — which is exactly what Turbopack does with them. Bundling each codec
 * separately with esbuild gives each one its own scope and its own file, and the
 * app then loads them at runtime with an ignore comment so no bundler touches
 * them again.
 *
 * The glue finds its .wasm with `new URL('name.wasm', import.meta.url)`, so the
 * binaries are copied next to the bundles that reference them.
 *
 * Run with `pnpm build:codecs`; `pnpm dev` and `pnpm build` run it first.
 */

import { build } from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'codecs');
const modules = join(root, 'node_modules', '@jsquash');

/** Each entry becomes one self-contained module in public/codecs/. */
const CODECS = [
  { out: 'webp-encode.js', entry: join(modules, 'webp/encode.js') },
  { out: 'avif-encode.js', entry: join(modules, 'avif/encode.js') },
  { out: 'resize.js', entry: join(modules, 'resize/index.js') },
];

/** Directories whose .wasm files the bundles fetch at runtime. */
const WASM_SOURCES = [
  join(modules, 'webp/codec/enc'),
  join(modules, 'avif/codec/enc'),
  join(modules, 'resize/lib/resize/pkg'),
  join(modules, 'resize/lib/hqx/pkg'),
  join(modules, 'resize/lib/magic-kernel/pkg'),
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const { out, entry } of CODECS) {
  await build({
    entryPoints: [entry],
    outfile: join(outDir, out),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    // Left as a runtime URL so the glue fetches the binary we copy below,
    // rather than esbuild inlining or renaming it.
    external: ['*.wasm'],
    logLevel: 'warning',
  });
}

let copied = 0;
for (const source of WASM_SOURCES) {
  for (const file of await readdir(source)) {
    if (!file.endsWith('.wasm')) continue;
    await cp(join(source, file), join(outDir, file));
    copied++;
  }
}

console.log(`codecs: ${CODECS.length} modules, ${copied} wasm binaries -> public/codecs/`);
