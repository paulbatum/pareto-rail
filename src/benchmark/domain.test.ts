/* Runnable with Node's type stripping and kept dependency-free so the domain
 * can be verified without a browser or a test framework. */
// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import { createDevelopmentFixtureApi, createFixtureCatalog } from './fixtures';
import { CatalogBenchmarkApi } from './catalog-api';
import { nextScheduledMatchup, pairId } from './scheduler';
import { mapVerdict, type MatchupAssignment, type MatchupVote, type RelativeOutcome } from './types';
import type { RankCatalog, RankCatalogEntrant, RankCatalogVersion } from './catalog';
import { selectPersonalCurveCatalog } from '../app/rank';
import { validateRankVoteBody } from '../../server/rank-vote-validation';
import { ComparisonStateMachine } from './state';
import { BENCHMARK_STORAGE_VERSION, BenchmarkLocalStore, createMemoryStorage, type StorageEnvelope } from './storage';
import { recomputePersonalCurve, type PersonalHistoryEntry } from './personal-curve';

declare const process: { argv: string[]; exitCode?: number } | undefined;

type Judged = { matchupId: string; relative: RelativeOutcome };

function assignment(): MatchupAssignment {
  return { matchupId: 'm', benchmarkVersion: 'v1', theme: { id: 't', title: 'T', summary: 'S', prompt: 'P' }, a: { playableRef: 'a' }, b: { playableRef: 'b' }, assignedAt: 'now' };
}

export async function runBenchmarkDomainTests(): Promise<void> {
  assert.deepEqual(mapVerdict('a-better'), { verdict: 'a-better', relative: 'a' });
  assert.deepEqual(mapVerdict('b-better'), { verdict: 'b-better', relative: 'b' });
  assert.equal(mapVerdict('both-good').sentiment, 'positive');
  assert.equal(mapVerdict('both-bad').sentiment, 'negative');

  testPersonalCurve();
  testIslandPlacement();
  testFeaturedIslandIsMain();
  testConnectionPromotes();
  testSelfHealingSchedule();
  testStorageVersioning();
  testStorageUndo();
  testSchedulerCoverage();
  testFeaturedFirstMatchup();
  testFeaturedThemeCoverage();
  testNewcomerAnchoring();
  testNewThemeCoverage();
  testFeaturedNewThemeOpener();
  testThemeBalance();
  testConvergenceAndStability();
  testSameConfigurationPairs();
  testVersionedSchedulerPool();
  testVersionedPruning();
  testVersionedPersonalCurveCatalog();
  await testInactiveVersionRestore();
  testVersionedVoteValidation();
  await testApisAndStateMachine();
}

function testPersonalCurve(): void {
  const votes: PersonalHistoryEntry[] = [
    historyEntry('m1', 'a', 'b', 'a'),
    historyEntry('m2', 'a', 'c', 'b'),
    historyEntry('m3', 'b', 'c', 'a'),
    historyEntry('m4', 'a', 'b', 'tie'),
    historyEntry('m5', 'a', 'c', 'a'),
  ];
  const forward = recomputePersonalCurve(votes);
  const reverse = recomputePersonalCurve([...votes].reverse());
  assert.deepEqual(
    forward.points.map((point) => [point.configurationId, point.rating]),
    reverse.points.map((point) => [point.configurationId, point.rating]),
    'Bradley-Terry ratings are independent of vote order',
  );

  const undefeated = recomputePersonalCurve([historyEntry('win', 'winner', 'loser', 'a')]);
  assert.ok(Number.isFinite(undefeated.points.find((point) => point.configurationId === 'winner')?.rating));
  assert.ok((undefeated.points.find((point) => point.configurationId === 'winner')?.rating ?? 0) > (undefeated.points.find((point) => point.configurationId === 'loser')?.rating ?? 0));

  const tieGoodEntry = historyEntry('tie-good', 'a', 'b', 'tie');
  const tieBadEntry = { ...tieGoodEntry, vote: { ...tieGoodEntry.vote, matchupId: 'tie-bad', verdict: 'both-bad' as const, sentiment: 'negative' as const } };
  const tieGood = recomputePersonalCurve([tieGoodEntry]);
  const tieBad = recomputePersonalCurve([tieBadEntry]);
  assert.deepEqual(tieGood.points.map((point) => point.rating), tieBad.points.map((point) => point.rating), 'both-good and both-bad use the same ordinal tie result');

  const catalog = makeSchedulerCatalog(3, 1);
  const withUnseen = recomputePersonalCurve([historyEntry('seen', 'configuration-0', 'configuration-1', 'a')], { catalog: catalog.entrants });
  assert.equal(withUnseen.points.length, 3);
  assert.equal(withUnseen.points.find((point) => point.configurationId === 'configuration-2')?.rating, undefined);
  assert.equal(withUnseen.points.find((point) => point.configurationId === 'configuration-2')?.status, 'pending');
  assert.equal(withUnseen.points.find((point) => point.configurationId === 'configuration-0')?.wins, 1);
  assert.equal(withUnseen.points.find((point) => point.configurationId === 'configuration-1')?.losses, 1);
}

