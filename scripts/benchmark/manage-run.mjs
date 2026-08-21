#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { checkoutLayout } from './checkout-layout.mjs';
import { assertOnlyOptions, fail, parseArgs, pathInside, readJson, writeJson } from './common.mjs';
import { loadResults } from './results.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS_DIR = path.join(ROOT, 'benchmark/private/runs');
const ARCHIVE_DIR = path.join(ROOT, 'benchmark/private/archive/runs');
const FAILED_STATES = new Set(['gate-failed', 'dnf', 'controller-failure', 'incomplete']);

async function main() {
  const { rest, options } = parseArgs(process.argv.slice(2), { positional: true, booleans: ['unblind'] });
  if (options.help || rest.length === 0) {
    console.log(`Usage:
  npm run benchmark:manage -- status [--unblind]
  npm run benchmark:manage -- archive-dnf [--dry-run true]
  npm run benchmark:manage -- unarchive --run <run-id-or-archived-directory>
  npm run benchmark:manage -- prune --run <run-id> --confirm <run-id>
  npm run benchmark:manage -- delete --run <run-id> --confirm <run-id> [--dry-run true]`);
    return;
  }
  const command = rest[0];
  if (rest.length !== 1) fail(`Unexpected argument: ${rest.slice(1).join(' ')}`);
  if (command === 'status') { assertOnlyOptions(options, new Set(['unblind'])); return showStatus({ unblind: options.unblind === true }); }
  if (command === 'archive-dnf') { assertOnlyOptions(options, new Set(['dry-run'])); return archiveDnf(options); }
  if (command === 'unarchive') { assertOnlyOptions(options, new Set(['run'])); return unarchive(options.run); }
  if (command === 'prune') { assertOnlyOptions(options, new Set(['run', 'confirm'])); return pruneRun({ runId: options.run, confirmation: options.confirm }); }
  if (command === 'delete') { assertOnlyOptions(options, new Set(['run', 'confirm', 'dry-run'])); return deleteRun({ runId: options.run, confirmation: options.confirm, dryRun: options['dry-run'] === 'true' }); }
  fail(`Unknown command: ${command}`);
}

async function showStatus({ unblind = false } = {}) {
  const results = await loadResults(RUNS_DIR, { unblind });
  const successful = results.filter((result) => result.state === 'completed');
  const disqualified = results.filter((result) => result.state === 'disqualified');
  const failed = results.filter((result) => FAILED_STATES.has(result.state));
  console.log('=== Benchmark Run Status ===');
  console.log(`Successful/Completed: ${successful.length}`);
  for (const result of successful) {
    const promotion = result.promotionStatus === 'not-applicable' ? '' : `, promotion ${result.promotionStatus}`;
    console.log(`  - ${result.runId} (${result.levelId}) [run completed${promotion}${result.recovered ? ', recovered' : ''}${incidentSuffix(result)}]${identitySuffix(result, unblind)}`);
    if (result.promotionStatus === 'pending' || result.promotionStatus === 'failed') console.log(`    Resume: npm run benchmark:promote -- --run ${result.runId}`);
  }
  console.log(`Disqualified: ${disqualified.length}`);
  for (const result of disqualified) {
    console.log(`  - ${result.runId} (${result.levelId}) [disqualified${incidentSuffix(result)}]${identitySuffix(result, unblind)}`);
  }
  console.log(`Failed/DNF/Incomplete: ${failed.length}`);
  for (const result of failed) {
    const spend = result.state === 'incomplete' ? await activeBudgetSpend(result.runId) : null;
    const budgetStatus = spend ? `, task budget ${Math.round(spend.fraction * 100)}%` : '';
    console.log(`  - ${result.runId} (${result.levelId}) [${result.state}${budgetStatus}${incidentSuffix(result)}]${identitySuffix(result, unblind)}`);
  }
}

function incidentSuffix(result) {
  return result.incident ? ', incident' : '';
}

function identitySuffix(result, unblind) {
  if (!unblind) return '';
  const models = result.models?.length ? ` ${result.models.join(',')}` : '';
  return ` {${result.configuration ?? '—'}${models}}`;
}

async function activeBudgetSpend(runId) {
  const runDirectory = path.join(RUNS_DIR, runId);
  const definition = await optionalJson(path.join(runDirectory, 'run-definition.json'));
  const stageDirectory = definition?.stage?.adapter === 'claude-cli' ? 'stages/solo/claude' : definition?.stage?.adapter === 'codex-cli' ? 'stages/solo/codex' : null;
  if (!definition?.stage?.budget || !stageDirectory) return null;
  const spend = await optionalJson(path.join(runDirectory, stageDirectory, 'budget', 'spend.json'));
  return Number.isFinite(spend?.fraction) ? spend : null;
}

