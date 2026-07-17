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
import { assertSiblingBaseRendering, dispositionFor, firstLevelOneHeading, manifestNeedsRefresh, reusableGateRecord, validatePlan, validateRunDefinition } from './run.mjs';
import { harnessCounters, harnessCountersForRounds, reconcileCost, reconciliationWarnings, summarizeCost } from './ccusage-cost.mjs';
import { createRecoverySnapshot, restoreRecoverySnapshot } from './recovery-snapshot.mjs';
import { checkBenchmarkScope } from '../check-benchmark-scope.mjs';
import { BENCHMARK_SOURCE_ROOT, BUILT_IN_SOURCE_ROOT } from './protocol.mjs';
import { createWorktree, derivePayload, sealEvaluatedCommit } from './admin.mjs';
import { pruneRun } from './manage-run.mjs';
import { sha256 } from './common.mjs';

const exec = promisify(execFile);

const hash = (character) => character.repeat(64);

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

const plan = {
  benchmarkVersion: 'v2',
  materialsCommit: 'c'.repeat(40),
  entrantBaseline: 'd'.repeat(40),
  runs: [{
    runId: 'run-a1b2c3d4', slotId: 'a1b2', levelId: 'cinder-a1b2', themeId: 'cinder', themePath: 'benchmark/themes/cinder.md',
    configurationId: 'codex-terra-high', recipePath: 'benchmark/recipes/codex-terra-high.md',
    stage: { adapter: 'codex-cli', model: 'gpt-5.6-terra', effort: 'high', timeoutSeconds: 10_800 },
  }],
};
assert.deepEqual(validatePlan(plan), []);
assert.deepEqual(validateRunDefinition({ ...plan, ...plan.runs[0], levelTitle: 'Cinder' }), []);
assert.deepEqual(dispositionFor({ kind: 'benchmark', passing: false, payload: { payloadCommit: 'a'.repeat(40) } }), { status: 'dnf', reasonCode: 'required-gate-failed' });
assert.deepEqual(dispositionFor({ kind: 'rehearsal', passing: true, payload: { payloadCommit: 'a'.repeat(40) } }), { status: 'rehearsal' });
const duplicateSlotPlan = structuredClone(plan);
duplicateSlotPlan.runs.push({ ...plan.runs[0], runId: 'run-b2c3d4e5' });
assert.ok(validatePlan(duplicateSlotPlan).some((error) => error.includes('slotId duplicates')));
const badLevelPlan = structuredClone(plan);
badLevelPlan.runs[0].levelId = 'wrong-level';
assert.ok(validatePlan(badLevelPlan).some((error) => error.includes('levelId must equal')));
const invalidBudgetPlan = structuredClone(plan);
invalidBudgetPlan.runs[0].stage.budget = { usd: Number.POSITIVE_INFINITY };
assert.ok(validatePlan(invalidBudgetPlan).some((error) => error.includes('budget.usd')));
const delegationPlan = structuredClone(plan);
delegationPlan.runs[0].delegation = { promptPath: 'benchmark/prompts/flexible-delegation.md', delegateModel: 'gpt-5.6-terra', delegateEffort: 'low' };
assert.deepEqual(validatePlan(delegationPlan), []);
const badDelegation = structuredClone(delegationPlan);
badDelegation.runs[0].delegation.delegateEffort = 'invalid';
assert.ok(validatePlan(badDelegation).some((error) => error.includes('delegation.delegateEffort')));
assert.equal(firstLevelOneHeading('before\n# Derived Title  \n## detail'), 'Derived Title');
assert.equal(firstLevelOneHeading('no heading here'), undefined);
const renderingRuns = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-rendering-runs-'));
try {
  const sibling = path.join(renderingRuns, 'run-sibling');
  await fs.mkdir(sibling, { recursive: true });
  await fs.writeFile(path.join(sibling, 'run-definition.json'), JSON.stringify({ benchmarkVersion: 'v2', themeId: 'cinder', runId: 'run-sibling' }));
  await fs.writeFile(path.join(sibling, 'rendered-assignment.md'), 'shared base');
  await fs.writeFile(path.join(sibling, 'rendered-assignment.json'), JSON.stringify({ baseRendering: { sha256: sha256('different base') } }));
  await assert.rejects(
    () => assertSiblingBaseRendering({ benchmarkVersion: 'v2', themeId: 'cinder' }, path.join(renderingRuns, 'run-current'), sha256('shared base')),
    /base differs from sibling/,
  );
  await fs.writeFile(path.join(sibling, 'rendered-assignment.json'), JSON.stringify({ baseRendering: { sha256: sha256('shared base') } }));
  await assert.doesNotReject(() => assertSiblingBaseRendering({ benchmarkVersion: 'v2', themeId: 'cinder' }, path.join(renderingRuns, 'run-current'), sha256('shared base')));
} finally {
  await fs.rm(renderingRuns, { recursive: true, force: true });
}

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