function testIslandPlacement(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  const curve = recomputePersonalCurve(coldStartHistory(), { catalog: catalog.entrants });
  assert.equal(curve.placedCount, 4);
  assert.equal(curve.points.filter((point) => point.status !== 'pending').length, 4, 'every twice-compared configuration is placed');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-2')?.status, 'provisional');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-3')?.status, 'provisional');
}

function testFeaturedIslandIsMain(): void {
  // The featured island wins the tie even when the other island holds the
  // lexicographically smallest configuration id.
  const catalog = makeSchedulerCatalog(4, 2, false, [2, 3]);
  const curve = recomputePersonalCurve([
    historyEntry('theme-a-featured', 'configuration-2', 'configuration-3', 'a'),
    historyEntry('theme-b-featured', 'configuration-2', 'configuration-3', 'a'),
    historyEntry('theme-a-other', 'configuration-0', 'configuration-1', 'a'),
    historyEntry('theme-b-other', 'configuration-0', 'configuration-1', 'a'),
  ], { catalog: catalog.entrants });
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-0')?.status, 'provisional', 'the unfeatured island is capped at provisional');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-1')?.status, 'provisional', 'the unfeatured island is capped at provisional');
}

function testConnectionPromotes(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  const curve = recomputePersonalCurve([
    ...coldStartHistory(),
    historyEntry('cross-island', 'configuration-1', 'configuration-2', 'a'),
  ], { catalog: catalog.entrants });
  assert.equal(curve.points.filter((point) => point.status !== 'pending').length, 4);
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-2')?.status, 'stable');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-3')?.status, 'stable');
}

function testSelfHealingSchedule(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  const simulated = simulateAssignments(catalog, 4);
  const next = scheduleOne(catalog, simulated.judged, simulated.exposures, simulated.themes);
  assert.ok(next);
  const configurationIds = [next!.levelIdA, next!.levelIdB].map((levelId) => catalog.entrants.find((entrant) => entrant.levelId === levelId)!.configurationId);
  const solo = new Set(['configuration-0', 'configuration-1']);
  const delegated = new Set(['configuration-2', 'configuration-3']);
  assert.equal(
    (solo.has(configurationIds[0]!) && delegated.has(configurationIds[1]!))
      || (solo.has(configurationIds[1]!) && delegated.has(configurationIds[0]!)),
    true,
    'playoff reconnects the solo and delegated comparison islands',
  );
}

function coldStartHistory(): PersonalHistoryEntry[] {
  return [
    historyEntry('theme-a-featured', 'configuration-0', 'configuration-1', 'a'),
    historyEntry('theme-b-featured', 'configuration-0', 'configuration-1', 'a'),
    historyEntry('theme-a-delegated', 'configuration-2', 'configuration-3', 'a'),
    historyEntry('theme-b-delegated', 'configuration-2', 'configuration-3', 'a'),
  ];
}

function testStorageVersioning(): void {
  assert.equal(BENCHMARK_STORAGE_VERSION, 2);
  const storage = createMemoryStorage();
  storage.setItem('legacy', JSON.stringify({ participantId: 'old', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] }));
  assert.notEqual(new BenchmarkLocalStore(storage, 'legacy').participantId, 'old', 'unversioned data is discarded');
  storage.setItem('old-envelope', JSON.stringify({ version: 1, data: { participantId: 'old', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] } }));
  assert.notEqual(new BenchmarkLocalStore(storage, 'old-envelope').participantId, 'old', 'old envelopes are discarded');
  storage.setItem('old-kind', JSON.stringify({ version: 2, data: { participantId: 'old', unfinishedMatchup: { kind: 'a-complete', assignment: assignment(), playCounts: { a: 1, b: 0 } }, completedMatchups: [], history: [], themeHistory: [], levelExposureCounts: {}, revealedEntrants: [] } }));
  assert.equal(new BenchmarkLocalStore(storage, 'old-kind').snapshot.unfinishedMatchup, undefined);

  const currentStorage = createMemoryStorage();
  const current = new BenchmarkLocalStore(currentStorage, 'current');
  current.save({ participantId: 'current-participant' });
  const envelope = JSON.parse(currentStorage.getItem('current')!) as StorageEnvelope;
  assert.equal(envelope.version, 2);
  assert.equal(new BenchmarkLocalStore(currentStorage, 'current').participantId, 'current-participant');
}

