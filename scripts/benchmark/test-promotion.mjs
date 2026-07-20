#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promoteRun, PromotionInterrupted } from './promote.mjs';
import { sha256 } from './common.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CHECKPOINTS = ['validation', 'extraction', 'conversion', 'application', 'catalog', 'commit'];
const GALLERY = '# Level gallery\n\n## Built-in levels\n\n# Built-in Level\n';
const CONTENT_KEYS = ['overview', 'start', 'hero'];
// A real 8x8 PNG, so the promotion step runs the repository's actual encoder.
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQI12M4oRGFFTEMLQkAWChSgWZuiAoAAAAASUVORK5CYII=', 'base64');

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

  for (const checkpoint of CHECKPOINTS) {
    const fixture = await createFixture({ content: 'png' });
    try {
      await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory, interruptAfter: checkpoint }), (error) => error instanceof PromotionInterrupted);
      const heroPath = path.join(fixture.root, 'public/level-content/synthetic-a1b2/hero.avif');
      const converted = await exists(heroPath);
      const before = converted ? await fs.stat(heroPath) : null;
      const resumed = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory });
      assert.equal(resumed.status, 'completed', `interruption at ${checkpoint} resumes with a PNG payload`);
      if (before) assert.equal((await fs.stat(heroPath)).mtimeMs, before.mtimeMs, `resuming after ${checkpoint} does not re-convert`);
      await assertPromotion(fixture, resumed.promotionCommit);
    } finally {
      await fixture.cleanup();
    }
  }

  {
    const fixture = await createFixture({ content: 'png' });
    try {
      const result = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory });
      await assertPromotion(fixture, result.promotionCommit);
    } finally {
      await fixture.cleanup();
    }
  }

  {
    const fixture = await createFixture({ danglingImage: true });
    try {
      await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }), /references a PNG the payload does not contain/);
      assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '0', 'a dangling descriptor image creates no commit');
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
    const fixture = await createFixture({ rehearsal: true });
    try {
      await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }), /rehearsals are not publishable/);
      assert.equal(await exists(path.join(fixture.root, 'src/benchmark-levels/synthetic-a1b2')), false, 'a rehearsal run is not promoted');
      assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '0', 'a rehearsal run creates no application commit');
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

  {
    const fixture = await createFixture({ content: 'avif' });
    try {
      const result = await promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory });
      await assertPromotion(fixture, result.promotionCommit);
      assert.equal(await fs.readFile(path.join(fixture.root, 'public/level-content/synthetic-a1b2/hero.avif'), 'utf8'), 'synthetic hero\n');
      const names = (await git(fixture.root, ['diff', '--name-only', `${fixture.base}..${result.promotionCommit}`])).trim().split('\n').filter(Boolean).sort();
      assert.deepEqual(names, [
        'public/level-content/synthetic-a1b2/hero.avif',
        'src/benchmark-levels/synthetic-a1b2/index.ts',
        'src/benchmark-levels/synthetic-a1b2/level.json',
        'src/benchmark-levels/synthetic-a1b2/level.md',
      ]);
    } finally {
      await fixture.cleanup();
    }
  }

  for (const [card, pattern] of [['missing', /must contain the entrant-authored level\.md/], ['mistitled', /level\.md must start with # Synthetic Promotion/]]) {
    const fixture = await createFixture({ card });
    try {
      await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }), pattern, `a ${card} identity card is rejected`);
      assert.equal(await exists(path.join(fixture.root, 'src/benchmark-levels/synthetic-a1b2')), false, `a ${card} identity card is rejected before destination creation`);
      assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '0');
    } finally {
      await fixture.cleanup();
    }
  }

  {
    const fixture = await createFixture({ outsidePayload: true });
    try {
      await assert.rejects(() => promoteRun({ root: fixture.root, runDirectory: fixture.runDirectory }), /outside the assigned level footprint/);
      assert.equal((await git(fixture.root, ['rev-list', '--count', `${fixture.base}..HEAD`])).trim(), '0');
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
    await fs.writeFile(path.join(fixture.payloadWorktree, 'src/benchmark-levels/synthetic-a1b2/index.ts'), 'tampered payload bytes\n');
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
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination, 'level.json'), 'utf8')), expectedDescriptor(fixture));
  assert.equal(await fs.readFile(path.join(fixture.root, 'docs/level-gallery.md'), 'utf8'), GALLERY, 'promotion leaves the gallery untouched');
  assert.equal((await git(fixture.root, ['show', '--format=%P', '--no-patch', promotionCommit])).trim(), fixture.base);
  if (fixture.content === 'avif') assert.equal(await fs.readFile(path.join(fixture.root, 'public/level-content/synthetic-a1b2/hero.avif'), 'utf8'), 'synthetic hero\n');
  if (fixture.content === 'png') await assertConvertedContent(fixture, promotionCommit);
}