// ccusage pi report: Claude-shaped per-model breakdown, but ccusage labels every model `[pi] <id>`
// for display. That prefix is stripped so a manifest records the model's own id. Shape taken from a
// real `ccusage pi session --json`.
const piReport = {
  sessions: [{
    sessionId: 's3',
    totalCost: 0.009118,
    modelBreakdowns: [
      { modelName: '[pi] gpt-5.6-luna', cost: 0.009118, inputTokens: 8406, outputTokens: 76, cacheReadTokens: 2560, cacheCreationTokens: 0 },
    ],
    totalTokens: 11042,
  }],
  totals: { totalCost: 0.009118, inputTokens: 8406, outputTokens: 76, cacheReadTokens: 2560, cacheCreationTokens: 0, totalTokens: 11042 },
};
const prefixReport = (modelName) => ({
  sessions: [{ sessionId: 's4', totalCost: 1, modelBreakdowns: [{ modelName, cost: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }] }],
  totals: { totalCost: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 2 },
});
const piCost = summarizeCost('pi-cli', piReport);
assert.equal(piCost.view, 'pi');
assert.equal(piCost.perModelCostAvailable, true);
assert.equal(piCost.totalUsd, 0.009118);
assert.equal(piCost.models.length, 1);
assert.equal(piCost.models[0].modelName, 'gpt-5.6-luna');
assert.equal(piCost.models[0].costUsd, 0.009118);
assert.equal(piCost.models[0].cacheReadTokens, 2560);
// A model id that merely contains the label text keeps it; only the leading prefix is a ccusage
// artifact. The Claude and Codex views declare no prefix, so their names pass through untouched.
assert.equal(summarizeCost('pi-cli', prefixReport('vendor/[pi] odd')).models[0].modelName, 'vendor/[pi] odd');
assert.equal(claudeCost.models.some((m) => m.modelName.startsWith('[')), false);

// The pi adapter reports its own tally in Claude's `modelUsage` shape so it reconciles unchanged.
const piCounters = harnessCounters({ normalized: { vendorFields: { modelUsage: { 'gpt-5.6-luna': { outputTokens: 76, costUSD: 0.009118 } } } } });
assert.equal(piCounters.get('gpt-5.6-luna').outputTokens, 76);
assert.equal(reconcileCost(piCost, piCounters).reconciliation.status, 'agreed');

// Resumed pi invocations report only their own API calls, unlike Claude/Codex's cumulative result
// counters. The round-aware helper sums pi but preserves the final-round rule for other harnesses.
const roundOne = { normalized: { vendorFields: { modelUsage: { 'gpt-5.6-luna': { outputTokens: 40, costUSD: 0.004 } } } } };
const roundTwo = { normalized: { vendorFields: { modelUsage: { 'gpt-5.6-luna': { outputTokens: 36, costUSD: 0.005118 } } } } };
const resumedPiCounters = harnessCountersForRounds('pi-cli', [roundOne, roundTwo]);
assert.equal(resumedPiCounters.get('gpt-5.6-luna').outputTokens, 76);
assert.equal(Number(resumedPiCounters.get('gpt-5.6-luna').costUsd.toFixed(6)), 0.009118);
assert.equal(harnessCountersForRounds('claude-cli', [roundOne, roundTwo]).get('gpt-5.6-luna').outputTokens, 36);

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

