#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, projectPreVote, DOWNPOUR_REHEARSAL_IDS } from './catalog.mjs';
import { generateThumbnail } from './generate-thumbnails.mjs';
import { buildCatalog, PUBLISHED_CONFIGURATIONS } from './export-rank-catalog.mjs';
import { benchmarkLevelFootprint } from './protocol.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rankCatalog = JSON.parse(await fs.readFile(path.join(root, 'src/benchmark/rank-catalog.json'), 'utf8'));
validateRankCatalogIds(rankCatalog);
const fixture = JSON.parse(await fs.readFile(path.join(root, 'benchmark/public/fixtures/downpour-rehearsal.json'), 'utf8'));
assert.deepEqual(validateCatalog(fixture, { mode: 'development', root, requireDownpourFixture: true }), []);
assert.deepEqual(fixture.entrants.map((entrant) => entrant.opaqueEntrantId).sort(), [...DOWNPOUR_REHEARSAL_IDS].sort());

const preVote = projectPreVote(fixture);
assert.equal(preVote.projection, 'pre-vote');
assert.ok(preVote.entrants.every((entrant) => !('levelId' in entrant)));
assert.ok(!JSON.stringify(preVote).includes('codex-'));
assert.ok(preVote.entrants.every((entrant) => entrant.playableRef.startsWith('asset-')));

const productionErrors = validateCatalog(fixture, { mode: 'production', root });
assert.ok(productionErrors.some((error) => error.includes('rehearsal/ineligible')));
assert.ok(productionErrors.some((error) => error.includes('placeholder')));
const leaked = structuredClone(fixture);
leaked.mode = 'production';
leaked.benchmarkVersion = 'v1';
for (const entrant of leaked.entrants) {
  entrant.eligibility = 'eligible';
  entrant.opaqueEntrantId = `codex-${entrant.opaqueEntrantId}`;
  entrant.playableRef = `model-${entrant.playableRef}`;
}
const leakErrors = validateCatalog(leaked, { mode: 'production', root });
assert.ok(leakErrors.some((error) => error.includes('identity hints')));

const dryRun = await generateThumbnail({ level: 'downpour-hlht', entrant: 'opaque-a', dryRun: true });
for (const expected of ['--thumbnails 4', '--seed 424242', '--immortal true', '--projectiles false', '--fidelity auto', '--width 1280', '--height 720']) assert.ok(dryRun.command.includes(expected), `missing ${expected}`);
assert.equal(dryRun.metadata.immortal, true);
assert.equal(dryRun.metadata.projectiles, false);
// The publication scope is one flat set now; Kimi stays labeled but withheld.
assert.ok(PUBLISHED_CONFIGURATIONS.has('claude-fable-5-high'), 'a published configuration is in scope');
assert.equal(PUBLISHED_CONFIGURATIONS.has('pi-openrouter-kimi-k3-max'), false, 'the withheld Kimi configuration is out of scope');

// Rank-catalog exporter gates on the publication scope and on level promotion: an
// unlabeled configuration is withheld with a warning, and a theme whose entrants
// are not yet promoted publishes nothing (no manifest read needed for either).
const syntheticPublication = {
  themes: [{ id: 'ember', path: 'benchmark/themes/ember.md', acceptedBaselines: ['a'.repeat(40)], retired: false }],
  entrants: [
    { levelId: 'ember-aa11', themeId: 'ember', configurationId: 'claude-fable-5-high', runId: 'r-listed', retired: false },
    { levelId: 'ember-bb22', themeId: 'ember', configurationId: 'mystery-config', runId: 'r-unlisted', retired: false },
  ],
};
const warnings = [];
const originalWarn = console.warn;
console.warn = (message) => warnings.push(message);
let synthetic;
try { synthetic = buildCatalog(syntheticPublication, new Date().toISOString()); } finally { console.warn = originalWarn; }
assert.ok(warnings.some((message) => message.includes('mystery-config')), 'an unlabeled configuration is withheld with a warning');
assert.deepEqual(synthetic.themes, [], 'a theme with no promoted live entrant publishes nothing');
assert.deepEqual(synthetic.entrants, [], 'unpromoted entrants stay unpublished');

