/* Runnable with Node's type stripping and kept dependency-free so the domain
 * can be verified without a browser or a test framework. */
// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import { createDevelopmentFixtureApi, createFixtureCatalog } from './fixtures';
import { CatalogBenchmarkApi, completedMatchupsFromVotes, exposureCountsFromVotes, playCountsFor, revealFromVote } from './catalog-api';
import { compareIds, nextScheduledMatchup, pairId, parsePairId } from './scheduler';
import { mapVerdict, type ComparisonState, type MatchupAssignment, type MatchupVote, type RelativeOutcome } from './types';
import { findCatalogEntrant, findCatalogTheme, rankCatalog, schedulingPool, type RankCatalog, type RankCatalogEntrant, type RankCatalogTheme, type SchedulingPool } from './catalog';
import { selectPersonalCurveCatalog } from '../app/rank';
import { CustomMatchController } from '../app/match';
import { parseRoute, routePath } from '../app/router';
import { validateRankVoteBody } from '../../server/rank-vote-validation';
import { ComparisonStateMachine } from './state';
import { BENCHMARK_PARTICIPANT_ID_KEY, BENCHMARK_STORAGE_VERSION, BenchmarkLocalStore, createMemoryStorage, type StorageEnvelope } from './storage';
import { recomputePersonalCurve, type PersonalHistoryEntry } from './personal-curve';

declare const process: { argv: string[]; exitCode?: number } | undefined;

type Judged = { matchupId: string; relative: RelativeOutcome; aLevelId?: string };

function assignment(): MatchupAssignment {
  return { matchupId: 'm', theme: { id: 't', title: 'T', summary: 'S', prompt: 'P' }, a: { playableRef: 'a' }, b: { playableRef: 'b' }, assignedAt: 'now' };
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
  testPairIdCanonicalization();
  testStorageUndo();
  testSchedulerCoverage();
  testFeaturedFirstMatchup();
  testFeaturedThemeCoverage();
  testNewcomerAnchoring();
  testNewThemeCoverage();
  testEachPairServedOnceThenExhausts();
  testServedSideOrderCanonicalization();
  testParticipantSequencesDiverge();
  testThemeBalance();
  testConvergenceAndStability();
  testSameConfigurationPairs();
  testRetiredEntrantsNotScheduled();
  testSchedulingPoolExcludesRetired();
  testRetiredThemesNeverScheduledButRevealable();
  testHistoricalVoteJudgedNeverReserved();
  testFeaturedOpenerStaysBroadside();
  await testPoolMatchupServesValidPair();
  testSchedulerIgnoresUnknownHistory();
  testCatalogDerivedHistory();
  testRetiredEntrantReveal();
  testPersonalCurveCatalogExcludesRetired();
  await testReloadPreservesMatchupAndPlayState();
  await testCatalogChangesRefreshReveals();
  testVoteValidationIsCatalogWide();
  await testApisAndStateMachine();
  testMatchRouteParsing();
  testCustomMatchController();
  testCustomMatchPlaysPersist();
}

/** A tiny catalog: two shared-theme entrants (`lv-a`, `lv-b`) and one in a
 * second theme (`lv-c`), enough to exercise the custom-match controller. */
function customMatchCatalog(): RankCatalog {
  return {
    generatedAt: 'test',
    themes: [
      { id: 'th', title: 'Theme', summary: 'S', prompt: 'P' },
      { id: 'th2', title: 'Theme two', summary: 'S2', prompt: 'P2' },
    ],
    entrants: [
      { levelId: 'lv-a', themeId: 'th', configurationId: 'c1', modelName: 'M1', workflowName: 'solo', generationCost: 1 },
      { levelId: 'lv-b', themeId: 'th', configurationId: 'c2', modelName: 'M2', workflowName: 'solo', generationCost: 2 },
      { levelId: 'lv-c', themeId: 'th2', configurationId: 'c3', modelName: 'M3', workflowName: 'solo', generationCost: 3 },
    ],
  };
}

function testCustomMatchPlaysPersist(): void {
  const catalog = customMatchCatalog();
  const storage = createMemoryStorage();
  // Match plays share the normal benchmark envelope (default key), so a fresh
  // store over the same storage reads what the match wrote.
  const store = () => new BenchmarkLocalStore(storage);

  const first = new CustomMatchController('lv-a', 'lv-b', catalog, store());
  first.launch('a');
  first.completeRun('a', 100);
  first.launch('b');
  first.completeRun('b', 250);
  first.submit('a-better');

  // Plays are recorded to the shared levelRuns; the vote is never written to history.
  const persisted = store().snapshot;
  assert.equal(persisted.levelRuns.find((run) => run.levelId === 'lv-a')?.score, 100);
  assert.equal(persisted.levelRuns.find((run) => run.levelId === 'lv-b')?.score, 250);
  assert.equal(persisted.history.length, 0);

  // A fresh controller for the same pair resumes at ready-to-vote from the shared runs.
  const resumed = new CustomMatchController('lv-a', 'lv-b', catalog, store());
  const resumedState: ComparisonState | null = resumed.state;
  assert.equal(resumedState?.kind, 'ready-to-vote');
  assert.equal(resumed.bestScore('lv-b'), 250);
}