function expectedDescriptor(fixture) {
  const descriptor = { id: 'synthetic-a1b2', title: 'Synthetic Promotion' };
  if (fixture.content === 'png') descriptor.contentImages = Object.fromEntries(CONTENT_KEYS.map((key) => [key, `/level-content/synthetic-a1b2/${key}.avif`]));
  return descriptor;
}

async function assertConvertedContent(fixture, promotionCommit) {
  const contentDirectory = path.join(fixture.root, 'public/level-content/synthetic-a1b2');
  for (const key of CONTENT_KEYS) {
    assert.equal(await exists(path.join(contentDirectory, `${key}.png`)), false, `${key}.png is gone from the promoted tree`);
    const bytes = await fs.readFile(path.join(contentDirectory, `${key}.avif`));
    assert.equal(bytes.subarray(4, 12).toString('latin1'), 'ftypavif', `${key}.avif is a real AVIF`);
  }
  const tracked = (await git(fixture.root, ['ls-files', '--', '*.png', '*.PNG'])).trim();
  assert.equal(tracked, '', 'promotion tracks no PNG');
  const names = (await git(fixture.root, ['diff', '--name-only', `${fixture.base}..${promotionCommit}`])).trim().split('\n').filter(Boolean).sort();
  assert.deepEqual(names, [
    ...CONTENT_KEYS.map((key) => `public/level-content/synthetic-a1b2/${key}.avif`).sort(),
    'src/benchmark-levels/synthetic-a1b2/index.ts',
    'src/benchmark-levels/synthetic-a1b2/level.json',
    'src/benchmark-levels/synthetic-a1b2/level.md',
  ].sort());

  const state = JSON.parse(await fs.readFile(path.join(fixture.runDirectory, 'promotion.json'), 'utf8'));
  const conversion = state.checkpoints.conversion;
  assert.equal(conversion.status, 'completed', 'the conversion is its own recorded checkpoint');
  assert.deepEqual(conversion.data.images.map((image) => image.path).sort(), CONTENT_KEYS.map((key) => `${key}.png`).sort());
  for (const image of conversion.data.images) {
    assert.equal(image.avifPath, `${image.path.slice(0, -4)}.avif`);
    assert.match(image.pngSha256, /^[a-f0-9]{64}$/);
    assert.equal(image.avifSha256, sha256(await fs.readFile(path.join(contentDirectory, image.avifPath))));
  }
  assert.deepEqual(conversion.data.descriptor.keys.sort(), [...CONTENT_KEYS].sort(), 'the record names the rewritten descriptor keys');
  assert.equal(conversion.data.descriptor.sha256After, sha256(await fs.readFile(path.join(fixture.root, 'src/benchmark-levels/synthetic-a1b2/level.json'), 'utf8')));
}

