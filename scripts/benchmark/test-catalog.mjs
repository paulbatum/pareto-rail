#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, projectPreVote, DOWNPOUR_REHEARSAL_IDS } from './catalog.mjs';
import { generateThumbnail } from './generate-thumbnails.mjs';
import { buildVersion, planAssignments, selectConfigurations } from './export-rank-catalog.mjs';

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
// Rank-catalog exporter reads a v2 plan: rehearsals are dropped, unlisted configuration ids are
// withheld with a warning, and listed rows survive into the version entry. Promotion/manifest
// reading is exercised elsewhere; a synthetic plan naming unpromoted levels yields an empty entry.
const v2Plan = {
  benchmarkVersion: 'v2',
  materialsCommit: 'a'.repeat(40),
  entrantBaseline: 'b'.repeat(40),
  runs: [
    { runId: 'r-listed', slotId: 'aa11', levelId: 'ember-aa11', themeId: 'ember', themePath: 'benchmark/themes/ember.md', configurationId: 'claude-fable-5-high', recipePath: 'benchmark/recipes/x.md', stage: {} },
    { runId: 'r-unlisted', slotId: 'bb22', levelId: 'ember-bb22', themeId: 'ember', themePath: 'benchmark/themes/ember.md', configurationId: 'mystery-config', recipePath: 'benchmark/recipes/x.md', stage: {} },
    { runId: 'r-rehearsal', slotId: 'cc33', levelId: 'ember-cc33', themeId: 'ember', themePath: 'benchmark/themes/ember.md', configurationId: 'claude-fable-5-high', recipePath: 'benchmark/recipes/x.md', stage: {}, kind: 'rehearsal' },
  ],
};
const planned = planAssignments(v2Plan);
assert.deepEqual(planned.map((assignment) => assignment.runId), ['r-listed', 'r-unlisted'], 'rehearsal rows are dropped from the plan');
const warnings = [];
const originalWarn = console.warn;
console.warn = (message) => warnings.push(message);
let selected;
try { selected = selectConfigurations(planned, 'v2'); } finally { console.warn = originalWarn; }
assert.deepEqual(selected.map((assignment) => assignment.runId), ['r-listed'], 'unlisted configuration ids are withheld');
assert.ok(warnings.some((message) => message.includes('mystery-config')), 'withheld configuration id is warned');
const v2Version = buildVersion('v2', selected, new Date().toISOString());
assert.equal(v2Version.benchmarkVersion, 'rank-catalog-v2');
assert.ok(Array.isArray(v2Version.entrants));

const actualPlan = JSON.parse(await fs.readFile(path.join(root, 'benchmark/private/v2-plan.json'), 'utf8'));
const actualVersion = buildVersion('v2', planAssignments(actualPlan), new Date().toISOString());
const massDriverTheme = actualVersion.entrants.filter((entrant) => entrant.themeId === 'mass-driver-detailed');
const massDriverRows = actualPlan.runs.filter((run) => run.themeId === 'mass-driver-detailed');
const promoted = new Set(await fs.readdir(path.join(root, 'src/benchmark-levels')));
assert.equal(actualVersion.themes.some((theme) => theme.id === 'mass-driver-detailed'), true, 'a theme with retired and live rows remains published');
assert.deepEqual(
  massDriverTheme.filter((entrant) => entrant.retired).map((entrant) => entrant.levelId).sort(),
  massDriverRows.filter((run) => run.retired).map((run) => run.levelId).sort(),
  'every retired row remains in the exported slice',
);
assert.deepEqual(
  massDriverTheme.filter((entrant) => !entrant.retired).map((entrant) => entrant.levelId).sort(),
  massDriverRows.filter((run) => !run.retired && promoted.has(run.levelId)).map((run) => run.levelId).sort(),
  'a live row is exported once its payload is promoted, and not before',
);
assert.ok(massDriverTheme.some((entrant) => entrant.retired), 'the theme still exercises the retired path');
assert.ok(massDriverTheme.find((entrant) => entrant.retired)?.run, 'retired entrants retain reveal metadata');

console.log('Benchmark catalog tests passed.');

function validateRankCatalogIds(catalog) {
  const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const assertId = (value, label) => {
    assert.equal(typeof value, 'string', `${label} must be a string`);
    assert.match(value, pattern, `${label} must use lowercase letters, digits, and single hyphens only`);
  };

  assertId(catalog.activeBenchmarkVersion, 'activeBenchmarkVersion');
  for (const configuration of catalog.configurations ?? []) assertId(configuration.id, `configuration ${configuration.id ?? '<unknown>'} id`);
  for (const version of catalog.versions ?? []) {
    assertId(version.benchmarkVersion, `benchmark version ${version.benchmarkVersion ?? '<unknown>'}`);
    for (const theme of version.themes ?? []) assertId(theme.id, `theme ${theme.id ?? '<unknown>'} id`);
    for (const entrant of version.entrants ?? []) {
      assertId(entrant.themeId, `entrant ${entrant.levelId ?? '<unknown>'} themeId`);
      assertId(entrant.levelId, `entrant ${entrant.levelId ?? '<unknown>'} levelId`);
      assertId(entrant.configurationId, `entrant ${entrant.levelId ?? '<unknown>'} configurationId`);
    }
  }
}
