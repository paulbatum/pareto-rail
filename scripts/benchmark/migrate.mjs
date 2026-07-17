#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildMigrationInventory } from './inventory.mjs';
import { acquirePromotionLock, builtInRegistryHasEntry, promoteRun, removeBuiltInRegistryEntry } from './promote.mjs';
import { sha256 } from './common.mjs';
import { LEGACY_LEVEL_REGISTRY_PATH, LEVEL_GALLERY_PATH, levelFootprint } from './protocol.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execFileAsync = promisify(execFile);
const GALLERY_PATH = LEVEL_GALLERY_PATH;
const REGISTRY_PATH = LEGACY_LEVEL_REGISTRY_PATH;

export class CleanupInterrupted extends Error {
  constructor(checkpoint) {
    super(`Synthetic interruption after cleanup checkpoint ${checkpoint}.`);
    this.name = 'CleanupInterrupted';
    this.checkpoint = checkpoint;
  }
}

/** Run the existing-output migration as a sequence of ordinary verified promotions. */
export async function migrateExistingOutputs({ root = ROOT, version, inventoryPath, acceptDiverged = [] } = {}) {
  const repositoryRoot = path.resolve(root);
  const acceptedDiverged = [...new Set(acceptDiverged)];
  const inventory = await buildMigrationInventory({ root: repositoryRoot, allowBlocked: true, acceptedDiverged });
  const migrationDirectory = path.join(repositoryRoot, 'benchmark/private/migrations');
  await fs.mkdir(migrationDirectory, { recursive: true });
  const reportPath = path.resolve(inventoryPath ?? path.join(migrationDirectory, `${version ?? 'all'}-inventory.json`));
  await writeJson(reportPath, inventory);
  if (inventory.blocked) throw new Error(`Migration inventory rejected with ${inventory.errors.length} safety error(s); see ${path.relative(repositoryRoot, reportPath).replaceAll(path.sep, '/')}.`);
  const knownLevelIds = new Set(inventory.records.map((record) => record.levelId));
  for (const levelId of acceptedDiverged) if (!knownLevelIds.has(levelId)) throw new Error(`Cannot accept divergence for unknown level ${levelId}.`);
  const selected = inventory.records.filter((record) => (record.disposition === 'playable' || record.source.derivative) && (!version || record.benchmarkVersion === version));
  const cleanups = inventory.records.filter((record) => record.disposition !== 'playable' && !record.source.derivative && (record.source.presentInPrimaryWorktree || (record.cleanup && record.cleanup.status !== 'completed')) && (!version || record.benchmarkVersion === version));
  const migrationPlanLevelIds = [...new Set(inventory.records.filter((record) => (!version || record.benchmarkVersion === version) && (record.disposition === 'playable' || acceptedDiverged.includes(record.levelId) || record.source.derivative)).map((record) => record.levelId))].sort();
  if (!selected.length && !cleanups.length) throw new Error('Migration inventory contains no playable records or verified source copies for the requested benchmark version.');
  for (const record of selected) {
    if (!record.privateRunDirectory) throw new Error(`Playable run ${record.runId} has no private run record required by the promotion path.`);
  }
  for (const record of cleanups) {
    if (!record.privateRunDirectory || record.source.bytesAgreeWithPayload !== true) throw new Error(`Source cleanup for ${record.runId} lacks a verified private record and exact payload bytes.`);
  }

  const recordPath = path.join(migrationDirectory, `${version ?? 'all'}.json`);
  const existingMigration = await optionalJson(recordPath);
  const migration = existingMigration?.schemaVersion === 1 && existingMigration.kind === 'existing-output-migration'
    ? { ...existingMigration, status: 'running', failure: undefined, inventoryPath: path.relative(repositoryRoot, reportPath).replaceAll(path.sep, '/') }
    : {
      schemaVersion: 1,
      kind: 'existing-output-migration',
      status: 'running',
      inventoryPath: path.relative(repositoryRoot, reportPath).replaceAll(path.sep, '/'),
      inventorySha256: sha256(stableJson(inventory)),
      entries: [],
      cleanups: [],
    };
  migration.migrationLevelIds = migrationPlanLevelIds;
  migration.entries ??= [];
  migration.cleanups ??= [];
  await writeJson(recordPath, migration);

  try {
    for (const candidate of selected) {
      const result = await promoteRun({
        root: repositoryRoot,
        runDirectory: path.join(repositoryRoot, candidate.privateRunDirectory),
        migration: true,
        acceptDiverged: candidate.source.derivative,
        migrationLevelIds: migrationPlanLevelIds,
      });
      const entry = {
        benchmarkVersion: candidate.benchmarkVersion,
        runId: candidate.runId,
        levelId: candidate.levelId,
        sourcePayloadCommit: candidate.payloadCommit,
        evaluatedCommit: candidate.evaluatedCommit,
        sourcePath: candidate.source.path,
        destinationPath: candidate.destination?.path ?? `src/benchmark-levels/${candidate.levelId}/`,
        sourcePresentInPrimaryWorktree: candidate.source.presentInPrimaryWorktree,
        sourceBytesAgreeWithPayload: candidate.source.bytesAgreeWithPayload,
        ...(candidate.source.derivative ? { derivative: candidate.source.derivative } : {}),
        floor: await migrationFloorCheck(repositoryRoot, path.join(repositoryRoot, candidate.privateRunDirectory), result.checks),
        promotionCommit: result.promotionCommit,
      };
      upsertMigrationEntry(migration.entries, entry);
      await writeJson(recordPath, migration);
    }
    for (const candidate of cleanups) {
      const result = await cleanupVerifiedSourceCopy({ root: repositoryRoot, runDirectory: path.join(repositoryRoot, candidate.privateRunDirectory), record: candidate });
      upsertMigrationEntry(migration.cleanups, {
        benchmarkVersion: candidate.benchmarkVersion,
        runId: candidate.runId,
        levelId: candidate.levelId,
        disposition: candidate.disposition,
        evaluatedCommit: candidate.evaluatedCommit,
        payloadCommit: candidate.payloadCommit,
        evaluatedBranch: candidate.evaluatedBranch,
        payloadBranch: candidate.payloadBranch,
        sourcePath: candidate.source.path,
        sourceBytesAgreeWithPayload: candidate.source.bytesAgreeWithPayload,
        sourceTreeSha256: candidate.source.treeSha256,
        payloadTreeSha256: candidate.source.payloadTreeSha256,
        applicationCommit: candidate.source.applicationCommit,
        cleanupStatePath: result.statePath,
        cleanupCommit: result.cleanupCommit,
      });
      await writeJson(recordPath, migration);
    }
    const finalCleanups = [...cleanups, ...migration.cleanups.map((entry) => ({ runId: entry.runId, levelId: entry.levelId }))].filter((record, index, records) => records.findIndex((candidate) => candidate.runId === record.runId) === index);
    migration.verification = await runFinalCatalogCheck(repositoryRoot, selected, finalCleanups);
    migration.status = 'completed';
    migration.completedAt = new Date().toISOString();
    await writeJson(recordPath, migration);
  } catch (error) {
    migration.status = 'failed';
    migration.failure = { message: error instanceof Error ? error.message : String(error) };
    await writeJson(recordPath, migration);
    throw error;
  }
  return { status: migration.status, inventoryPath: path.relative(repositoryRoot, reportPath).replaceAll(path.sep, '/'), recordPath: path.relative(repositoryRoot, recordPath).replaceAll(path.sep, '/'), promoted: migration.entries.length, cleaned: migration.cleanups.length };
}

