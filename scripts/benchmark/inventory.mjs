#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { manifestErrors } from './results.mjs';
import { sha256 } from './common.mjs';

const execFileAsync = promisify(execFile);
const SOURCE_ROOT = 'src/levels';
const DESTINATION_ROOT = 'src/benchmark-levels';
const REQUIRED_GATES = ['typecheck', 'build', 'scope', 'floor'];
const MANIFEST_KEYS = new Set(['schemaVersion', 'benchmarkVersion', 'runId', 'slotId', 'configuration', 'theme', 'baseline', 'recipe', 'controller', 'timing', 'stages', 'cost', 'gates', 'output', 'disposition']);

/**
 * Read only controller-owned records and Git objects to make the migration
 * inventory. Directory names and visual similarity are never used as evidence
 * that a level is benchmark output.
 */
export async function buildMigrationInventory({ root = process.cwd(), privateRoot, publicRoots, allowBlocked = false } = {}) {
  const repositoryRoot = path.resolve(root);
  const privateDirectory = path.resolve(privateRoot ?? path.join(repositoryRoot, 'benchmark/private'));
  const publishedDirectories = (publicRoots ?? [
    path.join(repositoryRoot, 'benchmark/public'),
    path.join(repositoryRoot, 'benchmark/manifests'),
  ]).map((directory) => path.resolve(directory));
  const files = await collectManifestFiles(repositoryRoot, privateDirectory, publishedDirectories);
  const grouped = new Map();
  for (const file of files) {
    const manifest = await readJson(file.path);
    if (!looksLikeManifest(manifest)) continue;
    const group = grouped.get(manifest.runId) ?? [];
    group.push({ ...file, manifest });
    grouped.set(manifest.runId, group);
  }
  const records = [];
  const byLevelId = new Map();
  const byPayloadCommit = new Map();

  for (const copies of grouped.values()) {
    assertConsistentManifestCopies(copies);
    const authoritative = copies.find((file) => file.kind === 'private' || file.kind === 'private-archive') ?? copies[0];
    const publicManifestPaths = copies.filter((file) => file.kind === 'published').map((file) => relative(repositoryRoot, file.path)).sort();
    const record = await makeRecord({ repositoryRoot, privateDirectory, publishedDirectories, file: authoritative, manifest: authoritative.manifest, manifestCopies: copies, publicManifestPaths });
    if (record.levelId) {
      const duplicateLevel = byLevelId.get(record.levelId);
      if (duplicateLevel) throw new Error(`Migration inventory has duplicate level id ${record.levelId}: ${duplicateLevel} and ${record.manifestPath}`);
      byLevelId.set(record.levelId, record.manifestPath);
    }
    if (record.payloadCommit) {
      const duplicatePayload = byPayloadCommit.get(record.payloadCommit);
      if (duplicatePayload && duplicatePayload.levelId !== record.levelId) throw new Error(`Migration inventory has a conflicting payload commit ${record.payloadCommit}: ${duplicatePayload.manifestPath} and ${record.manifestPath}`);
      byPayloadCommit.set(record.payloadCommit, record);
    }
    records.push(record);
  }

  records.sort((left, right) => left.runId.localeCompare(right.runId));
  const candidates = records.filter((record) => record.disposition === 'playable');
  const cleanupCandidates = records.filter((record) => record.disposition !== 'playable' && (record.source.presentInPrimaryWorktree || (record.cleanup && record.cleanup.status !== 'completed')));
  const safetyErrors = records.flatMap((record) => {
    const mustBeVerified = record.disposition === 'playable' || record.source.presentInPrimaryWorktree;
    return mustBeVerified ? record.errors.map((error) => `${record.runId}: ${error}`) : [];
  });
  if (safetyErrors.length && !allowBlocked) throw new Error(`Migration inventory rejected:\n${safetyErrors.map((error) => `- ${error}`).join('\n')}`);

  return {
    schemaVersion: 1,
    kind: 'existing-output-migration-inventory',
    sources: {
      private: path.relative(repositoryRoot, privateDirectory).replaceAll(path.sep, '/'),
      published: publishedDirectories.map((directory) => path.relative(repositoryRoot, directory).replaceAll(path.sep, '/')),
    },
    records,
    candidates: candidates.map((record) => record.runId),
    cleanupCandidates: cleanupCandidates.map((record) => record.runId),
    blocked: safetyErrors.length > 0,
    errors: safetyErrors,
  };
}

