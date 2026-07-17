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
import { LEGACY_LEVEL_REGISTRY_PATH, LEVEL_GALLERY_PATH, levelFootprint } from './protocol.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REQUIRED_GATES = ['typecheck', 'build', 'scope', 'floor'];
const CHECKPOINTS = ['validation', 'extraction', 'descriptor', 'application', 'catalog', 'commit'];
const PROMOTION_SCHEMA_VERSION = 1;
const PROMOTION_LOCK_NAME = 'raild-benchmark-promotion.lock';
const GALLERY_PATH = LEVEL_GALLERY_PATH;
const REGISTRY_PATH = LEGACY_LEVEL_REGISTRY_PATH;

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
export async function promoteRun({ root = ROOT, runDirectory, interruptAfter, migration = false, acceptDiverged = null, migrationLevelIds = [] } = {}) {
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
    const requestedMigrationPlan = [...new Set(migrationLevelIds)].sort();
    const context = { root: repositoryRoot, runDirectory: resolvedRunDirectory, runId, state, migration: migration || state.migration === true, acceptDiverged: acceptDiverged ?? state.acceptDiverged ?? null, migrationLevelIds: requestedMigrationPlan.length > 0 ? requestedMigrationPlan : (state.migrationLevelIds ?? []) };
    if (state.migration !== undefined && state.migration !== context.migration) throw new Error('Promotion migration mode does not match its recorded state.');
    if (state.acceptDiverged && JSON.stringify(state.acceptDiverged) !== JSON.stringify(context.acceptDiverged)) throw new Error('Promotion divergence acceptance does not match its recorded state.');
    if (state.migrationLevelIds && JSON.stringify(state.migrationLevelIds) !== JSON.stringify(context.migrationLevelIds)) throw new Error('Migration plan does not match its recorded promotion state.');
    state.migration = context.migration;
    if (context.acceptDiverged) state.acceptDiverged = context.acceptDiverged;
    if (context.migrationLevelIds.length > 0) state.migrationLevelIds = context.migrationLevelIds;

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
    return { runId, status: 'completed', promotionCommit: committed.promotionCommit, checks: context.state.checkpoints.catalog?.data?.checks ?? [] };
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

  const errors = manifestErrors(manifest).filter((error) => !(context.acceptDiverged && (error.includes('theme.id and output.title') || error.includes('current theme/output metadata'))));
  if (errors.length) throw new Error(`Promotion requires a complete manifest: ${errors.join('; ')}`);
  assertManifestShape(manifest, { allowLegacyMetadata: Boolean(context.acceptDiverged) });
  if (definition?.mode !== 'eligible' && !context.acceptDiverged) throw new Error('Only eligible benchmark runs can be promoted.');
  if (manifest.disposition?.status !== 'playable' && !context.acceptDiverged) throw new Error('Promotion requires a playable run disposition.');
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
  if (context.acceptDiverged && context.acceptDiverged.payloadCommit !== payloadCommit) throw new Error('Accepted divergence payload commit does not match the recorded payload commit.');
  if (manifest.output.payload.commit !== payloadCommit || manifest.output.payload.branch !== payload?.branch) {
    throw new Error('payload.json and the manifest disagree about the payload ref.');
  }
  await assertRecordedBranch(root, payload?.branch, payloadCommit, 'payload');
  await validateOptionalWorktree(payload?.worktree, payloadCommit, 'payload');
  const worktreeRecord = await optionalJson(path.join(runDirectory, 'worktree.json'));
  await validateOptionalWorktree(worktreeRecord?.worktree, evaluatedCommit, 'evaluated');
  if (worktreeRecord?.branch && worktreeRecord.branch !== manifest.output.evaluated.branch) throw new Error('Evaluated worktree metadata does not match the manifest ref.');

  const footprint = levelFootprint(levelId, definition.benchmarkVersion);
  const roots = [];
  for (const rootEntry of footprint.roots) {
    const materialEntries = await treeEntries(root, materialsCommit, rootEntry.path);
    if (materialEntries.length) throw new Error(`The materials commit already contains ${rootEntry.path}; refusing a collision.`);
    const evaluatedEntries = await treeEntries(root, evaluatedCommit, rootEntry.path);
    const payloadEntries = await treeEntries(root, payloadCommit, rootEntry.path);
    if (rootEntry.required && (!evaluatedEntries.length || !payloadEntries.length)) throw new Error(`Evaluated and payload commits must contain the required root ${rootEntry.path}.`);
    if (evaluatedEntries.length !== payloadEntries.length) throw new Error(`Evaluated and payload commits disagree about footprint root ${rootEntry.path}.`);
    if (evaluatedEntries.length) {
      assertNoSymlinks(evaluatedEntries, `evaluated ${rootEntry.id}`);
      assertNoSymlinks(payloadEntries, `payload ${rootEntry.id}`);
      assertSameTree(evaluatedEntries, payloadEntries, `evaluated and payload ${rootEntry.id} trees`);
    }
    roots.push({ ...rootEntry, present: payloadEntries.length > 0, evaluatedEntries, payloadEntries, destination: path.join(root, rootEntry.promotedPath) });
  }
  const sourceRoot = roots.find((rootEntry) => rootEntry.required);
  if (!sourceRoot) throw new Error('Level footprint has no required source root.');

  const changed = await payloadDiff(root, materialsCommit, payloadCommit);
  if (!changed.length) throw new Error('Payload diff is empty.');
  if (changed.some((entry) => !roots.some((rootEntry) => entry.path.startsWith(`${rootEntry.path}/`)))) throw new Error('Payload diff contains a path outside the assigned level footprint.');
  if (!changed.some((entry) => entry.path.startsWith(`${sourceRoot.path}/`))) throw new Error('Payload diff contains no file in the required source root.');
  if (changed.some((entry) => /^[DRC]/.test(entry.status))) throw new Error('Payload diff deletes, renames, or copies a path.');
  if (sourceRoot.payloadEntries.some((entry) => entry.relativePath === 'level.json')) throw new Error('Payload may not contain level.json; the controller owns the benchmark descriptor.');

  const builtInIdentities = await readBuiltInIdentities(root);
  const legacySourcePath = path.join(root, sourceRoot.path);
  const legacySourcePresent = await pathExists(legacySourcePath);
  const legacySourceWasPresent = legacySourcePresent || state.source?.legacySourcePresent === true;
  if (legacySourcePresent && !context.migration) throw new Error(`Assigned source directory already exists: ${sourceRoot.path}`);
  if (legacySourcePresent && !builtInIdentities.has(levelId)) throw new Error(`Existing assigned source directory is not registered as a built-in level: ${sourceRoot.path}`);
  if (context.migration && !legacySourcePresent && builtInIdentities.has(levelId) && !state.source?.levelId) throw new Error(`Migration expected a built-in source directory for ${levelId}.`);
  const benchmarkIdentities = await readPromotedIdentities(root, path.posix.dirname(sourceRoot.promotedPath));
  if (benchmarkIdentities.has(levelId) && !state.source?.levelId) throw new Error(`Assigned level id is already a promoted benchmark level: ${levelId}`);
  if (benchmarkIdentities.has(levelId) && state.source?.levelId !== levelId) throw new Error(`Assigned level id collides with another promoted benchmark level: ${levelId}`);

  const presentRoots = roots.filter((rootEntry) => rootEntry.present);
  const status = await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const existingPromotion = Boolean(state.source?.levelId);
  const galleryMayBePromotionChange = existingPromotion && (state.currentCheckpoint === 'catalog' || state.checkpoints.catalog?.status === 'completed' || state.checkpoints.commit?.status === 'completed');
  assertOnlyPromotionChanges(status, root, presentRoots.map((rootEntry) => rootEntry.destination), existingPromotion || (context.migration && context.migrationLevelIds.length > 0), galleryMayBePromotionChange, context.migration ? legacySourcePath : null, context.migration ? path.join(root, REGISTRY_PATH) : null, context.migrationLevelIds);
  if (context.migration && legacySourcePresent) {
    const divergence = await verifyPayloadTree(legacySourcePath, sourceRoot.payloadEntries, root, context.acceptDiverged?.divergingPaths ?? []);
    if (context.acceptDiverged && !samePathSet(divergence, context.acceptDiverged.divergingPaths)) throw new Error('Accepted divergence paths do not match the current source.');
  }
  for (const rootEntry of presentRoots) {
    if (!await pathExists(rootEntry.destination)) continue;
    if (!existingPromotion && !(context.migration && rootEntry.id !== 'source')) throw new Error(`Promotion destination already exists: ${rootEntry.destination}`);
    if (rootEntry.id === 'source') {
      await verifyDestination(rootEntry.destination, rootEntry.payloadEntries, descriptorBytes(levelId, title), { allowDescriptor: true, descriptorOptional: true, allowedDivergencePaths: context.acceptDiverged?.divergingPaths ?? [] }, root);
    } else {
      await verifyPayloadTree(rootEntry.destination, rootEntry.payloadEntries, root);
    }
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
    sourcePath: `${sourceRoot.path}/`,
    destinationPath: `${sourceRoot.promotedPath}/`,
    roots: roots.map(({ id, path: rootPath, promotedPath, required, present }) => ({ id, path: rootPath, promotedPath, required, present })),
    legacySourcePresent: legacySourceWasPresent,
    derivative: context.acceptDiverged,
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
  return { source: { ...sourceSnapshot, baseCommit }, definition, manifest, evaluated, payload, roots, presentRoots, sourceRoot, payloadEntries: sourceRoot.payloadEntries, changed, destination: sourceRoot.destination, legacySourcePath };
}

function samePathSet(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function extractPayload(context) {
  const { root, runId } = context;
  const { source, presentRoots, sourceRoot, legacySourcePath } = context.preflight;
  const gitDirectory = path.resolve(root, (await gitText(root, ['rev-parse', '--git-dir'])).trim());
  const results = [];

  for (const rootEntry of presentRoots) {
    const destination = rootEntry.destination;
    const stage = path.join(gitDirectory, 'raild-promotion-staging', `${source.levelId}-${runId}-${rootEntry.id}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (await pathExists(destination)) {
      if (rootEntry.id === 'source') {
        await verifyDestination(destination, rootEntry.payloadEntries, descriptorBytes(source.levelId, source.title), { allowDescriptor: true, descriptorOptional: true, allowedDivergencePaths: source.derivative?.divergingPaths ?? [] }, root);
      } else {
        await verifyPayloadTree(destination, rootEntry.payloadEntries, root);
      }
      if (await pathExists(stage)) await fs.rm(stage, { recursive: true, force: true });
      results.push({ id: rootEntry.id, destination: `${rootEntry.promotedPath}/`, files: rootEntry.payloadEntries.length, reused: true });
      continue;
    }
    if (rootEntry.id === 'source' && context.migration && source.legacySourcePresent && await pathExists(legacySourcePath)) {
      await fs.rename(legacySourcePath, destination);
      const divergence = await verifyPayloadTree(destination, rootEntry.payloadEntries, root, source.derivative?.divergingPaths ?? []);
      if (source.derivative && !samePathSet(divergence, source.derivative.divergingPaths)) throw new Error('Relocated source divergence does not match its acceptance record.');
      results.push({ id: rootEntry.id, destination: `${rootEntry.promotedPath}/`, files: rootEntry.payloadEntries.length, reused: false, relocated: true });
      continue;
    }
    if (await pathExists(stage)) await fs.rm(stage, { recursive: true, force: true });
    await materializeTree(root, source.payloadCommit, rootEntry.path, stage, rootEntry.payloadEntries);
    await verifyPayloadTree(stage, rootEntry.payloadEntries, root);
    try {
      await fs.rename(stage, destination);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await verifyPayloadTree(destination, rootEntry.payloadEntries, root, rootEntry.id === 'source' ? source.derivative?.divergingPaths ?? [] : []);
      await fs.rm(stage, { recursive: true, force: true });
    }
    await fs.rm(stage, { recursive: true, force: true });
    results.push({ id: rootEntry.id, destination: `${rootEntry.promotedPath}/`, files: rootEntry.payloadEntries.length, reused: false });
  }

  if (context.migration && sourceRoot.present) await removeBuiltInRegistryEntry(root, source.levelId, { allowMissing: true });
  return { roots: results };
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
  const { destination, payloadEntries, source, presentRoots } = context.preflight;
  for (const rootEntry of presentRoots) {
    if (rootEntry.id === 'source') {
      await verifyDestination(rootEntry.destination, rootEntry.payloadEntries, descriptorBytes(source.levelId, source.title), { allowDescriptor: true, allowedDivergencePaths: source.derivative?.divergingPaths ?? [] }, context.root);
    } else {
      await verifyPayloadTree(rootEntry.destination, rootEntry.payloadEntries, context.root);
    }
  }
  const module = payloadEntries.find((entry) => entry.relativePath === 'index.ts');
  const card = payloadEntries.find((entry) => entry.relativePath === 'level.md');
  if (!module || !card) throw new Error('Promoted payload must contain index.ts and level.md.');
  const cardText = (await fs.readFile(path.join(destination, 'level.md'), 'utf8')).trimStart();
  if (!source.derivative?.divergingPaths.includes('level.md') && cardText.split(/\r?\n/, 1)[0] !== `# ${source.title}`) throw new Error('Benchmark level.md title does not match controller-owned assignment data.');
  const galleryWasGenerated = context.state.currentCheckpoint === 'catalog' || context.state.checkpoints.catalog?.status === 'completed' || context.state.checkpoints.commit?.status === 'completed';
  await assertNoUnexpectedApplicationChanges(context, { allowGallery: galleryWasGenerated });
  return { destination: source.destinationPath, verifiedFiles: presentRoots.reduce((count, rootEntry) => count + rootEntry.payloadEntries.length, 1) };
}

async function updateCatalogAndRunChecks(context, { completed = false, data: previousData } = {}) {
  const { root, runDirectory } = context;
  const { source, destination } = context.preflight;
  const baseCommit = source.baseCommit;
  if (context.migration && context.state.checkpoints.commit?.status === 'completed') {
    const gallerySource = await readText(path.join(root, GALLERY_PATH));
    return { gallerySha256: sha256(gallerySource), checks: await recoverCompletedChecks(runDirectory, source.levelId) };
  }
  if (completed) {
    if (!previousData?.gallerySha256 || !Array.isArray(previousData.checks) || previousData.checks.length !== 4) throw new Error('Completed catalog checkpoint has no verifiable record.');
    const gallerySource = await readText(path.join(root, GALLERY_PATH));
    if (sha256(gallerySource) !== previousData.gallerySha256 && !context.migration) throw new Error('Derived gallery changed after the completed catalog checkpoint.');
    for (const check of previousData.checks) {
      const historicalFloorFailure = context.migration && check.id === 'floor' && check.status === 'historical-failure';
      if (check.exitCode !== 0 && !historicalFloorFailure) throw new Error(`Completed promotion check ${check.id} was not successful.`);
      const record = await optionalJson(path.join(runDirectory, 'promotion-checks', `${check.id}.json`));
      if (!record || record.exitCode !== check.exitCode || record.stdoutSha256 !== check.stdoutSha256 || record.stderrSha256 !== check.stderrSha256) throw new Error(`Promotion check record ${check.id} is missing or tampered.`);
    }
    await assertOnlyPromotionChanges(await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']), root, context.preflight.presentRoots.map((rootEntry) => rootEntry.destination), true, true, ...promotionPathArgs(context), context.migrationLevelIds);
    return previousData;
  }
  const gallery = await runCommand(root, 'npm', ['run', 'gallery']);
  await writeCommandLog(runDirectory, 'gallery', gallery);
  if (gallery.code !== 0) throw new Error('Gallery regeneration failed; promotion remains resumable.');
  const gallerySource = await readText(path.join(root, GALLERY_PATH));
  if (!gallerySource.includes('## Benchmark levels')) throw new Error('Regenerated gallery has no benchmark-level section.');
  if (!gallerySource.includes(`# ${source.title}`)) throw new Error('Regenerated gallery does not contain the promoted descriptor title.');
  const checks = [];
  const scopeBase = await migrationScopeBase(context, baseCommit);
  const commands = [
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['build', 'npm', ['run', 'build']],
    ['scope', process.execPath, [path.join(root, 'scripts', 'check-benchmark-scope.mjs'), '--level', source.levelId, '--base', scopeBase, ...(context.migration && source.legacySourcePresent ? ['--migration'] : [])]],
    ['floor', 'npm', ['run', 'check:floor', '--', '--level', source.levelId]],
  ];
  for (const [id, executable, args] of commands) {
    const result = await runCommand(root, executable, args);
    await writeCommandLog(runDirectory, id, result);
    const historicalFloorFailure = context.migration && id === 'floor' && result.code !== 0;
    checks.push({
      id,
      command: [executable, ...args].join(' '),
      exitCode: result.code,
      stdoutSha256: sha256(result.stdout),
      stderrSha256: sha256(result.stderr),
      wallTimeSeconds: result.wallTimeSeconds,
      ...(historicalFloorFailure ? { status: 'historical-failure', note: 'Current floor check failed during migration, but the run manifest records that the floor gate passed at run time.' } : { status: 'passed' }),
    });
    if (result.code !== 0 && !historicalFloorFailure) throw new Error(`Promotion ${id} check failed: ${result.stderr || result.stdout}`);
  }
  await assertOnlyPromotionChanges(await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']), root, context.preflight.presentRoots.map((rootEntry) => rootEntry.destination), true, true, ...promotionPathArgs(context), context.migrationLevelIds);
  return { gallerySha256: sha256(gallerySource), checks };
}

async function recoverCompletedChecks(runDirectory, levelId) {
  const commands = {
    typecheck: 'npm run typecheck',
    build: 'npm run build',
    scope: `node scripts/check-benchmark-scope.mjs --level ${levelId}`,
    floor: `npm run check:floor -- --level ${levelId}`,
  };
  const checks = [];
  for (const id of ['typecheck', 'build', 'scope', 'floor']) {
    const record = await optionalJson(path.join(runDirectory, 'promotion-checks', `${id}.json`));
    if (!record) throw new Error(`Completed migration promotion check ${id} is missing.`);
    const historicalFloorFailure = id === 'floor' && record.exitCode !== 0;
    const recoveredCompletedCheck = id !== 'floor' && record.exitCode !== 0;
    checks.push({
      id,
      command: commands[id],
      exitCode: record.exitCode,
      stdoutSha256: record.stdoutSha256,
      stderrSha256: record.stderrSha256,
      wallTimeSeconds: record.wallTimeSeconds,
      ...(historicalFloorFailure
        ? { status: 'historical-failure', note: 'Current floor check failed during migration, but the run manifest records that the floor gate passed at run time.' }
        : recoveredCompletedCheck
          ? { status: 'recovered', note: 'This completed promotion already has a valid promotion commit; the stale failed check was recorded by a later recovery attempt after other migration changes.' }
          : { status: 'passed' }),
    });
  }
  return checks;
}

async function commitPromotion(context) {
  const { root } = context;
  const { source, presentRoots, sourceRoot } = context.preflight;
  const expected = new Set([GALLERY_PATH]);
  for (const rootEntry of presentRoots) {
    for (const entry of await listFiles(rootEntry.destination)) expected.add(`${rootEntry.promotedPath}/${entry}`);
  }
  if (context.migration && source.legacySourcePresent) {
    expected.add(REGISTRY_PATH);
    for (const entry of sourceRoot.payloadEntries) expected.add(`${sourceRoot.path}/${entry.relativePath}`);
  }
  const status = await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  assertOnlyPromotionChanges(status, root, presentRoots.map((rootEntry) => rootEntry.destination), true, true, ...promotionPathArgs(context), context.migrationLevelIds);
  const head = await currentHead(root);
  const baseCommit = source.baseCommit;
  if (context.state.promotionCommit || context.state.checkpoints.commit?.promotionCommit) {
    const promotionCommit = context.state.promotionCommit ?? context.state.checkpoints.commit.promotionCommit;
    await verifyPromotionCommit(root, promotionCommit, baseCommit, expected, source, context);
    return { promotionCommit };
  }
  if (head !== baseCommit && !(context.migration && await migrationToolingOnly(root, baseCommit, head))) {
    await verifyPromotionCommit(root, head, baseCommit, expected, source, context);
    return { promotionCommit: head, reused: true };
  }
  const addPaths = [...presentRoots.map((rootEntry) => rootEntry.promotedPath), GALLERY_PATH];
  if (context.migration && source.legacySourcePresent) addPaths.push(sourceRoot.path, REGISTRY_PATH);
  await git(root, ['add', '--', ...addPaths]);
  const staged = await gitText(root, ['diff', '--cached', '--name-only']);
  const stagedNames = staged.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!stagedNames.length || stagedNames.some((name) => !expected.has(name))) throw new Error('Refusing to commit files outside the verified promotion payload and gallery.');
  await git(root, ['commit', '-m', `Promote benchmark level ${source.levelId}`]);
  const promotionCommit = await currentHead(root);
  await verifyPromotionCommit(root, promotionCommit, baseCommit, expected, source, context);
  return { promotionCommit, reused: false };
}

async function verifyPromotionCommit(root, commit, baseCommit, expected, source, context = null) {
  const resolved = await resolveCommit(root, commit, 'promotion commit');
  const parent = (await gitText(root, ['rev-list', '--parents', '-n', '1', resolved])).trim().split(/\s+/)[1];
  const migrationToolingParent = Boolean(context?.migration && await migrationToolingOnly(root, baseCommit, parent));
  if (parent !== baseCommit && !migrationToolingParent) throw new Error('Promotion commit is not a separate administrative child of the pre-promotion application commit.');
  const names = (await gitText(root, ['diff', '--name-only', `${baseCommit}..${resolved}`])).split('\n').map((line) => line.trim()).filter(Boolean);
  const unexpected = names.filter((name) => !expected.has(name) && !(context?.migration && isMigrationToolingPath(name)));
  if (!names.length || unexpected.length) throw new Error('Promotion commit contains an unexpected application path.');
  await assertOnlyPromotionChanges(await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']), root, [], false, false);
}

async function migrationScopeBase(context, baseCommit) {
  if (!context.migration) return baseCommit;
  const head = await currentHead(context.root);
  return head !== baseCommit && await migrationToolingOnly(context.root, baseCommit, head) ? head : baseCommit;
}

async function migrationToolingOnly(root, baseCommit, commit) {
  if (baseCommit === commit) return true;
  const names = (await gitText(root, ['diff', '--name-only', `${baseCommit}..${commit}`])).split('\n').map((line) => line.trim()).filter(Boolean);
  return names.length > 0 && names.every(isMigrationToolingPath);
}

function isMigrationToolingPath(name) {
  return name.startsWith('scripts/benchmark/');
}

async function checkpoint(context, id, action) {
  if (!CHECKPOINTS.includes(id)) throw new Error(`Unknown promotion checkpoint: ${id}`);
  const { state, runDirectory } = context;
  const existing = state.checkpoints[id];
  const completed = existing?.status === 'completed' || (id === 'catalog' && context.migration && state.checkpoints.commit?.status === 'completed');
  state.status = 'running';
  state.currentCheckpoint = id;
  state.updatedAt = new Date().toISOString();
  await writeAtomicJson(statePath(context), state);
  try {
    const data = await action({ completed, data: existing?.data ?? state.checkpoints.catalog?.data });
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
  const destinations = context.preflight.presentRoots.map((rootEntry) => rootEntry.destination);
  await assertOnlyPromotionChanges(await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']), root, destinations, true, allowGallery, ...promotionPathArgs(context), context.migrationLevelIds);
}

async function assertNoUnexpectedApplicationChanges(context, { allowGallery }) {
  await verifyApplicationChanges(context, allowGallery);
}

function assertOnlyPromotionChanges(status, root, destinations, allowPromotionChanges, allowGallery, legacySource = null, registryPath = null, migrationLevelIds = []) {
  const paths = parsePorcelain(status);
  if (!paths.length) return;
  if (!allowPromotionChanges) throw new Error(`Refusing to overwrite unrelated local changes: ${paths.join(', ')}`);
  const destinationRoots = (Array.isArray(destinations) ? destinations : [destinations]).filter(Boolean).map((destination) => {
    const relative = path.relative(root, destination).replaceAll(path.sep, '/');
    return { relative, prefix: `${relative}/` };
  });
  const legacyRelative = legacySource ? path.relative(root, legacySource).replaceAll(path.sep, '/') : null;
  const registryRelative = registryPath ? path.relative(root, registryPath).replaceAll(path.sep, '/') : null;
  const migrationPaths = new Set(migrationLevelIds.length > 0 ? [GALLERY_PATH, REGISTRY_PATH] : []);
  for (const levelId of migrationLevelIds) {
    for (const rootEntry of levelFootprint(levelId, 'v1').roots) {
      migrationPaths.add(rootEntry.path);
      migrationPaths.add(rootEntry.promotedPath);
    }
  }
  for (const item of paths) {
    const normalized = item.replaceAll(path.sep, '/');
    const inDestination = destinationRoots.some(({ relative, prefix }) => normalized === relative || normalized.startsWith(prefix));
    if ((allowGallery && normalized === GALLERY_PATH) || inDestination || (legacyRelative && (normalized === legacyRelative || normalized.startsWith(`${legacyRelative}/`))) || (registryRelative && normalized === registryRelative) || [...migrationPaths].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) continue;
    throw new Error(`Refusing to overwrite unrelated local changes: ${item}`);
  }
}

function promotionPathArgs(context) {
  const source = context.preflight?.source;
  if (!context.migration || !source?.legacySourcePresent) return [null, null];
  return [path.join(context.root, context.preflight.sourceRoot.path), path.join(context.root, REGISTRY_PATH)];
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

function assertManifestShape(manifest, { allowLegacyMetadata = false } = {}) {
  if (!Array.isArray(manifest.stages) || manifest.stages.length === 0) throw new Error('Promotion requires a manifest with at least one completed stage record.');
  for (const key of ['configuration', 'theme', 'baseline', 'recipe', 'controller', 'timing', 'cost', 'output', 'disposition']) {
    if (!isRecord(manifest[key])) throw new Error(`Promotion manifest field ${key} is incomplete.`);
  }
  const hasThemeId = Object.hasOwn(manifest.theme, 'id');
  const hasOutputTitle = Object.hasOwn(manifest.output, 'title');
  if (hasThemeId !== hasOutputTitle && !allowLegacyMetadata) throw new Error('Promotion manifest uses an incomplete current or legacy metadata shape.');
  if (hasThemeId && hasOutputTitle && (typeof manifest.theme.id !== 'string' || !manifest.theme.id || typeof manifest.output.title !== 'string' || !manifest.output.title)) {
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
  const registryPath = path.join(root, REGISTRY_PATH);
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
  const source = await readText(path.join(root, REGISTRY_PATH));
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

async function readPromotedIdentities(root, promotedRoot) {
  const identities = new Set();
  const directory = path.join(root, promotedRoot);
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

async function payloadDiff(root, materialsCommit, payloadCommit) {
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

async function verifyPayloadTree(directory, entries, root, allowedDivergencePaths = []) {
  return verifyPayloadTreeWithRoot(directory, entries, root, [], allowedDivergencePaths);
}

async function verifyDestination(destination, payloadEntries, descriptor, { allowDescriptor, descriptorOptional = false, allowedDivergencePaths = [] }, root = ROOT) {
  const destinationInfo = await fs.lstat(destination);
  if (!destinationInfo.isDirectory()) throw new Error('Benchmark destination is not a regular directory.');
  await verifyPayloadTreeWithRoot(destination, payloadEntries, root, ['level.json'], allowedDivergencePaths);
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

async function verifyPayloadTreeWithRoot(directory, entries, root = ROOT, ignoredFiles = [], allowedDivergencePaths = []) {
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
  const allowedDivergences = new Set(allowedDivergencePaths);
  const divergentPaths = [];
  for (const [relativePath, expectedEntry] of expected) {
    const item = actual.files.get(relativePath);
    if (!item) throw new Error(`Relocated payload is missing ${relativePath}.`);
    if (item.kind === 'symlink') throw new Error(`Relocated payload contains a symbolic link at ${relativePath}.`);
    const actualBytes = await fs.readFile(item.path);
    const expectedBytes = await gitBuffer(root, ['cat-file', 'blob', expectedEntry.oid]);
    const byteDifference = !actualBytes.equals(expectedBytes);
    let modeDifference = false;
    if (item.kind === 'file') {
      const executable = ((await fs.stat(item.path)).mode & 0o111) !== 0;
      modeDifference = executable !== (expectedEntry.mode === '100755');
    }
    if (byteDifference || modeDifference) {
      if (allowedDivergences.has(relativePath)) divergentPaths.push(relativePath);
      else if (byteDifference) throw new Error(`Relocated payload changed bytes at ${relativePath}.`);
      else throw new Error(`Relocated payload changed executable mode at ${relativePath}.`);
    }
  }
  return divergentPaths.sort();
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
  if (JSON.stringify(previous.derivative ?? null) !== JSON.stringify(next.derivative ?? null)) throw new Error('Promotion derivative provenance changed.');
  if (previous.roots) {
    if (JSON.stringify(previous.roots) !== JSON.stringify(next.roots)) throw new Error('Promotion footprint provenance changed.');
  } else {
    const present = next.roots.filter((rootEntry) => rootEntry.present);
    if (present.length !== 1 || present[0].id !== 'source') throw new Error('Legacy promotion provenance cannot gain an additional footprint root.');
  }
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
  const result = await promoteRun({ root, runDirectory, migration, interruptAfter: process.env.PARETO_RAIL_PROMOTION_INTERRUPT_AFTER });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