function testStorageUndo(): void {
  const store = new BenchmarkLocalStore(createMemoryStorage(), 'undo');
  const vote: MatchupVote = { matchupId: 'm', aEntrantId: 'a', bEntrantId: 'b', verdict: 'a-better', relative: 'a', playCounts: { a: 2, b: 1 }, submittedAt: 'now' };
  const reveal = {
    matchupId: 'm',
    a: { entrantId: 'a', playableRef: 'a', levelId: 'a', modelName: 'A', workflowName: 'solo', generationCost: 1, dataClass: 'eligible' as const },
    b: { entrantId: 'b', playableRef: 'b', levelId: 'b', modelName: 'B', workflowName: 'solo', generationCost: 2, dataClass: 'eligible' as const },
    vote,
  };
  store.completeMatchup({ matchupId: 'm', vote, reveal });
  const undone = store.undoLastVerdict();
  assert.equal(undone?.vote.verdict, 'a-better');
  assert.equal(store.snapshot.completedMatchups.length, 0);
  assert.equal(store.snapshot.history.length, 0);
  assert.deepEqual(store.snapshot.levelExposureCounts, {});
  assert.deepEqual(store.snapshot.revealedEntrants, []);
}

function testSchedulerCoverage(): void {
  const catalog = makeSchedulerCatalog(4, 2);
  const { judged, exposures, themes, assignments } = simulateAssignments(catalog, 4);
  assert.equal(assignments.length, 4);
  assert.equal(new Set(assignments.flatMap((matchup) => [matchup.levelIdA, matchup.levelIdB])).size, 8, 'cold start covers every level');
  assert.equal(new Set(judged.map((item) => configurationPairFromMatchup(catalog, item.matchupId))).size, 4, 'cold start uses four configuration pairs');
  const curve = curveFromJudged(catalog, judged);
  assert.equal(curve.placedCount, 4, 'the four-vote cold-start graph places every configuration');
  assert.ok(Object.values(exposures).every((count) => count === 1));
}

function testFeaturedFirstMatchup(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  for (const participantId of ['participant-a', 'participant-b']) {
    const { assignments } = simulateAssignments(catalog, catalog.themes.length, participantId);
    const firstByTheme = new Map<string, { themeId: string; levelIdA: string; levelIdB: string }>();
    for (const matchup of assignments) if (!firstByTheme.has(matchup.themeId)) firstByTheme.set(matchup.themeId, matchup);
    assert.equal(firstByTheme.size, catalog.themes.length);
    for (const [themeId, matchup] of firstByTheme) {
      const a = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdA)!;
      const b = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdB)!;
      assert.equal(themeId, matchup.themeId);
      assert.equal(a.featured, true, `${participantId} opened ${themeId} without a featured entrant`);
      assert.equal(b.featured, true, `${participantId} opened ${themeId} without a featured entrant`);
    }
  }
}

function testFeaturedThemeCoverage(): void {
  const catalog = makeSchedulerCatalog(4, 1, false, [0, 1]);
  const simulated = simulateAssignments(catalog, 3);
  assert.equal(simulated.assignments[0]?.themeId, 'theme-a');
  assert.ok(simulated.exposures['theme-a-0'] > 0);
  assert.ok(simulated.exposures['theme-a-1'] > 0);
  assert.ok(simulated.exposures['theme-a-2'] > 0);
  assert.ok(simulated.exposures['theme-a-3'] > 0, 'coverage continues after the featured opener');
}

