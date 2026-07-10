#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderAssignment } from './render-assignment.mjs';
import { createPairSchedule, validatePairSchedule, validateRankings } from './ranking.mjs';
import { validateDefinition as validateRunDefinition } from './run.mjs';
import { createSchedule, validateSchedule } from './schedule.mjs';

const hash = (character) => character.repeat(64);

function definition() {
  return {
    benchmarkVersion: 'v1',
    configurations: [
      { id: 'solo-a', recipe: { id: 'solo-a', path: 'benchmark/recipes/solo-a.md', sha256: hash('a') } },
      { id: 'solo-b', recipe: { id: 'solo-b', path: 'benchmark/recipes/solo-b.md', sha256: hash('b') } },
      { id: 'delegation', recipe: { id: 'delegation', path: 'benchmark/recipes/delegation.md', sha256: hash('c') } },
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

console.log('Benchmark controller tests passed.');