function testMatchRouteParsing(): void {
  const parse = (search: string) => parseRoute({ pathname: '/match', search } as Location);
  assert.deepEqual(parse('?a=lv-x&b=lv-y'), { kind: 'match', a: 'lv-x', b: 'lv-y', playSide: undefined });
  assert.deepEqual(parse('?a=lv-x&b=lv-y&play=b'), { kind: 'match', a: 'lv-x', b: 'lv-y', playSide: 'b' });
  // `play` is only honoured for the two sides; anything else is dropped.
  const droppedPlay = parse('?a=lv-x&b=lv-y&play=c');
  assert.equal(droppedPlay.kind === 'match' ? droppedPlay.playSide : 'unreachable', undefined);
  // Missing params still resolve to the match route so the page can explain the shape.
  assert.deepEqual(parse(''), { kind: 'match', a: undefined, b: undefined, playSide: undefined });
  assert.equal(routePath({ kind: 'match', a: 'lv-x', b: 'lv-y' }), '/match');
}

function testCustomMatchController(): void {
  const catalog = customMatchCatalog();

  assert.deepEqual(new CustomMatchController(undefined, 'lv-a', catalog).error, { kind: 'missing' });
  assert.deepEqual(new CustomMatchController('lv-a', 'lv-a', catalog).error, { kind: 'same', id: 'lv-a' });
  assert.deepEqual(new CustomMatchController('lv-a', 'nope', catalog).error, { kind: 'unknown', ids: ['nope'] });

  const shared = new CustomMatchController('lv-a', 'lv-b', catalog);
  assert.equal(shared.valid, true);
  assert.equal(shared.sharedTheme?.id, 'th');
  assert.equal(shared.assignment?.theme.id, 'th');
  assert.equal(shared.assignment?.matchupId, 'custom:lv-a:lv-b');

  // A full match runs entirely in memory: play both, vote, reveal.
  shared.launch('a');
  shared.completeRun('a', 100);
  shared.launch('b');
  shared.completeRun('b', 250);
  const readyState: ComparisonState | null = shared.state;
  assert.equal(readyState?.kind, 'ready-to-vote');
  assert.equal(shared.bestScore('lv-a'), 100);
  shared.submit('a-better');
  const revealState: ComparisonState | null = shared.state;
  assert.ok(revealState && revealState.kind === 'reveal');
  assert.equal(revealState.reveal.vote.verdict, 'a-better');
  assert.equal(revealState.reveal.a.levelId, 'lv-a');
  assert.equal(revealState.reveal.b.generationCost, 2);

  // Cross-theme falls back to the synthetic placeholder but keeps each side's real theme available.
  const cross = new CustomMatchController('lv-a', 'lv-c', catalog);
  assert.equal(cross.valid, true);
  assert.equal(cross.sharedTheme, null);
  assert.equal(cross.assignment?.theme.id, 'custom');
  assert.equal(cross.themeForSide('a')?.id, 'th');
  assert.equal(cross.themeForSide('b')?.id, 'th2');
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
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-2')?.status, 'contested');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-3')?.status, 'contested');
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
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-0')?.status, 'contested', 'the unfeatured island is capped at contested');
  assert.equal(curve.points.find((point) => point.configurationId === 'configuration-1')?.status, 'contested', 'the unfeatured island is capped at contested');
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
  // Two comparison islands: {0,1} and {2,3} judged within themselves in both themes.
  const judged: Judged[] = [
    { matchupId: pairId('theme-a', 'theme-a-0', 'theme-a-1'), relative: 'a', aLevelId: 'theme-a-0' },
    { matchupId: pairId('theme-b', 'theme-b-0', 'theme-b-1'), relative: 'a', aLevelId: 'theme-b-0' },
    { matchupId: pairId('theme-a', 'theme-a-2', 'theme-a-3'), relative: 'a', aLevelId: 'theme-a-2' },
    { matchupId: pairId('theme-b', 'theme-b-2', 'theme-b-3'), relative: 'a', aLevelId: 'theme-b-2' },
  ];
  const next = scheduleOne(catalog, judged, {}, []);
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
  assert.equal(BENCHMARK_STORAGE_VERSION, 3);
  const storage = createMemoryStorage();
  storage.setItem('legacy', JSON.stringify({ participantId: 'old', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] }));
  assert.notEqual(new BenchmarkLocalStore(storage, 'legacy').participantId, 'old', 'unversioned data is discarded');
  storage.removeItem?.(BENCHMARK_PARTICIPANT_ID_KEY);
  storage.setItem('old-envelope', JSON.stringify({ version: 2, data: { participantId: 'old', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] } }));
  const salvaged = new BenchmarkLocalStore(storage, 'old-envelope');
  assert.equal(salvaged.participantId, 'old', 'stale envelopes preserve the participant id');
  assert.equal(storage.getItem(BENCHMARK_PARTICIPANT_ID_KEY), 'old', 'stale envelope participant id is persisted separately');
  storage.setItem('old-kind', JSON.stringify({ version: 2, data: { participantId: 'old', unfinishedMatchup: { kind: 'a-complete', assignment: assignment(), playCounts: { a: 1, b: 0 } }, completedMatchups: [], history: [], themeHistory: [], levelExposureCounts: {}, revealedEntrants: [] } }));
  assert.deepEqual(new BenchmarkLocalStore(storage, 'old-kind').snapshot.history, []);

  const dedicatedWinsStorage = createMemoryStorage();
  dedicatedWinsStorage.setItem('dedicated-wins', JSON.stringify({ version: 2, data: { participantId: 'envelope-participant', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] } }));
  dedicatedWinsStorage.setItem(BENCHMARK_PARTICIPANT_ID_KEY, 'dedicated-participant');
  assert.equal(new BenchmarkLocalStore(dedicatedWinsStorage, 'dedicated-wins').participantId, 'dedicated-participant', 'dedicated participant id wins over the envelope');

  const freshStorage = createMemoryStorage();
  const fresh = new BenchmarkLocalStore(freshStorage, 'fresh');
  assert.ok(fresh.participantId);
  assert.equal(freshStorage.getItem(BENCHMARK_PARTICIPANT_ID_KEY), fresh.participantId, 'a fresh participant id is persisted separately');
  assert.equal(new BenchmarkLocalStore(freshStorage, 'fresh').participantId, fresh.participantId);

  const currentStorage = createMemoryStorage();
  const current = new BenchmarkLocalStore(currentStorage, 'current');
  current.save({ participantId: 'current-participant' });
  const envelope = JSON.parse(currentStorage.getItem('current')!) as StorageEnvelope;
  assert.equal(envelope.version, 3);
  assert.deepEqual(Object.keys(envelope.data).sort(), ['history', 'levelRuns', 'participantId']);
  assert.equal(currentStorage.getItem(BENCHMARK_PARTICIPANT_ID_KEY), 'current-participant');
  assert.equal(new BenchmarkLocalStore(currentStorage, 'current').participantId, 'current-participant');
}