function testNewcomerAnchoring(): void {
  const established = makeSchedulerCatalog(4, 2);
  const simulated = simulateAssignments(established, 4);
  const catalog = makeSchedulerCatalog(6, 2);
  const history = [...simulated.judged];
  const exposures = { ...simulated.exposures };
  const themeHistory = [...simulated.themes];
  const newcomerLevels = new Set(catalog.entrants.filter((entrant) => entrant.configurationId === 'configuration-4' || entrant.configurationId === 'configuration-5').map((entrant) => entrant.levelId));
  const establishedPlaced = new Set(curveFromJudged(catalog, history).points.filter((point) => point.status !== 'pending').map((point) => point.configurationId));
  const debutSeen = new Set<string>();
  let guard = 0;
  while (debutSeen.size < newcomerLevels.size && guard++ < 20) {
    const next = scheduleOne(catalog, history, exposures, themeHistory);
    assert.ok(next);
    const sides = [next!.levelIdA, next!.levelIdB];
    const unseen = sides.filter((levelId) => (exposures[levelId] ?? 0) === 0);
    assert.equal(unseen.length, 1, 'newcomer coverage is anchored to a seen level');
    assert.ok(newcomerLevels.has(unseen[0]!));
    debutSeen.add(unseen[0]!);
    appendJudgment(catalog, next!, history, exposures, themeHistory);
  }
  assert.equal(debutSeen.size, newcomerLevels.size);

  const newcomerVotes = new Map<string, number>();
  while ([...newcomerVotes.values()].some((count) => count < 2) || newcomerVotes.size < 2) {
    const next = scheduleOne(catalog, history, exposures, themeHistory);
    assert.ok(next);
    const configIds = [next!.levelIdA, next!.levelIdB].map((levelId) => catalog.entrants.find((entrant) => entrant.levelId === levelId)!.configurationId);
    for (const configurationId of configIds) if (configurationId === 'configuration-4' || configurationId === 'configuration-5') newcomerVotes.set(configurationId, (newcomerVotes.get(configurationId) ?? 0) + 1);
    appendJudgment(catalog, next!, history, exposures, themeHistory);
    if (history.length > 80) throw new Error('newcomer simulation did not converge');
  }
  const curve = curveFromJudged(catalog, history);
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-4')?.status === 'pending', false);
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-5')?.status === 'pending', false);
  for (const configurationId of establishedPlaced) assert.notEqual(curve.points.find((point) => point.configurationId === configurationId)?.status, 'pending');
}

function testNewThemeCoverage(): void {
  const established = makeSchedulerCatalog(8, 2);
  const simulated = simulateAssignments(established, 12);
  assert.ok(curveFromJudged(established, simulated.judged).placedCount >= 6, 'the established pool is placed before the theme arrives');
  const catalog = makeSchedulerCatalog(8, 3);
  const history = [...simulated.judged];
  const exposures = { ...simulated.exposures };
  const themeHistory = [...simulated.themes];
  const newThemeLevels = new Set(catalog.entrants.filter((entrant) => entrant.themeId === 'theme-c').map((entrant) => entrant.levelId));
  let guard = 0;
  while ([...newThemeLevels].some((levelId) => (exposures[levelId] ?? 0) === 0) && guard++ < 20) {
    const next = scheduleOne(catalog, history, exposures, themeHistory);
    assert.ok(next, 'a fully unseen theme never stalls the scheduler');
    appendJudgment(catalog, next!, history, exposures, themeHistory);
  }
  assert.ok([...newThemeLevels].every((levelId) => (exposures[levelId] ?? 0) > 0), 'the new theme gets covered');
}

function testFeaturedNewThemeOpener(): void {
  const established = makeSchedulerCatalog(8, 2, false, [0, 1]);
  const simulated = simulateAssignments(established, 12);
  const catalog = makeSchedulerCatalog(8, 3, false, [0, 1]);
  const next = scheduleOne(catalog, simulated.judged, simulated.exposures, simulated.themes);
  assert.ok(next);
  assert.equal(next!.themeId, 'theme-c');
  const a = catalog.entrants.find((entrant) => entrant.levelId === next!.levelIdA)!;
  const b = catalog.entrants.find((entrant) => entrant.levelId === next!.levelIdB)!;
  assert.equal(a.featured, true, 'a newly added theme opens with a featured entrant');
  assert.equal(b.featured, true, 'a newly added theme opens with a featured entrant');
}

function testThemeBalance(): void {
  const catalog = makeSchedulerCatalog(4, 2);
  const simulated = simulateAssignments(catalog, 30);
  const counts = new Map<string, number>();
  for (const item of simulated.judged) {
    const themeId = item.matchupId.slice(0, item.matchupId.indexOf(':'));
    counts.set(themeId, (counts.get(themeId) ?? 0) + 1);
  }
  assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1, `theme counts are balanced: ${JSON.stringify(Object.fromEntries(counts))}`);
}

