#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildMigrationInventory } from './inventory.mjs';
import { cleanupVerifiedSourceCopy, CleanupInterrupted, migrateExistingOutputs } from './migrate.mjs';
import { promoteRun, PromotionInterrupted } from './promote.mjs';

const execFileAsync = promisify(execFile);

async function main() {
  await testConsistentPublishedCopyAndPublicRollout();
  await testConflictingPublishedCopy();
  await testManualRelocationAndPayloadOnlyPromotion();
  await testVerifiedRehearsalCleanupAndFinalDomains();
  await testCleanupCommitDurabilityAndDirtyRefusal();
  await testDivergentSourceAndRefsRefuseCleanup();
  await testResumptionAndIdempotency();
  console.log('Benchmark migration inventory tests passed.');
}

async function testConsistentPublishedCopyAndPublicRollout() {
  const fixture = await createFixture({ playable: true, rehearsal: false, manualPlayable: false });
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(fixture.runDirectory, 'manifest.json'), 'utf8'));
    await writeJson(path.join(fixture.root, 'benchmark/public/manifests/published.json'), manifest);
    await writeText(path.join(fixture.root, `benchmark/public/rollouts/${fixture.runId}/rollout.jsonl`), `{"runId":"${fixture.runId}"}\n`);
    const inventory = await buildMigrationInventory({ root: fixture.root });
    assert.equal(inventory.records.length, 1);
    assert.equal(inventory.records[0].manifestCopies.length, 2);
    assert.equal(inventory.records[0].publicManifest.present, true);
    assert.equal(inventory.records[0].rolloutEvidence.publicPaths.length, 1);
  } finally {
    await fixture.cleanup();
  }
}

async function testConflictingPublishedCopy() {
  const fixture = await createFixture({ playable: true, rehearsal: false, manualPlayable: false });
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(fixture.runDirectory, 'manifest.json'), 'utf8'));
    manifest.output.levelId = 'conflicting-level';
    await writeJson(path.join(fixture.root, 'benchmark/public/conflict.json'), manifest);
    await assert.rejects(() => buildMigrationInventory({ root: fixture.root }), /conflicting manifest copies/);
  } finally {
    await fixture.cleanup();
  }
}

async function testManualRelocationAndPayloadOnlyPromotion() {
  const manual = await createFixture({ playable: true, rehearsal: false, manualPlayable: true });
  try {
    const before = await readTree(manual.root, path.join('src/levels', manual.levelId));
    const result = await (await import('./promote.mjs')).promoteRun({ root: manual.root, runDirectory: manual.runDirectory, migration: true });
    assert.match(result.promotionCommit, /^[a-f0-9]{40}$/);
    assert.equal(await exists(path.join(manual.root, 'src/levels', manual.levelId)), false);
    assert.deepEqual(await readTree(manual.root, path.join('src/benchmark-levels', manual.levelId)), { ...before, 'level.json': '{\n  "id": "manual-a1b2",\n  "title": "Manual Level"\n}\n' });
    assert.equal((await fs.readFile(path.join(manual.root, 'src/levels/index.ts'), 'utf8')).includes(manual.levelId), false);
  } finally {
    await manual.cleanup();
  }

  const payloadOnly = await createFixture({ playable: true, rehearsal: false, manualPlayable: false, levelId: 'payload-only-b2c3' });
  try {
    const result = await (await import('./promote.mjs')).promoteRun({ root: payloadOnly.root, runDirectory: payloadOnly.runDirectory, migration: true });
    assert.match(result.promotionCommit, /^[a-f0-9]{40}$/);
    assert.equal(await exists(path.join(payloadOnly.root, 'src/levels', payloadOnly.levelId)), false);
    assert.equal(await exists(path.join(payloadOnly.root, 'src/benchmark-levels', payloadOnly.levelId, 'level.json')), true);
  } finally {
    await payloadOnly.cleanup();
  }
}