function testPairIdCanonicalization(): void {
  for (const theme of rankCatalog.themes) {
    const entrants = rankCatalog.entrants.filter((entrant) => entrant.themeId === theme.id);
    for (let firstIndex = 0; firstIndex < entrants.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < entrants.length; secondIndex += 1) {
        const first = entrants[firstIndex]!.levelId;
        const second = entrants[secondIndex]!.levelId;
        const localeOrdered = [first, second].sort((left, right) => left.localeCompare(right));
        assert.equal(compareIds(first, second), Math.sign(first.localeCompare(second)), `${first} and ${second} changed ordering`);
        assert.equal(pairId(theme.id, first, second), `${theme.id}:${localeOrdered[0]}__${localeOrdered[1]}`, `${theme.id} pair id changed`);
      }
    }
  }
}

function testStorageUndo(): void {
  const store = new BenchmarkLocalStore(createMemoryStorage(), 'undo');
  const vote: MatchupVote = { matchupId: 'm', aEntrantId: 'a', bEntrantId: 'b', verdict: 'a-better', relative: 'a', playCounts: { a: 2, b: 1 }, submittedAt: 'now' };
  store.save({ history: [vote] });
  const undone = store.undoLastVerdict();
  assert.equal(undone?.verdict, 'a-better');
  assert.equal(store.snapshot.history.length, 0);
}

function testSchedulerCoverage(): void {
  const catalog = makeSchedulerCatalog(4, 2);
  const { judged, exposures, themes, assignments } = simulateAssignments(catalog, 4);
  assert.equal(assignments.length, 4);
  assert.equal(new Set(assignments.flatMap((matchup) => [matchup.levelIdA, matchup.levelIdB])).size, 8, 'cold start covers every level');
  const firstByTheme = new Map<string, { themeId: string; levelIdA: string; levelIdB: string }>();
  for (const matchup of assignments) if (!firstByTheme.has(matchup.themeId)) firstByTheme.set(matchup.themeId, matchup);
  const openerPairs = [...firstByTheme.values()].map((matchup) => configurationPairFromMatchup(catalog, pairId(matchup.themeId, matchup.levelIdA, matchup.levelIdB)));
  assert.equal(new Set(openerPairs).size, catalog.themes.length, 'theme openers spread across distinct configuration pairs');
  const curve = curveFromJudged(catalog, judged);
  assert.equal(curve.placedCount, 4, 'the four-vote cold-start graph places every configuration');
  assert.ok(Object.values(exposures).every((count) => count === 1));
}

