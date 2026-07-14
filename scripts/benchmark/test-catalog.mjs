#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, projectPreVote, DOWNPOUR_REHEARSAL_IDS } from './catalog.mjs';
import { generateThumbnail } from './generate-thumbnails.mjs';

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
