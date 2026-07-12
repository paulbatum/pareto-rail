#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  assertOnlyOptions,
  fail,
  parseArgs,
  pathInside,
  readJson,
  requireOption,
  RUN_ID_PATTERN,
  sha256,
} from './common.mjs';
import { manifestErrors } from './results.mjs';
import { buildMigrationInventory } from './inventory.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REQUIRED_GATES = ['typecheck', 'build', 'scope', 'floor'];
const CHECKPOINTS = ['validation', 'extraction', 'descriptor', 'application', 'catalog', 'commit'];
const PROMOTION_SCHEMA_VERSION = 1;
const PROMOTION_LOCK_NAME = 'raild-benchmark-promotion.lock';
const SOURCE_ROOT = 'src/levels';
const DESTINATION_ROOT = 'src/benchmark-levels';
const GALLERY_PATH = 'docs/level-gallery.md';

export class PromotionInterrupted extends Error {
  constructor(checkpoint) {
    super(`Synthetic interruption after promotion checkpoint ${checkpoint}.`);
    this.name = 'PromotionInterrupted';
    this.checkpoint = checkpoint;
  }
}

/**
 * Promote one finalized playable run. This function is exported so the
 * controller and synthetic repository tests use exactly the same operation.
 * It never edits a run manifest.
 */