export async function cleanupVerifiedSourceCopy({ root = ROOT, runDirectory, record, interruptAfter, lockHeld = false } = {}) {
  if (!runDirectory || !record?.runId || record.disposition === 'playable') throw new Error('Source cleanup requires a non-playable manifest record.');
  const repositoryRoot = path.resolve(root);
  const lock = lockHeld ? null : await acquirePromotionLock(repositoryRoot);
  try {
    return await cleanupVerifiedSourceCopyUnlocked({ repositoryRoot, runDirectory, record, interruptAfter });
  } finally {
    if (lock) await lock.release();
  }
}

async function cleanupVerifiedSourceCopyUnlocked({ repositoryRoot, runDirectory, record, interruptAfter }) {
  const resolvedRunDirectory = path.resolve(runDirectory);
  const statePath = path.join(resolvedRunDirectory, 'source-cleanup.json');
  const state = await loadCleanupState(statePath, record.runId);

  if (state.status === 'completed') {
    await verifyCleanupCommit(repositoryRoot, state.cleanupCommit, state.source);
    assertCleanupWorkingTree(await gitStatus(repositoryRoot), repositoryRoot, state.source.levelId, false);
    for (const rootEntry of cleanupRoots(state.source)) {
      if (await exists(path.join(repositoryRoot, rootEntry.path))) throw new Error(`Completed source cleanup still has ${rootEntry.path}.`);
    }
    return { statePath: path.relative(repositoryRoot, statePath).replaceAll(path.sep, '/'), cleanupCommit: state.cleanupCommit };
  }

  assertCleanupWorkingTree(await gitStatus(repositoryRoot), repositoryRoot, record.levelId, Boolean(state.checkpoints.registry?.status === 'completed' || state.checkpoints.source?.status === 'completed'));

  if (state.checkpoints.validation?.status !== 'completed') {
    const fresh = await buildMigrationInventory({ root: repositoryRoot });
    const verified = fresh.records.find((candidate) => candidate.runId === record.runId);
    if (!verified || verified.disposition === 'playable' || !verified.source.presentInPrimaryWorktree || verified.source.bytesAgreeWithPayload !== true || verified.errors.length > 0) {
      throw new Error(`Source cleanup validation failed for ${record.runId}; payload refs and source bytes must be reverified.`);
    }
    const baseCommit = await currentHead(repositoryRoot);
    const registryPresent = await builtInRegistryHasEntry(repositoryRoot, verified.levelId);
    if (!registryPresent) throw new Error(`Source cleanup for ${record.runId} is not registered as a built-in level.`);
    state.source = {
      runId: verified.runId,
      levelId: verified.levelId,
      benchmarkVersion: verified.benchmarkVersion,
      manifestSha256: verified.manifestSha256,
      evaluatedCommit: verified.evaluatedCommit,
      evaluatedBranch: verified.evaluatedBranch,
      payloadCommit: verified.payloadCommit,
      payloadBranch: verified.payloadBranch,
      sourcePath: verified.source.path,
      sourceFiles: [...verified.source.files],
      roots: verified.source.roots.map((rootEntry) => ({ ...rootEntry, files: [...rootEntry.files] })),
      sourceTreeSha256: verified.source.treeSha256,
      payloadTreeSha256: verified.source.payloadTreeSha256,
      applicationCommit: verified.source.applicationCommit,
      applicationTreeSha256: verified.source.applicationTreeSha256,
      baseCommit,
      bytesAgreeWithPayload: verified.source.bytesAgreeWithPayload,
      disposition: verified.disposition,
      registryPresent,
    };
    state.checkpoints.validation = { status: 'completed', finishedAt: new Date().toISOString() };
    await writeJson(statePath, state);
    await interruptCleanup(interruptAfter, 'validation');
  }

  if (await currentHead(repositoryRoot) !== state.source.baseCommit && !state.cleanupCommit) throw new Error('Cleanup base commit changed before its administrative commit.');

  if (state.checkpoints.registry?.status !== 'completed') {
    assertCleanupWorkingTree(await gitStatus(repositoryRoot), repositoryRoot, state.source.levelId, false);
    await removeBuiltInRegistryEntry(repositoryRoot, state.source.levelId, { allowMissing: false });
    state.checkpoints.registry = { status: 'completed', finishedAt: new Date().toISOString() };
    await writeJson(statePath, state);
    await interruptCleanup(interruptAfter, 'registry');
  }
  if (state.checkpoints.source?.status !== 'completed') {
    assertCleanupWorkingTree(await gitStatus(repositoryRoot), repositoryRoot, state.source.levelId, true);
    const roots = cleanupRoots(state.source);
    let anyRootPresent = false;
    for (const rootEntry of roots) {
      if (rootEntry.presentInPrimaryWorktree && await exists(path.join(repositoryRoot, rootEntry.path))) anyRootPresent = true;
    }
    if (anyRootPresent) {
      const fresh = await buildMigrationInventory({ root: repositoryRoot });
      const verified = fresh.records.find((candidate) => candidate.runId === record.runId);
      if (!verified || verified.source.bytesAgreeWithPayload !== true || verified.source.treeSha256 !== state.source.sourceTreeSha256) throw new Error(`Source cleanup for ${record.runId} changed after validation; refusing deletion.`);
      for (const rootEntry of roots) {
        if (!rootEntry.presentInPrimaryWorktree) continue;
        const freshRoot = verified.source.roots.find((candidate) => candidate.id === rootEntry.id);
        if (!freshRoot || freshRoot.treeSha256 !== rootEntry.treeSha256) throw new Error(`Footprint root ${rootEntry.path} changed after validation; refusing deletion.`);
      }
    }
    for (const rootEntry of roots) {
      const rootPath = path.join(repositoryRoot, rootEntry.path);
      if (rootEntry.presentInPrimaryWorktree && await exists(rootPath)) await fs.rm(rootPath, { recursive: true, force: false });
    }
    state.checkpoints.source = { status: 'completed', finishedAt: new Date().toISOString() };
    await writeJson(statePath, state);
    await interruptCleanup(interruptAfter, 'source');
  }

  if (state.checkpoints.catalog?.status !== 'completed') {
    assertCleanupWorkingTree(await gitStatus(repositoryRoot), repositoryRoot, state.source.levelId, true);
    const gallery = await runCommand(repositoryRoot, 'npm', ['run', 'gallery']);
    if (gallery.code !== 0) throw new Error(`Cleanup gallery regeneration failed: ${gallery.stderr || gallery.stdout}`);
    state.source.galleryChanged = parseStatus(await gitStatus(repositoryRoot)).includes(GALLERY_PATH);
    state.checkpoints.catalog = { status: 'completed', finishedAt: new Date().toISOString() };
    await writeJson(statePath, state);
    await interruptCleanup(interruptAfter, 'catalog');
  }

  if (state.checkpoints.commit?.status !== 'completed') {
    const head = await currentHead(repositoryRoot);
    if (head !== state.source.baseCommit) {
      await verifyCleanupCommit(repositoryRoot, head, state.source);
      state.cleanupCommit = head;
    } else {
      assertCleanupWorkingTree(await gitStatus(repositoryRoot), repositoryRoot, state.source.levelId, true);
      const expected = cleanupExpectedPaths(state.source);
      await git(repositoryRoot, ['add', '--', ...expected]);
      const staged = (await gitText(repositoryRoot, ['diff', '--cached', '--name-only'])).split('\n').map((item) => item.trim()).filter(Boolean).sort();
      if (JSON.stringify(staged) !== JSON.stringify([...expected].sort())) throw new Error('Cleanup commit contains an unexpected staged path.');
      await git(repositoryRoot, ['commit', '-m', `Remove verified benchmark source ${state.source.levelId}`]);
      state.cleanupCommit = await currentHead(repositoryRoot);
      await verifyCleanupCommit(repositoryRoot, state.cleanupCommit, state.source);
    }
    state.checkpoints.commit = { status: 'completed', finishedAt: new Date().toISOString(), cleanupCommit: state.cleanupCommit };
    await writeJson(statePath, state);
    await interruptCleanup(interruptAfter, 'commit');
  }

  await verifyCleanupCommit(repositoryRoot, state.cleanupCommit, state.source);
  assertCleanupWorkingTree(await gitStatus(repositoryRoot), repositoryRoot, state.source.levelId, false);
  state.status = 'completed';
  state.completedAt = new Date().toISOString();
  await writeJson(statePath, state);
  return { statePath: path.relative(repositoryRoot, statePath).replaceAll(path.sep, '/'), cleanupCommit: state.cleanupCommit };
}