assert.equal(shouldUnblind(), false);
assert.equal(shouldUnblind(false), false);
assert.equal(shouldUnblind(true), true);
const resultManifest = {
  schemaVersion: 2,
  benchmarkVersion: 'rehearsal',
  runId: 'rehearsal-a1b2',
  slotId: 'a1b2',
  configuration: { id: 'solo-a' },
  theme: { id: 'cinder', path: 'benchmark/examples/cinder.md', sha256: hash('a') },
  baseline: { materialsCommit: 'a'.repeat(40), entrantBaseline: { kind: 'git-commit', identifier: 'a'.repeat(40) } },
  recipe: { path: 'benchmark/recipes/solo-a.md', sha256: hash('b') },
  controller: { commit: 'c'.repeat(40) },
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
  protocol: { noticeStepPct: 25, minimumSubmitFraction: 0.75, maxResumeRounds: 20, pollIntervalSeconds: 30, minimumResumeRemainingSeconds: 600 },
  noticeHistory: [{ pct: 25, spentUsd: 5.1, at: '2026-01-01T00:15:00.000Z' }],
  resumes: [],
  finalSpendUsd: 17,
  finalFraction: 0.85,
};
assert.deepEqual(manifestErrors(budgetManifest), []);
budgetManifest.stages[0].budget.protocol.maxResumeRounds = 3;
assert.deepEqual(manifestErrors(budgetManifest), [], 'manifests recorded under the 3-round protocol remain valid');
budgetManifest.stages[0].budget.protocol.maxResumeRounds = 20;
budgetManifest.stages[0].budget.protocol.noticeStepPct = 10;
assert.ok(manifestErrors(budgetManifest).some((error) => error.includes('budget is invalid')));
const legacyManifest = structuredClone(resultManifest);
delete legacyManifest.theme.id;
delete legacyManifest.output.title;
assert.deepEqual(manifestErrors(legacyManifest), [], 'schema-v2 legacy manifests remain recognized');
const mixedManifest = structuredClone(resultManifest);
delete mixedManifest.output.title;
assert.ok(manifestErrors(mixedManifest).some((error) => error.includes('present together')), 'mixed legacy/current metadata is rejected');
// Blind by default, even for a rehearsal: no configuration or models on the result.
const blindRehearsal = resultFromArtifacts({ directoryName: 'rehearsal-a1b2', manifest: resultManifest });
assert.equal(blindRehearsal.identity, 'blinded');
assert.equal(blindRehearsal.configuration, undefined);
assert.equal(blindRehearsal.models, undefined);
// The explicit unblind flag reveals identity.
const rehearsalResult = resultFromArtifacts({ directoryName: 'rehearsal-a1b2', manifest: resultManifest }, { unblind: true });
assert.equal(rehearsalResult.identity, 'unblinded');
assert.equal(rehearsalResult.configuration, 'solo-a');
assert.deepEqual(rehearsalResult.models, ['model-a']);
assert.equal(rehearsalResult.stageWallTimeSeconds, 600);
assert.equal(rehearsalResult.controllerWallTimeSeconds, 3600);
const eligibleManifest = { ...resultManifest, benchmarkVersion: 'v1', disposition: { status: 'playable' } };
const eligibleResult = resultFromArtifacts({ directoryName: 'run-a1b2', manifest: eligibleManifest });
assert.equal(eligibleResult.identity, 'blinded');
assert.equal(eligibleResult.configuration, undefined);
assert.equal(eligibleResult.models, undefined);
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

await assertIsolatedEntrantRoundTrips();
await assertPruneLayouts();