export async function promoteRun({ root = ROOT, runDirectory, interruptAfter, migration = false } = {}) {
  const repositoryRoot = path.resolve(root);
  if (!runDirectory) throw new Error('Promotion requires a run directory.');
  const resolvedRunDirectory = path.resolve(runDirectory);
  if (pathInside(resolvedRunDirectory, repositoryRoot) && !pathInside(resolvedRunDirectory, path.join(repositoryRoot, 'benchmark/private'))) {
    throw new Error('Promotion run records must be under benchmark/private or outside the repository.');
  }
  const lock = await acquirePromotionLock(repositoryRoot);
  let state;
  try {
    const runId = path.basename(resolvedRunDirectory);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Run directory must end with an opaque run id: ${runId}`);
    state = await loadOrCreateState(resolvedRunDirectory, runId);
    const context = { root: repositoryRoot, runDirectory: resolvedRunDirectory, runId, state, migration: migration || state.migration === true };
    if (state.migration !== undefined && state.migration !== context.migration) throw new Error('Promotion migration mode does not match its recorded state.');
    state.migration = context.migration;

    const validation = await checkpoint(context, 'validation', () => validatePreflight(context));
    context.preflight = validation;
    context.state.source = validation.source;
    context.state.updatedAt = new Date().toISOString();
    await writeAtomicJson(statePath(context), context.state);
    await interruptIfRequested(interruptAfter, 'validation');

    await checkpoint(context, 'extraction', () => extractPayload(context));
    await interruptIfRequested(interruptAfter, 'extraction');

    await checkpoint(context, 'descriptor', () => createDescriptor(context));
    await interruptIfRequested(interruptAfter, 'descriptor');

    await checkpoint(context, 'application', () => verifyApplication(context));
    await interruptIfRequested(interruptAfter, 'application');

    await checkpoint(context, 'catalog', (checkpointState) => updateCatalogAndRunChecks(context, checkpointState));
    await interruptIfRequested(interruptAfter, 'catalog');

    const committed = await checkpoint(context, 'commit', () => commitPromotion(context));
    await interruptIfRequested(interruptAfter, 'commit');

    context.state.status = 'completed';
    context.state.currentCheckpoint = null;
    context.state.promotionCommit = committed.promotionCommit;
    context.state.updatedAt = new Date().toISOString();
    await writeAtomicJson(statePath(context), context.state);
    return { runId, status: 'completed', promotionCommit: committed.promotionCommit };
  } catch (error) {
    if (error instanceof PromotionInterrupted) throw error;
    if (state) await recordPromotionFailure(state, resolvedRunDirectory, error);
    throw error;
  } finally {
    await lock.release();
  }
}

async function validatePreflight(context) {
  const { root, runDirectory, runId, state } = context;
  const definitionSource = await readText(path.join(runDirectory, 'run-definition.json'));
  const manifestSource = await readText(path.join(runDirectory, 'manifest.json'));
  const evaluatedSource = await readText(path.join(runDirectory, 'evaluated.json'));
  const payloadSource = await readText(path.join(runDirectory, 'payload.json'));
  const definition = parseJson(definitionSource, 'run-definition.json');
  const manifest = parseJson(manifestSource, 'manifest.json');
  const evaluated = parseJson(evaluatedSource, 'evaluated.json');
  const payload = parseJson(payloadSource, 'payload.json');
  const assignment = definition?.assignment;

  const errors = manifestErrors(manifest);
  if (errors.length) throw new Error(`Promotion requires a complete manifest: ${errors.join('; ')}`);
  assertManifestShape(manifest);
  if (definition?.mode !== 'eligible') throw new Error('Only eligible benchmark runs can be promoted.');
  if (manifest.disposition?.status !== 'playable') throw new Error('Promotion requires a playable run disposition.');
  if (!isRecord(assignment)) throw new Error('Run definition has no assignment.');

  const levelId = assignment.levelId;
  const title = assignment.levelTitle;
  const themeId = assignment.theme?.id;
  const assignmentRunId = assignment.runId;
  const slotId = assignment.slotId;
  assertNonEmpty(assignmentRunId, 'assignment.runId');
  assertNonEmpty(slotId, 'assignment.slotId');
  assertNonEmpty(themeId, 'assignment.theme.id');
  assertLevelId(levelId);
  assertNonEmpty(title, 'assignment.levelTitle');
  if (assignmentRunId !== context.runId) throw new Error('Run directory id does not match the run definition.');

  if (manifest.benchmarkVersion !== definition.benchmarkVersion || manifest.runId !== assignmentRunId || manifest.slotId !== slotId) throw new Error('Manifest run, version, or slot metadata does not match the run definition.');
  if (manifest.configuration?.id !== assignment.configurationId) throw new Error('Manifest configuration metadata does not match the run definition.');
  validateManifestAssignmentMetadata(manifest, assignment, { levelId, title, themeId });
  if (manifest.baseline?.materialsCommit !== definition.baseline?.materialsCommit) throw new Error('Manifest materials commit does not match the run definition.');

  const gateRecords = manifest.gates;
  validateRequiredGates(gateRecords);
  const gatesRecord = await optionalJson(path.join(runDirectory, 'gates', 'gates.json'));
  if (!gatesRecord || gatesRecord.evaluatedCommit !== manifest.output.evaluated.commit) throw new Error('Recorded gates do not match the manifest evaluated commit.');
  validateRequiredGates(gatesRecord.gates);
  for (const gate of gateRecords) {
    const recorded = gatesRecord.gates.find((candidate) => candidate.id === gate.id);
    if (recorded.status !== gate.status || recorded.status !== 'passed') throw new Error(`Recorded gate ${gate.id} does not agree with the manifest.`);
  }

  const materialsCommit = await resolveCommit(root, definition.baseline?.materialsCommit, 'materials commit');
  const evaluatedCommit = await resolveCommit(root, evaluated?.evaluatedCommit, 'evaluated commit');
  if (manifest.output.evaluated.commit !== evaluatedCommit) throw new Error('evaluated.json and the manifest disagree about the evaluated commit.');
  await assertRecordedBranch(root, manifest.output.evaluated.branch, evaluatedCommit, 'evaluated');

  if (!manifest.output?.payload) throw new Error('Playable manifest has no payload output.');
  const payloadCommit = await resolveCommit(root, payload?.payloadCommit, 'payload commit');
  if (manifest.output.payload.commit !== payloadCommit || manifest.output.payload.branch !== payload?.branch) {
    throw new Error('payload.json and the manifest disagree about the payload ref.');
  }
  await assertRecordedBranch(root, payload?.branch, payloadCommit, 'payload');
  await validateOptionalWorktree(payload?.worktree, payloadCommit, 'payload');
  const worktreeRecord = await optionalJson(path.join(runDirectory, 'worktree.json'));
  await validateOptionalWorktree(worktreeRecord?.worktree, evaluatedCommit, 'evaluated');
  if (worktreeRecord?.branch && worktreeRecord.branch !== manifest.output.evaluated.branch) throw new Error('Evaluated worktree metadata does not match the manifest ref.');

  const materialEntries = await treeEntries(root, materialsCommit, `${SOURCE_ROOT}/${levelId}`);
  if (materialEntries.length) throw new Error(`The materials commit already contains ${SOURCE_ROOT}/${levelId}; refusing a collision.`);
  const evaluatedEntries = await treeEntries(root, evaluatedCommit, `${SOURCE_ROOT}/${levelId}`);
  const payloadEntries = await treeEntries(root, payloadCommit, `${SOURCE_ROOT}/${levelId}`);
  if (!evaluatedEntries.length || !payloadEntries.length) throw new Error('Evaluated and payload commits must contain a non-empty assigned level directory.');
  assertNoSymlinks(evaluatedEntries, 'evaluated');
  assertNoSymlinks(payloadEntries, 'payload');
  assertSameTree(evaluatedEntries, payloadEntries, 'evaluated and payload source trees');

  const changed = await payloadDiff(root, materialsCommit, payloadCommit, `${SOURCE_ROOT}/${levelId}`);
  if (!changed.length) throw new Error('Payload diff is empty.');
  if (changed.some((entry) => !entry.path.startsWith(`${SOURCE_ROOT}/${levelId}/`))) throw new Error('Payload diff contains a path outside the assigned level directory.');
  if (changed.some((entry) => /^[DRC]/.test(entry.status))) throw new Error('Payload diff deletes, renames, or copies a path.');
  if (payloadEntries.some((entry) => entry.relativePath === 'level.json')) throw new Error('Payload may not contain level.json; the controller owns the benchmark descriptor.');

  const builtInIdentities = await readBuiltInIdentities(root);
  const legacySourcePath = path.join(root, SOURCE_ROOT, levelId);
  const legacySourcePresent = await pathExists(legacySourcePath);
  const legacySourceWasPresent = legacySourcePresent || state.source?.legacySourcePresent === true;
  if (legacySourcePresent && !context.migration) throw new Error(`Assigned source directory already exists: ${SOURCE_ROOT}/${levelId}`);
  if (legacySourcePresent && !builtInIdentities.has(levelId)) throw new Error(`Existing assigned source directory is not registered as a built-in level: ${SOURCE_ROOT}/${levelId}`);
  if (context.migration && !legacySourcePresent && builtInIdentities.has(levelId) && !state.source?.levelId) throw new Error(`Migration expected a built-in source directory for ${levelId}.`);
  const benchmarkIdentities = await readPromotedIdentities(root);
  const destination = path.join(root, DESTINATION_ROOT, levelId);
  if (benchmarkIdentities.has(levelId) && !state.source?.levelId) throw new Error(`Assigned level id is already a promoted benchmark level: ${levelId}`);
  if (benchmarkIdentities.has(levelId) && state.source?.levelId !== levelId) throw new Error(`Assigned level id collides with another promoted benchmark level: ${levelId}`);

  const status = await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const existingPromotion = Boolean(state.source?.levelId);
  const galleryMayBePromotionChange = existingPromotion && (state.currentCheckpoint === 'catalog' || state.checkpoints.catalog?.status === 'completed' || state.checkpoints.commit?.status === 'completed');
  assertOnlyPromotionChanges(status, root, destination, existingPromotion, galleryMayBePromotionChange, context.migration ? legacySourcePath : null, context.migration ? path.join(root, 'src/levels/index.ts') : null);
  if (context.migration && legacySourcePresent) {
    await verifyPayloadTree(legacySourcePath, payloadEntries, root);
  }
  if (await pathExists(destination)) {
    if (!existingPromotion) throw new Error(`Promotion destination already exists: ${destination}`);
    await verifyDestination(destination, payloadEntries, descriptorBytes(levelId, title), { allowDescriptor: true, descriptorOptional: true }, root);
  }

  const sourceSnapshot = {
    runId: assignmentRunId,
    slotId,
    themeId,
    levelId,
    title,
    materialsCommit,
    evaluatedCommit,
    payloadCommit,
    manifestSha256: sha256(manifestSource),
    definitionSha256: sha256(definitionSource),
    evaluatedSha256: sha256(evaluatedSource),
    payloadSha256: sha256(payloadSource),
    payloadDiffSha256: sha256(JSON.stringify(changed)),
    sourcePath: `${SOURCE_ROOT}/${levelId}/`,
    destinationPath: `${DESTINATION_ROOT}/${levelId}/`,
    legacySourcePresent: legacySourceWasPresent,
    descriptor: {
      source: 'controller-owned assignment data',
      id: levelId,
      title,
      sha256: sha256(descriptorBytes(levelId, title)),
    },
  };
  if (state.source) assertSnapshot(state.source, sourceSnapshot);

  const baseCommit = state.source?.baseCommit ?? await currentHead(root);
  if (state.source?.baseCommit) await resolveCommit(root, state.source.baseCommit, 'promotion base commit');
  const promotionCommit = state.promotionCommit ?? state.checkpoints.commit?.promotionCommit;
  if (promotionCommit) await resolveCommit(root, promotionCommit, 'recorded promotion commit');
  return { source: { ...sourceSnapshot, baseCommit }, definition, manifest, evaluated, payload, payloadEntries, changed, destination, legacySourcePath };
}

async function extractPayload(context) {
  const { root, runId } = context;
  const { source, payloadEntries, destination } = context.preflight;
  const legacySourcePath = context.preflight.legacySourcePath;
  const gitDirectory = path.resolve(root, (await gitText(root, ['rev-parse', '--git-dir'])).trim());
  const stage = path.join(gitDirectory, 'raild-promotion-staging', `${source.levelId}-${runId}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (await pathExists(destination)) {
    await verifyDestination(destination, payloadEntries, descriptorBytes(source.levelId, source.title), { allowDescriptor: true, descriptorOptional: true }, root);
    if (await pathExists(stage)) await fs.rm(stage, { recursive: true, force: true });
    if (context.migration) await removeBuiltInRegistryEntry(root, source.levelId, { allowMissing: true });
    return { destination: source.destinationPath, files: payloadEntries.length, reused: true };
  }
  if (context.migration && source.legacySourcePresent && await pathExists(legacySourcePath)) {
    await fs.rename(legacySourcePath, destination);
    await verifyPayloadTree(destination, payloadEntries, root);
    await removeBuiltInRegistryEntry(root, source.levelId, { allowMissing: false });
    return { destination: source.destinationPath, files: payloadEntries.length, reused: false, relocated: true };
  }
  if (await pathExists(stage)) await fs.rm(stage, { recursive: true, force: true });
  await materializeTree(root, source.payloadCommit, `${SOURCE_ROOT}/${source.levelId}`, stage, payloadEntries);
  await verifyPayloadTree(stage, payloadEntries, root);
  try {
    await fs.rename(stage, destination);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    await verifyPayloadTree(destination, payloadEntries, root);
    await fs.rm(stage, { recursive: true, force: true });
  }
  await fs.rm(stage, { recursive: true, force: true });
  return { destination: source.destinationPath, files: payloadEntries.length, reused: false };
}

async function createDescriptor(context) {
  const { destination } = context.preflight;
  const { levelId, title } = context.preflight.source;
  const descriptorPath = path.join(destination, 'level.json');
  const bytes = descriptorBytes(levelId, title);
  if (await pathExists(descriptorPath)) {
    const descriptorInfo = await fs.lstat(descriptorPath);
    if (!descriptorInfo.isFile()) throw new Error('Existing benchmark descriptor is not a regular file.');
    const existing = await fs.readFile(descriptorPath);
    if (!existing.equals(bytes)) throw new Error('Existing benchmark descriptor does not match controller-owned assignment data.');
    return { path: `${context.preflight.source.destinationPath}level.json`, sha256: sha256(bytes), reused: true };
  }
  await writeAtomicBytes(descriptorPath, bytes);
  return { path: `${context.preflight.source.destinationPath}level.json`, sha256: sha256(bytes), reused: false };
}

async function verifyApplication(context) {
  const { destination, payloadEntries, source } = context.preflight;
  await verifyDestination(destination, payloadEntries, descriptorBytes(source.levelId, source.title), { allowDescriptor: true }, context.root);
  const module = payloadEntries.find((entry) => entry.relativePath === 'index.ts');
  const card = payloadEntries.find((entry) => entry.relativePath === 'level.md');
  if (!module || !card) throw new Error('Promoted payload must contain index.ts and level.md.');
  const cardText = (await fs.readFile(path.join(destination, 'level.md'), 'utf8')).trimStart();
  if (cardText.split(/\r?\n/, 1)[0] !== `# ${source.title}`) throw new Error('Benchmark level.md title does not match controller-owned assignment data.');
  const galleryWasGenerated = context.state.currentCheckpoint === 'catalog' || context.state.checkpoints.catalog?.status === 'completed' || context.state.checkpoints.commit?.status === 'completed';
  await assertNoUnexpectedApplicationChanges(context, { allowGallery: galleryWasGenerated });
  return { destination: source.destinationPath, verifiedFiles: payloadEntries.length + 1 };
}

async function updateCatalogAndRunChecks(context, { completed = false, data: previousData } = {}) {
  const { root, runDirectory } = context;
  const { source, destination } = context.preflight;
  const baseCommit = source.baseCommit;
  if (completed) {
    if (!previousData?.gallerySha256 || !Array.isArray(previousData.checks) || previousData.checks.length !== 4) throw new Error('Completed catalog checkpoint has no verifiable record.');
    const gallerySource = await readText(path.join(root, GALLERY_PATH));
    if (sha256(gallerySource) !== previousData.gallerySha256) throw new Error('Derived gallery changed after the completed catalog checkpoint.');
    for (const check of previousData.checks) {
      if (check.exitCode !== 0) throw new Error(`Completed promotion check ${check.id} was not successful.`);
      const record = await optionalJson(path.join(runDirectory, 'promotion-checks', `${check.id}.json`));
      if (!record || record.exitCode !== check.exitCode || record.stdoutSha256 !== check.stdoutSha256 || record.stderrSha256 !== check.stderrSha256) throw new Error(`Promotion check record ${check.id} is missing or tampered.`);
    }
    await assertOnlyPromotionChanges(await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']), root, destination, true, true, ...promotionPathArgs(context));
    return previousData;
  }
  const gallery = await runCommand(root, 'npm', ['run', 'gallery']);
  await writeCommandLog(runDirectory, 'gallery', gallery);
  if (gallery.code !== 0) throw new Error('Gallery regeneration failed; promotion remains resumable.');
  const gallerySource = await readText(path.join(root, GALLERY_PATH));
  if (!gallerySource.includes('## Benchmark levels')) throw new Error('Regenerated gallery has no benchmark-level section.');
  if (!gallerySource.includes(`# ${source.title}`)) throw new Error('Regenerated gallery does not contain the promoted descriptor title.');
  const checks = [];
  const commands = [
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['build', 'npm', ['run', 'build']],
    ['scope', process.execPath, [path.join(root, 'scripts', 'check-benchmark-scope.mjs'), '--level', source.levelId, '--base', baseCommit, ...(context.migration && source.legacySourcePresent ? ['--migration'] : [])]],
    ['floor', 'npm', ['run', 'check:floor', '--', '--level', source.levelId]],
  ];
  for (const [id, executable, args] of commands) {
    const result = await runCommand(root, executable, args);
    await writeCommandLog(runDirectory, id, result);
    checks.push({ id, command: [executable, ...args].join(' '), exitCode: result.code, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr), wallTimeSeconds: result.wallTimeSeconds });
    if (result.code !== 0) throw new Error(`Promotion ${id} check failed: ${result.stderr || result.stdout}`);
  }
  await assertOnlyPromotionChanges(await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']), root, destination, true, true, ...promotionPathArgs(context));
  return { gallerySha256: sha256(gallerySource), checks };
}

async function commitPromotion(context) {
  const { root } = context;
  const { source, destination } = context.preflight;
  const expectedPrefix = `${DESTINATION_ROOT}/${source.levelId}/`;
  const expected = new Set([GALLERY_PATH]);
  for (const entry of await listFiles(destination)) expected.add(`${expectedPrefix}${entry}`);
  if (context.migration && source.legacySourcePresent) {
    expected.add('src/levels/index.ts');
    for (const entry of context.preflight.payloadEntries) expected.add(`${SOURCE_ROOT}/${source.levelId}/${entry.relativePath}`);
  }
  const status = await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  assertOnlyPromotionChanges(status, root, destination, true, true, ...promotionPathArgs(context));
  const head = await currentHead(root);
  const baseCommit = source.baseCommit;
  if (context.state.promotionCommit || context.state.checkpoints.commit?.promotionCommit) {
    const promotionCommit = context.state.promotionCommit ?? context.state.checkpoints.commit.promotionCommit;
    await verifyPromotionCommit(root, promotionCommit, baseCommit, expected, source);
    return { promotionCommit };
  }
  if (head !== baseCommit) {
    await verifyPromotionCommit(root, head, baseCommit, expected, source);
    return { promotionCommit: head, reused: true };
  }
  const addPaths = [DESTINATION_ROOT + '/' + source.levelId, GALLERY_PATH];
  if (context.migration && source.legacySourcePresent) addPaths.push(SOURCE_ROOT + '/' + source.levelId, 'src/levels/index.ts');
  await git(root, ['add', '--', ...addPaths]);
  const staged = await gitText(root, ['diff', '--cached', '--name-only']);
  const stagedNames = staged.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!stagedNames.length || stagedNames.some((name) => !expected.has(name))) throw new Error('Refusing to commit files outside the verified promotion payload and gallery.');
  await git(root, ['commit', '-m', `Promote benchmark level ${source.levelId}`]);
  const promotionCommit = await currentHead(root);
  await verifyPromotionCommit(root, promotionCommit, baseCommit, expected, source);
  return { promotionCommit, reused: false };
}

async function verifyPromotionCommit(root, commit, baseCommit, expected, source) {
  const resolved = await resolveCommit(root, commit, 'promotion commit');
  const parent = (await gitText(root, ['rev-list', '--parents', '-n', '1', resolved])).trim().split(/\s+/)[1];
  if (parent !== baseCommit) throw new Error('Promotion commit is not a separate administrative child of the pre-promotion application commit.');
  const names = (await gitText(root, ['diff', '--name-only', `${baseCommit}..${resolved}`])).split('\n').map((line) => line.trim()).filter(Boolean);
  if (!names.length || names.some((name) => !expected.has(name))) throw new Error('Promotion commit contains an unexpected application path.');
  await assertOnlyPromotionChanges(await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']), root, path.join(root, DESTINATION_ROOT, source.levelId), false, false);
}

async function checkpoint(context, id, action) {
  if (!CHECKPOINTS.includes(id)) throw new Error(`Unknown promotion checkpoint: ${id}`);
  const { state, runDirectory } = context;
  const existing = state.checkpoints[id];
  state.status = 'running';
  state.currentCheckpoint = id;
  state.updatedAt = new Date().toISOString();
  await writeAtomicJson(statePath(context), state);
  try {
    const data = await action({ completed: existing?.status === 'completed', data: existing?.data });
    const persistedData = id === 'validation' && data ? { source: data.source } : data;
    state.checkpoints[id] = { status: 'completed', finishedAt: new Date().toISOString(), ...(persistedData === undefined ? {} : { data: persistedData }) };
    state.currentCheckpoint = null;
    state.updatedAt = new Date().toISOString();
    await writeAtomicJson(statePath(context), state);
    return data;
  } catch (error) {
    if (error instanceof PromotionInterrupted) throw error;
    state.status = 'failed';
    state.checkpoints[id] = { status: 'failed', finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
    state.currentCheckpoint = id;
    state.updatedAt = new Date().toISOString();
    await writeAtomicJson(statePath(context), state);
    throw error;
  }
}

async function verifyApplicationChanges(context, allowGallery) {
  const { root } = context;
  const destination = path.join(root, context.preflight.source.destinationPath);
  await assertOnlyPromotionChanges(await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']), root, destination, true, allowGallery, ...promotionPathArgs(context));
}

async function assertNoUnexpectedApplicationChanges(context, { allowGallery }) {
  await verifyApplicationChanges(context, allowGallery);
}

function assertOnlyPromotionChanges(status, root, destination, allowPromotionChanges, allowGallery, legacySource = null, registryPath = null) {
  const paths = parsePorcelain(status);
  if (!paths.length) return;
  if (!allowPromotionChanges) throw new Error(`Refusing to overwrite unrelated local changes: ${paths.join(', ')}`);
  const destinationRelative = path.relative(root, destination).replaceAll(path.sep, '/');
  const destinationRoot = `${destinationRelative}/`;
  const legacyRelative = legacySource ? path.relative(root, legacySource).replaceAll(path.sep, '/') : null;
  const registryRelative = registryPath ? path.relative(root, registryPath).replaceAll(path.sep, '/') : null;
  for (const item of paths) {
    const normalized = item.replaceAll(path.sep, '/');
    if ((allowGallery && normalized === GALLERY_PATH) || normalized.startsWith(destinationRoot) || (legacyRelative && (normalized === legacyRelative || normalized.startsWith(`${legacyRelative}/`))) || (registryRelative && normalized === registryRelative)) continue;
    throw new Error(`Refusing to overwrite unrelated local changes: ${item}`);
  }
}

function promotionPathArgs(context) {
  const source = context.preflight?.source;
  if (!context.migration || !source?.legacySourcePresent) return [null, null];
  return [path.join(context.root, SOURCE_ROOT, source.levelId), path.join(context.root, 'src/levels/index.ts')];
}

async function validateOptionalWorktree(worktree, expectedCommit, label) {
  if (!worktree || !(await pathExists(worktree))) return;
  const head = (await gitText(worktree, ['rev-parse', 'HEAD'])).trim();
  if (head !== expectedCommit) throw new Error(`${label} worktree does not match its recorded commit.`);
  const status = (await gitText(worktree, ['status', '--porcelain=v1', '--untracked-files=all'])).trim();
  if (status) throw new Error(`${label} worktree is dirty; its payload/evaluated contents cannot be verified.`);
}

async function assertRecordedBranch(root, branch, expectedCommit, label) {
  if (typeof branch !== 'string' || !branch || branch.includes('..') || /[\0\n\r\s]/.test(branch)) throw new Error(`${label} ref is missing or invalid.`);
  const actual = await resolveCommit(root, `refs/heads/${branch}`, `${label} branch`);
  if (actual !== expectedCommit) throw new Error(`${label} commit does not match its recorded branch.`);
}

function assertManifestShape(manifest) {
  if (!Array.isArray(manifest.stages) || manifest.stages.length === 0) throw new Error('Promotion requires a manifest with at least one completed stage record.');
  for (const key of ['configuration', 'theme', 'baseline', 'recipe', 'controller', 'timing', 'cost', 'output', 'disposition']) {
    if (!isRecord(manifest[key])) throw new Error(`Promotion manifest field ${key} is incomplete.`);
  }
  const hasThemeId = Object.hasOwn(manifest.theme, 'id');
  const hasOutputTitle = Object.hasOwn(manifest.output, 'title');
  if (hasThemeId !== hasOutputTitle) throw new Error('Promotion manifest uses an incomplete current or legacy metadata shape.');
  if (hasThemeId && (typeof manifest.theme.id !== 'string' || !manifest.theme.id || typeof manifest.output.title !== 'string' || !manifest.output.title)) {
    throw new Error('Promotion manifest current metadata shape is incomplete.');
  }
  if (!isRecord(manifest.output.evaluated)) throw new Error('Promotion manifest evaluated output is incomplete.');
  if (!isRecord(manifest.output.payload)) throw new Error('Promotion manifest payload output is incomplete.');
  if (manifest.cost.status !== 'measured' && manifest.cost.status !== 'unavailable') throw new Error('Promotion manifest cost record is incomplete.');
}

function validateManifestAssignmentMetadata(manifest, assignment, { levelId, title, themeId }) {
  if (!isRecord(manifest.theme) || manifest.theme.path !== assignment.theme.path || manifest.theme.sha256 !== assignment.theme.sha256) {
    throw new Error('Manifest theme metadata does not match the run definition.');
  }
  if (Object.hasOwn(manifest.theme, 'id') && manifest.theme.id !== themeId) {
    throw new Error('Manifest theme metadata does not match the run definition.');
  }
  if (manifest.output?.levelId !== levelId) throw new Error('Manifest level metadata does not match the run definition.');
  if (Object.hasOwn(manifest.output, 'title') && manifest.output.title !== title) {
    throw new Error('Manifest title metadata does not match the run definition.');
  }
}

function assertNoSymlinks(entries, label) {
  if (entries.some((entry) => entry.mode === '120000')) throw new Error(`${label} payload contains a symbolic link; promotion accepts regular files only.`);
}

function validateRequiredGates(gates) {
  if (!Array.isArray(gates)) throw new Error('Manifest gates must be an array.');
  const ids = gates.map((gate) => gate?.id);
  if (new Set(ids).size !== ids.length || REQUIRED_GATES.some((id) => !ids.includes(id))) throw new Error('Manifest must account for exactly the four required gates.');
  for (const gate of gates) if (gate.status !== 'passed') throw new Error(`Required gate ${gate.id} did not pass.`);
}

export async function removeBuiltInRegistryEntry(root, levelId, { allowMissing }) {
  const registryPath = path.join(root, 'src', 'levels', 'index.ts');
  const source = await readText(registryPath);
  const escapedId = levelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const metadataStart = source.indexOf('export const levelMetadatas');
  const metadataEnd = source.indexOf('\n];', metadataStart);
  const loaderStart = source.indexOf('const builtInLoaders');
  const loaderEnd = source.indexOf('\n};', loaderStart);
  if (metadataStart < 0 || metadataEnd < 0 || loaderStart < 0 || loaderEnd < 0) throw new Error('Could not locate the built-in level registry sections.');
  const metadataSection = source.slice(metadataStart, metadataEnd);
  const loaderSection = source.slice(loaderStart, loaderEnd);
  const metadataPattern = new RegExp(`^\\s*\\{\\s*id:\\s*'${escapedId}'\\s*,[^\\n]*(?:\\n|$)`, 'gm');
  const loaderPattern = new RegExp(`^\\s*'${escapedId}':\\s*async \\(\\) =>[^\\n]*(?:\\n|$)`, 'gm');
  const metadataMatches = metadataSection.match(metadataPattern) ?? [];
  const loaderMatches = loaderSection.match(loaderPattern) ?? [];
  if (!metadataMatches.length && !loaderMatches.length && allowMissing) return false;
  if (metadataMatches.length !== 1 || loaderMatches.length !== 1) throw new Error(`Built-in registry entry for ${levelId} is incomplete or duplicated; refusing to edit it (metadata=${metadataMatches.length}, loader=${loaderMatches.length}).`);
  const nextMetadata = metadataSection.replace(metadataPattern, '');
  const nextLoader = loaderSection.replace(loaderPattern, '');
  const next = source.slice(0, metadataStart) + nextMetadata + source.slice(metadataEnd, loaderStart) + nextLoader + source.slice(loaderEnd);
  await writeAtomicBytes(registryPath, Buffer.from(next, 'utf8'));
  return true;
}

export async function builtInRegistryHasEntry(root, levelId) {
  return (await readBuiltInIdentities(root)).has(levelId);
}

async function readBuiltInIdentities(root) {
  const source = await readText(path.join(root, 'src', 'levels', 'index.ts'));
  const identities = new Set();
  const entryPattern = /\{\s*id:\s*'([^']+)'\s*,([^}]*)\}/g;
  let match;
  while ((match = entryPattern.exec(source))) {
    identities.add(match[1]);
    const aliases = match[2].match(/aliases:\s*\[([^\]]*)\]/)?.[1];
    if (aliases) for (const alias of aliases.matchAll(/'([^']+)'/g)) identities.add(alias[1]);
  }
  if (!identities.size) throw new Error('Could not validate built-in level identities.');
  return identities;
}

async function readPromotedIdentities(root) {
  const identities = new Set();
  const directory = path.join(root, DESTINATION_ROOT);
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return identities; throw error; }
  for (const entry of entries.filter((candidate) => candidate.isDirectory() && !candidate.name.startsWith('.'))) {
    const descriptorPath = path.join(directory, entry.name, 'level.json');
    try {
      const descriptor = parseJson(await readText(descriptorPath), `benchmark descriptor ${entry.name}`);
      if (descriptor?.id) identities.add(descriptor.id);
      for (const alias of descriptor?.aliases ?? []) identities.add(alias);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
  }
  return identities;
}

async function treeEntries(root, commit, prefix) {
  const output = await gitBuffer(root, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', prefix]);
  const entries = [];
  for (const record of output.toString('utf8').split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error(`Malformed Git tree entry for ${prefix}.`);
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    const fullPath = record.slice(tab + 1).replaceAll('\\', '/');
    const prefixWithSlash = `${prefix}/`;
    if (!fullPath.startsWith(prefixWithSlash)) throw new Error(`Git tree escaped assigned payload directory: ${fullPath}`);
    if (type !== 'blob') throw new Error(`Payload contains unsupported Git object ${type} at ${fullPath}.`);
    entries.push({ relativePath: fullPath.slice(prefixWithSlash.length), mode, type, oid });
  }
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return entries;
}

async function payloadDiff(root, materialsCommit, payloadCommit, prefix) {
  const output = await gitBuffer(root, ['diff', '--name-status', '-z', `${materialsCommit}..${payloadCommit}`]);
  const tokens = output.toString('utf8').split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const pathName = tokens[index++];
    if (!pathName) throw new Error('Malformed payload diff.');
    entries.push({ status, path: pathName.replaceAll('\\', '/') });
    if (/^[RC]/.test(status)) {
      const oldPath = tokens[index++];
      if (!oldPath) throw new Error('Malformed payload rename/copy diff.');
      entries.push({ status, path: oldPath.replaceAll('\\', '/') });
    }
  }
  return entries;
}

function assertSameTree(left, right, label) {
  if (left.length !== right.length) throw new Error(`${label} do not contain the same files.`);
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]; const b = right[index];
    if (a.relativePath !== b.relativePath || a.mode !== b.mode || a.type !== b.type || a.oid !== b.oid) throw new Error(`${label} differ at ${a.relativePath ?? b.relativePath}.`);
  }
}

