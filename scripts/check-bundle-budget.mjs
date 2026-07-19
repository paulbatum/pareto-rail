#!/usr/bin/env node

// Guards the homepage against sudden bundle bloat. The eager graph is the entry
// chunk plus everything it *statically* imports (JS and CSS) — i.e. what a first
// visitor downloads before any route or the WebGPU runtime lazy-loads. A heavy
// feature accidentally pulled into the shell (rather than behind React.lazy /
// LazyGameFrame) shows up here as a jump in that number.
//
// Small, incremental growth is allowed; only jumps past the allowance fail. When
// growth is intentional, re-seed BASELINE_GZIP_BYTES to the reported size.

import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'dist', '.vite', 'manifest.json');

// Seed: measured eager gzip size of the homepage graph. Bump this when a real
// feature legitimately grows the shell (the failure message prints the value).
const BASELINE_GZIP_BYTES = 118_081;

// How much drift is tolerated before the build fails. "A little" growth passes;
// big jumps do not.
const MAX_GROWTH_RATIO = 0.15;

function fail(message) {
  console.error(`Bundle budget check failed: ${message}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(`could not read Vite manifest at ${path.relative(root, manifestPath)} ` +
    `(${error instanceof Error ? error.message : String(error)}). Run "vite build" first, ` +
    'and ensure build.manifest is enabled in vite.config.ts.');
}

const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
if (entries.length === 0) fail('no entry chunk found in the manifest.');

// Walk static imports only — dynamicImports are lazy and excluded by design.
const visited = new Set();
const files = new Set();
function walk(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  if (!chunk) return;
  files.add(chunk.file);
  for (const css of chunk.css ?? []) files.add(css);
  for (const imported of chunk.imports ?? []) walk(imported);
}
for (const entry of entries) walk(entry);

let totalGzip = 0;
for (const file of files) {
  const buffer = readFileSync(path.join(root, 'dist', file));
  totalGzip += gzipSync(buffer).length;
}

const limit = Math.round(BASELINE_GZIP_BYTES * (1 + MAX_GROWTH_RATIO));
const kb = (bytes) => (bytes / 1024).toFixed(1);
const deltaPct = ((totalGzip - BASELINE_GZIP_BYTES) / BASELINE_GZIP_BYTES) * 100;
const summary = `homepage eager gzip ${kb(totalGzip)} kB ` +
  `(baseline ${kb(BASELINE_GZIP_BYTES)} kB, ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%, ` +
  `limit ${kb(limit)} kB).`;

if (totalGzip > limit) {
  fail(`${summary}\n` +
    '  Something heavy likely reached the homepage shell. Prefer lazy-loading it ' +
    '(React.lazy / LazyGameFrame) so it stays out of the first download.\n' +
    `  If the growth is intentional, update BASELINE_GZIP_BYTES to ${totalGzip} in ` +
    'scripts/check-bundle-budget.mjs.');
}

console.log(`Bundle budget check passed: ${summary}`);
