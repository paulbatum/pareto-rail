#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkLevelFootprint, builtInLevelFootprint } from './benchmark/protocol.mjs';

const execFileAsync = promisify(execFile);

// The invocation form selects the footprint: the positional form checks a built-in
// level (src/levels/<id> plus the registry index), the flag form checks a benchmark
// entrant (src/benchmark-levels/<id>). This checker and protocol.mjs travel together
// in the isolated entrant checkout.
export async function checkBenchmarkScope({ root = process.cwd(), levelId, base = 'HEAD', builtIn = false } = {}) {
  if (!levelId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(levelId)) throw new Error('A safe benchmark level id is required.');
  const footprint = builtIn ? builtInLevelFootprint(levelId) : benchmarkLevelFootprint(levelId);
  const allowedRoots = [...footprint.roots];
  const allowedShared = new Set(footprint.sharedDerived);

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
    return { levelId: args[0], base: args[1] ?? 'main', builtIn: true, root: process.cwd() };
  }
  const get = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  return {
    levelId: get('--level'),
    base: get('--base') ?? 'HEAD',
    builtIn: false,
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
