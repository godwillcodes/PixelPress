/**
 * The Action's metadata, checked as data.
 *
 * This file is never executed locally, and the one time it mattered it was
 * unparseable — an unquoted description containing "pull-requests: write" reads
 * as a YAML mapping, which GitHub rejects before any step runs. Nothing in the
 * repository would have noticed. Now something does.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

interface ActionMetadata {
  name: string;
  description: string;
  inputs: Record<string, { description: string; default?: string; required?: boolean }>;
  outputs: Record<string, { description: string; value: string }>;
  runs: { using: string; steps: Array<{ name?: string; run?: string; shell?: string; id?: string }> };
}

let action: ActionMetadata;
let actionSource: string;

before(async () => {
  actionSource = await readFile('action.yml', 'utf8');
  action = parse(actionSource) as ActionMetadata;
});

describe('action.yml', () => {
  test('parses as YAML at all', () => {
    // The whole point of this file: if this throws, the Action is dead on
    // arrival for everyone using it.
    assert.ok(action, 'action.yml must parse');
    assert.equal(typeof action.name, 'string');
  });

  test('every description is a string, not an accidental mapping', () => {
    for (const [name, input] of Object.entries(action.inputs)) {
      assert.equal(typeof input.description, 'string', `inputs.${name}.description`);
    }
    for (const [name, output] of Object.entries(action.outputs)) {
      assert.equal(typeof output.description, 'string', `outputs.${name}.description`);
    }
  });

  test('declares the inputs and outputs the README documents', () => {
    assert.deepEqual(Object.keys(action.inputs).sort(), [
      'comment',
      'fail-on-error',
      'format',
      'out',
      'paths',
      'target',
    ]);
    assert.deepEqual(Object.keys(action.outputs).sort(), ['count', 'results', 'saved-bytes']);
    assert.equal(action.inputs.target.default, '80000');
  });

  test('runs the committed bundle and the report script', () => {
    const script = action.runs.steps.map((step) => step.run ?? '').join('\n');

    assert.equal(action.runs.using, 'composite');
    assert.match(script, /dist\/exact80\.mjs/, 'must run the committed CLI bundle');
    assert.match(script, /scripts\/action-report\.mjs/, 'must write the summary and comment');
    assert.match(script, /npm install .*sharp/, 'sharp cannot be bundled, so it must be installed');
  });
});

describe('the CI workflow', () => {
  test('parses, and runs the checks it claims to', async () => {
    const workflow = parse(await readFile('.github/workflows/ci.yml', 'utf8')) as {
      jobs: Record<string, { steps: Array<{ run?: string }> }>;
    };

    const script = Object.values(workflow.jobs)
      .flatMap((job) => job.steps.map((step) => step.run ?? ''))
      .join('\n');

    assert.match(script, /pnpm test/);
    assert.match(script, /tsc --noEmit/);
    assert.match(script, /pnpm build/);
    assert.match(script, /git diff --exit-code dist\/exact80\.mjs/, 'bundle freshness is checked');
  });
});
