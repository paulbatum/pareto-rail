import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sha256 } from './common.mjs';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export async function createRecoverySnapshot({ repo, runDirectory, runId, worktree, checkpoint, reason }) {
  if (!worktree || !await pathExists(worktree)) return null;
  const inside = await git(worktree, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return null;

  const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  const branch = (await git(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })).stdout.trim() || null;
  const status = (await git(worktree, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout;
  const temporaryIndex = path.join(os.tmpdir(), `raild-recovery-index-${runId}-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: temporaryIndex };
  try {
    await git(worktree, ['read-tree', 'HEAD'], { env });
    await git(worktree, ['add', '--all'], { env });
    const tree = (await git(worktree, ['write-tree'], { env })).stdout.trim();
    const commit = (await git(worktree, ['commit-tree', tree, '-p', head, '-m', `Preserve benchmark recovery snapshot ${runId}`])).stdout.trim();
    const attempt = `${new Date().toISOString().replace(/[:.]/g, '-')}-${commit.slice(0, 8)}`;
    const ref = `refs/benchmark-recovery/${runId}/${attempt}`;
    await git(repo, ['update-ref', ref, commit]);
    const changedPaths = (await git(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', `${head}..${commit}`])).stdout.trim().split('\n').filter(Boolean);
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

export async function restoreRecoverySnapshot({ repo, runDirectory, worktreeRecord }) {
  const snapshot = await readOptionalJson(path.join(runDirectory, 'recovery-snapshot.json'));
  if (!snapshot) return null;
  await git(repo, ['cat-file', '-e', `${snapshot.snapshotCommit}^{commit}`]);
  const refCommit = (await git(repo, ['rev-parse', '--verify', snapshot.ref])).stdout.trim();
  if (refCommit !== snapshot.snapshotCommit) throw new Error('Recovery snapshot ref no longer points to its recorded commit.');
  if (await pathExists(worktreeRecord.worktree)) throw new Error(`Refusing to restore over an existing path: ${worktreeRecord.worktree}`);

  await git(repo, ['worktree', 'prune']);
  const branch = worktreeRecord.branch ?? snapshot.branch;
  const branchCheck = await git(repo, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFailure: true });
  if (branchCheck.code === 0) await git(repo, ['worktree', 'add', worktreeRecord.worktree, branch]);
  else await git(repo, ['worktree', 'add', '-b', branch, worktreeRecord.worktree, snapshot.baseHead]);
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