async function materializeTree(root, commit, prefix, destination, entries) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const target = safeJoin(destination, entry.relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const bytes = await gitBuffer(root, ['cat-file', 'blob', entry.oid]);
    if (entry.mode === '120000') throw new Error('Payload contains a symbolic link; promotion accepts regular files only.');
    await fs.writeFile(target, bytes);
    await fs.chmod(target, entry.mode === '100755' ? 0o755 : 0o644);
  }
}

async function verifyPayloadTree(directory, entries, root) {
  await verifyPayloadTreeWithRoot(directory, entries, root);
}

async function verifyDestination(destination, payloadEntries, descriptor, { allowDescriptor, descriptorOptional = false }, root = ROOT) {
  const destinationInfo = await fs.lstat(destination);
  if (!destinationInfo.isDirectory()) throw new Error('Benchmark destination is not a regular directory.');
  await verifyPayloadTreeWithRoot(destination, payloadEntries, root, ['level.json']);
  const descriptorPath = path.join(destination, 'level.json');
  const descriptorExists = await pathExists(descriptorPath);
  if (allowDescriptor) {
    if (!descriptorExists && !descriptorOptional) throw new Error('Benchmark descriptor is missing.');
    if (descriptorExists) {
      const descriptorInfo = await fs.lstat(descriptorPath);
      if (!descriptorInfo.isFile() || !(await fs.readFile(descriptorPath)).equals(descriptor)) throw new Error('Benchmark descriptor is missing or has been tampered with.');
    }
  } else if (descriptorExists) {
    throw new Error('Payload relocation unexpectedly included a descriptor.');
  }
  const files = await listFiles(destination);
  const expected = new Set([...payloadEntries.map((entry) => entry.relativePath), ...(allowDescriptor && descriptorExists ? ['level.json'] : [])]);
  if (files.length !== expected.size || files.some((file) => !expected.has(file))) throw new Error('Benchmark destination contains unexpected files.');
}

