#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BUDGET_ASSIGNMENT_PARAGRAPH, renderAssignment, renderDelegation } from './render-assignment.mjs';
import { createPairSchedule, createSetSchedule, extendPairSchedule, validatePairSchedule, validateRankings, validateSetRankings, validateSetSchedule } from './ranking.mjs';
import { manifestErrors, resultFromArtifacts, shouldUnblind } from './results.mjs';
import { validateDefinition as validateRunDefinition } from './run.mjs';
import { createSchedule, extendSchedule, validateSchedule } from './schedule.mjs';
import { harnessCounters, reconcileCost, reconciliationWarnings, summarizeCost } from './ccusage-cost.mjs';
import { createRecoverySnapshot, restoreRecoverySnapshot } from './recovery-snapshot.mjs';
import { assertBenchmarkBaseline } from '../check-benchmark-baseline.mjs';
import { checkBenchmarkScope } from '../check-benchmark-scope.mjs';
import { protocolForVersion } from './protocol.mjs';

const exec = promisify(execFile);

const hash = (character) => character.repeat(64);
const configuration = (id, character, model = `model-${id}`) => ({
  id,
  configurationCommit: character.repeat(40),
  runner: { path: 'scripts/benchmark/run.mjs', sha256: hash(character) },
  executor: { path: `scripts/benchmark/${id}.mjs`, sha256: hash(character) },
  recipe: { id, path: `benchmark/recipes/${id}.md`, sha256: hash(character) },
  stage: { adapter: 'codex-cli', model, effort: 'high', timeoutSeconds: 10_800 },
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

const budgetDefinition = definition();
budgetDefinition.configurations[0].stage.budget = { usd: 20 };
const budgetSchedule = createSchedule(budgetDefinition);
assert.equal(budgetSchedule.assignments.find(({ configurationId }) => configurationId === 'solo-a').stage.budget.usd, 20);
assert.deepEqual(validateSchedule(budgetSchedule, budgetDefinition), []);
const invalidBudgetDefinition = structuredClone(budgetDefinition);
invalidBudgetDefinition.configurations[0].stage.budget.usd = 0;
assert.ok(validateSchedule(budgetSchedule, invalidBudgetDefinition).some((error) => error.includes('budget.usd')));
const unknownBudgetField = structuredClone(budgetDefinition);
unknownBudgetField.configurations[0].stage.budget.extra = true;
assert.ok(validateSchedule(budgetSchedule, unknownBudgetField).some((error) => error.includes('unknown field extra')));

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
assert.equal(
  renderAssignment('id={{LEVEL_ID}} title={{LEVEL_TITLE}} theme={{THEME}}', { levelId: 'cinder-a1b2', levelTitle: 'Cinder', theme: '# Cinder', budget: true }),
  `id=cinder-a1b2 title=Cinder theme=# Cinder\n\n${BUDGET_ASSIGNMENT_PARAGRAPH}`,
);
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
  worktree: { path: '/tmp/pareto-rail-run-a1b2c3d4' },
  payload: { path: '/tmp/pareto-rail-payload-a1b2c3d4', branch: 'benchmark-payload-a1b2c3d4' },
};
assert.deepEqual(validateRunDefinition(runDefinition), []);
const budgetRunDefinition = structuredClone(runDefinition);
budgetRunDefinition.stage.budget = { usd: 20 };
assert.deepEqual(validateRunDefinition(budgetRunDefinition), []);
const invalidBudgetRunDefinition = structuredClone(budgetRunDefinition);
invalidBudgetRunDefinition.stage.budget.usd = Number.POSITIVE_INFINITY;
assert.ok(validateRunDefinition(invalidBudgetRunDefinition).some((error) => error.includes('budget.usd')));
const unknownBudgetRunField = structuredClone(budgetRunDefinition);
unknownBudgetRunField.stage.budget.extra = true;
assert.ok(validateRunDefinition(unknownBudgetRunField).some((error) => error.includes('unknown field extra')));
runDefinition.stage.effort = 'invalid';
assert.ok(validateRunDefinition(runDefinition).some((error) => error.includes('stage.effort')));
runDefinition.stage.effort = 'high';

const delegationRunDefinition = {
  ...structuredClone(runDefinition),
  delegation: {
    prompt: { path: 'benchmark/prompts/flexible-delegation.md', sha256: hash('a') },
    delegateModel: 'gpt-5.6-terra',
    delegateEffort: 'low',
  },
};
assert.deepEqual(validateRunDefinition(delegationRunDefinition), []);
const badDelegation = structuredClone(delegationRunDefinition);
badDelegation.delegation.delegateEffort = 'invalid';
assert.ok(validateRunDefinition(badDelegation).some((error) => error.includes('delegation.delegateEffort')));
const missingDelegateModel = structuredClone(delegationRunDefinition);
delete missingDelegateModel.delegation.delegateModel;
assert.ok(validateRunDefinition(missingDelegateModel).some((error) => error.includes('delegation.delegateModel')));
const legacyPricing = { ...structuredClone(runDefinition), pricing: { path: 'benchmark/pricing/x.json', sha256: hash('a') } };
assert.ok(validateRunDefinition(legacyPricing).some((error) => error.includes('unknown field pricing')));

const claudeRunDefinition = {
  ...structuredClone(runDefinition),
  stage: { adapter: 'claude-cli', model: 'claude-fable-5', effort: 'high', timeoutSeconds: 10_800 },
};
assert.deepEqual(validateRunDefinition(claudeRunDefinition), []);
const directoryOnlyRunDefinition = { ...structuredClone(runDefinition), benchmarkVersion: 'v2', mode: 'rehearsal' };
assert.deepEqual(validateRunDefinition(directoryOnlyRunDefinition), []);
const unknownProtocol = { ...structuredClone(runDefinition), benchmarkVersion: 'v0' };
assert.ok(validateRunDefinition(unknownProtocol).some((error) => error.includes('Unsupported benchmark protocol version')));
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

const delegationAddendum = renderDelegation('Delegate to `{{DELEGATE_MODEL}}` at `{{DELEGATE_EFFORT}}`; report to {{DELEGATE_MODEL}}.', {
  delegateModel: 'opus',
  delegateEffort: 'low',
});
assert.equal(delegationAddendum, 'Delegate to `opus` at `low`; report to opus.');
assert.throws(() => renderDelegation('Delegate to {{DELEGATE_MODEL}}.', { delegateModel: 'opus', delegateEffort: 'low' }), /missing the \{\{DELEGATE_EFFORT\}\}/);
assert.throws(() => renderDelegation('{{DELEGATE_MODEL}} {{DELEGATE_EFFORT}} {{OTHER}}', { delegateModel: 'opus', delegateEffort: 'low' }), /Unknown delegation placeholder/);

// ccusage claude report: per-model cost available (parent Fable + delegated Opus).
const claudeReport = {
  sessions: [{
    sessionId: 's1',
    totalCost: 0.39,
    modelBreakdowns: [
      { modelName: 'claude-fable-5', cost: 0.334, inputTokens: 2775, outputTokens: 222, cacheReadTokens: 1000, cacheCreationTokens: 40 },
      { modelName: 'claude-opus-4-8', cost: 0.056, inputTokens: 2263, outputTokens: 29, cacheReadTokens: 500, cacheCreationTokens: 10 },
    ],
  }],
  totals: { totalCost: 0.39, inputTokens: 5038, outputTokens: 251, cacheReadTokens: 1500, cacheCreationTokens: 50, totalTokens: 6839 },
};
const claudeCost = summarizeCost('claude-cli', claudeReport);
assert.equal(claudeCost.perModelCostAvailable, true);
assert.equal(claudeCost.totalUsd, 0.39);
assert.equal(claudeCost.models.length, 2);
assert.equal(claudeCost.models.find((m) => m.modelName === 'claude-opus-4-8').costUsd, 0.056);
assert.equal(claudeCost.models.find((m) => m.modelName === 'claude-fable-5').cacheWriteTokens, 40);

// ccusage codex report: per-model tokens only (no cost), so cost lives in the run total.
const codexReport = {
  sessions: [{
    sessionId: 's2',
    costUSD: 0.025,
    models: {
      'gpt-5.6-sol': { inputTokens: 8000, outputTokens: 14, cacheReadTokens: 10000, cacheCreationTokens: 0, reasoningOutputTokens: 5 },
      'gpt-5.6-terra': { inputTokens: 5282, outputTokens: 33, cacheReadTokens: 23040, cacheCreationTokens: 0, reasoningOutputTokens: 0 },
    },
  }],
  totals: { costUSD: 0.025, inputTokens: 13282, outputTokens: 47, cacheReadTokens: 33040, cacheCreationTokens: 0, reasoningOutputTokens: 5, totalTokens: 46416 },
};
const codexCost = summarizeCost('codex-cli', codexReport);
assert.equal(codexCost.perModelCostAvailable, false);
assert.equal(codexCost.totalUsd, 0.025);
assert.equal(codexCost.models.length, 2);
assert.equal(codexCost.models.every((m) => m.costUsd === null), true);
assert.equal(codexCost.totals.reasoningTokens, 5);
assert.throws(() => summarizeCost('claude-cli', { sessions: [], totals: {} }), /totals\.totalCost was not a number/);

// Reconciling the replayed transcripts against the harness's own counter. Replay loses output when
// an assistant message never finalized on disk, so a counter above replay wins; a counter below
// replay cannot be explained that way, so replay stands and the run is flagged for a human.
const counterUsage = (modelUsage) => ({ normalized: { vendorFields: { modelUsage } } });
assert.equal(harnessCounters(counterUsage(undefined)), null);
assert.equal(harnessCounters({}), null);

// A model billed at two context tiers reports under two keys and is one model to the run.
const tiered = harnessCounters(counterUsage({
  'claude-opus-4-8[1m]': { outputTokens: 200, costUSD: 2 },
  'claude-opus-4-8': { outputTokens: 50, costUSD: 0.5 },
}));
assert.equal(tiered.get('claude-opus-4-8').outputTokens, 250);
assert.equal(tiered.get('claude-opus-4-8').costUsd, 2.5);

const replay = () => ({ totalUsd: 1, models: [{ modelName: 'claude-fable-5', outputTokens: 100, costUsd: 0.4 }, { modelName: 'claude-opus-4-8', outputTokens: 200, costUsd: 0.6 }] });

// Codex reports no counter: nothing to cross-check, figures untouched.
const unavailable = reconcileCost(replay(), harnessCounters(counterUsage(undefined)));
assert.equal(unavailable.reconciliation.status, 'unavailable');
assert.deepEqual(unavailable.models, replay().models);

// Both sources agree.
const agreed = reconcileCost(replay(), harnessCounters(counterUsage({
  'claude-fable-5': { outputTokens: 100, costUSD: 0.4 },
  'claude-opus-4-8': { outputTokens: 200, costUSD: 0.6 },
})));
assert.equal(agreed.reconciliation.status, 'agreed');
assert.equal(agreed.reconciliation.adjustments, undefined);
assert.equal(agreed.totalUsd, 1);
assert.equal(agreed.models.every((model) => model.usageSource === 'agreed'), true);

// Counter above replay: take the counter, and fold only its delta into the run total.
const adjusted = reconcileCost(replay(), harnessCounters(counterUsage({
  'claude-fable-5': { outputTokens: 100, costUSD: 0.4 },
  'claude-opus-4-8': { outputTokens: 250, costUSD: 0.85 },
})));
assert.equal(adjusted.reconciliation.status, 'adjusted');
assert.equal(adjusted.reconciliation.adjustments.length, 1);
assert.deepEqual(adjusted.reconciliation.adjustments[0], {
  modelName: 'claude-opus-4-8', replayOutputTokens: 200, counterOutputTokens: 250, resolution: 'took-counter', replayCostUsd: 0.6, counterCostUsd: 0.85,
});
const takenModel = adjusted.models.find((model) => model.modelName === 'claude-opus-4-8');
assert.equal(takenModel.outputTokens, 250);
assert.equal(takenModel.costUsd, 0.85);
assert.equal(takenModel.usageSource, 'harness-counter');
assert.equal(adjusted.models.find((model) => model.modelName === 'claude-fable-5').usageSource, 'agreed');
assert.equal(Number(adjusted.totalUsd.toFixed(4)), 1.25);
assert.match(reconciliationWarnings(adjusted.reconciliation)[0], /took the counter/);

// Counter below replay: the counter did not cover the whole session, so replay stands and it is flagged.
const suspect = reconcileCost(replay(), harnessCounters(counterUsage({
  'claude-fable-5': { outputTokens: 100, costUSD: 0.4 },
  'claude-opus-4-8': { outputTokens: 10, costUSD: 0.05 },
})));
assert.equal(suspect.reconciliation.status, 'suspect');
assert.equal(suspect.reconciliation.adjustments[0].resolution, 'kept-replay');
assert.equal(suspect.totalUsd, 1);
assert.equal(suspect.models.find((model) => model.modelName === 'claude-opus-4-8').outputTokens, 200);
assert.match(reconciliationWarnings(suspect.reconciliation)[0], /investigate before trusting/);

// A counter naming a model the run does not attribute (the harness's auxiliary summarizer, which
// leaves no rollout to replay) is ignored rather than added; see benchmark/README.md.
const auxiliary = reconcileCost(replay(), harnessCounters(counterUsage({
  'claude-fable-5': { outputTokens: 100, costUSD: 0.4 },
  'claude-opus-4-8': { outputTokens: 200, costUSD: 0.6 },
  'claude-haiku-4-5-20251001': { outputTokens: 13, costUSD: 0.001 },
})));
assert.equal(auxiliary.reconciliation.status, 'agreed');
assert.equal(auxiliary.models.length, 2);
assert.equal(auxiliary.totalUsd, 1);

assert.equal(shouldUnblind('rehearsal'), true);
assert.equal(shouldUnblind('v1'), false);
assert.equal(shouldUnblind('rehearsal', 'blind'), false);
assert.equal(shouldUnblind('v1', 'unblind'), true);
const resultManifest = {
  schemaVersion: 2,
  benchmarkVersion: 'rehearsal',
  runId: 'rehearsal-a1b2',
  slotId: 'a1b2',
  configuration: { id: 'solo-a' },
  theme: { id: 'cinder', path: 'benchmark/examples/cinder.md', sha256: hash('a') },
  baseline: { materialsCommit: 'a'.repeat(40), entrantBaseline: { kind: 'git-commit', identifier: 'a'.repeat(40) } },
  recipe: { path: 'benchmark/recipes/solo-a.md', sha256: hash('b') },
  controller: { path: 'benchmark/controller/runbook.md', sha256: hash('c') },
  timing: { startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T01:00:00.000Z', wallTimeSeconds: 3600 },
  stages: [{ model: { snapshotId: 'model-a' }, startedAt: '2026-01-01T00:10:00.000Z', finishedAt: '2026-01-01T00:20:00.000Z', wallTimeSeconds: 600 }],
  cost: { status: 'measured', totalUsd: 1.25 },
  gates: [{ id: 'typecheck', status: 'passed' }, { id: 'floor', status: 'passed' }],
  output: { levelId: 'cinder-a1b2', title: 'Cinder', evaluated: { commit: 'a'.repeat(40) }, payload: { commit: 'b'.repeat(40) } },
  disposition: { status: 'rehearsal' },
};
assert.deepEqual(manifestErrors(resultManifest), []);
const budgetManifest = structuredClone(resultManifest);
budgetManifest.stages[0].budget = {
  budgetUsd: 20,
  protocol: { noticeStepPct: 25, minimumSubmitFraction: 0.75, maxResumeRounds: 3, pollIntervalSeconds: 30, minimumResumeRemainingSeconds: 600 },
  noticeHistory: [{ pct: 25, spentUsd: 5.1, at: '2026-01-01T00:15:00.000Z' }],
  resumes: [],
  finalSpendUsd: 17,
  finalFraction: 0.85,
};
assert.deepEqual(manifestErrors(budgetManifest), []);
budgetManifest.stages[0].budget.protocol.noticeStepPct = 10;
assert.ok(manifestErrors(budgetManifest).some((error) => error.includes('budget is invalid')));
const legacyManifest = structuredClone(resultManifest);
delete legacyManifest.theme.id;
delete legacyManifest.output.title;
assert.deepEqual(manifestErrors(legacyManifest), [], 'schema-v2 legacy manifests remain recognized');
const mixedManifest = structuredClone(resultManifest);
delete mixedManifest.output.title;
assert.ok(manifestErrors(mixedManifest).some((error) => error.includes('present together')), 'mixed legacy/current metadata is rejected');
const rehearsalResult = resultFromArtifacts({ directoryName: 'rehearsal-a1b2', manifest: resultManifest });
assert.equal(rehearsalResult.configuration, 'solo-a');
assert.deepEqual(rehearsalResult.models, ['model-a']);
assert.equal(rehearsalResult.stageWallTimeSeconds, 600);
assert.equal(rehearsalResult.controllerWallTimeSeconds, 3600);
const eligibleManifest = { ...resultManifest, benchmarkVersion: 'v1', disposition: { status: 'playable' } };
const eligibleResult = resultFromArtifacts({ directoryName: 'run-a1b2', manifest: eligibleManifest });
assert.equal(eligibleResult.identity, 'blinded');
assert.equal(eligibleResult.configuration, null);
assert.deepEqual(eligibleResult.models, []);
assert.equal(eligibleResult.promotionStatus, 'pending');
assert.equal(resultFromArtifacts({ directoryName: 'run-a1b2', manifest: { ...resultManifest, benchmarkVersion: 'v1' }, promotion: { status: 'completed', promotionCommit: 'c'.repeat(40) } }).promotionStatus, 'not-applicable');
assert.equal(resultFromArtifacts({ directoryName: 'run-a1b2', manifest: eligibleManifest, promotion: { status: 'completed', promotionCommit: 'c'.repeat(40) } }).promotionStatus, 'completed');
const recoveredResult = resultFromArtifacts({ directoryName: 'rehearsal-a1b2', manifest: resultManifest, recovery: { recoveredAt: '2026-01-01T01:00:00.000Z', reason: 'infrastructure-timeout' } });
assert.equal(recoveredResult.state, 'completed');
assert.equal(recoveredResult.recovered, true);
assert.equal(recoveredResult.recoveryReason, 'infrastructure-timeout');

const snapshotRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-snapshot-repo-'));
const snapshotRun = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-snapshot-run-'));
const snapshotWorktree = `${snapshotRepo}-worktree`;
try {
  await exec('git', ['init', '-q'], { cwd: snapshotRepo });
  await exec('git', ['config', 'user.name', 'Benchmark Test'], { cwd: snapshotRepo });
  await exec('git', ['config', 'user.email', 'benchmark@example.com'], { cwd: snapshotRepo });
  await fs.writeFile(path.join(snapshotRepo, 'tracked.txt'), 'base\n');
  await exec('git', ['add', 'tracked.txt'], { cwd: snapshotRepo });
  await exec('git', ['commit', '-qm', 'base'], { cwd: snapshotRepo });
  await exec('git', ['worktree', 'add', '-qb', 'benchmark-run-test', snapshotWorktree], { cwd: snapshotRepo });
  await fs.writeFile(path.join(snapshotWorktree, 'tracked.txt'), 'changed\n');
  await fs.writeFile(path.join(snapshotWorktree, 'new.txt'), 'untracked\n');
  const snapshot = await createRecoverySnapshot({ repo: snapshotRepo, runDirectory: snapshotRun, runId: 'run-test', worktree: snapshotWorktree, checkpoint: 'stage', reason: 'synthetic failure' });
  assert.deepEqual(snapshot.changedPaths.sort(), ['new.txt', 'tracked.txt']);
  await exec('git', ['worktree', 'remove', '--force', snapshotWorktree], { cwd: snapshotRepo });
  await restoreRecoverySnapshot({ repo: snapshotRepo, runDirectory: snapshotRun, worktreeRecord: { worktree: snapshotWorktree, branch: 'benchmark-run-test' } });
  assert.equal(await fs.readFile(path.join(snapshotWorktree, 'tracked.txt'), 'utf8'), 'changed\n');
  assert.equal(await fs.readFile(path.join(snapshotWorktree, 'new.txt'), 'utf8'), 'untracked\n');
  assert.match((await exec('git', ['status', '--porcelain'], { cwd: snapshotWorktree })).stdout, /tracked\.txt/);
} finally {
  await exec('git', ['worktree', 'remove', '--force', snapshotWorktree], { cwd: snapshotRepo }).catch(() => {});
  await fs.rm(snapshotRepo, { recursive: true, force: true });
  await fs.rm(snapshotRun, { recursive: true, force: true });
}

const scopeRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-directory-only-scope-'));
try {
  await fs.mkdir(path.join(scopeRepo, 'src/levels'), { recursive: true });
  await fs.mkdir(path.join(scopeRepo, 'src/benchmark-levels'), { recursive: true });
  await fs.writeFile(path.join(scopeRepo, 'src/levels/index.ts'), "export const levelMetadatas: LevelMetadata[] = [\n  { id: 'anchor', title: 'Anchor' },\n];\n");
  await exec('git', ['init', '-q'], { cwd: scopeRepo });
  await exec('git', ['config', 'user.name', 'Benchmark Test'], { cwd: scopeRepo });
  await exec('git', ['config', 'user.email', 'benchmark@example.com'], { cwd: scopeRepo });
  await exec('git', ['add', '.'], { cwd: scopeRepo });
  await exec('git', ['commit', '-qm', 'scope baseline'], { cwd: scopeRepo });
  await fs.mkdir(path.join(scopeRepo, 'src/benchmark-levels/synthetic-a1b2'), { recursive: true });
  await fs.writeFile(path.join(scopeRepo, 'src/benchmark-levels/synthetic-a1b2/index.ts'), 'synthetic\n');
  assert.deepEqual(
    await checkBenchmarkScope({ root: scopeRepo, levelId: 'synthetic-a1b2', base: 'HEAD', benchmarkVersion: 'v2' }),
    ['src/benchmark-levels/synthetic-a1b2/index.ts'],
  );
  await fs.writeFile(path.join(scopeRepo, 'src/levels/index.ts'), 'unrelated\n');
  await assert.rejects(
    () => checkBenchmarkScope({ root: scopeRepo, levelId: 'synthetic-a1b2', base: 'HEAD', benchmarkVersion: 'v2' }),
    /Out-of-scope files/,
  );
} finally {
  await fs.rm(scopeRepo, { recursive: true, force: true });
}

const directoryOnlyRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-directory-only-baseline-'));
try {
  await fs.mkdir(path.join(directoryOnlyRepo, 'src/levels'), { recursive: true });
  await fs.mkdir(path.join(directoryOnlyRepo, 'src/benchmark-levels/test-fixtures'), { recursive: true });
  await fs.writeFile(path.join(directoryOnlyRepo, 'src/levels/index.ts'), "export const levelMetadatas: LevelMetadata[] = [\n  { id: 'anchor', title: 'Anchor' },\n];\n");
  for (const file of ['catalog.ts', 'domain.test.ts', 'index.ts', 'types.ts', 'validation.ts']) {
    await fs.writeFile(path.join(directoryOnlyRepo, 'src/benchmark-levels', file), 'permanent infrastructure\n');
  }
  await exec('git', ['init', '-q'], { cwd: directoryOnlyRepo });
  await exec('git', ['config', 'user.name', 'Benchmark Test'], { cwd: directoryOnlyRepo });
  await exec('git', ['config', 'user.email', 'benchmark@example.com'], { cwd: directoryOnlyRepo });
  await exec('git', ['add', '.'], { cwd: directoryOnlyRepo });
  await exec('git', ['commit', '-qm', 'directory-only baseline'], { cwd: directoryOnlyRepo });
  assert.equal(protocolForVersion('v2').sourceRoot, 'src/benchmark-levels');
  assert.equal(protocolForVersion('v1').sourceRoot, 'src/levels');
  await assertBenchmarkBaseline({ root: directoryOnlyRepo, ref: 'HEAD', benchmarkVersion: 'v2', expectedBuiltInLevelIds: ['anchor'] });
  await fs.mkdir(path.join(directoryOnlyRepo, 'src/benchmark-levels/promoted-a1b2'), { recursive: true });
  await fs.writeFile(path.join(directoryOnlyRepo, 'src/benchmark-levels/promoted-a1b2/index.ts'), 'promoted\n');
  await exec('git', ['add', '.'], { cwd: directoryOnlyRepo });
  await exec('git', ['commit', '-qm', 'invalid promoted output'], { cwd: directoryOnlyRepo });
  await assert.rejects(
    () => assertBenchmarkBaseline({ root: directoryOnlyRepo, ref: 'HEAD', benchmarkVersion: 'v2', expectedBuiltInLevelIds: ['anchor'] }),
    /output root is not empty/,
  );
} finally {
  await fs.rm(directoryOnlyRepo, { recursive: true, force: true });
}

console.log('Benchmark controller tests passed.');