async function assertIsolatedEntrantRoundTrips() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-isolated-main-'));
  const entrant = `${repo}-entrant`;
  const payloadWorktree = `${repo}-payload`;
  const runDirectory = `${repo}-run`;
  const branch = 'benchmark-run-isolation';
  const levelId = 'synthetic-a1b2';
  try {
    await exec('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await exec('git', ['config', 'user.name', 'Benchmark Test'], { cwd: repo });
    await exec('git', ['config', 'user.email', 'benchmark@example.com'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'baseline.txt'), 'entrant baseline\n');
    await exec('git', ['add', '.'], { cwd: repo });
    await exec('git', ['commit', '-qm', 'entrant baseline'], { cwd: repo });
    const baseline = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

    await exec('git', ['switch', '-qc', 'hidden-materials'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'sealed-marker.txt'), 'must not enter entrant repository\n');
    await exec('git', ['add', '.'], { cwd: repo });
    await exec('git', ['commit', '-qm', 'hidden marker'], { cwd: repo });
    const hiddenCommit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
    const hiddenTree = (await exec('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo })).stdout.trim();
    await exec('git', ['update-ref', 'refs/private/hidden-marker', hiddenCommit], { cwd: repo });
    await exec('git', ['switch', '-q', 'main'], { cwd: repo });

    const worktree = await createWorktree({ repo, baseline, 'run-id': 'run-isolation', path: entrant, branch });
    assert.equal(worktree.layout, 'standalone');
    assert.equal((await fs.lstat(path.join(entrant, '.git'))).isDirectory(), true);
    assert.equal((await exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: entrant })).stdout.trim(), branch);
    assert.equal((await exec('git', ['rev-parse', 'HEAD'], { cwd: entrant })).stdout.trim(), baseline);
    assert.deepEqual((await exec('git', ['rev-list', '--all'], { cwd: entrant })).stdout.trim().split('\n').filter(Boolean), [baseline]);
    assert.deepEqual((await exec('git', ['for-each-ref', '--format=%(refname)'], { cwd: entrant })).stdout.trim().split('\n').filter(Boolean), [`refs/heads/${branch}`]);
    await assert.rejects(() => exec('git', ['cat-file', '-e', `${hiddenCommit}^{commit}`], { cwd: entrant }));
    await assert.rejects(() => exec('git', ['cat-file', '-e', `${hiddenTree}^{tree}`], { cwd: entrant }));
    await assert.rejects(() => fs.readFile(path.join(entrant, 'sealed-marker.txt'), 'utf8'));
    assert.equal((await exec('git', ['for-each-ref', '--format=%(refname)', 'refs/benchmark-baselines'], { cwd: repo })).stdout.trim(), '');

    const levelDirectory = path.join(entrant, 'src/benchmark-levels', levelId);
    await fs.mkdir(levelDirectory, { recursive: true });
    await fs.writeFile(path.join(levelDirectory, 'index.ts'), 'export const synthetic = true;\n');
    await fs.writeFile(path.join(levelDirectory, 'level.json'), `${JSON.stringify({ id: levelId, title: 'Synthetic' }, null, 2)}\n`);
    await exec('git', ['add', '.'], { cwd: entrant });
    await exec('git', ['commit', '-qm', 'entrant implementation'], { cwd: entrant });
    const entrantCommit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: entrant })).stdout.trim();
    assert.notEqual(entrantCommit, baseline);
    await exec('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], { cwd: entrant });

    const sealed = await sealEvaluatedCommit({ repo, worktree: entrant, baseline, 'level-id': levelId, 'level-title': 'Synthetic' });
    assert.equal(sealed.evaluatedCommit, entrantCommit);
    assert.equal((await exec('git', ['rev-parse', `refs/heads/${branch}`], { cwd: repo })).stdout.trim(), entrantCommit);
    const payload = await derivePayload({ repo, materials: baseline, evaluated: entrantCommit, 'level-id': levelId, 'level-title': 'Synthetic', path: payloadWorktree, branch: 'benchmark-payload-isolation' });
    assert.equal((await exec('git', ['cat-file', '-t', `${payload.payloadCommit}:${`src/benchmark-levels/${levelId}`}`], { cwd: repo })).stdout.trim(), 'tree');

    await fs.mkdir(runDirectory, { recursive: true });
    await fs.writeFile(path.join(levelDirectory, 'index.ts'), 'export const synthetic = "recovered";\n');
    await fs.writeFile(path.join(levelDirectory, 'recovery.txt'), 'uncommitted recovery data\n');
    const snapshot = await createRecoverySnapshot({ repo, runDirectory, runId: 'run-isolation', worktree: entrant, checkpoint: 'stage', reason: 'synthetic isolated failure' });
    assert.deepEqual(snapshot.changedPaths.sort(), [`src/benchmark-levels/${levelId}/index.ts`, `src/benchmark-levels/${levelId}/recovery.txt`]);
    assert.equal((await exec('git', ['rev-parse', snapshot.ref], { cwd: repo })).stdout.trim(), snapshot.snapshotCommit);

    await fs.rm(entrant, { recursive: true });
    await restoreRecoverySnapshot({ repo, runDirectory, worktreeRecord: worktree });
    assert.equal((await fs.lstat(path.join(entrant, '.git'))).isDirectory(), true);
    assert.equal((await exec('git', ['write-tree'], { cwd: entrant })).stdout.trim(), snapshot.snapshotTree);
    assert.equal(await fs.readFile(path.join(levelDirectory, 'index.ts'), 'utf8'), 'export const synthetic = "recovered";\n');
    assert.equal(await fs.readFile(path.join(levelDirectory, 'recovery.txt'), 'utf8'), 'uncommitted recovery data\n');
    assert.deepEqual((await exec('git', ['for-each-ref', '--format=%(refname)'], { cwd: entrant })).stdout.trim().split('\n').filter(Boolean), [`refs/heads/${branch}`]);
    assert.equal((await exec('git', ['rev-list', '--all'], { cwd: entrant })).stdout.includes(hiddenCommit), false);
    await assert.rejects(() => exec('git', ['cat-file', '-e', `${hiddenCommit}^{commit}`], { cwd: entrant }));
  } finally {
    await exec('git', ['worktree', 'remove', '--force', payloadWorktree], { cwd: repo }).catch(() => {});
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(entrant, { recursive: true, force: true });
    await fs.rm(payloadWorktree, { recursive: true, force: true });
    await fs.rm(runDirectory, { recursive: true, force: true });
  }
}

