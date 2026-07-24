import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { checkoutLayout } from './checkout-layout.mjs';
import { sha256 } from './common.mjs';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export async function createRecoverySnapshot({ repo, runDirectory, runId, worktree, checkpoint, reason, previousTree }) {
  if (!worktree || !await pathExists(worktree)) return null;
  const inside = await git(worktree, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return null;

  const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  const branch = (await git(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })).stdout.trim() || null;
  // The entrant edits this worktree concurrently and runs its own git. GIT_OPTIONAL_LOCKS=0 keeps this
  // read from taking index.lock, so it never races the entrant's `git add`; the staging below stages
  // into a private GIT_INDEX_FILE, so the entrant's own index and working files are never mutated.
  const status = (await git(worktree, ['status', '--porcelain=v1', '--untracked-files=all'], { env: { GIT_OPTIONAL_LOCKS: '0' } })).stdout;
  const temporaryIndex = path.join(os.tmpdir(), `pareto-rail-recovery-index-${runId}-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: temporaryIndex };
  try {
    await git(worktree, ['read-tree', 'HEAD'], { env });
    await git(worktree, ['add', '--all'], { env });
    const tree = (await git(worktree, ['write-tree'], { env })).stdout.trim();
    // A periodic caller passes the tree of its last snapshot; an unchanged worktree writes an identical
    // tree, so skip the commit/ref/record work rather than pile up duplicate refs. The identity is the
    // tree git just computed here, not a re-derived one.
    if (previousTree && tree === previousTree) return { deduped: true, snapshotTree: tree };
    const commit = (await git(worktree, ['commit-tree', tree, '-p', head, '-m', `Preserve benchmark recovery snapshot ${runId}`])).stdout.trim();
    const attempt = `${new Date().toISOString().replace(/[:.]/g, '-')}-${commit.slice(0, 8)}`;
    const ref = `refs/benchmark-recovery/${runId}/${attempt}`;
    await git(worktree, ['update-ref', ref, commit, '']);
    if (await checkoutLayout(worktree) === 'standalone') {
      await git(repo, ['fetch', '--no-tags', worktree, `${ref}:${ref}`]);
    }
    const fetchedCommit = (await git(repo, ['rev-parse', '--verify', `${ref}^{commit}`])).stdout.trim();
    if (fetchedCommit !== commit) throw new Error('Recovery snapshot did not reach the primary repository intact.');
    const changedPaths = (await git(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', `${head}..${commit}`])).stdout.trim().split('\n').filter(Boolean);
    const record = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      runId,
      checkpoint: checkpoint ?? null,
      reason,
      worktree,
      branch,
      baseHead: head,
      snapshotCommit: commit,
      snapshotTree: tree,
      ref,
      statusSha256: sha256(status),
      changedPaths,
    };
    const snapshotsDirectory = path.join(runDirectory, 'recovery-snapshots');
    await fs.mkdir(snapshotsDirectory, { recursive: true });
    await writeJson(path.join(snapshotsDirectory, `${attempt}.json`), record);
    await writeJson(path.join(runDirectory, 'recovery-snapshot.json'), record);
    return record;
  } finally {
    await fs.rm(temporaryIndex, { force: true });
  }
}

// A long stage (up to twelve hours, including in-process quota waits) is snapshotted on this cadence so
// a host that dies without the controller's failure handling — a reboot, a kill during a wait — loses at
// most one interval of entrant work rather than everything since the last checkpoint failure.
export const RECOVERY_SNAPSHOT_INTERVAL_MS = 12 * 60 * 1000;

// The dedup-carrying single shot behind the periodic loop, exported so tests can drive it deterministically
// without waiting on the timer. Failures never propagate: they are recorded and swallowed so a snapshot
// problem can never fail or stall the stage it is protecting.
export function makePeriodicSnapshotter({ repo, runDirectory, runId, worktree, checkpoint = 'stage', reason = 'periodic snapshot while the stage runs' }) {
  let previousTree = null;
  return async function snapshotOnce() {
    try {
      const result = await createRecoverySnapshot({ repo, runDirectory, runId, worktree, checkpoint, reason, previousTree });
      if (result?.snapshotTree) previousTree = result.snapshotTree;
      return result;
    } catch (error) {
      await recordSnapshotError(runDirectory, error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
}

// Start snapshotting the worktree on an interval and return a handle whose stop() clears the timer and
// awaits any in-flight snapshot. Ticks never overlap (an in-flight snapshot skips the next tick) and the
// timer is unref'd so it never keeps the process alive on its own.
export function startPeriodicRecoverySnapshots({ repo, runDirectory, runId, worktree, checkpoint, reason, intervalMs = RECOVERY_SNAPSHOT_INTERVAL_MS }) {
  const snapshotOnce = makePeriodicSnapshotter({ repo, runDirectory, runId, worktree, checkpoint, reason });
  let stopped = false;
  let inFlight = null;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = snapshotOnce().finally(() => { inFlight = null; });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (inFlight) await inFlight;
    },
  };
}

async function recordSnapshotError(runDirectory, error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const logPath = path.join(runDirectory, 'recovery-snapshots', 'periodic-errors.json');
    const log = await readOptionalJson(logPath) ?? { schemaVersion: 1, errors: [] };
    log.errors.push({ at: new Date().toISOString(), message });
    await writeJson(logPath, log);
  } catch {
    // Durability is best-effort; the snapshot loop must never throw.
  }
  console.warn(`Recovery snapshot failed (continuing): ${message}`);
}

export async function restoreRecoverySnapshot({ repo, runDirectory, worktreeRecord }) {
  const snapshot = await readOptionalJson(path.join(runDirectory, 'recovery-snapshot.json'));
  if (!snapshot) return null;
  await git(repo, ['cat-file', '-e', `${snapshot.snapshotCommit}^{commit}`]);
  const refCommit = (await git(repo, ['rev-parse', '--verify', snapshot.ref])).stdout.trim();
  if (refCommit !== snapshot.snapshotCommit) throw new Error('Recovery snapshot ref no longer points to its recorded commit.');
  if (await pathExists(worktreeRecord.worktree)) throw new Error(`Refusing to restore over an existing path: ${worktreeRecord.worktree}`);

  const branch = worktreeRecord.branch ?? snapshot.branch;
  if (!branch) throw new Error('Recovery snapshot has no entrant branch to restore.');
  if (worktreeRecord.layout === 'standalone') {
    await fs.mkdir(worktreeRecord.worktree, { recursive: true });
    await git(worktreeRecord.worktree, ['init', '-q']);
    await copyGitIdentity(repo, worktreeRecord.worktree);
    await git(worktreeRecord.worktree, ['fetch', '--no-tags', repo, snapshot.ref]);
    await git(worktreeRecord.worktree, ['checkout', '-q', '-b', branch, snapshot.baseHead]);
  } else {
    await git(repo, ['worktree', 'prune']);
    const branchCheck = await git(repo, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFailure: true });
    if (branchCheck.code === 0) await git(repo, ['worktree', 'add', worktreeRecord.worktree, branch]);
    else await git(repo, ['worktree', 'add', '-b', branch, worktreeRecord.worktree, snapshot.baseHead]);
  }
  await git(worktreeRecord.worktree, ['read-tree', '--reset', '-u', snapshot.snapshotCommit]);

  const tree = (await git(worktreeRecord.worktree, ['write-tree'])).stdout.trim();
  if (tree !== snapshot.snapshotTree) throw new Error('Restored worktree tree does not match the recovery snapshot.');
  await writeJson(path.join(runDirectory, 'worktree-restored.json'), {
    schemaVersion: 1,
    restoredAt: new Date().toISOString(),
    snapshotCommit: snapshot.snapshotCommit,
    snapshotTree: snapshot.snapshotTree,
    ref: snapshot.ref,
    worktree: worktreeRecord.worktree,
  });
  return snapshot;
}

async function readOptionalJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function pathExists(filePath) {
  try { await fs.lstat(filePath); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function copyGitIdentity(sourceRepository, destinationRepository) {
  for (const key of ['user.name', 'user.email']) {
    const value = await git(sourceRepository, ['config', '--get', key], { allowFailure: true });
    if (value.code === 0 && value.stdout.trim()) await git(destinationRepository, ['config', key, value.stdout.trim()]);
  }
}

function git(cwd, args, options) {
  return run('git', args, cwd, options);
}

function run(executable, args, cwd, { allowFailure = false, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !allowFailure) reject(new Error(`${executable} ${args.join(' ')} failed:\n${stderr || stdout}`));
      else resolve(result);
    });
  });
}
