#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { assertOnlyOptions, fail, parseArgs, readJson, writeJson } from './common.mjs';
import { loadResults } from './results.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS_DIR = path.join(ROOT, 'benchmark/private/runs');
const ARCHIVE_DIR = path.join(ROOT, 'benchmark/private/archive/runs');
const FAILED_STATES = new Set(['gate-failed', 'dnf', 'controller-failure', 'incomplete']);

async function main() {
  const { rest, options } = parseArgs(process.argv.slice(2), { positional: true });
  if (options.help || rest.length === 0) {
    console.log(`Usage:
  npm run benchmark:manage -- status
  npm run benchmark:manage -- archive-dnf [--dry-run true]
  npm run benchmark:manage -- unarchive --run <run-id-or-archived-directory>
  npm run benchmark:manage -- prune --run <run-id> --confirm <run-id>`);
    return;
  }
  const command = rest[0];
  if (rest.length !== 1) fail(`Unexpected argument: ${rest.slice(1).join(' ')}`);
  if (command === 'status') { assertOnlyOptions(options, new Set()); return showStatus(); }
  if (command === 'archive-dnf') { assertOnlyOptions(options, new Set(['dry-run'])); return archiveDnf(options); }
  if (command === 'unarchive') { assertOnlyOptions(options, new Set(['run'])); return unarchive(options.run); }
  if (command === 'prune') { assertOnlyOptions(options, new Set(['run', 'confirm'])); return prune(options.run, options.confirm); }
  fail(`Unknown command: ${command}`);
}

async function showStatus() {
  const results = await loadResults(RUNS_DIR, { identity: 'blind' });
  const successful = results.filter((result) => result.state === 'completed');
  const failed = results.filter((result) => FAILED_STATES.has(result.state));
  console.log('=== Benchmark Run Status ===');
  console.log(`Successful/Completed: ${successful.length}`);
  for (const result of successful) console.log(`  - ${result.runId} (${result.levelId}) [${result.state}${result.recovered ? ', recovered' : ''}]`);
  console.log(`Failed/DNF/Incomplete: ${failed.length}`);
  for (const result of failed) console.log(`  - ${result.runId} (${result.levelId}) [${result.state}]`);
}

async function archiveDnf(options) {
  const dryRun = options['dry-run'] === 'true';
  const results = await loadResults(RUNS_DIR, { identity: 'blind' });
  const failed = results.filter((result) => FAILED_STATES.has(result.state));
  if (!failed.length) { console.log('No failed or DNF runs to archive.'); return; }
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  for (const result of failed) {
    const source = path.join(RUNS_DIR, result.runId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(ARCHIVE_DIR, `${result.runId}-${timestamp}`);
    console.log(`${dryRun ? 'Would archive' : 'Archiving'} ${result.runId} to ${path.relative(ROOT, destination)}`);
    console.log('  Entrant worktrees, branches, commits, and source are preserved.');
    if (!dryRun) {
      await fs.rename(source, destination);
      await writeJson(path.join(destination, 'archive.json'), { schemaVersion: 1, archivedAt: new Date().toISOString(), originalPath: path.relative(ROOT, source), stateAtArchive: result.state, destructiveCleanup: false });
    }
  }
}

async function unarchive(identifier) {
  if (!identifier) fail('Missing --run <run-id-or-archived-directory>.');
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const entries = await fs.readdir(ARCHIVE_DIR, { withFileTypes: true });
  const matches = entries.filter((entry) => entry.isDirectory() && (entry.name === identifier || entry.name.startsWith(`${identifier}-20`)));
  if (matches.length !== 1) fail(`Expected one archived run matching ${identifier}, found ${matches.length}.`);
  const source = path.join(ARCHIVE_DIR, matches[0].name);
  const definition = await readJson(path.join(source, 'run-definition.json'));
  const destination = path.join(RUNS_DIR, definition.assignment.runId);
  try { await fs.lstat(destination); fail(`Active run already exists: ${destination}`); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await fs.rename(source, destination);
  await writeJson(path.join(destination, 'unarchive.json'), { schemaVersion: 1, unarchivedAt: new Date().toISOString(), archivedDirectory: matches[0].name });
  console.log(`Restored ${definition.assignment.runId} to ${path.relative(ROOT, destination)}.`);
}

async function prune(runId, confirmation) {
  if (!runId || confirmation !== runId) fail('Destructive pruning requires --run <run-id> --confirm <same-run-id>.');
  const runDirectory = path.join(RUNS_DIR, runId);
  const definition = await readJson(path.join(runDirectory, 'run-definition.json'));
  const evaluated = await readJson(path.join(runDirectory, 'evaluated.json'));
  await git(['cat-file', '-e', `${evaluated.evaluatedCommit}^{commit}`]);
  const worktree = await optionalJson(path.join(runDirectory, 'worktree.json'));
  const targets = [
    { path: worktree?.worktree ?? definition.worktree.path, branch: worktree?.branch ?? `benchmark-run-${runId}` },
    { path: definition.payload.path, branch: definition.payload.branch },
  ];
  for (const target of targets) {
    console.log(`Pruning temporary worktree ${target.path}; durable commits remain.`);
    await git(['worktree', 'remove', '--force', target.path], { allowFailure: true });
    console.log(`  Preserved branch ${target.branch}.`);
  }
  await writeJson(path.join(runDirectory, 'prune.json'), { schemaVersion: 1, prunedAt: new Date().toISOString(), evaluatedCommit: evaluated.evaluatedCommit, targets });
  console.log('Temporary worktrees pruned. Primary-repository source was not modified.');
}

async function optionalJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function git(args, options) { return run('git', args, ROOT, options); }
function run(executable, args, cwd, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code && !allowFailure) reject(new Error(`${executable} ${args.join(' ')} failed:\n${output}`));
      else resolve({ code: code ?? 1, output });
    });
  });
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