async function verifyPayloadTreeWithRoot(directory, entries, root = ROOT, ignoredFiles = []) {
  const actual = await collectFilesystemEntries(directory);
  for (const ignoredFile of ignoredFiles) actual.files.delete(ignoredFile);
  const expected = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const expectedDirectories = new Set();
  for (const relativePath of expected.keys()) {
    const segments = relativePath.split('/');
    for (let index = 1; index < segments.length; index += 1) expectedDirectories.add(segments.slice(0, index).join('/'));
  }
  if ([...actual.directories].some((directory) => !expectedDirectories.has(directory))) throw new Error('Relocated payload contains an unexpected directory.');
  if (actual.files.size !== expected.size) throw new Error('Relocated payload file count does not match the payload commit.');
  for (const [relativePath, expectedEntry] of expected) {
    const item = actual.files.get(relativePath);
    if (!item) throw new Error(`Relocated payload is missing ${relativePath}.`);
    if (item.kind === 'symlink') throw new Error(`Relocated payload contains a symbolic link at ${relativePath}.`);
    const actualBytes = await fs.readFile(item.path);
    const expectedBytes = await gitBuffer(root, ['cat-file', 'blob', expectedEntry.oid]);
    if (!actualBytes.equals(expectedBytes)) throw new Error(`Relocated payload changed bytes at ${relativePath}.`);
    if (item.kind === 'file') {
      const executable = ((await fs.stat(item.path)).mode & 0o111) !== 0;
      if (executable !== (expectedEntry.mode === '100755')) throw new Error(`Relocated payload changed executable mode at ${relativePath}.`);
    }
  }
}

