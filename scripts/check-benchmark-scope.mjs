#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export async function checkBenchmarkScope({ root = process.cwd(), levelId, base = 'HEAD' } = {}) {
  if (!levelId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(levelId)) throw new Error('A safe benchmark level id is required.');
  const allowedPrefix = `src/benchmark-levels/${levelId}/`;
  const changed = new Set();
  const tracked = await git(root, ['diff', '--name-only', base]);
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard']);
  for (const name of `${tracked}\n${untracked}`.split('\n').map((value) => value.trim()).filter(Boolean)) changed.add(name);
  const outOfScope = [...changed].filter((name) => name !== 'docs/level-gallery.md' && !name.startsWith(allowedPrefix));
  if (outOfScope.length) throw new Error(`Out-of-scope files for benchmark level '${levelId}':\n${outOfScope.join('\n')}`);
  if (![...changed].some((name) => name.startsWith(allowedPrefix))) throw new Error(`Benchmark scope contains no promoted level directory for '${levelId}'.`);
  return [...changed].sort();
}

async function git(cwd, args) {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const levelId = get('--level');
  const base = get('--base') ?? 'HEAD';
  const root = path.resolve(get('--root') ?? process.cwd());
  const changed = await checkBenchmarkScope({ root, levelId, base });
  console.log(`benchmark scope valid (${changed.length} paths)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