function testConvergenceAndStability(): void {
  const catalog = makeSchedulerCatalog(4, 1);
  const trueOrder = ['configuration-3', 'configuration-2', 'configuration-1', 'configuration-0'];
  const history: PersonalHistoryEntry[] = [];
  for (let repeat = 0; repeat < 12; repeat += 1) {
    for (let i = 0; i < trueOrder.length; i += 1) for (let j = i + 1; j < trueOrder.length; j += 1) {
      history.push(historyEntry(`truth-${repeat}-${i}-${j}`, trueOrder[i]!, trueOrder[j]!, 'a', configCost(trueOrder[i]!), configCost(trueOrder[j]!)));
    }
  }
  const curve = recomputePersonalCurve(history, { catalog: catalog.entrants });
  const ranked = curve.points.filter((point) => point.rating !== undefined).sort((a, b) => b.rating! - a.rating!).map((point) => point.configurationId);
  assert.deepEqual(ranked, trueOrder);
  assert.ok(curve.points.filter((point) => point.frontier).every((point) => point.status === 'stable'));

  const fresh = recomputePersonalCurve([
    historyEntry('fresh-a', 'configuration-0', 'configuration-1', 'a'),
    historyEntry('fresh-b', 'configuration-1', 'configuration-2', 'a'),
    historyEntry('fresh-c', 'configuration-0', 'configuration-2', 'b'),
    historyEntry('fresh-d', 'configuration-2', 'configuration-3', 'a'),
    historyEntry('fresh-e', 'configuration-0', 'configuration-3', 'b'),
  ], { catalog: catalog.entrants });
  assert.ok(fresh.points.some((point) => point.status === 'provisional'), 'a one-vote frontier flip is provisional');
}

function testSameConfigurationPairs(): void {
  const catalog = makeSchedulerCatalog(2, 1, true);
  assert.equal(nextScheduledMatchup(catalog, 'same-config', { judged: [], levelExposureCounts: {} }), null, 'same-configuration levels are never paired');
}

function testVersionedSchedulerPool(): void {
  const inactive = makeSchedulerCatalog(2, 1, false, [], 'rank-catalog-v1', 'v1');
  const active = makeSchedulerCatalog(2, 1, false, [], 'rank-catalog-v2', 'v2');
  const next = nextScheduledMatchup(active, 'versioned-scheduler', { judged: [], levelExposureCounts: {} });
  assert.ok(next);
  assert.ok(active.entrants.some((entrant) => entrant.levelId === next!.levelIdA));
  assert.ok(active.entrants.some((entrant) => entrant.levelId === next!.levelIdB));
  assert.equal(inactive.entrants.some((entrant) => entrant.levelId === next!.levelIdA), false);
  assert.equal(inactive.entrants.some((entrant) => entrant.levelId === next!.levelIdB), false);
  const oldMatchup = pairId(inactive.themes[0]!.id, inactive.entrants[0]!.levelId, inactive.entrants[1]!.levelId);
  const afterOldHistory = nextScheduledMatchup(active, 'versioned-scheduler', {
    judged: [{ matchupId: oldMatchup, relative: 'a' }],
    levelExposureCounts: { [inactive.entrants[0]!.levelId]: 99, [inactive.entrants[1]!.levelId]: 99 },
  });
  assert.ok(afterOldHistory);
  assert.ok(active.entrants.some((entrant) => entrant.levelId === afterOldHistory!.levelIdA));
  assert.ok(active.entrants.some((entrant) => entrant.levelId === afterOldHistory!.levelIdB));
}

function testVersionedPruning(): void {
  const inactive = makeSchedulerCatalog(2, 1, false, [], 'rank-catalog-v1', 'v1');
  const active = makeSchedulerCatalog(2, 1, false, [], 'rank-catalog-v2', 'v2');
  const oldA = inactive.entrants[0]!;
  const oldB = inactive.entrants[1]!;
  const theme = inactive.themes[0]!;
  const matchupId = pairId(theme.id, oldA.levelId, oldB.levelId);
  const vote: MatchupVote = { matchupId, aEntrantId: oldA.levelId, bEntrantId: oldB.levelId, verdict: 'a-better', relative: 'a', playCounts: { a: 1, b: 1 }, submittedAt: 'now' };
  const reveal = {
    matchupId,
    a: { entrantId: oldA.levelId, playableRef: oldA.levelId, levelId: oldA.levelId, modelName: oldA.modelName, workflowName: oldA.workflowName, generationCost: oldA.generationCost, dataClass: 'eligible' as const },
    b: { entrantId: oldB.levelId, playableRef: oldB.levelId, levelId: oldB.levelId, modelName: oldB.modelName, workflowName: oldB.workflowName, generationCost: oldB.generationCost, dataClass: 'eligible' as const },
    vote,
  };
  const store = new BenchmarkLocalStore(createMemoryStorage(), 'versioned-prune');
  store.completeMatchup({ matchupId, vote, reveal });
  const unfinished: MatchupAssignment = { matchupId: 'unfinished-v1', benchmarkVersion: inactive.benchmarkVersion, theme, a: { playableRef: oldA.levelId }, b: { playableRef: oldB.levelId }, assignedAt: 'now' };
  store.setUnfinishedMatchup({ kind: 'assignment', assignment: unfinished, playCounts: { a: 0, b: 0 } });
  store.pruneToCatalog(
    new Set([...inactive.entrants, ...active.entrants].map((entrant) => entrant.levelId)),
    new Set([...inactive.themes, ...active.themes].map((candidate) => candidate.id)),
  );
  assert.equal(store.snapshot.completedMatchups.length, 1, 'inactive-version completed matchup was pruned');
  assert.equal(store.snapshot.history.length, 1, 'inactive-version vote history was pruned');
  assert.equal(store.snapshot.revealedEntrants.length, 2, 'inactive-version reveal was pruned');
  assert.equal(store.snapshot.unfinishedMatchup?.assignment.benchmarkVersion, inactive.benchmarkVersion, 'inactive-version unfinished matchup was pruned');
}