function cleanupRoots(source) {
  if (Array.isArray(source.roots) && source.roots.length) return source.roots;
  const sourceRoot = levelFootprint(source.levelId, source.benchmarkVersion ?? 'v1').roots.find((rootEntry) => rootEntry.required);
  return [{
    id: 'source',
    path: sourceRoot.path,
    promotedPath: sourceRoot.promotedPath,
    required: true,
    presentInPrimaryWorktree: true,
    files: source.sourceFiles,
    treeSha256: source.sourceTreeSha256,
    payloadTreeSha256: source.payloadTreeSha256,
    applicationTreeSha256: source.applicationTreeSha256,
  }];
}

function cleanupExpectedPaths(source) {
  const rootFiles = cleanupRoots(source).filter((rootEntry) => rootEntry.presentInPrimaryWorktree).flatMap((rootEntry) => rootEntry.files.map((file) => `${rootEntry.path.replace(/\/$/, '')}/${file}`));
  return new Set([...(source.galleryChanged ? [GALLERY_PATH] : []), REGISTRY_PATH, ...rootFiles]);
}

async function verifyCleanupCommit(root, commit, source) {
  if (typeof commit !== 'string' || !/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Cleanup commit is missing or invalid.');
  const resolved = await resolveCommit(root, commit, 'cleanup commit');
  const parent = (await gitText(root, ['rev-list', '--parents', '-n', '1', resolved])).trim().split(/\s+/)[1];
  if (parent !== source.baseCommit) throw new Error('Cleanup commit is not a child of its recorded application parent.');
  if (source.applicationCommit !== source.baseCommit || !source.sourceTreeSha256 || !source.applicationTreeSha256 || !source.payloadTreeSha256) throw new Error('Cleanup provenance is incomplete.');
  const expected = cleanupExpectedPaths(source);
  const names = (await gitText(root, ['diff', '--name-only', `${source.baseCommit}..${resolved}`])).split('\n').map((item) => item.trim()).filter(Boolean).sort();
  if (JSON.stringify(names) !== JSON.stringify([...expected].sort())) throw new Error('Cleanup commit contains paths outside the verified source copy and built-in registry.');
  for (const rootEntry of cleanupRoots(source).filter((candidate) => candidate.presentInPrimaryWorktree)) {
    const remainingEntries = await gitText(root, ['ls-tree', '-r', '--name-only', resolved, '--', rootEntry.path]);
    if (remainingEntries.trim()) throw new Error(`Cleanup commit still contains removed footprint root ${rootEntry.path}.`);
    const baseEntries = await treeEntries(root, source.baseCommit, rootEntry.path.replace(/\/$/, ''));
    if (treeEntriesSha256(baseEntries) !== rootEntry.applicationTreeSha256 || rootEntry.applicationTreeSha256 !== rootEntry.payloadTreeSha256) throw new Error(`Cleanup commit parent does not preserve provenance for footprint root ${rootEntry.path}.`);
  }
  const registry = await gitText(root, ['show', `${resolved}:${REGISTRY_PATH}`]);
  if (registryHasId(registry, source.levelId)) throw new Error('Cleanup commit still registers the removed built-in level.');
  await resolveCommit(root, source.payloadCommit, 'source payload commit');
  await resolveCommit(root, source.evaluatedCommit, 'source evaluated commit');
  if (await resolveCommit(root, `refs/heads/${source.payloadBranch}`, 'source payload branch') !== source.payloadCommit) throw new Error('Cleanup provenance payload branch does not match its payload commit.');
  if (await resolveCommit(root, `refs/heads/${source.evaluatedBranch}`, 'source evaluated branch') !== source.evaluatedCommit) throw new Error('Cleanup provenance evaluated branch does not match its evaluated commit.');
  return resolved;
}

function registryHasId(source, levelId) {
  const escaped = levelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bid:\\s*'${escaped}'\\b`).test(source) || new RegExp(`['"]${escaped}['"]\\s*:`).test(source);
}

async function treeEntries(root, commit, prefix) {
  const output = await gitBuffer(root, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', prefix]);
  return output.toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    const [mode, type, oid] = entry.slice(0, tab).split(' ');
    const fullPath = entry.slice(tab + 1).replaceAll('\\', '/');
    return { relativePath: fullPath.slice(`${prefix}/`.length), mode, type, oid };
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function treeEntriesSha256(entries) {
  return sha256(JSON.stringify(entries.map((entry) => ({ path: entry.relativePath, mode: entry.mode, type: entry.type, oid: entry.oid }))));
}

async function resolveCommit(root, ref, label) {
  const value = (await gitText(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  if (!/^[a-f0-9]{40,64}$/.test(value)) throw new Error(`${label} did not resolve to a Git commit.`);
  return value;
}

async function currentHead(root) {
  return (await gitText(root, ['rev-parse', 'HEAD'])).trim();
}

async function gitText(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout; }
async function gitBuffer(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })).stdout; }
async function git(cwd, args) { await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
async function gitStatus(root) { return gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']); }

function parseStatus(status) { return status.split('\n').map((line) => line.slice(3)).filter(Boolean); }
function assertCleanupWorkingTree(status, root, levelId, allowExpected) {
  const paths = parseStatus(status);
  if (!paths.length) return;
  if (!allowExpected) throw new Error(`Refusing unrelated dirty worktree before cleanup: ${paths.join(', ')}`);
  const ownedRoots = levelFootprint(levelId, 'v1').roots;
  for (const item of paths) {
    const normalized = item.replaceAll(path.sep, '/');
    const inOwnedRoot = ownedRoots.some((rootEntry) => normalized.startsWith(`${rootEntry.path}/`));
    if (normalized !== GALLERY_PATH && normalized !== REGISTRY_PATH && !inOwnedRoot) throw new Error(`Refusing unrelated dirty worktree during cleanup: ${item}`);
  }
}

async function interruptCleanup(value, checkpoint) {
  if (value === checkpoint) throw new CleanupInterrupted(checkpoint);
}

function upsertMigrationEntry(entries, entry) {
  const index = entries.findIndex((candidate) => candidate.runId === entry.runId);
  if (index < 0) entries.push(entry);
  else entries[index] = entry;
}

async function migrationFloorCheck(root, runDirectory, checks = []) {
  const check = checks.find((candidate) => candidate.id === 'floor');
  if (!check) return null;
  const log = await optionalJson(path.join(runDirectory, 'promotion-checks', 'floor.json'));
  return {
    status: check.status ?? (check.exitCode === 0 ? 'passed' : 'failed'),
    command: check.command,
    result: {
      exitCode: check.exitCode,
      stdout: log?.stdout ?? null,
      stderr: log?.stderr ?? null,
      stdoutSha256: check.stdoutSha256,
      stderrSha256: check.stderrSha256,
    },
    note: check.note ?? (check.exitCode === 0 ? 'Floor check passed during migration.' : 'Floor check failed during migration.'),
  };
}

async function optionalJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function loadCleanupState(filePath, runId) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (value.schemaVersion !== 1 || value.runId !== runId || !value.checkpoints) throw new Error('Source cleanup state is invalid or tampered.');
    return value;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { schemaVersion: 1, kind: 'verified-source-cleanup', runId, status: 'running', checkpoints: {} };
  }
}

async function runFinalCatalogCheck(root, promotedRecords, cleanupRecords) {
  const checks = [];
  for (const [id, args] of [['gallery', ['run', 'gallery']], ['typecheck', ['run', 'typecheck']], ['build', ['run', 'build']]]) {
    const result = await runCommand(root, 'npm', args);
    checks.push({ id, exitCode: result.code, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr) });
    if (result.code !== 0) throw new Error(`Final ${id} check failed: ${result.stderr || result.stdout}`);
  }
  const inventory = await buildMigrationInventory({ root });
  for (const record of promotedRecords) {
    const current = inventory.records.find((candidate) => candidate.runId === record.runId);
    if (!current || !await exists(path.join(root, 'src/benchmark-levels', record.levelId, 'level.json'))) throw new Error(`Final benchmark catalog is missing a promoted level.`);
    if (current.source.presentInPrimaryWorktree || await builtInRegistryHasEntry(root, record.levelId)) throw new Error('Final membership still exposes a promoted level in the built-in domain.');
  }
  for (const record of cleanupRecords) {
    const ownedPaths = new Set(levelFootprint(record.levelId, 'v1').roots.flatMap((rootEntry) => [rootEntry.path, rootEntry.promotedPath]));
    for (const ownedPath of ownedPaths) if (await exists(path.join(root, ownedPath))) throw new Error('Final membership still contains a cleaned level footprint.');
    if (await builtInRegistryHasEntry(root, record.levelId)) throw new Error('Final membership still exposes a cleaned source in the built-in domain.');
  }
  return { checks, membership: { promoted: promotedRecords.length, cleaned: cleanupRecords.length } };
}

async function runCommand(cwd, executable, args) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function exists(filePath) { try { await fs.lstat(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
async function writeJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, stableJson(value), 'utf8');
  await fs.rename(temporary, filePath);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run benchmark:migrate -- [--repo <repository>] [--version <benchmark-version>] [--inventory <private-report-path>] [--accept-diverged <level-id>[,<level-id>...]]');
    return;
  }
  const options = parseOptions(args);
  const result = await migrateExistingOutputs(options);
  console.log(JSON.stringify(result));
}

function parseOptions(args) {
  const options = { root: ROOT };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    if (name === '--repo') options.root = path.resolve(value);
    else if (name === '--version') options.version = value;
    else if (name === '--inventory') options.inventoryPath = path.resolve(value);
    else if (name === '--accept-diverged') {
      options.acceptDiverged ??= [];
      for (const levelId of value.split(',')) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(levelId)) throw new Error(`Invalid level id for --accept-diverged: ${levelId}`);
        options.acceptDiverged.push(levelId);
      }
    } else throw new Error(`Unknown option ${name}`);
    index += 1;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
