#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promoteRun, PromotionInterrupted } from './promote.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CHECKPOINTS = ['validation', 'extraction', 'descriptor', 'application', 'catalog', 'commit'];

async function main() {
  for (const checkpoint of CHECKPOINTS) {
    const fixture = await createFixture();
    try {
      await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory, interruptAfter: checkpoint }), (error) => error instanceof PromotionInterrupted);
      const resumed = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory });
      assert.equal(resumed.status, 'completed', `interruption at ${checkpoint} resumes`);
      await assertPromotion(fixture, resumed.promotionCommit);
    } finally {
      await fixture.cleanup();
    }
  }

  {
    const fixture = await createFixture();
    try {
      const cli = await execFileAsync(process.execPath, [path.join(HERE, 'scripts/benchmark/promote.mjs'), '--repo', fixture.root, '--run', fixture.runDirectory], { encoding: 'utf8' });
      const cliResult = JSON.parse(cli.stdout);
      assert.equal(cliResult.status, 'completed', 'the documented promotion command completes a synthetic run');
      await assertPromotion(fixture, cliResult.promotionCommit);
    } finally {
      await fixture.cleanup();
    }
  }

  {
    const fixture = await createFixture();
    try {
      const [first, second] = await Promise.all([
        promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }),
        promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }),
      ]);
      assert.equal(first.promotionCommit, second.promotionCommit, 'simultaneous promotions serialize on one Git lock');
      await assertPromotion(fixture, first.promotionCommit);
    } finally {
      await fixture.cleanup();
    }
  }

  {
    const fixture = await createFixture();
    try {
      const first = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory });
      const second = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory });
      assert.equal(second.promotionCommit, first.promotionCommit, 'repeated promotion reuses its administrative commit');
      assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '1', 'repeated promotion creates no second commit');
      await assertPromotion(fixture, first.promotionCommit);
    } finally {
      await fixture.cleanup();
    }
  }

  {
    const fixture = await createFixture({ legacyManifest: true });
    try {
      const manifestBefore = await fs.readFile(path.join(fixture.runDirectory, 'manifest.json'));
      const result = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory });
      await assertPromotion(fixture, result.promotionCommit);
      assert.deepEqual(await fs.readFile(path.join(fixture.runDirectory, 'manifest.json')), manifestBefore, 'legacy manifest remains byte-for-byte unchanged');
    } finally {
      await fixture.cleanup();
    }
  }

  {
    const fixture = await createFixture({ payloadSymlink: true });
    try {
      await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }), /symbolic link/);
      assert.equal(await exists(path.join(fixture.root, 'src/benchmark-levels/synthetic-a1b2')), false, 'symlink payload is rejected before destination creation');
      assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '0', 'symlink payload creates no application commit');
    } finally {
      await fixture.cleanup();
    }
  }

  await assertTamper('manifest', async (fixture) => {
    const manifest = JSON.parse(await fs.readFile(path.join(fixture.runDirectory, 'manifest.json'), 'utf8'));
    manifest.output.title = 'Tampered title';
    await writeJson(path.join(fixture.runDirectory, 'manifest.json'), manifest);
  });
  await assertTamper('payload ref', async (fixture) => {
    const payload = JSON.parse(await fs.readFile(path.join(fixture.runDirectory, 'payload.json'), 'utf8'));
    payload.branch = 'evaluated-run';
    await writeJson(path.join(fixture.runDirectory, 'payload.json'), payload);
  });
  await assertTamper('payload contents', async (fixture) => {
    await fs.writeFile(path.join(fixture.payloadWorktree, 'src/levels/synthetic-a1b2/index.ts'), 'tampered payload bytes\n');
  }, { payloadWorktree: true });
  await assertTamper('descriptor destination', async (fixture) => {
    await fs.writeFile(path.join(fixture.root, 'src/benchmark-levels/synthetic-a1b2/level.json'), '{"id":"synthetic-a1b2","title":"Tampered"}\n');
  });

  {
    const fixture = await createFixture();
    try {
      await fs.writeFile(path.join(fixture.root, 'unrelated.txt'), 'do not overwrite\n');
      await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }), /unrelated local changes/);
      assert.equal(await exists(path.join(fixture.root, 'src/benchmark-levels/synthetic-a1b2')), false, 'preflight failure does not mutate application source');
    } finally {
      await fixture.cleanup();
    }
  }

  console.log('Benchmark promotion tests passed.');
}