async function createFixture({ payloadWorktree = false, rehearsal = false, payloadSymlink = false, content = false, danglingImage = false, outsidePayload = false, card = 'valid' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-promotion-repo-'));
  const externalPayloadWorktree = `${root}-payload-worktree`;
  const runDirectory = path.join(root, 'benchmark/private/runs/synthetic-run-a1b2');
  await fs.mkdir(path.join(root, 'src/levels'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/benchmark-levels'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts/benchmark'), { recursive: true });
  await writeText(path.join(root, '.gitignore'), 'benchmark/private/\n');
  await writeText(path.join(root, 'package.json'), JSON.stringify({ name: 'synthetic-promotion', scripts: { typecheck: 'node -e ""', build: 'node -e ""', 'check:floor': 'node -e "process.exit(0)" --' } }, null, 2) + '\n');
  await writeText(path.join(root, 'src/levels/index.ts'), "export const levelMetadatas = [{ id: 'built-in-level', title: 'Built-in Level', aliases: ['built-in'], kind: 'playable' }];\n");
  await writeText(path.join(root, 'docs/level-gallery.md'), GALLERY);
  await fs.copyFile(path.join(HERE, 'scripts/check-benchmark-scope.mjs'), path.join(root, 'scripts/check-benchmark-scope.mjs'));
  await fs.copyFile(path.join(HERE, 'scripts/benchmark/protocol.mjs'), path.join(root, 'scripts/benchmark/protocol.mjs'));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.name', 'Synthetic Promotion Test']);
  await git(root, ['config', 'user.email', 'synthetic@example.test']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'synthetic materials']);
  const base = (await git(root, ['rev-parse', 'HEAD'])).trim();

  const descriptor = { id: 'synthetic-a1b2', title: 'Synthetic Promotion' };
  if (content === 'png' || danglingImage) {
    descriptor.contentImages = Object.fromEntries(CONTENT_KEYS.map((key) => [key, `/level-content/synthetic-a1b2/${key}.png`]));
  }
  const sourceFiles = {
    'src/benchmark-levels/synthetic-a1b2/index.ts': "export const syntheticLevel = { id: 'synthetic-a1b2', title: 'Synthetic Promotion' };\n",
    'src/benchmark-levels/synthetic-a1b2/level.md': '# Synthetic Promotion\n\nSynthetic test payload.\n',
    'src/benchmark-levels/synthetic-a1b2/level.json': `${JSON.stringify(descriptor, null, 2)}\n`,
  };
  if (card === 'missing') delete sourceFiles['src/benchmark-levels/synthetic-a1b2/level.md'];
  if (card === 'mistitled') sourceFiles['src/benchmark-levels/synthetic-a1b2/level.md'] = '# Some Other Level\n\nSynthetic test payload.\n';
  if (content === 'avif' || content === true) sourceFiles['public/level-content/synthetic-a1b2/hero.avif'] = 'synthetic hero\n';
  if (content === 'png') for (const key of CONTENT_KEYS) sourceFiles[`public/level-content/synthetic-a1b2/${key}.png`] = PNG_BYTES;
  if (danglingImage) sourceFiles['public/level-content/synthetic-a1b2/hero.avif'] = 'synthetic hero\n';
  const payloadPaths = ['src/benchmark-levels/synthetic-a1b2', ...(content || danglingImage ? ['public/level-content/synthetic-a1b2'] : [])];
  await git(root, ['switch', '-c', 'evaluated-run']);
  for (const [file, contents] of Object.entries(sourceFiles)) await writePayloadFile(path.join(root, file), contents, payloadSymlink);
  await git(root, ['add', ...payloadPaths]);
  await git(root, ['commit', '-qm', 'synthetic evaluated level']);
  const evaluatedCommit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['switch', '-q', '-c', 'payload-run', base]);
  for (const [file, contents] of Object.entries(sourceFiles)) await writePayloadFile(path.join(root, file), contents, payloadSymlink);
  if (outsidePayload) {
    await writeText(path.join(root, 'outside.txt'), 'outside footprint\n');
    payloadPaths.push('outside.txt');
  }
  await git(root, ['add', ...payloadPaths]);
  await git(root, ['commit', '-qm', 'synthetic payload']);
  const payloadCommit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['switch', '-q', 'main']);
  if (payloadWorktree) await git(root, ['worktree', 'add', '-q', externalPayloadWorktree, 'payload-run']);

  const definition = {
    schemaVersion: 1,
    benchmarkVersion: 'v2',
    runId: 'synthetic-run-a1b2',
    slotId: 'a1b2',
    levelId: 'synthetic-a1b2',
    levelTitle: 'Synthetic Promotion',
    themeId: 'synthetic-theme',
    themePath: 'synthetic/theme.md',
    configurationId: 'synthetic-configuration',
    recipePath: 'synthetic/recipe.md',
    materialsCommit: base,
    entrantBaseline: base,
    kind: rehearsal ? 'rehearsal' : 'benchmark',
    stage: { adapter: 'codex-cli', model: 'synthetic', effort: 'high', timeoutSeconds: 60 },
  };
  const gates = ['typecheck', 'build', 'scope', 'floor'].map((id) => ({ id, status: 'passed', command: id, wallTimeSeconds: 0 }));
  const manifest = {
    schemaVersion: 2,
    benchmarkVersion: definition.benchmarkVersion,
    runId: definition.runId,
    slotId: definition.slotId,
    configuration: { id: definition.configurationId },
    theme: { id: definition.themeId, path: definition.themePath, sha256: 'b'.repeat(64) },
    baseline: { materialsCommit: base, entrantBaseline: { kind: 'git-commit', identifier: base } },
    recipe: { path: definition.recipePath, sha256: 'a'.repeat(64) },
    controller: { commit: 'c'.repeat(40) },
    timing: { startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z', wallTimeSeconds: 60 },
    stages: [{ id: 'synthetic', role: 'solo', model: { provider: 'synthetic', snapshotId: 'synthetic' }, harness: { name: 'synthetic', version: '1' }, sessionId: 'synthetic', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z', wallTimeSeconds: 60, usage: { inputTokens: 0, outputTokens: 0 }, pricing: { status: 'measured', costUsd: 0 }, result: 'completed' }],
    cost: { currency: 'USD', status: 'measured', totalUsd: 0, orchestrationTreatment: 'none' },
    gates,
    output: { levelId: definition.levelId, title: definition.levelTitle, evaluated: { commit: evaluatedCommit, branch: 'evaluated-run' }, payload: { commit: payloadCommit, branch: 'payload-run' } },
    disposition: { status: rehearsal ? 'rehearsal' : 'playable' },
  };
  const payload = { payloadCommit, branch: 'payload-run', ...(payloadWorktree ? { worktree: externalPayloadWorktree } : {}) };
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
    content,
    descriptor,
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
  else await fs.writeFile(filePath, contents);
}
async function writeJson(filePath, value) { await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`); }
async function exists(filePath) { try { await fs.lstat(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }

main().catch((error) => { console.error(error); process.exitCode = 1; });
