#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levelFootprint } from './benchmark/protocol.mjs';

const execFileAsync = promisify(execFile);

// This checker and scripts/benchmark/protocol.mjs travel together in synthetic
// repositories and frozen benchmark controllers. The recorded version, not
// filesystem probing, selects the contract.
export async function checkBenchmarkScope({ root = process.cwd(), levelId, base = 'HEAD', benchmarkVersion = 'v2', migration = false } = {}) {
  if (!levelId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(levelId)) throw new Error('A safe benchmark level id is required.');
  const footprint = levelFootprint(levelId, benchmarkVersion);
  const allowedRoots = [...footprint.roots];
  const allowedShared = new Set(footprint.sharedDerived);
  if (migration) {
    const legacy = levelFootprint(levelId, 'v1');
    allowedRoots.push(...legacy.roots.filter((rootEntry) => rootEntry.id === 'source'));
    for (const sharedPath of legacy.sharedDerived) allowedShared.add(sharedPath);
  }

  const changed = new Set();
  const tracked = await git(root, ['diff', '--name-only', base]);
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard']);
  for (const name of `${tracked}\n${untracked}`.split('\n').map((value) => value.trim()).filter(Boolean)) changed.add(name);

  const ownsPath = (name) => allowedRoots.some((rootEntry) => name.startsWith(`${rootEntry.path}/`));
  const outOfScope = [...changed].filter((name) => !allowedShared.has(name) && !ownsPath(name));
  if (outOfScope.length) throw new Error(`Out-of-scope files for benchmark level '${levelId}':\n${outOfScope.join('\n')}`);

  const requiredRoot = footprint.roots.find((rootEntry) => rootEntry.required);
  if (!requiredRoot || ![...changed].some((name) => name.startsWith(`${requiredRoot.path}/`))) {
    throw new Error(`Benchmark scope contains no assigned output directory for '${levelId}'.`);
  }
  return [...changed].sort();
}

async function git(cwd, args) {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout;
}

function parseCli(args) {
  if (args[0] && !args[0].startsWith('-')) {
    if (args.length > 2) throw new Error('Usage: npm run check:scope -- <level-id> [base-ref]');
    return { levelId: args[0], base: args[1] ?? 'main', benchmarkVersion: 'v1', migration: false, root: process.cwd() };
  }
  const get = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  return {
    levelId: get('--level'),
    base: get('--base') ?? 'HEAD',
    benchmarkVersion: get('--version') ?? get('--benchmark-version') ?? 'v2',
    migration: args.includes('--migration'),
    root: path.resolve(get('--root') ?? process.cwd()),
  };
}

async function main() {
  const changed = await checkBenchmarkScope(parseCli(process.argv.slice(2)));
  console.log(`benchmark scope valid (${changed.length} paths)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