const publication = JSON.parse(await fs.readFile(path.join(root, 'benchmark/private/publication.json'), 'utf8'));
const built = buildCatalog(publication, new Date().toISOString());
const massDriverTheme = built.entrants.filter((entrant) => entrant.themeId === 'mass-driver-detailed');
const massDriverRows = publication.entrants.filter((entrant) => entrant.themeId === 'mass-driver-detailed');
const promoted = new Set(await fs.readdir(path.join(root, 'src/benchmark-levels')));
assert.equal(built.themes.some((theme) => theme.id === 'mass-driver-detailed'), true, 'a theme with retired and live rows remains published');
assert.equal(built.themes.find((theme) => theme.id === 'mass-driver-detailed')?.retired, true, 'the retired theme carries its flag');
assert.deepEqual(
  massDriverTheme.filter((entrant) => entrant.retired).map((entrant) => entrant.levelId).sort(),
  massDriverRows.filter((row) => row.retired).map((row) => row.levelId).sort(),
  'every retired row remains in the exported catalog',
);
assert.deepEqual(
  massDriverTheme.filter((entrant) => !entrant.retired).map((entrant) => entrant.levelId).sort(),
  massDriverRows.filter((row) => !row.retired && promoted.has(row.levelId)).map((row) => row.levelId).sort(),
  'a live row is exported once its payload is promoted, and not before',
);
assert.ok(massDriverTheme.some((entrant) => entrant.retired), 'the theme still exercises the retired path');
assert.ok(massDriverTheme.find((entrant) => entrant.retired)?.run, 'retired entrants retain reveal metadata');
assert.ok(built.entrants.every((entrant) => !entrant.retired || typeof entrant.entrantBaseline === 'string'), 'entrants with a manifest carry their entrant baseline provenance');
assert.ok(built.entrants.filter((entrant) => !entrant.retired).every((entrant) => typeof entrant.entrantBaseline === 'string' && typeof entrant.materialsCommit === 'string'), 'every live entrant carries provenance');

// A live (non-retired) entrant whose baseline is not accepted for its theme fails the export.
const tampered = structuredClone(publication);
const liveTheme = tampered.themes.find((theme) => !theme.retired && tampered.entrants.some((entrant) => entrant.themeId === theme.id && !entrant.retired));
liveTheme.acceptedBaselines = ['0'.repeat(40)];
assert.throws(() => buildCatalog(tampered, new Date().toISOString()), /not an accepted baseline/, 'an unaccepted entrant baseline fails the export');

// Every live (non-retired) catalog entrant must resolve to a promoted level module on disk.
// A retired row may keep its module (still playable history) or have none (gallery-only,
// published without a thumbnail). If a module-less row is flipped live (or a row is promoted
// without its payload), this bites here instead of at level-load time.
assert.deepEqual(
  await benchmarkModuleErrors(rankCatalog),
  [],
  'every live catalog entrant resolves to a promoted level module',
);
const flippedRetired = structuredClone(rankCatalog);
const retiredEntrant = (flippedRetired.entrants ?? []).find((entrant) => entrant.retired && !entrant.thumbnailPath);
assert.ok(retiredEntrant, 'catalog fixture retains at least one module-less retired entrant to exercise the negative path');
retiredEntrant.retired = false;
assert.ok(
  (await benchmarkModuleErrors(flippedRetired)).some((error) => error.includes(retiredEntrant.levelId)),
  'flipping a retired entrant live surfaces its missing module',
);

console.log('Benchmark catalog tests passed.');

async function benchmarkModuleErrors(catalog) {
  const errors = [];
  for (const entrant of catalog.entrants ?? []) {
    if (entrant.retired) continue;
    const source = benchmarkLevelFootprint(entrant.levelId).roots.find((rootDef) => rootDef.id === 'source');
    for (const file of ['index.ts', 'level.json']) {
      if (!(await fileExists(path.join(root, source.path, file)))) {
        errors.push(`live catalog entrant ${entrant.levelId} is missing ${source.path}/${file}`);
      }
    }
  }
  return errors;
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function validateRankCatalogIds(catalog) {
  const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const assertId = (value, label) => {
    assert.equal(typeof value, 'string', `${label} must be a string`);
    assert.match(value, pattern, `${label} must use lowercase letters, digits, and single hyphens only`);
  };

  for (const configuration of catalog.configurations ?? []) assertId(configuration.id, `configuration ${configuration.id ?? '<unknown>'} id`);
  for (const theme of catalog.themes ?? []) assertId(theme.id, `theme ${theme.id ?? '<unknown>'} id`);
  for (const entrant of catalog.entrants ?? []) {
    assertId(entrant.themeId, `entrant ${entrant.levelId ?? '<unknown>'} themeId`);
    assertId(entrant.levelId, `entrant ${entrant.levelId ?? '<unknown>'} levelId`);
    assertId(entrant.configurationId, `entrant ${entrant.levelId ?? '<unknown>'} configurationId`);
  }
}
