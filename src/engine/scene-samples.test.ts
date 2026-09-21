import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneSampleCount } from './scene-samples';

test('a level without a threshold keeps the renderer samples at any size', () => {
  assert.equal(sceneSampleCount(4, 5120, 2880, undefined), 4);
  assert.equal(sceneSampleCount(0, 1280, 720, undefined), 0);
});

test('multisamples up to and including the threshold, and not above it', () => {
  const max = 9_000_000;
  assert.equal(sceneSampleCount(4, 3840, 2160, max), 4);
  assert.equal(sceneSampleCount(4, 3000, 3000, max), 4);
  assert.equal(sceneSampleCount(4, 3000, 3001, max), 0);
  assert.equal(sceneSampleCount(4, 5120, 2880, max), 0);
});

test('a renderer built without MSAA stays single-sampled under the threshold', () => {
  assert.equal(sceneSampleCount(0, 1280, 720, 9_000_000), 0);
});