async function collectFilesystemEntries(directory) {
  const files = new Map();
  const directories = new Set();
  async function visit(current, relative = '') {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      const info = await fs.lstat(full);
      if (info.isDirectory()) {
        directories.add(rel);
        await visit(full, rel);
      } else if (info.isFile() || info.isSymbolicLink()) files.set(rel, { path: full, kind: info.isSymbolicLink() ? 'symlink' : 'file' });
      else throw new Error(`Unsupported filesystem entry in promoted directory: ${rel}`);
    }
  }
  await visit(directory);
  return { files, directories };
}

async function listFiles(directory) {
  const result = [];
  async function visit(current, relative = '') {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      const info = await fs.lstat(full);
      if (info.isDirectory()) await visit(full, rel);
      else if (info.isFile() || info.isSymbolicLink()) result.push(rel);
      else throw new Error(`Unsupported filesystem entry in promoted directory: ${rel}`);
    }
  }
  await visit(directory);
  return result.sort();
}

function safeJoin(root, relative) {
  const target = path.resolve(root, relative);
  const relativeTarget = path.relative(path.resolve(root), target);
  if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) throw new Error(`Payload path escapes staging directory: ${relative}`);
  return target;
}

function descriptorBytes(id, title) {
  return Buffer.from(`${JSON.stringify({ id, title }, null, 2)}\n`, 'utf8');
}

