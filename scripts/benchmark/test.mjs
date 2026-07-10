#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderAssignment } from './render-assignment.mjs';
import { createPairSchedule, createSetSchedule, extendPairSchedule, validatePairSchedule, validateRankings, validateSetRankings, validateSetSchedule } from './ranking.mjs';
import { validateDefinition as validateRunDefinition } from './run.mjs';
import { createSchedule, extendSchedule, validateSchedule } from './schedule.mjs';

const hash = (character) => character.repeat(64);
const configuration = (id, character, model = `model-${id}`) => ({
  id,
  configurationCommit: character.repeat(40),
  runner: { path: 'scripts/benchmark/run.mjs', sha256: hash(character) },
  executor: { path: `scripts/benchmark/${id}.mjs`, sha256: hash(character) },
  recipe: { id, path: `benchmark/recipes/${id}.md`, sha256: hash(character) },
  stage: { adapter: 'codex-cli', model, effort: 'high', timeoutSeconds: 10_800 },
  pricing: { path: `benchmark/pricing/${id}.json`, sha256: hash(character) },
});

function definition() {
  return {
    benchmarkVersion: 'v1',
    configurations: [
      configuration('solo-a', 'a'),
      configuration('solo-b', 'b'),
      configuration('delegation', 'c'),
    ],
    themes: [
      { id: 'cinder', path: 'benchmark/themes/cinder.md', sha256: hash('d'), levelTitle: 'Cinder' },
      { id: 'tide', path: 'benchmark/themes/tide.md', sha256: hash('e'), levelTitle: 'Tide' },
      { id: 'vault', path: 'benchmark/themes/vault.md', sha256: hash('f'), levelTitle: 'Vault' },
    ],
  };
}

const schedule = createSchedule(definition());
assert.equal(schedule.assignments.length, 9);
assert.deepEqual(validateSchedule(schedule, definition()), []);
assert.equal(new Set(schedule.assignments.map((assignment) => assignment.slotId)).size, 9);
for (const assignment of schedule.assignments) assert.equal(assignment.levelId, `${assignment.theme.id}-${assignment.slotId}`);

const brokenSchedule = structuredClone(schedule);
brokenSchedule.assignments[0].levelId = 'wrong';
assert.ok(validateSchedule(brokenSchedule, definition()).some((error) => error.includes('levelId')));

const extendedDefinition = definition();
extendedDefinition.configurations.push(configuration('solo-c', '1'));
const extendedSchedule = extendSchedule(schedule, extendedDefinition);
assert.equal(extendedSchedule.assignments.length, 12);
assert.deepEqual(extendedSchedule.assignments.slice(0, 9), schedule.assignments);
assert.deepEqual(validateSchedule(extendedSchedule, extendedDefinition), []);
const changedDefinition = structuredClone(extendedDefinition);
changedDefinition.configurations[0].recipe.sha256 = hash('2');
assert.throws(() => extendSchedule(schedule, changedDefinition), /changed its registered recipe/);
const changedRunnerDefinition = structuredClone(extendedDefinition);
changedRunnerDefinition.configurations[0].runner.sha256 = hash('2');
assert.throws(() => extendSchedule(schedule, changedRunnerDefinition), /changed its registered execution inputs/);

const projection = {
  benchmarkVersion: 'v1',
  themes: [
    { id: 'cinder', slotIds: ['a1b2', 'c3d4', 'e5f6'] },
    { id: 'tide', slotIds: ['g7h8', 'i9j0', 'k1l2'] },
    { id: 'vault', slotIds: ['m3n4', 'o5p6', 'q7r8'] },
  ],
};
const pairSchedule = createPairSchedule(projection);
assert.equal(pairSchedule.pairs.length, 9);
assert.deepEqual(validatePairSchedule(pairSchedule, projection), []);
const rankings = pairSchedule.pairs.map((pair, index) => ({
  schemaVersion: 1,
  benchmarkVersion: 'v1',
  rankingId: pair.rankingId,
  themeId: pair.themeId,
  pairSlotIds: pair.pairSlotIds,
  presentationOrder: pair.presentationOrder,
  playCounts: pair.pairSlotIds.map((slotId) => ({ slotId, count: 1 })),
  verdict: index % 2 === 0 ? 'tie' : 'preference',
  ...(index % 2 === 0 ? {} : { winnerSlotId: pair.pairSlotIds[0] }),
  recordedAt: new Date().toISOString(),
}));
assert.deepEqual(validateRankings(rankings, pairSchedule, projection), []);
rankings[0].playCounts[1].slotId = rankings[0].playCounts[0].slotId;
assert.ok(validateRankings(rankings, pairSchedule, projection).some((error) => error.includes('playCounts')));

const expandedProjection = structuredClone(projection);
expandedProjection.themes[0].slotIds.push('s9t0');
const extendedPairs = extendPairSchedule(pairSchedule, expandedProjection);
assert.equal(extendedPairs.pairs.length, 12);
assert.deepEqual(extendedPairs.pairs.slice(0, pairSchedule.pairs.length), pairSchedule.pairs);