async function testVerifiedRehearsalCleanupAndFinalDomains() {
  const fixture = await createFixture({ playable: true, rehearsal: true, manualPlayable: true });
  try {
    const result = await migrateExistingOutputs({ root: fixture.root, version: 'synthetic' });
    assert.equal(result.promoted, 1);
    assert.equal(result.cleaned, 1);
    assert.equal(await exists(path.join(fixture.root, 'src/levels', fixture.rehearsalLevelId)), false);
    assert.equal(await exists(path.join(fixture.root, 'src/benchmark-levels', fixture.rehearsalLevelId)), false);
    assert.equal(await exists(path.join(fixture.root, 'src/benchmark-levels', fixture.levelId, 'level.json')), true);
    const registry = await fs.readFile(path.join(fixture.root, 'src/levels/index.ts'), 'utf8');
    assert.equal(registry.includes(fixture.levelId), false);
    assert.equal(registry.includes(fixture.rehearsalLevelId), false);
    const migration = JSON.parse(await fs.readFile(path.join(fixture.root, 'benchmark/private/migrations/synthetic.json'), 'utf8'));
    assert.equal(migration.status, 'completed');
    assert.deepEqual(migration.verification.checks.map((check) => check.id), ['gallery', 'typecheck', 'build']);
    assert.equal(migration.entries.length, 1);
    assert.equal(migration.cleanups.length, 1);
    assert.match(migration.cleanups[0].cleanupCommit, /^[a-f0-9]{40}$/);
    assert.equal((await git(fixture.root, ['show', '--format=%P', '--no-patch', migration.cleanups[0].cleanupCommit])).trim(), migration.entries[0].promotionCommit);
    const cleanupState = JSON.parse(await fs.readFile(path.join(fixture.root, 'benchmark/private/runs', fixture.rehearsalRunId, 'source-cleanup.json'), 'utf8'));
    assert.equal(cleanupState.status, 'completed');
    assert.equal(cleanupState.source.payloadCommit.length, 40);
    assert.equal(cleanupState.cleanupCommit, migration.cleanups[0].cleanupCommit);
  } finally {
    await fixture.cleanup();
  }
}

async function testCleanupCommitDurabilityAndDirtyRefusal() {
  const fixture = await createFixture({ playable: false, rehearsal: true, manualPlayable: true });
  try {
    const inventory = await buildMigrationInventory({ root: fixture.root });
    const record = inventory.records.find((candidate) => candidate.runId === fixture.runId);
    await assert.rejects(() => cleanupVerifiedSourceCopy({ root: fixture.root, runDirectory: fixture.runDirectory, record, interruptAfter: 'source' }), (error) => error instanceof CleanupInterrupted);
    const stateAfterInterrupt = JSON.parse(await fs.readFile(path.join(fixture.runDirectory, 'source-cleanup.json'), 'utf8'));
    assert.equal(stateAfterInterrupt.checkpoints.source.status, 'completed');
    assert.equal(stateAfterInterrupt.cleanupCommit, undefined);
    const resumed = await cleanupVerifiedSourceCopy({ root: fixture.root, runDirectory: fixture.runDirectory, record });
    assert.match(resumed.cleanupCommit, /^[a-f0-9]{40}$/);
    const repeated = await cleanupVerifiedSourceCopy({ root: fixture.root, runDirectory: fixture.runDirectory, record });
    assert.equal(repeated.cleanupCommit, resumed.cleanupCommit);
    assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '1');
    const names = (await git(fixture.root, ['diff', '--name-only', `${fixture.base}..HEAD`])).trim().split('\n').filter(Boolean);
    assert.ok(names.includes('src/levels/index.ts'));
    assert.ok(names.every((name) => name === 'src/levels/index.ts' || name.startsWith(`src/levels/${fixture.levelId}/`) || name === 'docs/level-gallery.md'));
  } finally {
    await fixture.cleanup();
  }

  const dirty = await createFixture({ playable: false, rehearsal: true, manualPlayable: true });
  try {
    const inventory = await buildMigrationInventory({ root: dirty.root });
    const record = inventory.records.find((candidate) => candidate.runId === dirty.runId);
    await writeText(path.join(dirty.root, 'unrelated.txt'), 'unrelated\n');
    await assert.rejects(() => cleanupVerifiedSourceCopy({ root: dirty.root, runDirectory: dirty.runDirectory, record }), /unrelated dirty worktree/);
    assert.equal(await exists(path.join(dirty.root, 'src/levels', dirty.levelId)), true);
    assert.equal((await git(dirty.root, ['rev-list', '--count', `${dirty.base}..HEAD`])).trim(), '0');
  } finally {
    await dirty.cleanup();
  }
}

async function testDivergentSourceAndRefsRefuseCleanup() {
  const source = await createFixture({ playable: false, rehearsal: true, manualPlayable: true });
  try {
    await fs.writeFile(path.join(source.root, 'src/levels', source.levelId, 'index.ts'), 'divergent bytes\n');
    await assert.rejects(() => buildMigrationInventory({ root: source.root }), /primary source differs from payload/);
    await assert.rejects(() => cleanupVerifiedSourceCopy({ root: source.root, runDirectory: source.runDirectory, record: { runId: source.runId, levelId: source.levelId, disposition: 'rehearsal', source: { path: `src/levels/${source.levelId}/` } } }), /Migration inventory rejected|primary source differs|unrelated dirty/);
  } finally {
    await source.cleanup();
  }

  const refs = await createFixture({ playable: false, rehearsal: true, manualPlayable: true });
  try {
    const payload = JSON.parse(await fs.readFile(path.join(refs.runDirectory, 'payload.json'), 'utf8'));
    payload.branch = refs.evaluatedBranch;
    await writeJson(path.join(refs.runDirectory, 'payload.json'), payload);
    await assert.rejects(() => buildMigrationInventory({ root: refs.root }), /payload branch does not resolve|manifest and payload.json disagree/);
  } finally {
    await refs.cleanup();
  }
}

