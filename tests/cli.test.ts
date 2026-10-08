/**
 * The CLI is what the GitHub Action runs and what anyone scripting this uses,
 * so its contract — exact bytes out, sane exit codes, parsable JSON — is worth
 * holding still.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { run } from '../src/cli/index';

const EXACT = 80_000;

let workDir: string;
let photo: string;
let graphic: string;

/** Collect what the CLI writes, through the sink it takes for exactly this. */
async function capture(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, { out: (text) => out.push(text), err: (text) => err.push(text) });

  return { code, out: out.join(''), err: err.join('') };
}

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'exact80-cli-'));

  const inputs = join(workDir, 'in');
  await mkdir(inputs, { recursive: true });

  photo = join(inputs, 'photo.jpg');
  graphic = join(inputs, 'graphic.png');

  // Noise, so it cannot trivially fit and the search has to work.
  const noise = Buffer.alloc(1400 * 1000 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
  await sharp(noise, { raw: { width: 1400, height: 1000, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(photo);

  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2563eb' } })
    .png()
    .toFile(graphic);

  await writeFile(join(inputs, 'notes.txt'), 'not an image');
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('exact80 CLI', () => {
  test('compresses a directory, skipping files that are not images', async () => {
    const outDir = join(workDir, 'out-dir');
    const { code, out } = await capture([join(workDir, 'in'), '--format', 'webp', '--out', outDir]);

    assert.equal(code, 0);

    const written = (await readdir(outDir)).sort();
    assert.deepEqual(written, ['graphic.webp', 'photo.webp'], 'notes.txt must be ignored');

    for (const file of written) {
      const info = await stat(join(outDir, file));
      assert.equal(info.size, EXACT, `${file} must be exactly ${EXACT} bytes`);
    }

    assert.match(out, /2\/2 images at exactly 80000 bytes/);
  });

  test('--json prints one parsable line per image', async () => {
    const outDir = join(workDir, 'out-json');
    const { code, out } = await capture([photo, '--json', '--out', outDir]);

    assert.equal(code, 0);

    const lines = out.trim().split('\n');
    assert.equal(lines.length, 1);

    const record = JSON.parse(lines[0]);
    assert.equal(record.bytes, EXACT);
    assert.ok(record.width > 0 && record.height > 0);
    assert.ok(record.quality >= 45);
    assert.ok(record.score > 0 && record.score <= 1);
  });

  test('--target sets a different exact size', async () => {
    const outDir = join(workDir, 'out-target');
    const { code } = await capture([graphic, '--target', '20000', '--out', outDir, '--quiet']);

    assert.equal(code, 0);
    const info = await stat(join(outDir, 'graphic.avif'));
    assert.equal(info.size, 20_000);
  });

  test('rejects a format it cannot write', async () => {
    const { code, err } = await capture([photo, '--format', 'jpeg']);

    assert.equal(code, 2, 'bad usage exits 2');
    assert.match(err, /--format must be avif or webp/);
  });

  test('reports a file it cannot read and exits non-zero', async () => {
    const broken = join(workDir, 'broken.png');
    await writeFile(broken, 'this is not a png');

    const { code, err } = await capture([broken, '--out', join(workDir, 'out-broken')]);

    assert.equal(code, 1);
    assert.match(err, /broken\.png/);
  });

  test('keeps both images when two inputs want the same output name', async () => {
    // a/logo.png and b/logo.png, plus photo.jpg beside photo.png: all three
    // used to collapse onto one output file, silently.
    const nested = join(workDir, 'nested');
    await mkdir(join(nested, 'a'), { recursive: true });
    await mkdir(join(nested, 'b'), { recursive: true });

    const square = (colour: string) =>
      sharp({ create: { width: 400, height: 400, channels: 3, background: colour } });
    await square('#f00').png().toFile(join(nested, 'a', 'logo.png'));
    await square('#0f0').png().toFile(join(nested, 'b', 'logo.png'));
    await square('#00f').jpeg().toFile(join(nested, 'logo.jpg'));

    const outDir = join(workDir, 'out-collision');
    const { code } = await capture([nested, '--out', outDir, '--quiet']);

    assert.equal(code, 0);

    const written = (await readdir(outDir)).sort();
    assert.equal(written.length, 3, `expected three files, got ${written.join(', ')}`);
    assert.deepEqual(written, ['logo-2.avif', 'logo-3.avif', 'logo.avif']);

    for (const file of written) {
      assert.equal((await stat(join(outDir, file))).size, EXACT);
    }
  });

  test('says so when there is nothing to do', async () => {
    const empty = join(workDir, 'empty');
    await mkdir(empty, { recursive: true });

    const { code, err } = await capture([empty]);

    assert.equal(code, 1);
    assert.match(err, /No images found/);
  });

  test('the output of a run is a real image at the stated size', async () => {
    const outDir = join(workDir, 'out-verify');
    await capture([photo, '--out', outDir, '--quiet']);

    const data = await readFile(join(outDir, 'photo.avif'));
    const meta = await sharp(data).metadata();

    assert.equal(data.length, EXACT);
    assert.ok(meta.width && meta.width > 0);
    // Decoding every pixel proves the padding did not corrupt the file.
    assert.ok((await sharp(data).raw().toBuffer()).length > 0);
  });
});