async function assertPruneLayouts() {
  for (const layout of ['linked', 'standalone']) {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), `pareto-rail-prune-${layout}-`));
    const checkout = `${repo}-checkout`;
    const runDirectory = `${repo}-run`;
    const runId = `run-prune-${layout}`;
    const branch = `benchmark-${layout}`;
    try {
      await exec('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      await exec('git', ['config', 'user.name', 'Benchmark Test'], { cwd: repo });
      await exec('git', ['config', 'user.email', 'benchmark@example.com'], { cwd: repo });
      await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
      await exec('git', ['add', '.'], { cwd: repo });
      await exec('git', ['commit', '-qm', 'base'], { cwd: repo });
      const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
      let worktreeRecord;
      if (layout === 'linked') {
        await exec('git', ['worktree', 'add', '-qb', branch, checkout, commit], { cwd: repo });
        worktreeRecord = { worktree: checkout, branch, baselineCommit: commit };
      } else {
        worktreeRecord = await createWorktree({ repo, baseline: commit, 'run-id': runId, path: checkout, branch });
        await exec('git', ['branch', branch, commit], { cwd: repo });
      }
      await fs.mkdir(runDirectory, { recursive: true });
      await fs.writeFile(path.join(runDirectory, 'run-definition.json'), `${JSON.stringify({ worktree: { path: checkout }, payload: { path: `${checkout}-payload`, branch: `${branch}-payload` } })}\n`);
      await fs.writeFile(path.join(runDirectory, 'worktree.json'), `${JSON.stringify(worktreeRecord)}\n`);
      await fs.writeFile(path.join(runDirectory, 'evaluated.json'), `${JSON.stringify({ evaluatedCommit: commit })}\n`);

      await pruneRun({ runId, confirmation: runId, root: repo, runDirectory });
      await assert.rejects(() => fs.lstat(checkout));
      assert.equal((await exec('git', ['rev-parse', `refs/heads/${branch}`], { cwd: repo })).stdout.trim(), commit);
      assert.equal((await exec('git', ['cat-file', '-t', commit], { cwd: repo })).stdout.trim(), 'commit');
    } finally {
      await exec('git', ['worktree', 'remove', '--force', checkout], { cwd: repo }).catch(() => {});
      await fs.rm(repo, { recursive: true, force: true });
      await fs.rm(checkout, { recursive: true, force: true });
      await fs.rm(runDirectory, { recursive: true, force: true });
    }
  }
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
    await checkBenchmarkScope({ root: scopeRepo, levelId: 'synthetic-a1b2', base: 'HEAD' }),
    ['src/benchmark-levels/synthetic-a1b2/index.ts'],
  );
  // A level co-owns its gallery content directory; self-produced images are in scope.
  await fs.mkdir(path.join(scopeRepo, 'public/level-content/synthetic-a1b2'), { recursive: true });
  await fs.writeFile(path.join(scopeRepo, 'public/level-content/synthetic-a1b2/hero.png'), 'binary\n');
  assert.deepEqual(
    await checkBenchmarkScope({ root: scopeRepo, levelId: 'synthetic-a1b2', base: 'HEAD' }),
    ['public/level-content/synthetic-a1b2/hero.png', 'src/benchmark-levels/synthetic-a1b2/index.ts'],
  );
  // Another level's content directory remains out of scope.
  await fs.mkdir(path.join(scopeRepo, 'public/level-content/other-z9z9'), { recursive: true });
  await fs.writeFile(path.join(scopeRepo, 'public/level-content/other-z9z9/hero.png'), 'binary\n');
  await assert.rejects(
    () => checkBenchmarkScope({ root: scopeRepo, levelId: 'synthetic-a1b2', base: 'HEAD' }),
    /Out-of-scope files/,
  );
  await fs.rm(path.join(scopeRepo, 'public/level-content/other-z9z9'), { recursive: true, force: true });
  await fs.writeFile(path.join(scopeRepo, 'src/levels/index.ts'), 'unrelated\n');
  await assert.rejects(
    () => checkBenchmarkScope({ root: scopeRepo, levelId: 'synthetic-a1b2', base: 'HEAD' }),
    /Out-of-scope files/,
  );

  await exec('git', ['checkout', '--', 'src/levels/index.ts'], { cwd: scopeRepo });
  await fs.rm(path.join(scopeRepo, 'src/benchmark-levels/synthetic-a1b2'), { recursive: true, force: true });
  await fs.rm(path.join(scopeRepo, 'public/level-content/synthetic-a1b2'), { recursive: true, force: true });
  await fs.mkdir(path.join(scopeRepo, 'src/levels/synthetic-a1b2'), { recursive: true });
  await fs.writeFile(path.join(scopeRepo, 'src/levels/synthetic-a1b2/index.ts'), 'synthetic legacy\n');
  await fs.writeFile(path.join(scopeRepo, 'src/levels/index.ts'), 'derived registry\n');
  await fs.mkdir(path.join(scopeRepo, 'public/level-content/synthetic-a1b2'), { recursive: true });
  await fs.writeFile(path.join(scopeRepo, 'public/level-content/synthetic-a1b2/hero.png'), 'legacy hero\n');
  assert.deepEqual(
    await checkBenchmarkScope({ root: scopeRepo, levelId: 'synthetic-a1b2', base: 'HEAD', builtIn: true }),
    ['public/level-content/synthetic-a1b2/hero.png', 'src/levels/index.ts', 'src/levels/synthetic-a1b2/index.ts'],
  );
  await fs.mkdir(path.join(scopeRepo, 'public/level-content/other-z9z9'), { recursive: true });
  await fs.writeFile(path.join(scopeRepo, 'public/level-content/other-z9z9/hero.png'), 'other\n');
  await assert.rejects(
    () => checkBenchmarkScope({ root: scopeRepo, levelId: 'synthetic-a1b2', base: 'HEAD', builtIn: true }),
    /public\/level-content\/other-z9z9\/hero\.png/,
  );
} finally {
  await fs.rm(scopeRepo, { recursive: true, force: true });
}