const setSchedule = createSetSchedule(projection);
assert.equal(setSchedule.sets.length, 3);
assert.deepEqual(validateSetSchedule(setSchedule, projection), []);
const setRankings = setSchedule.sets.map((set) => ({
  schemaVersion: 1,
  benchmarkVersion: 'v1',
  rankingId: set.rankingId,
  themeId: set.themeId,
  slotIds: set.slotIds,
  presentationOrder: set.presentationOrder,
  playCounts: set.slotIds.map((slotId) => ({ slotId, count: 1 })),
  tiers: [[set.slotIds[0]], set.slotIds.slice(1)],
  recordedAt: new Date().toISOString(),
}));
assert.deepEqual(validateSetRankings(setRankings, setSchedule, projection), []);
setRankings[0].tiers[1].push(setRankings[0].tiers[0][0]);
assert.ok(validateSetRankings(setRankings, setSchedule, projection).some((error) => error.includes('invalid or repeated')));

const rendered = renderAssignment('id={{LEVEL_ID}} title={{LEVEL_TITLE}} theme={{THEME}}', {
  levelId: 'cinder-a1b2',
  levelTitle: 'Cinder',
  theme: '# Cinder',
});
assert.equal(rendered, 'id=cinder-a1b2 title=Cinder theme=# Cinder');
assert.throws(() => renderAssignment('{{LEVEL_ID}} {{UNKNOWN}} {{THEME}}', { levelId: 'x', levelTitle: 'X', theme: 'T' }), /Unknown template placeholder/);
assert.equal(
  renderAssignment('id={{LEVEL_ID}} dir=levels/{{LEVEL_ID}}/ title={{LEVEL_TITLE}} theme={{THEME}}', { levelId: 'cinder-a1b2', levelTitle: 'Cinder', theme: '# Cinder' }),
  'id=cinder-a1b2 dir=levels/cinder-a1b2/ title=Cinder theme=# Cinder',
);
assert.throws(() => renderAssignment('{{LEVEL_ID}} {{LEVEL_TITLE}} {{LEVEL_TITLE}} {{THEME}}', { levelId: 'x', levelTitle: 'X', theme: 'T' }), /Expected exactly one \{\{LEVEL_TITLE\}\}/);

const runDefinition = {
  schemaVersion: 1,
  benchmarkVersion: 'rehearsal',
  mode: 'rehearsal',
  assignment: {
    runId: 'run-a1b2c3d4', slotId: 'a1b2', configurationId: 'codex-terra-high', levelId: 'cinder-a1b2', levelTitle: 'Cinder',
    recipe: { path: 'benchmark/recipes/codex-terra-high.md', sha256: hash('a') },
    theme: { id: 'cinder', path: 'benchmark/examples/cinder.md', sha256: hash('b') },
  },
  baseline: { materialsCommit: 'c'.repeat(40), entrantBaseline: 'd'.repeat(40) },
  template: { path: 'benchmark/prompts/level-assignment.md', sha256: hash('e') },
  failureTaxonomy: { path: 'benchmark/controller/failure-taxonomy.md', sha256: hash('f') },
  stage: { adapter: 'codex-cli', model: 'gpt-5.6-terra', effort: 'high', timeoutSeconds: 10_800 },
  worktree: { path: '/tmp/raild-run-a1b2c3d4' },
  payload: { path: '/tmp/raild-payload-a1b2c3d4', branch: 'benchmark-payload-a1b2c3d4' },
  pricing: { path: 'benchmark/pricing/gpt-5.6-terra-standard-short.json', sha256: hash('a') },
};
assert.deepEqual(validateRunDefinition(runDefinition), []);
runDefinition.stage.effort = 'invalid';
assert.ok(validateRunDefinition(runDefinition).some((error) => error.includes('stage.effort')));

const claudeRunDefinition = {
  ...structuredClone(runDefinition),
  stage: { adapter: 'claude-cli', model: 'claude-fable-5', effort: 'high', timeoutSeconds: 10_800 },
};
assert.deepEqual(validateRunDefinition(claudeRunDefinition), []);
const unknownAdapter = { ...structuredClone(claudeRunDefinition), stage: { ...claudeRunDefinition.stage, adapter: 'unknown-cli' } };
assert.ok(validateRunDefinition(unknownAdapter).some((error) => error.includes('stage.adapter')));

const eligibleRunDefinition = {
  ...structuredClone(runDefinition),
  benchmarkVersion: 'v1',
  mode: 'eligible',
  baseline: { ...runDefinition.baseline, configurationCommit: 'e'.repeat(40) },
  release: { path: 'benchmark/releases/v1/freeze.json', sha256: hash('1') },
  schedule: { path: 'benchmark/private/run-schedule.json', sha256: hash('2') },
  runner: { path: 'scripts/benchmark/run.mjs', sha256: hash('3') },
  executor: { path: 'scripts/benchmark/codex-cli.mjs', sha256: hash('4') },
  stage: { ...runDefinition.stage, effort: 'high' },
};
assert.deepEqual(validateRunDefinition(eligibleRunDefinition), []);
delete eligibleRunDefinition.schedule;
assert.ok(validateRunDefinition(eligibleRunDefinition).some((error) => error.includes('definition.schedule')));
eligibleRunDefinition.schedule = { path: 'benchmark/private/run-schedule.json', sha256: hash('2') };
delete eligibleRunDefinition.runner;
assert.ok(validateRunDefinition(eligibleRunDefinition).some((error) => error.includes('definition.runner')));

console.log('Benchmark controller tests passed.');