function testVersionedPersonalCurveCatalog(): void {
  const theme = { id: 'versioned-theme', title: 'Versioned', summary: 'S', prompt: 'P' };
  const entrant = (levelId: string, configurationId: string, generationCost: number): RankCatalogEntrant => ({ levelId, themeId: theme.id, configurationId, modelName: configurationId, workflowName: 'solo', generationCost });
  const inactive: RankCatalogVersion = { benchmarkVersion: 'rank-catalog-v1', generatedAt: 'test', themes: [theme], entrants: [entrant('v1-shared', 'shared', 10), entrant('v1-played', 'inactive-played', 30), entrant('v1-never', 'inactive-never', 50)] };
  const active: RankCatalogVersion = { benchmarkVersion: 'rank-catalog-v2', generatedAt: 'test', themes: [theme], entrants: [entrant('v2-shared', 'shared', 40), entrant('v2-active', 'active', 20), entrant('v2-unplayed', 'active-unplayed', 60)] };
  const catalog = makeRankCatalog(inactive, active);
  const history = [
    historyEntry('shared-vote', 'shared', 'active', 'a', 10, 20),
    historyEntry('inactive-vote', 'inactive-played', 'active', 'b', 30, 20),
  ];
  const selected = selectPersonalCurveCatalog(catalog, history);
  assert.equal(selected.some((item) => item.configurationId === 'v1-never'), false, 'unplayed inactive configuration was included');
  assert.equal(selected.some((item) => item.configurationId === 'inactive-played'), true, 'played inactive configuration was omitted');
  const curve = recomputePersonalCurve(history, { catalog: selected });
  assert.equal(curve.points.find((point) => point.configurationId === 'shared')?.meanCost, 25, 'shared configuration costs were not pooled across versions');
  assert.equal(curve.points.find((point) => point.configurationId === 'active-unplayed')?.status, 'pending', 'unplayed active configuration was not shown as pending');
}

async function testInactiveVersionRestore(): Promise<void> {
  const inactive = makeSchedulerCatalog(2, 1, false, [], 'rank-catalog-v1', 'v1');
  const active = makeSchedulerCatalog(2, 1, false, [], 'rank-catalog-v2', 'v2');
  const catalog = makeRankCatalog(inactive, active);
  const oldA = inactive.entrants[0]!;
  const oldB = inactive.entrants[1]!;
  const theme = inactive.themes[0]!;
  const assignment: MatchupAssignment = {
    matchupId: pairId(theme.id, oldA.levelId, oldB.levelId),
    benchmarkVersion: inactive.benchmarkVersion,
    theme,
    a: { playableRef: oldA.levelId },
    b: { playableRef: oldB.levelId },
    assignedAt: 'now',
  };
  const store = new BenchmarkLocalStore(createMemoryStorage(), 'inactive-restore');
  store.setUnfinishedMatchup({ kind: 'assignment', assignment, playCounts: { a: 0, b: 0 } });
  const api = new CatalogBenchmarkApi(catalog, store);
  const participantId = store.participantId;
  await api.recordPlay({ matchupId: assignment.matchupId, participantId, side: 'a' });
  await api.recordPlay({ matchupId: assignment.matchupId, participantId, side: 'b' });
  assert.equal(store.snapshot.unfinishedMatchup?.assignment.benchmarkVersion, inactive.benchmarkVersion);
  await api.submitVote({ matchupId: assignment.matchupId, participantId, verdict: 'a-better', playCounts: { a: 1, b: 1 } });
  const reveal = await api.reveal(assignment.matchupId, participantId);
  assert.equal(reveal.a.levelId, oldA.levelId);
  assert.equal(reveal.b.levelId, oldB.levelId);
  assert.equal(store.snapshot.completedMatchups.length, 1);
}

