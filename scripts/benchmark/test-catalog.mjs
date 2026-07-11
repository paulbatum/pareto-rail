#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, projectPreVote, DOWNPOUR_REHEARSAL_IDS } from './catalog.mjs';
import { generateThumbnail } from './generate-thumbnails.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
