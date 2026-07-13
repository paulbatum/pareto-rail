/* Runnable with Node's type stripping and kept dependency-free so the domain
 * can be verified without a browser or a test framework. */
// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import { createDevelopmentFixtureApi, createFixtureCatalog } from './fixtures';
import { CatalogBenchmarkApi } from './catalog-api';
import { nextScheduledMatchup, pairId } from './scheduler';
import { mapVerdict, type MatchupAssignment, type MatchupVote, type RelativeOutcome } from './types';
import type { RankCatalog, RankCatalogEntrant } from './catalog';
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
  testStorageVersioning();
  testSchedulerCoverage();
  testNewcomerAnchoring();
  testNewThemeCoverage();
  testThemeBalance();
  testConvergenceAndStability();
  testSameConfigurationPairs();
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

  const catalog = makeSchedulerCatalog(4, 2);
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
}

function simulateAssignments(catalog: RankCatalog, count: number): { judged: Judged[]; exposures: Record<string, number>; themes: string[]; assignments: { themeId: string; levelIdA: string; levelIdB: string }[] } {
  const judged: Judged[] = [];
  const exposures: Record<string, number> = {};
  const themes: string[] = [];
  const assignments: { themeId: string; levelIdA: string; levelIdB: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = scheduleOne(catalog, judged, exposures, themes);
    assert.ok(next);
    assignments.push(next!);
    appendJudgment(catalog, next!, judged, exposures, themes);
  }
  return { judged, exposures, themes, assignments };
}

function scheduleOne(catalog: RankCatalog, judged: readonly Judged[], exposures: Readonly<Record<string, number>>, themes: readonly string[]) {
  return nextScheduledMatchup(catalog, 'test-participant', { judged, levelExposureCounts: exposures, themeHistory: themes });
}

function appendJudgment(catalog: RankCatalog, matchup: { themeId: string; levelIdA: string; levelIdB: string }, judged: Judged[], exposures: Record<string, number>, themes: string[]): void {
  const a = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdA)!;
  const b = catalog.entrants.find((entrant) => entrant.levelId === matchup.levelIdB)!;
  const aIndex = Number(a.configurationId.split('-').at(-1));
  const bIndex = Number(b.configurationId.split('-').at(-1));
  judged.push({ matchupId: pairId(matchup.themeId, matchup.levelIdA, matchup.levelIdB), relative: aIndex >= bIndex ? 'a' : 'b' });
  exposures[a.levelId] = (exposures[a.levelId] ?? 0) + 1;
  exposures[b.levelId] = (exposures[b.levelId] ?? 0) + 1;
  themes.push(matchup.themeId);
}

function curveFromJudged(catalog: RankCatalog, judged: readonly Judged[]) {
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

function makeSchedulerCatalog(configurations: number, themeCount: number, sameConfiguration = false): RankCatalog {
  const themes = Array.from({ length: themeCount }, (_, index) => ({ id: `theme-${String.fromCharCode(97 + index)}`, title: `Theme ${index}`, summary: 'S', prompt: 'P' }));
  const entrants: RankCatalogEntrant[] = themes.flatMap((theme) => Array.from({ length: configurations }, (_, index) => ({
    levelId: `${theme.id}-${index}`,
    themeId: theme.id,
    configurationId: sameConfiguration ? 'shared' : `configuration-${index}`,
    modelName: sameConfiguration ? 'Shared' : `Model ${index}`,
    workflowName: 'solo',
    generationCost: index + 1,
  })));
  return { generatedAt: 'test', themes, entrants };
}

function configurationPairFromMatchup(catalog: RankCatalog, matchupId: string): string {
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