function testVersionedVoteValidation(): void {
  const inactive = makeSchedulerCatalog(2, 1, false, [], 'rank-catalog-v1', 'v1');
  const active = makeSchedulerCatalog(2, 1, false, [], 'rank-catalog-v2', 'v2');
  const catalog = makeRankCatalog(inactive, active);
  const oldTheme = inactive.themes[0]!;
  const oldA = inactive.entrants[0]!;
  const oldB = inactive.entrants[1]!;
  const base = { matchupId: pairId(oldTheme.id, oldA.levelId, oldB.levelId), participantId: 'participant', benchmarkVersion: inactive.benchmarkVersion, themeId: oldTheme.id, aLevelId: oldA.levelId, bLevelId: oldB.levelId, verdict: 'both-good', playCounts: { a: 1, b: 1 } };
  assert.equal(validateRankVoteBody(base, catalog).ok, true, 'valid inactive-version vote was rejected');
  assert.equal(validateRankVoteBody({ ...base, benchmarkVersion: 'rank-catalog-v9' }, catalog).ok, false, 'unknown benchmark version was accepted');
  assert.equal(validateRankVoteBody({ ...base, benchmarkVersion: active.benchmarkVersion }, catalog).ok, false, 'version/entrant mismatch was accepted');
}

async function testApisAndStateMachine(): Promise<void> {
  const machine = new ComparisonStateMachine(assignment());
  machine.startA(); machine.completeRun('a'); machine.startB(); machine.completeRun('b');
  machine.submit('both-good');
  assert.equal(machine.state.kind, 'submitting');
  assert.throws(() => machine.reveal({ matchupId: 'other', a: undefined as never, b: undefined as never, vote: undefined as never }));

  assert.equal(createFixtureCatalog('production').entrants.length, 0);
  const fixture = createDevelopmentFixtureApi();
  const first = await fixture.nextMatchup({ participantId: 'p1' });
  assert.ok(first);
  await assert.rejects(() => fixture.reveal(first!.matchupId, 'p1'), /vote/);
  await fixture.recordPlay({ matchupId: first!.matchupId, side: 'a', participantId: 'p1' });
  await fixture.recordPlay({ matchupId: first!.matchupId, side: 'b', participantId: 'p1' });
  const vote = await fixture.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'a-better', playCounts: { a: 1, b: 1 } });
  assert.equal((await fixture.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'a-better', playCounts: { a: 1, b: 1 } })).matchupId, vote.matchupId);
  await assert.rejects(() => fixture.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'b-better', playCounts: { a: 1, b: 1 } }), /different vote/);

  const version = makeSchedulerCatalog(4, 2);
  const catalog = makeRankCatalog(version);
  const storage = createMemoryStorage();
  const store = new BenchmarkLocalStore(storage, 'catalog-api');
  const api = new CatalogBenchmarkApi(catalog, store);
  const participantId = store.participantId;
  const next = await api.nextMatchup({ participantId });
  assert.ok(next);
  await api.recordPlay({ matchupId: next!.matchupId, participantId, side: 'a' });
  await api.recordPlay({ matchupId: next!.matchupId, participantId, side: 'b' });
  await api.submitVote({ matchupId: next!.matchupId, participantId, verdict: 'a-better', playCounts: { a: 1, b: 1 } });
  const reveal = await api.reveal(next!.matchupId, participantId);
  assert.equal(reveal.a.dataClass, 'eligible');
  assert.equal(store.snapshot.history.length, 1);
  api.restoreAssignment(next!, participantId, { a: 0, b: 0 });
  assert.equal(store.snapshot.unfinishedMatchup?.kind, 'ready-to-vote');
  assert.deepEqual(store.snapshot.unfinishedMatchup?.playCounts, { a: 1, b: 1 });
}

function simulateAssignments(catalog: RankCatalogVersion, count: number, participantId = 'test-participant'): { judged: Judged[]; exposures: Record<string, number>; themes: string[]; assignments: { themeId: string; levelIdA: string; levelIdB: string }[] } {
  const judged: Judged[] = [];
  const exposures: Record<string, number> = {};
  const themes: string[] = [];
  const assignments: { themeId: string; levelIdA: string; levelIdB: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = scheduleOne(catalog, judged, exposures, themes, participantId);
    assert.ok(next);
    assignments.push(next!);
    appendJudgment(catalog, next!, judged, exposures, themes);
  }
  return { judged, exposures, themes, assignments };
}

function scheduleOne(catalog: RankCatalogVersion, judged: readonly Judged[], exposures: Readonly<Record<string, number>>, themes: readonly string[], participantId = 'test-participant') {
  return nextScheduledMatchup(catalog, participantId, { judged, levelExposureCounts: exposures, themeHistory: themes });
}