async function assertTamper(label, mutate, options = {}) {
  const fixture = await createFixture(options);
  try {
    await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory });
    await mutate(fixture);
    await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }), undefined, `${label} is rejected`);
    const state = JSON.parse(await fs.readFile(path.join(fixture.runDirectory, 'promotion.json'), 'utf8'));
    assert.equal(state.status, 'failed', `${label} records a resumable promotion failure`);
    assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '1', `${label} does not create another commit`);
  } finally {
    await fixture.cleanup();
  }
}

async function assertPromotion(fixture, promotionCommit) {
  assert.match(promotionCommit, /^[a-f0-9]{40}$/);
  const destination = path.join(fixture.root, 'src/benchmark-levels/synthetic-a1b2');
  assert.equal(await fs.readFile(path.join(destination, 'index.ts'), 'utf8'), "export const syntheticLevel = { id: 'synthetic-a1b2', title: 'Synthetic Promotion' };\n");
  assert.equal(await fs.readFile(path.join(destination, 'level.md'), 'utf8'), '# Synthetic Promotion\n\nSynthetic test payload.\n');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination, 'level.json'), 'utf8')), { id: 'synthetic-a1b2', title: 'Synthetic Promotion' });
  assert.match(await fs.readFile(path.join(fixture.root, 'docs/level-gallery.md'), 'utf8'), /## Benchmark levels/);
  assert.equal((await git(fixture.root, ['show', '--format=%P', '--no-patch', promotionCommit])).trim(), fixture.base);
}

