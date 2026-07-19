#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  if (git(['rev-parse', '--is-inside-work-tree']).trim() !== 'true') {
    console.warn('Tracked PNG check skipped: not a Git work tree.');
    process.exit(0);
  }
} catch {
  console.warn('Tracked PNG check skipped: not a Git checkout.');
  process.exit(0);
}

let tracked;
try {
  tracked = git(['ls-files', '--', '*.png', '*.PNG'])
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
} catch (error) {
  console.error(`Tracked PNG check failed: could not list tracked files (${error instanceof Error ? error.message : String(error)}).`);
  process.exit(1);
}

if (tracked.length > 0) {
  console.error('Tracked PNG files are not allowed. Convert them with node scripts/png-to-avif.mjs:');
  for (const file of tracked) console.error(`  ${file}`);
  process.exit(1);
}

console.log('Tracked PNG check passed: no tracked PNG files.');
