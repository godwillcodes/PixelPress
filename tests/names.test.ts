/**
 * Name collisions lose images silently, in the ZIP and on disk, so the rule
 * that prevents them is worth pinning down.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueName } from '../src/lib/exact80/core/names';

describe('uniqueName', () => {
  test('leaves a free name alone', () => {
    assert.equal(uniqueName(new Set(), 'photo.webp'), 'photo.webp');
  });

  test('counts up before the extension, not after it', () => {
    const taken = new Set(['photo.webp']);
    assert.equal(uniqueName(taken, 'photo.webp'), 'photo-2.webp');
  });

  test('keeps counting past an existing counter', () => {
    const taken = new Set(['photo.webp', 'photo-2.webp', 'photo-3.webp']);
    assert.equal(uniqueName(taken, 'photo.webp'), 'photo-4.webp');
  });

  test('handles a name with no extension', () => {
    assert.equal(uniqueName(new Set(['photo']), 'photo'), 'photo-2');
  });

  test('treats a dotfile as a name, not an extension', () => {
    assert.equal(uniqueName(new Set(['.gitignore']), '.gitignore'), '.gitignore-2');
  });

  test('a sequence of identical names stays distinct', () => {
    const taken = new Set<string>();
    const names = ['a.webp', 'a.webp', 'a.webp', 'a.webp'].map((name) => {
      const unique = uniqueName(taken, name);
      taken.add(unique);
      return unique;
    });

    assert.deepEqual(names, ['a.webp', 'a-2.webp', 'a-3.webp', 'a-4.webp']);
    assert.equal(new Set(names).size, names.length);
  });
});