function appendJudgment(catalog: RankCatalogVersion, matchup: { themeId: string; levelIdA: string; levelIdB: string }, judged: Judged[], exposures: Record<string, number>, themes: string[]): void {
  const a = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdA)!;
  const b = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdB)!;
  const aIndex = Number(a.configurationId.split('-').at(-1));
  const bIndex = Number(b.configurationId.split('-').at(-1));
  judged.push({ matchupId: pairId(matchup.themeId, matchup.levelIdA, matchup.levelIdB), relative: aIndex >= bIndex ? 'a' : 'b' });
  exposures[a.levelId] = (exposures[a.levelId] ?? 0) + 1;
  exposures[b.levelId] = (exposures[b.levelId] ?? 0) + 1;
  themes.push(matchup.themeId);
}

function curveFromJudged(catalog: RankCatalogVersion, judged: readonly Judged[]) {
  const entrants = new Map(catalog.entrants.map((entrant) => [entrant.levelId, entrant]));
  const history = judged.flatMap((item): PersonalHistoryEntry[] => {
    const parsed = parseMatchup(item.matchupId);
    const a = parsed ? entrants.get(parsed.levelA) : undefined;
    const b = parsed ? entrants.get(parsed.levelB) : undefined;
    return a && b ? [historyEntry(item.matchupId, a.configurationId, b.configurationId, item.relative, a.generationCost, b.generationCost)] : [];
  });
  return recomputePersonalCurve(history, { catalog: catalog.entrants });
}

function historyEntry(matchupId: string, aConfigurationId: string, bConfigurationId: string, relative: RelativeOutcome, aCost = costForId(aConfigurationId), bCost = costForId(bConfigurationId)): PersonalHistoryEntry {
  const vote: MatchupVote = {
    matchupId,
    aEntrantId: `${aConfigurationId}-level`,
    bEntrantId: `${bConfigurationId}-level`,
    verdict: relative === 'a' ? 'a-better' : relative === 'b' ? 'b-better' : 'both-good',
    relative,
    playCounts: { a: 1, b: 1 },
    submittedAt: '',
  };
  return { vote, a: { configurationId: aConfigurationId, modelName: aConfigurationId, workflowName: 'solo', generationCost: aCost }, b: { configurationId: bConfigurationId, modelName: bConfigurationId, workflowName: 'solo', generationCost: bCost } };
}

function makeSchedulerCatalog(configurations: number, themeCount: number, sameConfiguration = false, featuredConfigurations: readonly number[] = [], benchmarkVersion = 'rank-catalog-v1', slotPrefix = ''): RankCatalogVersion {
  const themes = Array.from({ length: themeCount }, (_, index) => ({ id: `${slotPrefix ? `${slotPrefix}-` : ''}theme-${String.fromCharCode(97 + index)}`, title: `Theme ${index}`, summary: 'S', prompt: 'P' }));
  const entrants: RankCatalogEntrant[] = themes.flatMap((theme) => Array.from({ length: configurations }, (_, index) => ({
    levelId: `${theme.id}-${index}`,
    themeId: theme.id,
    configurationId: sameConfiguration ? 'shared' : `configuration-${index}`,
    modelName: sameConfiguration ? 'Shared' : `Model ${index}`,
    workflowName: 'solo',
    generationCost: index + 1,
    ...(featuredConfigurations.includes(index) ? { featured: true } : {}),
  })));
  return { benchmarkVersion, generatedAt: 'test', themes, entrants };
}

function makeRankCatalog(...versions: readonly RankCatalogVersion[]): RankCatalog {
  const selected = versions.length > 0 ? versions : [makeSchedulerCatalog(2, 1)];
  return { generatedAt: 'test', activeBenchmarkVersion: selected.at(-1)!.benchmarkVersion, versions: selected };
}

function configurationPairFromMatchup(catalog: RankCatalogVersion, matchupId: string): string {
  const parsed = parseMatchup(matchupId)!;
  const a = catalog.entrants.find((entrant) => entrant.levelId === parsed.levelA)!;
  const b = catalog.entrants.find((entrant) => entrant.levelId === parsed.levelB)!;
  return [a.configurationId, b.configurationId].sort().join('__');
}

function parseMatchup(matchupId: string): { themeId: string; levelA: string; levelB: string } | null {
  const separator = matchupId.indexOf(':');
  const pair = separator >= 0 ? matchupId.slice(separator + 1) : '';
  const divider = pair.indexOf('__');
  return separator > 0 && divider > 0 ? { themeId: matchupId.slice(0, separator), levelA: pair.slice(0, divider), levelB: pair.slice(divider + 2) } : null;
}

function configCost(configurationId: string): number { return Number(configurationId.split('-').at(-1)) + 1; }
function costForId(configurationId: string): number { return configurationId.startsWith('configuration-') ? configCost(configurationId) : 1; }

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  runBenchmarkDomainTests().then(() => console.log('Benchmark domain tests passed.')).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
