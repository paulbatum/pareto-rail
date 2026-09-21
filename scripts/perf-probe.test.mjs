import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, gateGpuSamples, parseArgs, requestedTimes } from './perf-probe.mjs';

test('parses start-screen defaults and deterministic probe options', () => {
  const options = parseArgs(['--level', 'demo', '--gpu', '--start-screen', '--freeze', '--warmup', '3', '--repeats', '2', '--max-gpu-ms', '4']);
  assert.equal(options.startScreen, true);
  assert.equal(options.freeze, true);
  assert.equal(options.warmupFrames, 3);
  assert.equal(options.repeats, 2);
  assert.equal(options.maxGpuMs, 4);
  assert.deepEqual(options.times, []);
  assert.deepEqual(requestedTimes(options, { sections: [{ name: 'run', time: 4 }], duration: 10 }), [0.8]);
});

test('--no-msaa turns multisampling off, and the report names it and the effective scene samples', () => {
  assert.equal(parseArgs(['--level', 'demo']).msaa, true);
  const options = parseArgs(['--level', 'demo', '--no-msaa']);
  assert.equal(options.msaa, false);
  const output = formatReport({
    level: { id: 'demo' },
    metadata: { renderSize: { width: 10, height: 10, multisampled: false, samples: 0 } },
    options: { ...options, backend: 'webgpu', width: 10, height: 10 },
    samples: [],
  });
  assert.match(output, /msaa off/);
  assert.match(output, /scene MSAA off/);
  assert.match(formatReport({ level: { id: 'demo' }, metadata: { renderSize: { samples: 4 } }, options: parseArgs(['--level', 'demo']), samples: [] }), /scene MSAA 4x/);
});

test('accepts an ordered finite non-negative time list', () => {
  assert.deepEqual(parseArgs(['--level', 'demo', '--times', '0,0.5,2']).times, [0, 0.5, 2]);
});

test('rejects invalid flags and malformed time values', () => {
  assert.throws(() => parseArgs(['--level', 'demo', '--dt', '0']), /positive number/);
  assert.throws(() => parseArgs(['--level', 'demo', '--seed', '1.2']), /integer/);
  assert.throws(() => parseArgs(['--level', 'demo', '--times', '1,0']), /ordered/);
  assert.throws(() => parseArgs(['--level', 'demo', '--times', '0,wat']), /finite/);
  assert.throws(() => parseArgs(['--level', 'demo', '--repeats', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--software', '--max-gpu-ms', '4']), /requires --gpu/);
  for (const value of ['', '1,', 'Infinity', '-1']) {
    assert.throws(() => parseArgs(['--times', value]));
  }
});

test('GPU budget gate passes, fails over-budget, and fails missing timestamps', () => {
  const samples = [
    { requestedTime: 0.8, repeat: 1, frames: 4, gpuSamples: 4, gpuTotalMs: 3 },
    { requestedTime: 0.8, repeat: 2, frames: 4, gpuSamples: 4, gpuTotalMs: 5 },
    { requestedTime: 1.2, repeat: 1, frames: 4, gpuSamples: 3, gpuTotalMs: null },
  ];
  assert.deepEqual(gateGpuSamples([samples[0]], 4), []);
  assert.equal(gateGpuSamples(samples, 4).length, 2);
  assert.match(gateGpuSamples([samples[1]], 4)[0], /exceeds/);
  assert.match(gateGpuSamples([samples[2]], 4)[0], /missing GPU timestamps/);
  assert.equal(gateGpuSamples([], 4).length, 1);
  assert.equal(gateGpuSamples([{ frames: 4, gpuTotalMs: 2 }], 4).length, 1);
  assert.equal(gateGpuSamples([{ frames: 0, gpuSamples: 0, gpuTotalMs: 0 }], 4).length, 1);
});

test('report labels requested point and repeat', () => {
  const output = formatReport({
    level: { id: 'demo' },
    options: { backend: 'webgpu', width: 10, height: 10, fidelity: 'full', frames: 1, repeats: 2, freeze: true, hide: [], dropStages: [], flatten: [], velocityBuffer: null, shadows: true, detail: false },
    samples: [{ repeat: 2, requestedTime: 0.8, section: 'intro', t: 0.8, updateMs: 0, renderMs: 1, firstRenderMs: 1, gpuRenderMs: 2, gpuComputeMs: 1, gpuTotalMs: 3, gpuTotalP95Ms: 3, gpuSamples: 1, calls: 1, triangles: 3 }],
  });
  assert.match(output, /repeat requested/);
  assert.match(output, /0\.8/);
  assert.match(output, /\s2\s/);
});
