#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { commandEntryPoints, cutBaseline, moduleGraphIsIntact } from './cut-baseline.mjs';
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
      'check:scope': 'node scripts/check-benchmark-scope.mjs',
      'benchmark:status': 'node scripts/report-status.mjs',
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
  await write('src/benchmark/rank-catalog.json', JSON.stringify({ themes: [{ id: 'entrant' }], entrants: [{ levelId: 'entrant' }] }));
  // A command dangles through an import as readily as through the path it names, the
  // shape that broke every v3 entrant's `npm run check:scope`.
  await write('scripts/report-status.mjs', "import { runRecords } from './benchmark/records.mjs';\nconsole.log(runRecords());\n");
  await write('scripts/benchmark/records.mjs', 'export function runRecords() { return [];\n}\n');
  // The scope checker takes its footprints from outside the harness, so it survives.
  await write('scripts/check-benchmark-scope.mjs', "import { levelFootprint } from './level-footprint.mjs';\nconsole.log(levelFootprint('anchor'));\n");
  await write('scripts/level-footprint.mjs', 'export function levelFootprint(levelId) { return { levelId };\n}\n');
  await fs.mkdir(path.join(repository, 'scripts'), { recursive: true });
  await fs.copyFile(path.join(root, 'scripts/collect-gallery.mjs'), path.join(repository, 'scripts/collect-gallery.mjs'));
  await fs.copyFile(path.join(root, 'scripts/level-gallery.mjs'), path.join(repository, 'scripts/level-gallery.mjs'));
  await fs.copyFile(path.join(root, 'scripts/count-source-lines.mjs'), path.join(repository, 'scripts/count-source-lines.mjs'));

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
  assert.deepEqual(catalog.entrants, []);
  assert.equal((await git(['show', `${result.scrubbedCommit}:public/level-content/anchor/hero.png`])).trim(), 'built-in content');

  const scrubbedManifest = JSON.parse(await git(['show', `${result.scrubbedCommit}:package.json`]));
  assert.ok(!('benchmark:status' in scrubbedManifest.scripts), 'a script whose import graph lost a file must not be advertised');
  assert.ok('gallery' in scrubbedManifest.scripts, 'a script whose import graph survives intact must be kept');
  assert.ok('check:scope' in scrubbedManifest.scripts, 'the scope check must survive: its footprints live outside the harness');
  assert.notEqual((await git(['ls-tree', '-r', '--name-only', result.scrubbedCommit, 'scripts/level-footprint.mjs'])).trim(), '');

  // The general form of the same rule: nothing the manifest offers may reach a missing file.
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-baseline-graph-'));
  try {
    const archive = path.join(checkout, 'baseline.tar');
    await exec('git', ['archive', '--format=tar', '-o', archive, result.scrubbedCommit], { cwd: repository });
    await exec('tar', ['-xf', archive, '-C', checkout]);
    const tracked = new Set((await git(['ls-tree', '-r', '--name-only', result.scrubbedCommit])).split('\n').filter(Boolean).map((name) => path.join(checkout, name)));
    for (const [name, command] of Object.entries(scrubbedManifest.scripts)) {
      for (const entry of commandEntryPoints(checkout, command)) {
        assert.ok(moduleGraphIsIntact(entry, tracked), `script '${name}' reaches a missing local file through ${path.relative(checkout, entry)}`);
      }
    }
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }

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