async function loadOrCreateState(runDirectory, runId) {
  const filePath = path.join(runDirectory, 'promotion.json');
  const existing = await optionalJson(filePath);
  if (existing) {
    if (existing.schemaVersion !== PROMOTION_SCHEMA_VERSION || existing.runId !== runId || !isRecord(existing.checkpoints)) throw new Error('Promotion state record is invalid or tampered.');
    return existing;
  }
  const state = { schemaVersion: PROMOTION_SCHEMA_VERSION, runId, status: 'pending', currentCheckpoint: null, checkpoints: {}, failures: [], updatedAt: new Date().toISOString() };
  await writeAtomicJson(filePath, state);
  return state;
}

async function recordPromotionFailure(state, runDirectory, error) {
  const failure = { failedAt: new Date().toISOString(), checkpoint: state.currentCheckpoint, message: error instanceof Error ? error.message : String(error) };
  state.status = 'failed';
  state.failure = failure;
  state.failures = [...(state.failures ?? []), failure];
  state.updatedAt = new Date().toISOString();
  await writeAtomicJson(path.join(runDirectory, 'promotion.json'), state);
}

function assertSnapshot(previous, next) {
  const fields = ['runId', 'slotId', 'themeId', 'levelId', 'title', 'materialsCommit', 'evaluatedCommit', 'payloadCommit', 'manifestSha256', 'definitionSha256', 'evaluatedSha256', 'payloadSha256', 'payloadDiffSha256', 'sourcePath', 'destinationPath'];
  for (const field of fields) if (previous[field] !== next[field]) throw new Error(`Promotion provenance changed for ${field}.`);
  if (previous.descriptor?.sha256 !== next.descriptor.sha256 || previous.descriptor?.id !== next.descriptor.id || previous.descriptor?.title !== next.descriptor.title) throw new Error('Promotion descriptor provenance changed.');
}