assert.equal(BENCHMARK_SOURCE_ROOT, 'src/benchmark-levels');
assert.equal(BUILT_IN_SOURCE_ROOT, 'src/levels');

const adminSource = await fs.readFile(path.join(process.cwd(), 'scripts/benchmark/admin.mjs'), 'utf8');
assert.match(adminSource, /CONTROLLER_SCOPE_SCRIPT/);
assert.doesNotMatch(adminSource, /path\.resolve\(worktree, 'scripts\/check-benchmark-scope\.mjs'\)/);
await assertMissingGatesResumeFixture();

async function assertMissingGatesResumeFixture() {
  const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-missing-gates-'));
  const evaluatedCommit = 'a'.repeat(40);
  try {
    await fs.writeFile(path.join(runDirectory, 'controller-state.json'), `${JSON.stringify({ checkpoints: { gates: { status: 'completed' } } }, null, 2)}\n`);
    assert.equal(await reusableGateRecord(runDirectory, evaluatedCommit), null, 'a completed gates checkpoint with no gates.json must not be reusable');
    const oldManifest = { output: { evaluated: { commit: evaluatedCommit } }, gates: [{ id: 'typecheck', status: 'failed' }], disposition: { status: 'dnf' } };
    const newGateRecord = { evaluatedCommit, gates: ['typecheck', 'build', 'scope', 'floor'].map((id) => ({ id, status: 'passed' })) };
    assert.equal(manifestNeedsRefresh(oldManifest, { evaluatedCommit }, null, newGateRecord), true, 'changed gate results must refresh the manifest on resume');
    assert.deepEqual(dispositionFor({ kind: 'benchmark', passing: true, payload: null }), { status: 'dnf', reasonCode: 'payload-pending' });
    await fs.mkdir(path.join(runDirectory, 'gates'), { recursive: true });
    await fs.writeFile(path.join(runDirectory, 'gates/gates.json'), `${JSON.stringify(newGateRecord)}\n`);
    assert.deepEqual(await reusableGateRecord(runDirectory, evaluatedCommit), newGateRecord);
  } finally {
    await fs.rm(runDirectory, { recursive: true, force: true });
  }
}

console.log('Benchmark controller tests passed.');