async function makeRecord({ repositoryRoot, privateDirectory, publishedDirectories, file, manifest, manifestCopies = [], publicManifestPaths = [] }) {
  const manifestPath = relative(repositoryRoot, file.path);
  const runId = manifest.runId;
  if (typeof runId !== 'string' || !runId) throw new Error(`Manifest ${manifestPath} has no runId.`);
  const privateRun = await locatePrivateRun(repositoryRoot, privateDirectory, runId, file);
  const definition = privateRun ? await optionalJson(path.join(privateRun, 'run-definition.json')) : null;
  const payloadRecord = privateRun ? await optionalJson(path.join(privateRun, 'payload.json')) : null;
  const evaluatedRecord = privateRun ? await optionalJson(path.join(privateRun, 'evaluated.json')) : null;
  const gatesRecord = privateRun ? await optionalJson(path.join(privateRun, 'gates', 'gates.json')) : null;
  const cleanupRecord = privateRun ? await optionalJson(path.join(privateRun, 'source-cleanup.json')) : null;
  const levelId = manifest.output?.levelId ?? definition?.assignment?.levelId ?? null;
  const resolvedPublicManifestPaths = publicManifestPaths.length > 0
    ? publicManifestPaths
    : (publishedDirectories.includes(file.root) || publishedDirectories.some((directory) => isInside(file.path, directory))
      ? [manifestPath]
      : await findPublishedManifestPaths(repositoryRoot, publishedDirectories, runId));
  const privateRollout = privateRun ? await findRolloutEvidence(privateRun, manifest) : { present: false, paths: [] };
  const publicRollout = await findPublicRolloutEvidence(repositoryRoot, publishedDirectories, runId);
  const rollout = {
    present: privateRollout.present || publicRollout.present,
    paths: privateRollout.paths,
    publicPaths: publicRollout.paths,
    manifestArtifactRecorded: privateRollout.manifestArtifactRecorded,
  };
  const record = {
    manifestPath,
    manifestSha256: sha256(await fs.readFile(file.path)),
    manifestCopies: manifestCopies.map((copy) => ({ path: relative(repositoryRoot, copy.path), kind: copy.kind })).sort((left, right) => left.path.localeCompare(right.path)),
    recordKind: file.kind,
    benchmarkVersion: manifest.benchmarkVersion ?? definition?.benchmarkVersion ?? null,
    runId,
    slotId: manifest.slotId ?? definition?.assignment?.slotId ?? null,
    themeId: manifest.theme?.id ?? definition?.assignment?.theme?.id ?? themeIdFromPath(manifest.theme?.path ?? definition?.assignment?.theme?.path),
    levelId,
    title: manifest.output?.title ?? definition?.assignment?.levelTitle ?? null,
    disposition: manifest.disposition?.status ?? null,
    gateStatus: gateStatus(manifest.gates),
    evaluatedCommit: manifest.output?.evaluated?.commit ?? evaluatedRecord?.evaluatedCommit ?? null,
    evaluatedBranch: manifest.output?.evaluated?.branch ?? null,
    payloadCommit: manifest.output?.payload?.commit ?? payloadRecord?.payloadCommit ?? null,
    payloadBranch: manifest.output?.payload?.branch ?? payloadRecord?.branch ?? null,
    source: {
      path: levelId ? `${SOURCE_ROOT}/${levelId}/` : null,
      presentInPrimaryWorktree: Boolean(levelId && await exists(path.join(repositoryRoot, SOURCE_ROOT, levelId))),
      bytesAgreeWithPayload: null,
      files: [],
      payloadTreeSha256: null,
      treeSha256: null,
      applicationCommit: null,
      applicationTreeSha256: null,
    },
    publicManifest: {
      present: resolvedPublicManifestPaths.length > 0,
      paths: resolvedPublicManifestPaths,
    },
    rolloutEvidence: rollout,
    privateRunDirectory: privateRun ? relative(repositoryRoot, privateRun) : null,
    cleanup: cleanupRecord ? { status: cleanupRecord.status ?? null, cleanupCommit: cleanupRecord.cleanupCommit ?? null, statePath: relative(repositoryRoot, path.join(privateRun, 'source-cleanup.json')) } : null,
    errors: [],
  };

  if (record.disposition !== 'playable' && !record.source.presentInPrimaryWorktree) {
    record.status = 'not-applicable';
    return record;
  }
  const shapeErrors = manifestErrors(manifest);
  if (record.disposition === 'playable') record.errors.push(...shapeErrors);
  else record.errors.push(...shapeErrors.filter((error) => !error.includes('theme.id and output.title') && !error.includes('current theme/output metadata')));
  if (!definition) record.errors.push('private run-definition.json is missing.');
  if (!payloadRecord) record.errors.push('private payload.json is missing.');
  if (!evaluatedRecord) record.errors.push('private evaluated.json is missing.');
  if (!gatesRecord) record.errors.push('private gates/gates.json is missing.');
  if (record.disposition === 'playable' && definition?.mode !== 'eligible') record.errors.push('run definition is not an eligible benchmark run.');
  if (definition && !sameAssignmentMetadata(manifest, definition)) record.errors.push('manifest and run definition assignment metadata disagree.');
  if (payloadRecord && manifest.output?.payload?.commit !== payloadRecord.payloadCommit) record.errors.push('manifest and payload.json disagree about the payload commit.');
  if (payloadRecord && manifest.output?.payload?.branch !== payloadRecord.branch) record.errors.push('manifest and payload.json disagree about the payload branch.');
  if (evaluatedRecord && manifest.output?.evaluated?.commit !== evaluatedRecord.evaluatedCommit) record.errors.push('manifest and evaluated.json disagree about the evaluated commit.');
  if (gatesRecord && manifest.output?.evaluated?.commit !== gatesRecord.evaluatedCommit) record.errors.push('recorded gates do not match the manifest evaluated commit.');
  if (gatesRecord) {
    const gateErrors = validateGates(gatesRecord.gates);
    record.errors.push(...gateErrors);
    const manifestGateMap = new Map((manifest.gates ?? []).map((gate) => [gate?.id, gate?.status]));
    for (const gate of gatesRecord.gates ?? []) if (manifestGateMap.get(gate?.id) !== gate?.status) record.errors.push(`gate ${gate?.id ?? '<missing>'} disagrees between manifest and gates.json.`);
  }

  if (record.errors.length) return record;
  try {
    const materialsCommit = await resolveCommit(repositoryRoot, definition.baseline?.materialsCommit, 'materials commit');
    const evaluatedCommit = await resolveCommit(repositoryRoot, evaluatedRecord.evaluatedCommit, 'evaluated commit');
    const payloadCommit = await resolveCommit(repositoryRoot, payloadRecord.payloadCommit, 'payload commit');
    record.evaluatedCommit = evaluatedCommit;
    record.payloadCommit = payloadCommit;
    await assertBranch(repositoryRoot, manifest.output.evaluated.branch, evaluatedCommit, 'evaluated');
    await assertBranch(repositoryRoot, payloadRecord.branch, payloadCommit, 'payload');
    const evaluatedEntries = await treeEntries(repositoryRoot, evaluatedCommit, `${SOURCE_ROOT}/${levelId}`);
    const payloadEntries = await treeEntries(repositoryRoot, payloadCommit, `${SOURCE_ROOT}/${levelId}`);
    if (!evaluatedEntries.length || !payloadEntries.length) throw new Error('evaluated and payload commits must contain a non-empty assigned level directory.');
    assertNoSymlinks(evaluatedEntries, 'evaluated');
    assertNoSymlinks(payloadEntries, 'payload');
    assertSameTree(evaluatedEntries, payloadEntries, 'evaluated and payload source trees');
    if (payloadEntries.some((entry) => entry.relativePath === 'level.json')) throw new Error('payload contains a benchmark descriptor; the controller must own level.json.');
    const changed = await payloadDiff(repositoryRoot, materialsCommit, payloadCommit);
    if (!changed.length) throw new Error('payload diff is empty.');
    if (changed.some((entry) => !entry.path.startsWith(`${SOURCE_ROOT}/${levelId}/`))) throw new Error('payload diff contains a path outside the assigned level directory.');
    if (changed.some((entry) => /^[DRC]/.test(entry.status))) throw new Error('payload diff deletes, renames, or copies a path.');
    const sourcePath = path.join(repositoryRoot, SOURCE_ROOT, levelId);
    record.source.files = payloadEntries.map((entry) => entry.relativePath);
    record.source.payloadTreeSha256 = treeEntriesSha256(payloadEntries);
    if (record.source.presentInPrimaryWorktree) {
      const applicationCommit = await currentHead(repositoryRoot);
      const applicationEntries = await treeEntries(repositoryRoot, applicationCommit, `${SOURCE_ROOT}/${levelId}`);
      if (!applicationEntries.length) record.errors.push('primary source directory is not tracked at the current application commit.');
      else {
        record.source.applicationCommit = applicationCommit;
        record.source.applicationTreeSha256 = treeEntriesSha256(applicationEntries);
        if (record.source.applicationTreeSha256 !== record.source.payloadTreeSha256) record.errors.push('primary source differs from the current application commit.');
      }
      try {
        record.source.treeSha256 = await verifyFilesystemTree(sourcePath, payloadEntries, repositoryRoot);
        record.source.bytesAgreeWithPayload = true;
      } catch (error) {
        record.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    const destinationPath = path.join(repositoryRoot, DESTINATION_ROOT, levelId);
    record.destination = {
      path: `${DESTINATION_ROOT}/${levelId}/`,
      presentInPrimaryWorktree: await exists(destinationPath),
    };
    record.promotion = privateRun ? await optionalJson(path.join(privateRun, 'promotion.json')) : null;
    record.status = record.disposition === 'playable'
      ? (record.promotion?.status === 'completed' ? 'already-promoted' : (record.source.presentInPrimaryWorktree ? 'ready-for-legacy-relocation' : 'ready-for-payload-promotion'))
      : 'ready-for-source-cleanup';
  } catch (error) {
    record.errors.push(error instanceof Error ? error.message : String(error));
  }
  return record;
}

function sameAssignmentMetadata(manifest, definition) {
  const assignment = definition.assignment;
  if (!assignment || manifest.benchmarkVersion !== definition.benchmarkVersion || manifest.runId !== assignment.runId || manifest.slotId !== assignment.slotId) return false;
  if (manifest.configuration?.id !== assignment.configurationId) return false;
  if (manifest.baseline?.materialsCommit !== definition.baseline?.materialsCommit) return false;
  if (manifest.output?.levelId !== assignment.levelId) return false;
  if (Object.hasOwn(manifest.output ?? {}, 'title') && manifest.output.title !== assignment.levelTitle) return false;
  if (manifest.theme?.path !== assignment.theme?.path || manifest.theme?.sha256 !== assignment.theme?.sha256) return false;
  if (Object.hasOwn(manifest.theme ?? {}, 'id') && manifest.theme.id !== assignment.theme?.id) return false;
  return true;
}

function validateGates(gates) {
  if (!Array.isArray(gates)) return ['recorded gates are not an array.'];
  const ids = gates.map((gate) => gate?.id);
  const errors = [];
  if (new Set(ids).size !== ids.length || REQUIRED_GATES.some((id) => !ids.includes(id))) errors.push('recorded gates must account for the four required gates exactly once.');
  for (const gate of gates) if (gate?.status !== 'passed') errors.push(`recorded gate ${gate?.id ?? '<missing>'} did not pass.`);
  return errors;
}

function gateStatus(gates) {
  if (!Array.isArray(gates)) return null;
  return Object.fromEntries(gates.map((gate) => [gate?.id ?? '<missing>', gate?.status ?? null]));
}

async function collectManifestFiles(repositoryRoot, privateDirectory, publishedDirectories) {
  const roots = [
    { root: path.join(privateDirectory, 'runs'), kind: 'private', matchAllJson: false },
    { root: path.join(privateDirectory, 'archive', 'runs'), kind: 'private-archive', matchAllJson: false },
    ...publishedDirectories.map((root) => ({ root, kind: 'published', matchAllJson: true })),
  ];
  const files = [];
  for (const source of roots) {
    if (!await exists(source.root)) continue;
    for (const file of await walk(source.root)) {
      if (path.basename(file) !== 'manifest.json' && !(source.matchAllJson && file.endsWith('.json'))) continue;
      files.push({ path: file, root: source.root, kind: source.kind });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function locatePrivateRun(repositoryRoot, privateDirectory, runId, file) {
  if (file.kind === 'private' || file.kind === 'private-archive') return path.dirname(file.path);
  const candidates = [];
  for (const root of [path.join(privateDirectory, 'runs'), path.join(privateDirectory, 'archive', 'runs')]) {
    const candidate = path.join(root, runId);
    if (await exists(path.join(candidate, 'manifest.json'))) candidates.push(candidate);
  }
  if (candidates.length > 1) throw new Error(`Migration inventory has duplicate private records for run id ${runId}: ${candidates.join(', ')}`);
  return candidates[0] ?? null;
}

function assertConsistentManifestCopies(copies) {
  if (copies.length < 2) return;
  const reference = manifestFingerprint(copies[0].manifest);
  for (const copy of copies.slice(1)) {
    if (manifestFingerprint(copy.manifest) !== reference) {
      throw new Error(`Migration inventory has conflicting manifest copies for run id ${copies[0].manifest.runId}: ${copies.map((item) => item.path).join(' and ')}`);
    }
  }
}

function manifestFingerprint(manifest) {
  return stableValue(manifest);
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function findPublishedManifestPaths(repositoryRoot, publishedDirectories, runId) {
  const paths = [];
  for (const directory of publishedDirectories) {
    if (!await exists(directory)) continue;
    for (const file of await walk(directory)) {
      if (!file.endsWith('.json')) continue;
      const value = await optionalJson(file);
      if (value?.runId === runId && looksLikeManifest(value)) paths.push(relative(repositoryRoot, file));
    }
  }
  return paths.sort();
}

async function findRolloutEvidence(runDirectory, manifest) {
  const files = (await walk(runDirectory)).filter((file) => /(^|[/\\])rollout\.jsonl$/i.test(file) || /(^|[/\\])rollouts?[/\\]/i.test(file));
  const manifestEvidence = (manifest.stages ?? []).some((stage) => typeof stage?.rolloutArtifactSha256 === 'string' && stage.rolloutArtifactSha256.length > 0);
  return { present: files.length > 0 || manifestEvidence, paths: files.map((file) => path.relative(runDirectory, file).replaceAll(path.sep, '/')).sort(), manifestArtifactRecorded: manifestEvidence };
}

async function findPublicRolloutEvidence(repositoryRoot, publishedDirectories, runId) {
  const paths = [];
  for (const directory of publishedDirectories) {
    if (!await exists(directory)) continue;
    for (const file of await walk(directory)) {
      const normalized = file.replaceAll(path.sep, '/');
      if (!/(^|\/)(?:rollouts?|evidence)(?:\/|$)|(?:^|\/)rollout[^/]*\.(?:jsonl?|txt)$/i.test(normalized)) continue;
      const pathMentionsRun = normalized.includes(`/${runId}/`) || normalized.endsWith(`/${runId}.jsonl`) || normalized.endsWith(`/${runId}.json`);
      if (pathMentionsRun || await fileMentionsRunId(file, runId)) paths.push(relative(repositoryRoot, file));
    }
  }
  return { present: paths.length > 0, paths: [...new Set(paths)].sort() };
}

async function fileMentionsRunId(filePath, runId) {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(256 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).toString('utf8').includes(runId);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function treeEntries(root, commit, prefix) {
  const output = await gitBuffer(root, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', prefix]);
  const entries = [];
  for (const record of output.toString('utf8').split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error(`malformed Git tree entry for ${prefix}.`);
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    const fullPath = record.slice(tab + 1).replaceAll('\\', '/');
    const expectedPrefix = `${prefix}/`;
    if (!fullPath.startsWith(expectedPrefix)) throw new Error(`Git tree escaped assigned payload directory: ${fullPath}`);
    if (type !== 'blob') throw new Error(`payload contains unsupported Git object ${type} at ${fullPath}.`);
    entries.push({ relativePath: fullPath.slice(expectedPrefix.length), mode, type, oid });
  }
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return entries;
}

async function payloadDiff(root, materialsCommit, payloadCommit) {
  const output = await gitBuffer(root, ['diff', '--name-status', '-z', `${materialsCommit}..${payloadCommit}`]);
  const tokens = output.toString('utf8').split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const filePath = tokens[index++];
    if (!filePath) throw new Error('malformed payload diff.');
    entries.push({ status, path: filePath.replaceAll('\\', '/') });
    if (/^[RC]/.test(status)) {
      const oldPath = tokens[index++];
      if (!oldPath) throw new Error('malformed payload rename/copy diff.');
      entries.push({ status, path: oldPath.replaceAll('\\', '/') });
    }
  }
  return entries;
}

async function verifyFilesystemTree(directory, entries, root) {
  const actual = await collectFilesystemEntries(directory);
  const expected = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const expectedDirectories = new Set();
  for (const relativePath of expected.keys()) {
    const segments = relativePath.split('/');
    for (let index = 1; index < segments.length; index += 1) expectedDirectories.add(segments.slice(0, index).join('/'));
  }
  if ([...actual.directories].some((directoryName) => !expectedDirectories.has(directoryName))) throw new Error('primary source contains an unexpected directory.');
  if (actual.files.size !== expected.size) throw new Error('primary source file count does not match the payload commit.');
  const digests = [];
  const failures = [];
  for (const [relativePath, expectedEntry] of expected) {
    const item = actual.files.get(relativePath);
    if (!item) { failures.push(`primary source is missing ${relativePath}.`); continue; }
    if (item.kind === 'symlink') { failures.push(`primary source contains a symbolic link at ${relativePath}.`); continue; }
    const actualBytes = await fs.readFile(item.path);
    const expectedBytes = await gitBuffer(root, ['cat-file', 'blob', expectedEntry.oid]);
    if (!actualBytes.equals(expectedBytes)) failures.push(`primary source differs from payload at ${relativePath}.`);
    const executable = ((await fs.stat(item.path)).mode & 0o111) !== 0;
    if (executable !== (expectedEntry.mode === '100755')) failures.push(`primary source changed executable mode at ${relativePath}.`);
    digests.push({ path: relativePath, mode: executable ? '100755' : '100644', sha256: sha256(actualBytes) });
  }
  if (failures.length) throw new Error(failures.join('; '));
  return sha256(JSON.stringify(digests.sort((left, right) => left.path.localeCompare(right.path))));
}

async function collectFilesystemEntries(directory) {
  const files = new Map();
  const directories = new Set();
  async function visit(current, relativePath = '') {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const next = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      const info = await fs.lstat(full);
      if (info.isDirectory()) {
        directories.add(next);
        await visit(full, next);
      } else if (info.isFile() || info.isSymbolicLink()) files.set(next, { path: full, kind: info.isSymbolicLink() ? 'symlink' : 'file' });
      else throw new Error(`unsupported filesystem entry ${next}.`);
    }
  }
  await visit(directory);
  return { files, directories };
}

function assertSameTree(left, right, label) {
  if (left.length !== right.length) throw new Error(`${label} differ in file count.`);
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.relativePath !== b.relativePath || a.mode !== b.mode || a.type !== b.type || a.oid !== b.oid) throw new Error(`${label} differ at ${a.relativePath ?? b.relativePath}.`);
  }
}

function assertNoSymlinks(entries, label) {
  if (entries.some((entry) => entry.mode === '120000')) throw new Error(`${label} payload contains a symbolic link.`);
}

async function assertBranch(root, branch, commit, label) {
  if (typeof branch !== 'string' || !branch) throw new Error(`${label} branch is missing.`);
  const actual = await resolveCommit(root, `refs/heads/${branch}`, `${label} branch`);
  if (actual !== commit) throw new Error(`${label} branch does not resolve to its recorded commit.`);
}

function treeEntriesSha256(entries) {
  return sha256(JSON.stringify(entries.map((entry) => ({ path: entry.relativePath, mode: entry.mode, type: entry.type, oid: entry.oid }))));
}

async function currentHead(root) {
  return (await gitText(root, ['rev-parse', 'HEAD'])).trim();
}

async function resolveCommit(root, ref, label) {
  if (typeof ref !== 'string' || !ref) throw new Error(`${label} is missing.`);
  const value = (await gitText(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  if (!/^[a-f0-9]{40,64}$/.test(value)) throw new Error(`${label} did not resolve to a Git commit.`);
  return value;
}

function looksLikeManifest(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value.schemaVersion === 2 || MANIFEST_KEYS.has('runId') && typeof value.runId === 'string' && 'disposition' in value && 'output' in value));
}

function themeIdFromPath(value) {
  return value ? path.basename(value, path.extname(value)) : null;
}

function relative(root, filePath) { return path.relative(root, filePath).replaceAll(path.sep, '/'); }
function isInside(child, parent) { const relativePath = path.relative(path.resolve(parent), path.resolve(child)); return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath)); }

async function walk(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) result.push(full);
    }
  }
  await visit(directory);
  return result.sort();
}

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { throw new Error(`Invalid JSON in ${filePath}: ${error.message}`); }
}

async function optionalJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw new Error(`Invalid JSON in ${filePath}: ${error.message}`); }
}

async function exists(filePath) { try { await fs.lstat(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
async function gitText(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout; }
async function gitBuffer(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })).stdout; }

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  buildMigrationInventory().then((inventory) => console.log(JSON.stringify(inventory, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
