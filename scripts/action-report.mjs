/**
 * Turns the CLI's JSON Lines output into what a reviewer sees: a job summary,
 * the action's outputs, and the body of the pull request comment.
 *
 * Kept separate from action.yml so it can be read, and tested, as code.
 *
 *   node scripts/action-report.mjs <results.jsonl> [targetBytes]
 */

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [, , resultsPath, targetArg] = process.argv;
const target = Number(targetArg) || 80_000;

const formatBytes = (bytes) => {
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${sign}${(abs / 1024 / 1024).toFixed(1)} MB`;
  if (abs >= 1024) return `${sign}${Math.round(abs / 1024)} KB`;
  return `${sign}${abs} B`;
};

const raw = await readFile(resultsPath, 'utf8').catch(() => '');
const records = raw
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const savedBytes = records.reduce((sum, r) => sum + (r.inputBytes - r.bytes), 0);
const grew = records.filter((r) => r.bytes > r.inputBytes);

const lines = [
  `### Exact80 — ${records.length} image${records.length === 1 ? '' : 's'} at exactly ${target.toLocaleString('en-US')} bytes`,
  '',
  records.length > 0 ? `**${formatBytes(savedBytes)}** saved in total.` : 'No images were compressed.',
  '',
];

if (records.length > 0) {
  lines.push(
    '| Image | Before | After | Dimensions | Quality |',
    '| --- | --- | --- | --- | --- |',
    // "After" is the exact byte count, not a rounded KB figure: the exactness
    // is the point, and "78 KB" reads like it missed.
    ...records.map(
      (r) =>
        `| \`${r.input}\` | ${formatBytes(r.inputBytes)} | ${r.bytes.toLocaleString('en-US')} B | ${r.width}×${r.height} | ${r.quality} |`
    ),
    ''
  );
}

// An image already under the target is padded up to it, which makes it bigger.
// Saying so is better than a reviewer noticing a file grew and not knowing why.
if (grew.length > 0) {
  lines.push(
    `${grew.length} image${grew.length === 1 ? ' was' : 's were'} already smaller than the target and ` +
      `${grew.length === 1 ? 'was' : 'were'} padded up to it.`,
    ''
  );
}

const body = lines.join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, body + '\n');
}

if (process.env.RUNNER_TEMP) {
  await writeFile(join(process.env.RUNNER_TEMP, 'exact80-comment.md'), body + '\n');
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [`saved-bytes=${savedBytes}`, `count=${records.length}`, `results=${resultsPath}`].join('\n') + '\n'
  );
}

process.stdout.write(body + '\n');
