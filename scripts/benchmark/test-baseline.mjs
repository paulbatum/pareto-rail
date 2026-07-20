#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { cutBaseline } from './cut-baseline.mjs';
import { scrubbedBaselineViolations } from './baseline-policy.mjs';

const exec = promisify(execFile);
const root = process.cwd();
const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-baseline-test-'));
try {
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Benchmark Test']);
  await git(['config', 'user.email', 'benchmark@example.com']);

  await write('package.json', JSON.stringify({
    name: 'baseline-fixture',
    version: '1.0.0',
    type: 'module',
    scripts: {
      gallery: 'node scripts/collect-gallery.mjs',
      typecheck: "node -e \"console.log('typecheck passed')\"",
      build: "node -e \"console.log('build passed')\"",
    },
  }, null, 2));
  await write('package-lock.json', JSON.stringify({
    name: 'baseline-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'baseline-fixture', version: '1.0.0' } },
  }, null, 2));
  await write('src/levels/index.ts', `export const levelMetadatas: LevelMetadata[] = [
  { id: 'anchor', title: 'Anchor', kind: 'playable' },
];
`);
  await write('src/levels/anchor/level.md', '# Anchor\n\nBuilt-in card.\n');
  for (const file of ['index.ts', 'catalog.ts', 'types.ts', 'validation.ts']) await write(`src/benchmark-levels/${file}`, '// required empty-catalog scaffold\n');
  await write('src/benchmark-levels/entrant/index.ts', 'entrant material\n');
  await write('src/benchmark-levels/test-fixtures/catalog-fixture/index.ts', 'fixture material\n');
  await write('benchmark/README.md', 'private benchmark material\n');
  await write('public/level-content/anchor/hero.png', 'built-in content\n');
  await write('public/level-content/entrant/hero.png', 'entrant content\n');
  await write('docs/level-gallery.md', '# Level gallery\n\n## Benchmark levels\n');
  await write('src/benchmark/rank-catalog.json', JSON.stringify({ versions: [{ entrants: [{ levelId: 'entrant' }] }] }));
  await fs.mkdir(path.join(repository, 'scripts'), { recursive: true });
  await fs.copyFile(path.join(root, 'scripts/collect-gallery.mjs'), path.join(repository, 'scripts/collect-gallery.mjs'));
  await fs.copyFile(path.join(root, 'scripts/level-gallery.mjs'), path.join(repository, 'scripts/level-gallery.mjs'));

  await git(['add', '.']);
  await git(['commit', '-qm', 'synthetic contaminated baseline']);
  const source = await git(['rev-parse', 'HEAD']);
  const rawViolations = await scrubbedBaselineViolations({ repo: repository, baseline: source });
  assert.ok(rawViolations.some(({ path: pathName }) => pathName === 'benchmark/'));
  assert.ok(rawViolations.some(({ path: pathName }) => pathName === 'src/benchmark-levels/entrant'));
  assert.ok(rawViolations.some(({ path: pathName }) => pathName === 'public/level-content/entrant'));
  assert.ok(rawViolations.some(({ path: pathName }) => pathName === 'docs/level-gallery.md'));
  assert.ok(rawViolations.some(({ path: pathName }) => pathName === 'src/benchmark/rank-catalog.json'));

  const result = await cutBaseline({ repo: repository, source, branch: 'scrubbed-test' });
  assert.equal(result.branch, 'scrubbed-test');
  assert.notEqual(result.scrubbedCommit, source);
  assert.deepEqual(await scrubbedBaselineViolations({ repo: repository, baseline: result.scrubbedCommit }), []);
  assert.equal((await git(['ls-tree', '-r', '--name-only', result.scrubbedCommit, 'benchmark'])).trim(), '');
  assert.equal((await git(['ls-tree', '-r', '--name-only', result.scrubbedCommit, 'src/benchmark-levels/entrant'])).trim(), '');
  assert.equal((await git(['ls-tree', '-r', '--name-only', result.scrubbedCommit, 'public/level-content/entrant'])).trim(), '');
  const gallery = await git(['show', `${result.scrubbedCommit}:docs/level-gallery.md`]);
  assert.match(gallery, /## Built-in levels/);
  assert.match(gallery, /# Anchor/);
  assert.doesNotMatch(gallery, /Benchmark levels/);
  const catalog = JSON.parse(await git(['show', `${result.scrubbedCommit}:src/benchmark/rank-catalog.json` ]));
  assert.deepEqual(catalog.versions, []);
  assert.equal((await git(['show', `${result.scrubbedCommit}:public/level-content/anchor/hero.png`])).trim(), 'built-in content');

  console.log('Benchmark baseline tests passed.');
} finally {
  await exec('git', ['worktree', 'prune'], { cwd: repository }).catch(() => {});
  await fs.rm(repository, { recursive: true, force: true });
}

async function write(relativePath, content) {
  const target = path.join(repository, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

async function git(args) {
  return (await exec('git', args, { cwd: repository, encoding: 'utf8' })).stdout.trim();
}
