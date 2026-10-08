/**
 * Bundles the CLI to a single file in dist/.
 *
 * sharp stays external: it ships native binaries that cannot be bundled, and it
 * is the one runtime dependency the CLI has.
 */

import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'dist', 'exact80.mjs');

await build({
  entryPoints: [join(root, 'src', 'cli', 'bin.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['sharp'],
  // The shebang comes from src/cli/bin.ts; a banner here would duplicate it.
  logLevel: 'warning',
});

await chmod(outfile, 0o755);
console.log(`cli: ${outfile}`);