function testFeaturedFirstMatchup(): void {
  const catalog = makeSchedulerCatalog(4, 3, false, [0, 1]);
  const isFeaturedPair = (matchup: { levelIdA: string; levelIdB: string }) =>
    [matchup.levelIdA, matchup.levelIdB].every((levelId) => catalog.entrants.find((entrant) => entrant.levelId === levelId)!.featured === true);
  const openerThemes = new Set<string>();
  for (const participantId of ['participant-a', 'participant-b', 'participant-c', 'participant-d', 'participant-e', 'participant-f']) {
    const { assignments } = simulateAssignments(catalog, 6, participantId);
    assert.equal(isFeaturedPair(assignments[0]!), true, `${participantId} did not open on the featured pairing`);
    openerThemes.add(assignments[0]!.themeId);
    const firstByTheme = new Map<string, { levelIdA: string; levelIdB: string }>();
    for (const matchup of assignments) if (!firstByTheme.has(matchup.themeId)) firstByTheme.set(matchup.themeId, matchup);
    assert.equal(firstByTheme.size, catalog.themes.length);
    const featuredOpeners = [...firstByTheme.values()].filter(isFeaturedPair).length;
    assert.equal(featuredOpeners, 1, 'the featured pairing opens one theme only, not every theme');
  }
  assert.ok(openerThemes.size > 1, 'the featured opener theme varies across participants');
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

function testEachPairServedOnceThenExhausts(): void {
  const catalog = makeSchedulerCatalog(4, 2, false, [0, 1]);
  const judged: Judged[] = [];
  const seen = new Set<string>();
  const totalPairs = 12;
  for (let index = 0; index < totalPairs; index += 1) {
    const next = nextScheduledMatchup(catalog, 'exhaustion', { judged });
    assert.ok(next, `pair ${index} was available`);
    const id = pairId(next!.themeId, next!.levelIdA, next!.levelIdB);
    assert.equal(seen.has(id), false, `pair ${id} was served twice`);
    seen.add(id);
    appendJudgment(catalog, next!, judged, {}, []);
  }
  assert.equal(nextScheduledMatchup(catalog, 'exhaustion', { judged }), null, 'an exhausted catalog stops scheduling instead of repeating pairs');
}

function testServedSideOrderCanonicalization(): void {
  const catalog = makeSchedulerCatalog(4, 1);
  const theme = catalog.themes[0]!.id;
  const level = (index: number) => `${theme}-${index}`;
  // Ground truth: 0 beats 1 and 2; 2 and 1 beat 3. The undecided pairs are
  // 0-3 (lopsided) and 1-2 (near-even, most informative).
  const canonical: Judged[] = [
    { matchupId: pairId(theme, level(0), level(1)), relative: 'a', aLevelId: level(0) },
    { matchupId: pairId(theme, level(0), level(2)), relative: 'a', aLevelId: level(0) },
    { matchupId: pairId(theme, level(2), level(3)), relative: 'a', aLevelId: level(2) },
    { matchupId: pairId(theme, level(1), level(3)), relative: 'a', aLevelId: level(1) },
  ];
  // The same outcomes with some matchups served with flipped sides.
  const flipped: Judged[] = [
    { matchupId: pairId(theme, level(0), level(1)), relative: 'b', aLevelId: level(1) },
    canonical[1]!,
    { matchupId: pairId(theme, level(2), level(3)), relative: 'b', aLevelId: level(3) },
    canonical[3]!,
  ];
  const fromCanonical = nextScheduledMatchup(catalog, 'sides', { judged: canonical });
  const fromFlipped = nextScheduledMatchup(catalog, 'sides', { judged: flipped });
  assert.ok(fromCanonical);
  assert.equal(pairId(theme, fromCanonical!.levelIdA, fromCanonical!.levelIdB), pairId(theme, level(1), level(2)), 'the near-even pair is scheduled as most informative');
  assert.deepEqual(fromFlipped, fromCanonical, 'served side order does not change how outcomes are interpreted');
}

function testParticipantSequencesDiverge(): void {
  const catalog = makeSchedulerCatalog(6, 1);
  const sequences = ['participant-a', 'participant-b', 'participant-c', 'participant-d'].map((participantId) =>
    simulateAssignments(catalog, 3, participantId).judged.map((item) => item.matchupId).join('|'));
  assert.ok(new Set(sequences).size > 1, 'coverage visits the same pairs in the same order for every participant');
}

function testThemeBalance(): void {
  const catalog = makeSchedulerCatalog(4, 2);
  const simulated = simulateAssignments(catalog, 12);
  const counts = new Map<string, number>();
  for (const item of simulated.judged) {
    const themeId = parsePairId(item.matchupId)?.themeId;
    assert.ok(themeId);
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
  assert.ok(fresh.points.some((point) => point.status === 'contested'), 'a one-vote frontier flip is contested');
}

function testSameConfigurationPairs(): void {
  const catalog = makeSchedulerCatalog(2, 1, true);
  assert.equal(nextScheduledMatchup(catalog, 'same-config', { judged: [] }), null, 'same-configuration levels are never paired');
}

function testRetiredEntrantsNotScheduled(): void {
  const theme = { id: 'retired-theme', title: 'Retired', summary: 'S', prompt: 'P' };
  const catalog: SchedulingPool = {
    themes: [theme],
    entrants: [
      entrant('retired-theme-a1b2', 'configuration-a', true),
      entrant('retired-theme-c3d4', 'configuration-b'),
      entrant('retired-theme-e5f6', 'configuration-c'),
    ],
  };
  const next = nextScheduledMatchup(catalog, 'retired-test');
  assert.ok(next);
  assert.equal([next!.levelIdA, next!.levelIdB].includes('retired-theme-a1b2'), false, 'retired entrants must not be scheduled');

  function entrant(levelId: string, configurationId: string, retired = false): RankCatalogEntrant {
    return { levelId, themeId: theme.id, configurationId, modelName: configurationId, workflowName: 'solo', generationCost: 1, ...(retired ? { retired: true } : {}) };
  }
}

function testSchedulingPoolExcludesRetired(): void {
  const pool = schedulingPool(rankCatalog);
  const poolThemeIds = new Set(pool.themes.map((theme) => theme.id));
  // The pool holds every non-retired theme.
  for (const themeId of ['mass-driver', 'skyhook', 'broadside', 'strandline']) {
    assert.ok(poolThemeIds.has(themeId), `${themeId} should be in the scheduling pool`);
  }
  // Retired themes are absent from the pool entirely, entrants included.
  for (const themeId of ['hull-run', 'mass-driver-detailed']) {
    assert.equal(poolThemeIds.has(themeId), false, `${themeId} is retired and must not be in the pool`);
    assert.equal(pool.entrants.some((entrant) => entrant.themeId === themeId), false, `${themeId} entrants must not be in the pool`);
  }
  // Experimental themes stay in the catalog for browsing but are never scheduled.
  for (const themeId of ['purse-pursuit', 'speedsolve']) {
    assert.ok(findCatalogTheme(rankCatalog, themeId)?.experimental, `${themeId} carries the experimental flag`);
    assert.equal(poolThemeIds.has(themeId), false, `${themeId} is experimental and must not be in the pool`);
    assert.equal(pool.entrants.some((entrant) => entrant.themeId === themeId), false, `${themeId} entrants must not be in the pool`);
  }
  // Every pooled entrant belongs to a pooled, non-retired theme, and is not itself retired.
  const poolLevelIds = pool.entrants.map((entrant) => entrant.levelId);
  assert.equal(new Set(poolLevelIds).size, poolLevelIds.length, 'the pool must not duplicate entrants');
  for (const entrant of pool.entrants) {
    assert.ok(poolThemeIds.has(entrant.themeId), `pooled entrant ${entrant.levelId} has an unpooled theme`);
    assert.notEqual(entrant.retired, true, `retired entrant ${entrant.levelId} must not be in the pool`);
  }
}

function testRetiredThemesNeverScheduledButRevealable(): void {
  const pool = schedulingPool(rankCatalog);
  const retiredThemes = new Set(['hull-run', 'mass-driver-detailed']);
  // Drive the pool scheduler to exhaustion for a participant; no served pair may
  // come from an unscheduled theme.
  const judged: Judged[] = [];
  for (let index = 0; index < 400; index += 1) {
    const next = nextScheduledMatchup(pool, 'retired-guard', { judged });
    if (!next) break;
    assert.equal(retiredThemes.has(next.themeId), false, `a retired theme (${next.themeId}) was scheduled`);
    judged.push({ matchupId: pairId(next.themeId, next.levelIdA, next.levelIdB), relative: 'a', aLevelId: next.levelIdA });
  }
  assert.ok(judged.length > 0, 'the pool served at least one matchup');

  // Retired levels and their content are gone, but a returning voter's stored
  // vote on a retired theme still reconstructs into a reveal.
  const a = findCatalogEntrant(rankCatalog, 'mass-driver-detailed-k4wz');
  const b = findCatalogEntrant(rankCatalog, 'mass-driver-detailed-uk78');
  assert.ok(a && b, 'retired-theme entrants remain resolvable in the catalog');
  assert.ok(findCatalogTheme(rankCatalog, 'mass-driver-detailed')?.retired, 'mass-driver-detailed carries the retired flag');
  const vote: MatchupVote = {
    matchupId: pairId('mass-driver-detailed', a!.levelId, b!.levelId),
    aEntrantId: a!.levelId,
    bEntrantId: b!.levelId,
    verdict: 'a-better',
    relative: 'a',
    playCounts: { a: 1, b: 1 },
    submittedAt: 'now',
  };
  const derived = completedMatchupsFromVotes(rankCatalog, [vote]);
  assert.equal(derived.length, 1, 'a vote on a retired theme still counts as judged history');
  assert.equal(revealFromVote(rankCatalog, vote)?.a.levelId, a!.levelId, 'a retired-theme vote remains revealable');
}

function testHistoricalVoteJudgedNeverReserved(): void {
  // A returning voter's past decision on a mass-driver pair. (The published
  // mass-driver entrants are 7rkv/bczy/vyxj/wo4m; the pair below is real.)
  const a = findCatalogEntrant(rankCatalog, 'mass-driver-7rkv');
  const b = findCatalogEntrant(rankCatalog, 'mass-driver-bczy');
  assert.ok(a && b, 'mass-driver entrants are in the catalog');
  const matchupId = pairId('mass-driver', a!.levelId, b!.levelId);
  const vote: MatchupVote = {
    matchupId,
    aEntrantId: a!.levelId,
    bEntrantId: b!.levelId,
    verdict: 'a-better',
    relative: 'a',
    playCounts: { a: 1, b: 1 },
    submittedAt: 'now',
  };
  assert.equal(completedMatchupsFromVotes(rankCatalog, [vote]).length, 1, 'a mass-driver pair vote counts as judged');

  const pool = schedulingPool(rankCatalog);
  const judged: Judged[] = [{ matchupId, relative: 'a', aLevelId: a!.levelId }];
  for (let index = 0; index < 60; index += 1) {
    const next = nextScheduledMatchup(pool, 'returning-voter', { judged });
    if (!next) break;
    const id = pairId(next.themeId, next.levelIdA, next.levelIdB);
    assert.notEqual(id, matchupId, 'the already-judged pair is never re-served');
    judged.push({ matchupId: id, relative: 'a', aLevelId: next.levelIdA });
  }
}

function testFeaturedOpenerStaysBroadside(): void {
  const pool = schedulingPool(rankCatalog);
  // The featured opener is participant-salted across all featured pairs, but for
  // a given participant it stays anchored to its theme as the pool grows.
  // participant-1 lands on the broadside Fable-solo vs Sol-solo pairing.
  const opener = nextScheduledMatchup(pool, 'participant-1', { judged: [] });
  assert.ok(opener);
  assert.equal(
    pairId(opener!.themeId, opener!.levelIdA, opener!.levelIdB),
    pairId('broadside', 'broadside-b4kd', 'broadside-b6ej'),
    'a fresh participant still opens on the broadside featured pair',
  );

  // Whatever theme hosts a participant's opener, it is always a featured pair and
  // never migrates onto a retired theme.
  const retiredThemes = new Set(['hull-run', 'mass-driver-detailed']);
  for (let index = 0; index < 60; index += 1) {
    const first = nextScheduledMatchup(pool, `opener-participant-${index}`, { judged: [] });
    assert.ok(first);
    assert.equal(retiredThemes.has(first!.themeId), false, 'the featured opener never comes from a retired theme');
    const ea = findCatalogEntrant(rankCatalog, first!.levelIdA);
    const eb = findCatalogEntrant(rankCatalog, first!.levelIdB);
    assert.equal(ea?.featured === true && eb?.featured === true, true, 'the opener is a featured pairing');
  }
}

async function testPoolMatchupServesValidPair(): Promise<void> {
  // The served assignment resolves to a real catalog theme and pair, drawn from
  // the scheduling pool, with no version marker on the assignment.
  const store = new BenchmarkLocalStore(createMemoryStorage(), 'served-pair');
  store.save({ participantId: 'participant-1' });
  const api = new CatalogBenchmarkApi(rankCatalog, store);
  const matchup = await api.nextMatchup({ participantId: 'participant-1' });
  assert.ok(matchup);
  assert.equal('benchmarkVersion' in matchup!, false, 'the assignment carries no benchmark version');
  const parsed = parsePairId(matchup!.matchupId);
  assert.ok(parsed);
  assert.equal(matchup!.theme.id, parsed!.themeId, 'the served theme matches the pair id');
  const a = findCatalogEntrant(rankCatalog, matchup!.a.playableRef);
  const b = findCatalogEntrant(rankCatalog, matchup!.b.playableRef);
  assert.ok(a && b, 'both served levels resolve in the catalog');
  assert.equal(a!.themeId, matchup!.theme.id);
  assert.equal(b!.themeId, matchup!.theme.id);
  // participant-1 opens on the broadside featured pair.
  assert.equal(matchup!.theme.id, 'broadside', 'participant-1 opens on a broadside pair');
}

function testSchedulerIgnoresUnknownHistory(): void {
  const active = makeSchedulerCatalog(2, 1, false, [], 'active');
  const foreign = makeSchedulerCatalog(2, 1, false, [], 'foreign');
  const next = nextScheduledMatchup(active, 'ignores-unknown-history', { judged: [] });
  assert.ok(next);
  assert.ok(active.entrants.some((entrant) => entrant.levelId === next!.levelIdA));
  assert.ok(active.entrants.some((entrant) => entrant.levelId === next!.levelIdB));
  assert.equal(foreign.entrants.some((entrant) => entrant.levelId === next!.levelIdA), false);
  assert.equal(foreign.entrants.some((entrant) => entrant.levelId === next!.levelIdB), false);
  // Judged history that names levels outside the pool is ignored, and the
  // scheduler still serves a valid pair from the active pool.
  const foreignMatchup = pairId(foreign.themes[0]!.id, foreign.entrants[0]!.levelId, foreign.entrants[1]!.levelId);
  const afterForeignHistory = nextScheduledMatchup(active, 'ignores-unknown-history', {
    judged: [{ matchupId: foreignMatchup, relative: 'a' }],
  });
  assert.ok(afterForeignHistory);
  assert.ok(active.entrants.some((entrant) => entrant.levelId === afterForeignHistory!.levelIdA));
  assert.ok(active.entrants.some((entrant) => entrant.levelId === afterForeignHistory!.levelIdB));
}

function testCatalogDerivedHistory(): void {
  const version = makeSchedulerCatalog(2, 1);
  const catalog = makeRankCatalog(version);
  const theme = version.themes[0]!;
  const a = version.entrants[0]!;
  const b = version.entrants[1]!;
  const vote: MatchupVote = { matchupId: pairId(theme.id, a.levelId, b.levelId), aEntrantId: a.levelId, bEntrantId: b.levelId, verdict: 'a-better', relative: 'tie', playCounts: { a: 1, b: 1 }, submittedAt: 'now' };
  const derived = completedMatchupsFromVotes(catalog, [vote]);
  assert.equal(derived.length, 1);
  assert.equal(derived[0]!.vote.relative, 'a', 'relative outcome is derived from the stored verdict');
  assert.deepEqual(exposureCountsFromVotes(catalog, [vote]), { [a.levelId]: 1, [b.levelId]: 1 });

  const missing = { ...vote, matchupId: pairId(theme.id, 'retired-a', b.levelId) };
  assert.equal(completedMatchupsFromVotes(catalog, [missing]).length, 0, 'votes for retired levels are skipped at read time');
  const missingTheme = { ...vote, matchupId: pairId('retired-theme', a.levelId, b.levelId) };
  assert.equal(completedMatchupsFromVotes(catalog, [missingTheme]).length, 0, 'votes for retired themes are skipped at read time');
}

function testRetiredEntrantReveal(): void {
  const retired = rankCatalog.entrants.find((entrant) => entrant.retired)!;
  const live = rankCatalog.entrants.find((entrant) => entrant.themeId === retired.themeId && !entrant.retired)!;
  assert.ok(retired && live);
  const theme = rankCatalog.themes.find((candidate) => candidate.id === retired.themeId)!;
  const vote: MatchupVote = {
    matchupId: pairId(theme.id, retired.levelId, live.levelId),
    aEntrantId: retired.levelId,
    bEntrantId: live.levelId,
    verdict: 'a-better',
    relative: 'a',
    playCounts: { a: 1, b: 1 },
    submittedAt: 'now',
  };
  const reveal = revealFromVote(rankCatalog, vote);
  assert.ok(reveal, 'a vote involving a retired entrant remains revealable');
  assert.equal(reveal!.a.levelId, retired.levelId);
  assert.ok(reveal!.a.run, 'retired entrant retains its generation record for reveal');
}

function testPersonalCurveCatalogExcludesRetired(): void {
  // The personal-curve base is the scheduling pool (non-retired entrants) plus any
  // configuration the participant actually judged. A configuration living only on
  // retired entrants stays out unless it was judged.
  const theme = { id: 'curve-theme', title: 'Curve', summary: 'S', prompt: 'P' };
  const entrant = (levelId: string, configurationId: string, generationCost: number, retired = false): RankCatalogEntrant => ({ levelId, themeId: theme.id, configurationId, modelName: configurationId, workflowName: 'solo', generationCost, ...(retired ? { retired: true } : {}) });
  const catalog: RankCatalog = {
    generatedAt: 'test',
    themes: [theme],
    entrants: [
      entrant('live-shared', 'shared', 40),
      entrant('retired-shared', 'shared', 10, true),
      entrant('retired-played', 'retired-played-config', 30, true),
      entrant('retired-never', 'retired-never-config', 50, true),
      entrant('live-active', 'active', 20),
      entrant('live-unplayed', 'active-unplayed', 60),
    ],
  };
  const history = [
    historyEntry('shared-vote', 'shared', 'active', 'a', 10, 20),
    historyEntry('retired-vote', 'retired-played-config', 'active', 'b', 30, 20),
  ];
  const selected = selectPersonalCurveCatalog(catalog, history);
  assert.equal(selected.some((item) => item.configurationId === 'retired-never-config'), false, 'an unplayed retired-only configuration was included');
  assert.equal(selected.some((item) => item.configurationId === 'retired-played-config'), true, 'a judged retired-only configuration was omitted');
  const curve = recomputePersonalCurve(history, { catalog: selected });
  assert.equal(curve.points.find((point) => point.configurationId === 'shared')?.meanCost, 25, 'shared configuration costs were not pooled across live and retired entrants');
  assert.equal(curve.points.find((point) => point.configurationId === 'active-unplayed')?.status, 'pending', 'unplayed active configuration was not shown as pending');
}

async function testReloadPreservesMatchupAndPlayState(): Promise<void> {
  const catalog = makeRankCatalog(makeSchedulerCatalog(4, 1));
  const storage = createMemoryStorage();
  const firstStore = new BenchmarkLocalStore(storage, 'reload');
  const firstApi = new CatalogBenchmarkApi(catalog, firstStore);
  const participantId = firstStore.participantId;
  const first = await firstApi.nextMatchup({ participantId });
  assert.ok(first);
  firstStore.recordLevelRun(first!.a.playableRef, 42);

  const reloadedStore = new BenchmarkLocalStore(storage, 'reload');
  const reloadedApi = new CatalogBenchmarkApi(catalog, reloadedStore);
  const second = await reloadedApi.nextMatchup({ participantId: reloadedStore.participantId });
  assert.ok(second);
  assert.equal(second!.matchupId, first!.matchupId, 'the scheduler reproduces the same current matchup after reload');
  assert.deepEqual(playCountsFor(second!, reloadedStore.snapshot.levelRuns), { a: 1, b: 0 }, 'local runs pre-fill one side after reload');
}

async function testCatalogChangesRefreshReveals(): Promise<void> {
  const originalPool = makeSchedulerCatalog(2, 1);
  const original = makeRankCatalog({
    ...originalPool,
    entrants: originalPool.entrants.map((entrant, index) => ({ ...entrant, thumbnailPath: `/old-${index}.png` })),
  });
  const storage = createMemoryStorage();
  const store = new BenchmarkLocalStore(storage, 'thumbnail-refresh');
  const api = new CatalogBenchmarkApi(original, store);
  const participantId = store.participantId;
  const matchup = await api.nextMatchup({ participantId });
  assert.ok(matchup);
  await api.recordPlay({ matchupId: matchup!.matchupId, participantId, side: 'a' });
  await api.recordPlay({ matchupId: matchup!.matchupId, participantId, side: 'b' });
  await api.submitVote({ matchupId: matchup!.matchupId, participantId, verdict: 'a-better', playCounts: { a: 1, b: 1 } });

  const changedPool = {
    ...originalPool,
    entrants: original.entrants.map((entrant, index) => ({ ...entrant, thumbnailPath: `/new-${index}.avif` })),
  };
  const changedCatalog = makeRankCatalog(changedPool);
  const reloaded = new BenchmarkLocalStore(storage, 'thumbnail-refresh');
  const derived = completedMatchupsFromVotes(changedCatalog, reloaded.snapshot.history);
  const savedVote = reloaded.snapshot.history[0]!;
  assert.equal(derived[0]!.reveal.a.levelId, savedVote.aEntrantId, 'reconstructed reveal preserves the original side order');
  assert.equal(derived[0]!.reveal.b.levelId, savedVote.bEntrantId, 'reconstructed reveal preserves the original side order');
  assert.equal(derived[0]!.reveal.a.thumbnailPath, changedPool.entrants.find((entrant) => entrant.levelId === savedVote.aEntrantId)?.thumbnailPath);
  assert.equal(derived[0]!.reveal.b.thumbnailPath, changedPool.entrants.find((entrant) => entrant.levelId === savedVote.bEntrantId)?.thumbnailPath);
}

function testVoteValidationIsCatalogWide(): void {
  const themeA = makeSchedulerCatalog(2, 1, false, [], 'a');
  const themeB = makeSchedulerCatalog(2, 1, false, [], 'b');
  const catalog = makeRankCatalog(themeA, themeB);
  const theme = themeA.themes[0]!;
  const a = themeA.entrants[0]!;
  const b = themeA.entrants[1]!;
  const otherEntrant = themeB.entrants.find((entrant) => entrant.themeId === themeB.themes[0]!.id)!;
  const base = { matchupId: pairId(theme.id, a.levelId, b.levelId), participantId: 'participant', themeId: theme.id, aLevelId: a.levelId, bLevelId: b.levelId, verdict: 'both-good', playCounts: { a: 1, b: 1 } };
  // benchmarkVersion is now optional and ignored: absent is valid, any non-empty
  // string is valid, and entrant resolution is catalog-wide.
  assert.equal(validateRankVoteBody(base, catalog).ok, true, 'vote without benchmarkVersion was rejected');
  assert.equal(validateRankVoteBody({ ...base, benchmarkVersion: 'rank-catalog-v1' }, catalog).ok, true, 'vote with a benchmarkVersion was rejected');
  assert.equal(validateRankVoteBody({ ...base, benchmarkVersion: 'rank-catalog-v9' }, catalog).ok, true, 'a stale benchmarkVersion was rejected');
  assert.equal(validateRankVoteBody({ ...base, benchmarkVersion: '' }, catalog).ok, false, 'a present-but-empty benchmarkVersion was accepted');
  assert.equal(validateRankVoteBody({ ...base, bLevelId: otherEntrant.levelId }, catalog).ok, false, 'a cross-theme entrant pairing was accepted');
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
  assert.deepEqual(store.snapshot.levelRuns, [], 'matchup state is not written into local storage');
}

function simulateAssignments(catalog: SchedulingPool, count: number, participantId = 'test-participant'): { judged: Judged[]; exposures: Record<string, number>; themes: string[]; assignments: { themeId: string; levelIdA: string; levelIdB: string }[] } {
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

function scheduleOne(catalog: SchedulingPool, judged: readonly Judged[], exposures: Readonly<Record<string, number>>, themes: readonly string[], participantId = 'test-participant') {
  return nextScheduledMatchup(catalog, participantId, { judged });
}

function appendJudgment(catalog: SchedulingPool, matchup: { themeId: string; levelIdA: string; levelIdB: string }, judged: Judged[], exposures: Record<string, number>, themes: string[]): void {
  const a = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdA)!;
  const b = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdB)!;
  const aIndex = Number(a.configurationId.split('-').at(-1));
  const bIndex = Number(b.configurationId.split('-').at(-1));
  judged.push({ matchupId: pairId(matchup.themeId, matchup.levelIdA, matchup.levelIdB), relative: aIndex >= bIndex ? 'a' : 'b', aLevelId: matchup.levelIdA });
  exposures[a.levelId] = (exposures[a.levelId] ?? 0) + 1;
  exposures[b.levelId] = (exposures[b.levelId] ?? 0) + 1;
  themes.push(matchup.themeId);
}

function curveFromJudged(catalog: SchedulingPool, judged: readonly Judged[]) {
  const entrants = new Map(catalog.entrants.map((entrant) => [entrant.levelId, entrant]));
  const history = judged.flatMap((item): PersonalHistoryEntry[] => {
    const parsed = parsePairId(item.matchupId);
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

function makeSchedulerCatalog(configurations: number, themeCount: number, sameConfiguration = false, featuredConfigurations: readonly number[] = [], slotPrefix = ''): SchedulingPool {
  const themes: RankCatalogTheme[] = Array.from({ length: themeCount }, (_, index) => ({ id: `${slotPrefix ? `${slotPrefix}-` : ''}theme-${String.fromCharCode(97 + index)}`, title: `Theme ${index}`, summary: 'S', prompt: 'P' }));
  const entrants: RankCatalogEntrant[] = themes.flatMap((theme) => Array.from({ length: configurations }, (_, index) => ({
    levelId: `${theme.id}-${index}`,
    themeId: theme.id,
    configurationId: sameConfiguration ? 'shared' : `configuration-${index}`,
    modelName: sameConfiguration ? 'Shared' : `Model ${index}`,
    workflowName: 'solo',
    generationCost: index + 1,
    ...(featuredConfigurations.includes(index) ? { featured: true } : {}),
  })));
  return { themes, entrants };
}

function makeRankCatalog(...pools: readonly SchedulingPool[]): RankCatalog {
  const selected = pools.length > 0 ? pools : [makeSchedulerCatalog(2, 1)];
  return { generatedAt: 'test', themes: selected.flatMap((pool) => pool.themes), entrants: selected.flatMap((pool) => pool.entrants) };
}

function configurationPairFromMatchup(catalog: SchedulingPool, matchupId: string): string {
  const parsed = parsePairId(matchupId)!;
  const a = catalog.entrants.find((entrant) => entrant.levelId === parsed.levelA)!;
  const b = catalog.entrants.find((entrant) => entrant.levelId === parsed.levelB)!;
  return [a.configurationId, b.configurationId].sort().join('__');
}

function configCost(configurationId: string): number { return Number(configurationId.split('-').at(-1)) + 1; }
function costForId(configurationId: string): number { return configurationId.startsWith('configuration-') ? configCost(configurationId) : 1; }

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  runBenchmarkDomainTests().then(() => console.log('Benchmark domain tests passed.')).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