export async function acquirePromotionLock(root) {
  const gitDirectory = await gitText(root, ['rev-parse', '--git-dir']);
  const lockPath = path.resolve(root, gitDirectory.trim(), PROMOTION_LOCK_NAME);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      const owner = { pid: process.pid, acquiredAt: new Date().toISOString() };
      await writeAtomicJson(path.join(lockPath, 'owner.json'), owner);
      return { release: async () => fs.rm(lockPath, { recursive: true, force: true }) };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = await optionalJson(path.join(lockPath, 'owner.json'));
      if (owner && isProcessAlive(owner.pid)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      if (!owner) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const afterWait = await optionalJson(path.join(lockPath, 'owner.json'));
        if (afterWait && isProcessAlive(afterWait.pid)) continue;
      }
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  }
  throw new Error('Timed out waiting for the benchmark promotion lock.');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function interruptIfRequested(value, checkpointName) {
  if (value === checkpointName) throw new PromotionInterrupted(checkpointName);
}

async function runCommand(cwd, executable, args) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr, wallTimeSeconds: (performance.now() - started) / 1000 }));
  });
}

async function writeCommandLog(runDirectory, id, result) {
  await writeAtomicJson(path.join(runDirectory, 'promotion-checks', `${id}.json`), {
    exitCode: result.code,
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    wallTimeSeconds: result.wallTimeSeconds,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

async function resolveCommit(root, ref, label) {
  if (typeof ref !== 'string' || !ref) throw new Error(`${label} is missing.`);
  const value = (await gitText(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  if (!/^[a-f0-9]{40,64}$/.test(value)) throw new Error(`${label} did not resolve to a Git commit.`);
  return value;
}

async function currentHead(root) { return (await gitText(root, ['rev-parse', 'HEAD'])).trim(); }
async function gitText(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout; }
async function gitBuffer(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })).stdout; }
async function git(cwd, args) { await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }

async function readText(filePath) { return fs.readFile(filePath, 'utf8'); }
async function optionalJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
function parseJson(source, label) { try { return JSON.parse(source); } catch (error) { throw new Error(`Invalid ${label}: ${error.message}`); } }
function parsePorcelain(source) { return source.split('\n').map((line) => line.slice(3)).filter(Boolean); }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function assertNonEmpty(value, label) { if (typeof value !== 'string' || !value) throw new Error(`${label} is missing.`); }
function assertLevelId(value) { if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error('assignment.levelId is not a safe level id.'); }
function statePath(context) { return path.join(context.runDirectory, 'promotion.json'); }
async function pathExists(filePath) { try { await fs.lstat(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
async function writeAtomicBytes(filePath, bytes) { await fs.mkdir(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`; await fs.writeFile(temporary, bytes); await fs.rename(temporary, filePath); }
async function writeAtomicJson(filePath, value) { await writeAtomicBytes(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')); }

async function main() {
  const rawArgs = process.argv.slice(2);
  const normalizedArgs = rawArgs.flatMap((argument, index) => (
    (argument === '--inventory' || argument === '--migration') && (rawArgs[index + 1] === undefined || rawArgs[index + 1].startsWith('--'))
      ? [argument, 'true']
      : [argument]
  ));
  const { options, rest } = parseArgs(normalizedArgs);
  if (options.help) {
    console.log('Usage: npm run benchmark:promote -- --run <run-id-or-private-run-directory> [--repo <repository>] [--migration true]\n       npm run benchmark:promote -- --inventory true [--repo <repository>] [--out <private-report-path>]');
    return;
  }
  if (rest.length) fail(`Unexpected argument: ${rest.join(' ')}`);
  assertOnlyOptions(options, new Set(['help', 'run', 'repo', 'migration', 'inventory', 'out']));
  const root = path.resolve(options.repo ?? ROOT);
  if (options.inventory !== undefined) {
    if (options.run !== undefined || options.migration !== undefined) fail('--inventory cannot be combined with --run or --migration.');
    const inventory = await buildMigrationInventory({ root, allowBlocked: true });
    if (options.out) await writeAtomicJson(path.resolve(options.out), inventory);
    console.log(JSON.stringify(inventory));
    if (inventory.blocked) process.exitCode = 1;
    return;
  }
  const runOption = requireOption(options, 'run');
  const runDirectory = path.isAbsolute(runOption) || runOption.includes('/') || runOption.includes(path.sep)
    ? path.resolve(runOption)
    : path.join(root, 'benchmark/private/runs', runOption);
  const migration = options.migration === 'true';
  const result = await promoteRun({ root, runDirectory, migration, interruptAfter: process.env.RAILD_PROMOTION_INTERRUPT_AFTER });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