async function createFixture({ payloadWorktree = false, legacyManifest = false, payloadSymlink = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-promotion-repo-'));
  const externalPayloadWorktree = `${root}-payload-worktree`;
  const runDirectory = path.join(root, 'benchmark/private/runs/synthetic-run-a1b2');
  await fs.mkdir(path.join(root, 'src/levels'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/benchmark-levels'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeText(path.join(root, '.gitignore'), 'benchmark/private/\n');
  await writeText(path.join(root, 'package.json'), JSON.stringify({ name: 'synthetic-promotion', scripts: { gallery: 'node gallery.mjs', typecheck: 'node -e ""', build: 'node -e ""', 'check:floor': 'node -e "process.exit(0)" --' } }, null, 2) + '\n');
  await writeText(path.join(root, 'gallery.mjs'), "import fs from 'node:fs/promises';\nawait fs.writeFile('docs/level-gallery.md', '# Level gallery\\n\\n## Benchmark levels\\n\\n# Synthetic Promotion\\n');\n");
  await writeText(path.join(root, 'src/levels/index.ts'), "export const levelMetadatas = [{ id: 'built-in-level', title: 'Built-in Level', aliases: ['built-in'], kind: 'playable' }];\n");
  await writeText(path.join(root, 'docs/level-gallery.md'), '# Level gallery\n\n## Built-in levels\n');
  await fs.copyFile(path.join(HERE, 'scripts/check-benchmark-scope.mjs'), path.join(root, 'scripts/check-benchmark-scope.mjs'));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.name', 'Synthetic Promotion Test']);
  await git(root, ['config', 'user.email', 'synthetic@example.test']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'synthetic materials']);
  const base = (await git(root, ['rev-parse', 'HEAD'])).trim();

  const sourceFiles = {
    'src/levels/synthetic-a1b2/index.ts': "export const syntheticLevel = { id: 'synthetic-a1b2', title: 'Synthetic Promotion' };\n",
    'src/levels/synthetic-a1b2/level.md': '# Synthetic Promotion\n\nSynthetic test payload.\n',
  };
  await git(root, ['switch', '-c', 'evaluated-run']);
  for (const [file, contents] of Object.entries(sourceFiles)) await writePayloadFile(path.join(root, file), contents, payloadSymlink);
  await git(root, ['add', 'src/levels/synthetic-a1b2']);
  await git(root, ['commit', '-qm', 'synthetic evaluated level']);
  const evaluatedCommit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['switch', '-q', '-c', 'payload-run', base]);
  for (const [file, contents] of Object.entries(sourceFiles)) await writePayloadFile(path.join(root, file), contents, payloadSymlink);
  await git(root, ['add', 'src/levels/synthetic-a1b2']);
  await git(root, ['commit', '-qm', 'synthetic payload']);
  const payloadCommit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['switch', '-q', 'main']);
  if (payloadWorktree) await git(root, ['worktree', 'add', '-q', externalPayloadWorktree, 'payload-run']);

  const assignment = {
    runId: 'synthetic-run-a1b2',
    slotId: 'a1b2',
    configurationId: 'synthetic-configuration',
    levelId: 'synthetic-a1b2',
    levelTitle: 'Synthetic Promotion',
    recipe: { path: 'synthetic/recipe.md', sha256: 'a'.repeat(64) },
    theme: { id: 'synthetic-theme', path: 'synthetic/theme.md', sha256: 'b'.repeat(64) },
  };
  const definition = {
    schemaVersion: 1,
    benchmarkVersion: 'v-synthetic',
    mode: 'eligible',
    assignment,
    baseline: { materialsCommit: base, entrantBaseline: base },
  };
  const gates = ['typecheck', 'build', 'scope', 'floor'].map((id) => ({ id, status: 'passed', command: id, wallTimeSeconds: 0 }));
  const manifest = {
    schemaVersion: 2,
    benchmarkVersion: definition.benchmarkVersion,
    runId: assignment.runId,
    slotId: assignment.slotId,
    configuration: { id: assignment.configurationId },
    theme: { ...assignment.theme },
    baseline: { materialsCommit: base, entrantBaseline: { kind: 'git-commit', identifier: base } },
    recipe: assignment.recipe,
    controller: { path: 'synthetic/controller.md', sha256: 'c'.repeat(64) },
    timing: { startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z', wallTimeSeconds: 60 },
    stages: [{ id: 'synthetic', role: 'solo', model: { provider: 'synthetic', snapshotId: 'synthetic' }, harness: { name: 'synthetic', version: '1' }, sessionId: 'synthetic', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z', wallTimeSeconds: 60, usage: { inputTokens: 0, outputTokens: 0 }, pricing: { status: 'measured', costUsd: 0 }, result: 'completed' }],
    cost: { currency: 'USD', status: 'measured', totalUsd: 0, orchestrationTreatment: 'none' },
    gates,
    output: { levelId: assignment.levelId, title: assignment.levelTitle, evaluated: { commit: evaluatedCommit, branch: 'evaluated-run' }, payload: { commit: payloadCommit, branch: 'payload-run' } },
    disposition: { status: 'playable' },
  };
  const payload = { payloadCommit, branch: 'payload-run', ...(payloadWorktree ? { worktree: externalPayloadWorktree } : {}) };
  if (legacyManifest) {
    delete manifest.theme.id;
    delete manifest.output.title;
  }
  await writeJson(path.join(runDirectory, 'run-definition.json'), definition);
  await writeJson(path.join(runDirectory, 'manifest.json'), manifest);
  await writeJson(path.join(runDirectory, 'evaluated.json'), { evaluatedCommit });
  await writeJson(path.join(runDirectory, 'payload.json'), payload);
  await writeJson(path.join(runDirectory, 'gates/gates.json'), { evaluatedCommit, gates });
  return {
    root,
    base,
    runDirectory,
    payloadWorktree: externalPayloadWorktree,
    cleanup: async () => {
      if (payloadWorktree) await git(root, ['worktree', 'remove', '--force', externalPayloadWorktree]).catch(() => {});
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(externalPayloadWorktree, { recursive: true, force: true });
    },
  };
}

async function git(cwd, args) { return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout; }
async function writeText(filePath, contents) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, contents, 'utf8'); }
async function writePayloadFile(filePath, contents, symlink) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (symlink && filePath.endsWith('/index.ts')) await fs.symlink('/outside/verified-payload-boundary', filePath);
  else await fs.writeFile(filePath, contents, 'utf8');
}
async function writeJson(filePath, value) { await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`); }
async function exists(filePath) { try { await fs.lstat(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }

main().catch((error) => { console.error(error); process.exitCode = 1; });