async function archiveDnf(options) {
  const dryRun = options['dry-run'] === 'true';
  const results = await loadResults(RUNS_DIR, {});
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
  const runId = definition.runId ?? definition.assignment?.runId;
  const destination = path.join(RUNS_DIR, runId);
  try { await fs.lstat(destination); fail(`Active run already exists: ${destination}`); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await fs.rename(source, destination);
  await writeJson(path.join(destination, 'unarchive.json'), { schemaVersion: 1, unarchivedAt: new Date().toISOString(), archivedDirectory: matches[0].name });
  console.log(`Restored ${runId} to ${path.relative(ROOT, destination)}.`);
}

export async function pruneRun({ runId, confirmation, root = ROOT, runDirectory = path.join(root, 'benchmark/private/runs', runId ?? '') }) {
  if (!runId || confirmation !== runId) fail('Destructive pruning requires --run <run-id> --confirm <same-run-id>.');
  const definition = await readJson(path.join(runDirectory, 'run-definition.json'));
  const evaluated = await readJson(path.join(runDirectory, 'evaluated.json'));
  const worktree = await optionalJson(path.join(runDirectory, 'worktree.json'));
  const payload = await optionalJson(path.join(runDirectory, 'payload.json'));
  const targets = [
    {
      kind: 'evaluated',
      path: worktree?.worktree ?? definition.worktree.path,
      branch: worktree?.branch ?? `benchmark-run-${runId}`,
      commit: evaluated.evaluatedCommit,
    },
    ...(payload ? [{ kind: 'payload', path: payload.worktree ?? definition.payload.path, branch: payload.branch ?? definition.payload.branch, commit: payload.payloadCommit }] : []),
  ];

  for (const target of targets) await assertSafeToPrune(target, root);
  for (const target of targets) {
    if (await pathExists(target.path)) {
      console.log(`Pruning verified ${target.kind} worktree ${target.path}.`);
      const layout = await checkoutLayout(target.path);
      if (layout === 'linked') await git(root, ['worktree', 'remove', target.path]);
      else if (layout === 'standalone') await fs.rm(target.path, { recursive: true });
      else fail(`Refusing to prune ${target.kind}: ${target.path} is not a recognized Git checkout.`);
    }
    const branchCommit = (await git(root, ['rev-parse', '--verify', `refs/heads/${target.branch}`])).output.trim();
    if (branchCommit !== target.commit) fail(`Preserved branch ${target.branch} changed during pruning.`);
    await git(root, ['cat-file', '-e', `${target.commit}^{commit}`]);
    console.log(`  Preserved branch ${target.branch} at ${target.commit}.`);
  }
  await writeJson(path.join(runDirectory, 'prune.json'), { schemaVersion: 1, prunedAt: new Date().toISOString(), evaluatedCommit: evaluated.evaluatedCommit, targets });
  console.log('Verified temporary worktrees pruned. Primary-repository source and all Git refs were preserved.');
}

async function assertSafeToPrune(target, root) {
  await git(root, ['cat-file', '-e', `${target.commit}^{commit}`]);
  const branchCommit = (await git(root, ['rev-parse', '--verify', `refs/heads/${target.branch}`])).output.trim();
  if (branchCommit !== target.commit) fail(`Refusing to prune ${target.kind}: branch ${target.branch} does not point to recorded commit ${target.commit}.`);
  if (!await pathExists(target.path)) return;
  const layout = await checkoutLayout(target.path);
  if (!layout) fail(`Refusing to prune ${target.kind}: ${target.path} is not a recognized Git checkout.`);
  if (layout === 'standalone' && (pathInside(target.path, root) || pathInside(root, target.path))) {
    fail(`Refusing to prune ${target.kind}: standalone checkout overlaps the primary repository.`);
  }
  const head = (await run('git', ['rev-parse', 'HEAD'], target.path)).output.trim();
  if (head !== target.commit) fail(`Refusing to prune ${target.kind}: worktree HEAD ${head} does not match recorded commit ${target.commit}.`);
  const status = (await run('git', ['status', '--porcelain=v1', '--untracked-files=all'], target.path)).output.trim();
  if (status) fail(`Refusing to prune ${target.kind}: worktree is dirty.\n${status}`);
}

// `prune` reclaims a run's temporary worktrees and keeps its record, because a run that produced an
// entrant is evidence the benchmark answers fairness questions from. `delete` is for the other case:
// a run whose entrant produced nothing anyone will look at again — a provider blip, an aborted
// launch. It removes the record and every trace the run created, so the refusals below are what
// stands between that and deleting something the catalog or a published manifest still points at.
export async function deleteRun({ runId, confirmation, dryRun = false, root = ROOT }) {
  if (!runId || confirmation !== runId) fail('Destructive deletion requires --run <run-id> --confirm <same-run-id>.');
  const located = await locateRun(runId, root);
  const definition = await readJson(path.join(located.directory, 'run-definition.json'));
  const levelId = definition.levelId ?? definition.assignment?.levelId;
  await assertSafeToDelete({ runId, levelId, located, definition, root });

  const worktrees = [
    definition.worktree?.path,
    definition.payload?.path,
    (await optionalJson(path.join(located.directory, 'worktree.json')))?.worktree,
    (await optionalJson(path.join(located.directory, 'payload.json')))?.worktree,
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  for (const worktree of worktrees) {
    if (pathInside(worktree, root) || pathInside(root, worktree)) fail(`Refusing to delete: worktree ${worktree} overlaps the primary repository.`);
  }

  const branches = [
    definition.worktree?.branch ?? `benchmark-run-${runId}`,
    definition.payload?.branch,
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  const liveBranches = [];
  for (const branch of branches) {
    const found = await git(root, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFailure: true });
    if (found.code === 0) liveBranches.push({ branch, commit: found.output.trim() });
  }

  const recoveryRefs = (await git(root, ['for-each-ref', '--format=%(refname)', `refs/benchmark-recovery/${runId}`])).output
    .split('\n').map((line) => line.trim()).filter(Boolean);

  const label = dryRun ? 'Would delete' : 'Deleting';
  console.log(`${label} run ${runId}${levelId ? ` (${levelId})` : ''}, state ${located.state}.`);
  console.log(`  ${label} record ${path.relative(root, located.directory)}`);
  for (const worktree of worktrees) console.log(`  ${label} worktree ${worktree}${await pathExists(worktree) ? '' : ' (already gone)'}`);
  for (const { branch, commit } of liveBranches) console.log(`  ${label} branch ${branch} at ${commit}`);
  for (const ref of recoveryRefs) console.log(`  ${label} recovery ref ${ref}`);
  if (dryRun) { console.log('Nothing was removed. Re-run without --dry-run to delete.'); return; }

  for (const worktree of worktrees) {
    if (!await pathExists(worktree)) continue;
    const layout = await checkoutLayout(worktree);
    if (layout === 'linked') await git(root, ['worktree', 'remove', '--force', worktree]);
    else if (layout === 'standalone') await fs.rm(worktree, { recursive: true, force: true });
    else fail(`Refusing to delete: ${worktree} is not a recognized Git checkout.`);
  }
  await git(root, ['worktree', 'prune']);
  for (const { branch } of liveBranches) await git(root, ['branch', '-D', branch]);
  for (const ref of recoveryRefs) await git(root, ['update-ref', '-d', ref]);
  await fs.rm(located.directory, { recursive: true, force: true });
  console.log(`Deleted ${runId}. Its plan row is untouched — edit the plan file yourself to drop or re-slot it.`);
}

// A run directory lives under runs/ while active and under archive/runs/<run-id>-<timestamp> once
// archived, so both are searched and the state comes from the record rather than the directory name.
async function locateRun(runId, root) {
  const runsDirectory = path.join(root, 'benchmark/private/runs');
  const archiveDirectory = path.join(root, 'benchmark/private/archive/runs');
  for (const [directory, archived] of [[runsDirectory, false], [archiveDirectory, true]]) {
    let results;
    try { results = await loadResults(directory, {}); } catch { continue; }
    const match = results.find((result) => result.runId === runId);
    if (!match) continue;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const candidate = path.join(directory, entry.name);
      const definition = await optionalJson(path.join(candidate, 'run-definition.json'));
      if ((definition?.runId ?? definition?.assignment?.runId) === runId) return { directory: candidate, archived, state: match.state };
    }
  }
  fail(`No run record found for ${runId} under benchmark/private/runs or benchmark/private/archive/runs.`);
}

async function assertSafeToDelete({ runId, levelId, located, definition, root }) {
  if (!FAILED_STATES.has(located.state)) {
    fail(`Refusing to delete ${runId}: its state is ${located.state}, not a failed run. Only ${[...FAILED_STATES].join(', ')} may be deleted; use prune to reclaim a completed run's worktrees.`);
  }
  if (definition.kind === 'benchmark' && !levelId) fail(`Refusing to delete ${runId}: its record has no level id, so promotion and publication cannot be checked.`);
  if (!levelId) return;

  const promoted = path.join(root, 'src/benchmark-levels', levelId);
  if (await pathExists(promoted)) fail(`Refusing to delete ${runId}: ${path.relative(root, promoted)} exists, so the run is promoted. Retire the entrant instead.`);

  const publication = await optionalJson(path.join(root, 'benchmark/private/publication.json'));
  if (publication?.entrants?.some((entrant) => entrant.runId === runId || entrant.levelId === levelId)) {
    fail(`Refusing to delete ${runId}: the publication manifest still lists it. Remove it there first, and read docs/compat.md before you do — production votes reference level ids.`);
  }

  const manifest = path.join(root, 'benchmark/manifests', runId);
  if (await pathExists(manifest)) fail(`Refusing to delete ${runId}: published provenance exists at ${path.relative(root, manifest)}.`);
}

async function optionalJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function pathExists(filePath) {
  try { await fs.lstat(filePath); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function git(cwd, args, options) { return run('git', args, cwd, options); }
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