async function testResumptionAndIdempotency() {
  const fixture = await createFixture({ playable: true, rehearsal: false, manualPlayable: true });
  try {
    await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory, migration: true, interruptAfter: 'extraction' }), (error) => error instanceof PromotionInterrupted);
    const resumed = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory, migration: true });
    const repeated = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory, migration: true });
    assert.equal(repeated.promotionCommit, resumed.promotionCommit);
    assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '1');
  } finally {
    await fixture.cleanup();
  }
}

async function createFixture({ playable, rehearsal, manualPlayable, levelId = playable ? 'manual-a1b2' : 'rehearsal-c3d4' }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'raild-inventory-repo-'));
  const runId = `run-${levelId}`;
  const rehearsalLevelId = 'rehearsal-c3d4';
  const rehearsalRunId = `run-${rehearsalLevelId}`;
  await fs.mkdir(path.join(root, 'src/levels'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/benchmark-levels'), { recursive: true });
  await fs.mkdir(path.join(root, 'benchmark/private/runs'), { recursive: true });
  await fs.mkdir(path.join(root, 'benchmark/public'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeText(path.join(root, '.gitignore'), 'benchmark/private/\nnode_modules/\n');
  await writeJson(path.join(root, 'package.json'), {
    type: 'module',
    scripts: {
      gallery: 'node gallery.mjs',
      typecheck: 'node -e "process.exit(0)"',
      build: 'node -e "process.exit(0)"',
      'check:floor': 'node -e "process.exit(0)" --',
    },
  });
  await writeText(path.join(root, 'gallery.mjs'), "import fs from 'node:fs/promises'; const entries = await fs.readdir('src/benchmark-levels', { withFileTypes: true }); const titles = []; for (const entry of entries.filter((item) => item.isDirectory())) { const descriptor = JSON.parse(await fs.readFile(`src/benchmark-levels/${entry.name}/level.json`, 'utf8')); titles.push(`# ${descriptor.title}`); } await fs.writeFile('docs/level-gallery.md', `# Level gallery\\n\\n## Built-in levels\\n\\n## Benchmark levels\\n\\n${titles.join('\\n') }\\n`);\n");
  await writeText(path.join(root, 'docs/level-gallery.md'), '# Level gallery\n\n## Built-in levels\n');
  await fs.copyFile(path.resolve('scripts/check-benchmark-scope.mjs'), path.join(root, 'scripts/check-benchmark-scope.mjs'));
  await writeText(path.join(root, 'src/levels/index.ts'), [
    'export const levelMetadatas = [',
    "  { id: 'anchor', title: 'Anchor', kind: 'playable' },",
    ...(manualPlayable ? [`  { id: '${levelId}', title: '${rehearsal ? 'Rehearsal Level' : 'Manual Level'}', kind: 'playable' },`] : []),
    ...(rehearsal && rehearsalLevelId !== levelId ? [`  { id: '${rehearsalLevelId}', title: 'Rehearsal Level', kind: 'playable' },`] : []),
    '];',
    'const builtInLoaders = {',
    "  'anchor': async () => (await import('./anchor')).anchorLevel,",
    ...(manualPlayable ? [`  '${levelId}': async () => (await import('./${levelId}')).${rehearsal ? 'rehearsalLevel' : 'manualLevel'},`] : []),
    ...(rehearsal && rehearsalLevelId !== levelId ? [`  '${rehearsalLevelId}': async () => (await import('./${rehearsalLevelId}')).rehearsalLevel,`] : []),
    '};',
  ].join('\n') + '\n');
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.name', 'Inventory Test']);
  await git(root, ['config', 'user.email', 'inventory@example.test']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'materials']);
  const materials = (await git(root, ['rev-parse', 'HEAD'])).trim();

  const definitions = [];
  if (playable) definitions.push(await createRun(root, { runId, levelId, title: 'Manual Level', disposition: 'playable', mode: 'eligible', materials, mainHasSource: manualPlayable }));
  if (rehearsal) definitions.push(await createRun(root, { runId: rehearsalRunId, levelId: rehearsalLevelId, title: 'Rehearsal Level', disposition: 'rehearsal', mode: 'rehearsal', materials, mainHasSource: true }));
  await git(root, ['switch', '-q', '-C', 'main']);
  return {
    root,
    base: (await git(root, ['rev-parse', 'HEAD'])).trim(),
    runId,
    levelId,
    runDirectory: path.join(root, 'benchmark/private/runs', runId),
    evaluatedBranch: definitions.find((item) => item.runId === runId)?.evaluatedBranch,
    rehearsalRunId,
    rehearsalLevelId,
    cleanup: async () => fs.rm(root, { recursive: true, force: true }),
  };
}

async function createRun(root, { runId, levelId, title, disposition, mode, materials, mainHasSource }) {
  const source = {
    'index.ts': `export const ${mode === 'eligible' ? 'manual' : 'rehearsal'}Level = { id: '${levelId}', title: '${title}' };\n`,
    'level.md': `# ${title}\n\nThis is a sufficiently long synthetic card for migration verification. It is not used by the fixture gallery.\n`,
  };
  const base = materials;
  const evaluatedBranch = `evaluated-${runId}`;
  const payloadBranch = `payload-${runId}`;
  await git(root, ['switch', '-q', '-c', evaluatedBranch, base]);
  await writeSource(root, levelId, source);
  await git(root, ['add', `src/levels/${levelId}`]);
  await git(root, ['commit', '-qm', `${levelId} evaluated`]);
  const evaluatedCommit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['switch', '-q', '-c', payloadBranch, base]);
  await writeSource(root, levelId, source);
  await git(root, ['add', `src/levels/${levelId}`]);
  await git(root, ['commit', '-qm', `${levelId} payload`]);
  const payloadCommit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['switch', '-q', 'main']);
  if (mainHasSource) {
    await writeSource(root, levelId, source);
    await git(root, ['add', `src/levels/${levelId}`]);
    await git(root, ['commit', '-qm', `${levelId} manual copy`]);
  }

  const gates = ['typecheck', 'build', 'scope', 'floor'].map((id) => ({ id, status: 'passed', command: id, wallTimeSeconds: 0 }));
  const assignment = { runId, slotId: levelId.slice(-4), configurationId: 'synthetic-config', levelId, levelTitle: title, recipe: { path: 'synthetic/recipe.md', sha256: 'a'.repeat(64) }, theme: { id: 'synthetic-theme', path: 'synthetic/theme.md', sha256: 'b'.repeat(64) } };
  const definition = { schemaVersion: 1, benchmarkVersion: 'synthetic', mode, assignment, baseline: { materialsCommit: materials, entrantBaseline: materials } };
  const manifest = {
    schemaVersion: 2,
    benchmarkVersion: 'synthetic',
    runId,
    slotId: assignment.slotId,
    configuration: { id: assignment.configurationId },
    theme: assignment.theme,
    baseline: { materialsCommit: materials, entrantBaseline: { kind: 'git-commit', identifier: materials } },
    recipe: assignment.recipe,
    controller: { path: 'synthetic/controller.md', sha256: 'c'.repeat(64) },
    timing: { startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z', wallTimeSeconds: 60 },
    stages: [{ id: 'synthetic', role: 'solo', model: { provider: 'synthetic', snapshotId: 'synthetic' }, harness: { name: 'synthetic', version: '1' }, sessionId: 'synthetic', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z', wallTimeSeconds: 60, usage: { inputTokens: 0, outputTokens: 0 }, pricing: { status: 'measured', costUsd: 0 }, result: 'completed' }],
    cost: { currency: 'USD', status: 'measured', totalUsd: 0, orchestrationTreatment: 'none' },
    gates,
    output: { levelId, title, evaluated: { commit: evaluatedCommit, branch: evaluatedBranch }, payload: { commit: payloadCommit, branch: payloadBranch } },
    disposition: { status: disposition },
  };
  const directory = path.join(root, 'benchmark/private/runs', runId);
  await writeJson(path.join(directory, 'run-definition.json'), definition);
  await writeJson(path.join(directory, 'manifest.json'), manifest);
  await writeJson(path.join(directory, 'evaluated.json'), { evaluatedCommit });
  await writeJson(path.join(directory, 'payload.json'), { payloadCommit, branch: payloadBranch });
  await writeJson(path.join(directory, 'gates/gates.json'), { evaluatedCommit, gates });
  return { runId, evaluatedBranch };
}

async function writeSource(root, levelId, source) {
  for (const [name, contents] of Object.entries(source)) await writeText(path.join(root, 'src/levels', levelId, name), contents);
}
async function readTree(root, directory) {
  const target = path.isAbsolute(directory) ? directory : path.join(root, directory);
  const result = {};
  for (const name of await fs.readdir(target)) {
    const full = path.join(target, name);
    const stat = await fs.stat(full);
    if (stat.isFile()) result[name] = await fs.readFile(full, 'utf8');
  }
  return result;
}
async function writeText(filePath, contents) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, contents, 'utf8'); }
async function writeJson(filePath, value) { await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`); }
async function exists(filePath) { try { await fs.lstat(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
async function git(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout; }

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
