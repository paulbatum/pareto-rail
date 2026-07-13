/* Runnable with a TypeScript test runner (or Node's type stripping) and kept
 * dependency-free so the domain can be verified without a browser. */
// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
// @ts-ignore Node fs types are intentionally not a production dependency.
import { readFileSync } from 'node:fs';
import { createDevelopmentFixtureApi, createFixtureCatalog } from './fixtures';
import { CatalogBenchmarkApi } from './catalog-api';
import { nextScheduledMatchup, pairId } from './scheduler';
import { mapVerdict, type MatchupAssignment } from './types';
import type { RankCatalog } from './catalog';
import { ComparisonStateMachine } from './state';
import { BenchmarkLocalStore, createMemoryStorage } from './storage';
import { recomputePersonalCurve, paretoFrontier, type PersonalHistoryEntry } from './personal-curve';

declare const process: { argv: string[]; exitCode?: number } | undefined;

function assignment(): MatchupAssignment {
  return { matchupId: 'm', benchmarkVersion: 'v1', theme: { id: 't', title: 'T', summary: 'S', prompt: 'P' }, a: { playableRef: 'a' }, b: { playableRef: 'b' }, assignedAt: 'now' };
}

export async function runBenchmarkDomainTests(): Promise<void> {
  assert.deepEqual(mapVerdict('a-better'), { verdict: 'a-better', relative: 'a' });

  const schedulerCatalog = makeSchedulerCatalog(4);
  const generatedCatalog = JSON.parse(readFileSync(new URL('./rank-catalog.json', import.meta.url), 'utf8')) as RankCatalog;
  assertCoverage(generatedCatalog, generatedCatalog.entrants.length / 2, generatedCatalog.entrants.length);
  assertCoverage(schedulerCatalog, 4, 8);
  assertCoverage(makeSchedulerCatalog(6), 6, 12);
  const catalogStorage = createMemoryStorage();
  const catalogStore = new BenchmarkLocalStore(catalogStorage, 'catalog-api');
  const catalogApi = new CatalogBenchmarkApi(schedulerCatalog, catalogStore);
  const participantId = catalogStore.participantId;
  const catalogAssignment = await catalogApi.nextMatchup({ participantId });
  assert.ok(catalogAssignment);
  await catalogApi.recordPlay({ matchupId: catalogAssignment!.matchupId, participantId, side: 'a' });
  await catalogApi.recordPlay({ matchupId: catalogAssignment!.matchupId, participantId, side: 'b' });
  await catalogApi.submitVote({ matchupId: catalogAssignment!.matchupId, participantId, verdict: 'a-better', playCounts: { a: 1, b: 1 } });
  const catalogReveal = await catalogApi.reveal(catalogAssignment!.matchupId, participantId);
  assert.equal(catalogReveal.a.dataClass, 'eligible');
  assert.equal(catalogStore.snapshot.levelExposureCounts[catalogReveal.a.levelId], 1);
  const refreshedApi = new CatalogBenchmarkApi(schedulerCatalog, new BenchmarkLocalStore(catalogStorage, 'catalog-api'));
  const refreshedAssignment = await refreshedApi.nextMatchup({ participantId });
  assert.ok(refreshedAssignment);
  assert.notEqual(refreshedAssignment!.matchupId, catalogAssignment!.matchupId);

  // Stale rehearsal data (retired theme/levels) must be pruned on restore, not resurrected.
  const staleStore = new BenchmarkLocalStore(catalogStorage, 'catalog-api');
  const staleAssignment = {
    matchupId: 'downpour:asset-a__asset-b',
    benchmarkVersion: 'fixture-downpour-v1',
    theme: { id: 'downpour', title: 'Downpour', summary: 's', prompt: 'p' },
    a: { playableRef: 'asset-a' },
    b: { playableRef: 'asset-b' },
    assignedAt: 'then',
  };
  staleStore.save({
    unfinishedMatchup: { kind: 'assignment', assignment: staleAssignment, playCounts: { a: 0, b: 0 } },
    themeHistory: [...staleStore.snapshot.themeHistory, 'downpour'],
  });
  const knownLevels = new Set(schedulerCatalog.entrants.map((entrant) => entrant.levelId));
  const knownThemes = new Set(schedulerCatalog.themes.map((theme) => theme.id));
  const pruned = staleStore.pruneToCatalog(knownLevels, knownThemes);
  assert.equal(pruned.unfinishedMatchup, undefined);
  assert.ok(!pruned.themeHistory.includes('downpour'));
  assert.equal(pruned.completedMatchups.length, 1);
  assert.equal(pruned.history.length, 1);
  const currentRound = await new CatalogBenchmarkApi(schedulerCatalog, staleStore).nextMatchup({ participantId });
  assert.ok(currentRound);
  assert.notEqual(currentRound!.theme.id, 'downpour');

  assert.deepEqual(mapVerdict('b-better'), { verdict: 'b-better', relative: 'b' });
  assert.equal(mapVerdict('both-good').sentiment, 'positive');
  assert.equal(mapVerdict('both-bad').sentiment, 'negative');

  const machine = new ComparisonStateMachine(assignment());
  machine.startA(); machine.completeRun('a'); machine.startB(); machine.completeRun('b');
  machine.replay('a'); machine.completeRun('a');
  assert.equal(machine.state.kind, 'ready-to-vote');
  machine.submit('both-good');
  assert.equal(machine.state.kind, 'submitting');
  assert.throws(() => machine.reveal({ matchupId: 'other', a: undefined as never, b: undefined as never, vote: undefined as never }));

  const bFirst = new ComparisonStateMachine(assignment());
  bFirst.start('b'); bFirst.completeRun('b');
  assert.equal(bFirst.state.kind, 'assignment');
  bFirst.start('a'); bFirst.completeRun('a');
  assert.equal(bFirst.state.kind, 'ready-to-vote');
  bFirst.replay('a');
  assert.equal(bFirst.state.kind, 'playing-a');
  bFirst.completeRun('a');
  assert.equal(bFirst.state.kind, 'ready-to-vote');
  bFirst.replay('b');
  assert.equal(bFirst.state.kind, 'playing-b');
  bFirst.completeRun('b');
  assert.equal(bFirst.state.kind, 'ready-to-vote');
  assert.throws(() => new ComparisonStateMachine(assignment()).completeRun('a'));
  assert.throws(() => new ComparisonStateMachine(assignment()).replay('a'));

  const storage = createMemoryStorage();
  storage.setItem('x', '{not-json');
  const recovered = new BenchmarkLocalStore(storage, 'x');
  assert.ok(recovered.participantId);
  storage.setItem('v0', JSON.stringify({ participantId: 'p', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] }));
  assert.equal(new BenchmarkLocalStore(storage, 'v0').participantId, 'p');
  storage.setItem('legacy-a-complete', JSON.stringify({
    version: 1,
    data: {
      participantId: 'legacy-participant',
      unfinishedMatchup: { kind: 'a-complete', assignment: assignment(), playCounts: { a: 1, b: 0 } },
      completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [],
    },
  }));
  assert.equal(new BenchmarkLocalStore(storage, 'legacy-a-complete').snapshot.unfinishedMatchup?.kind, 'assignment');

  assert.equal(createFixtureCatalog('production').entrants.length, 0);
  const api = createDevelopmentFixtureApi();
  const first = await api.nextMatchup({ participantId: 'p1' });
  assert.ok(first);
  await assert.rejects(() => api.reveal(first!.matchupId, 'p1'), /vote/);
  await api.recordPlay({ matchupId: first!.matchupId, side: 'a', participantId: 'p1' });
  await api.recordPlay({ matchupId: first!.matchupId, side: 'b', participantId: 'p1' });
  const vote = await api.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'a-better', playCounts: { a: 1, b: 1 } });
  assert.equal((await api.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'a-better', playCounts: { a: 1, b: 1 } })).matchupId, vote.matchupId);
  await assert.rejects(() => api.submitVote({ matchupId: first!.matchupId, participantId: 'p1', verdict: 'b-better', playCounts: { a: 1, b: 1 } }), /different vote/);
  await assert.rejects(() => api.submitVote({ matchupId: first!.matchupId, participantId: 'p2', verdict: 'a-better', playCounts: { a: 1, b: 1 } }), /played/);

  const history: PersonalHistoryEntry[] = [
    { vote, a: { entrantId: vote.aEntrantId, generationCost: 1 }, b: { entrantId: vote.bEntrantId, generationCost: 2 } },
    { vote: { ...vote, matchupId: 'm2', relative: 'tie', verdict: 'both-good' }, a: { entrantId: vote.aEntrantId, generationCost: 3 }, b: { entrantId: vote.bEntrantId, generationCost: 2 } },
    { vote: { ...vote, matchupId: 'm3', relative: 'tie', verdict: 'both-bad' }, a: { entrantId: vote.aEntrantId, generationCost: 1 }, b: { entrantId: vote.bEntrantId, generationCost: 2 } },
  ];
  assert.equal(recomputePersonalCurve(history).unlocked, false);
  assert.equal(recomputePersonalCurve([...history, { ...history[0], vote: { ...history[0].vote, matchupId: 'm4' } }]).unlocked, true);
  assert.ok(paretoFrontier([{ entrantId: 'a', meanCost: 1, rating: 1000 }, { entrantId: 'b', meanCost: 2, rating: 900 }]).some((point) => point.entrantId === 'a'));
}

function makeSchedulerCatalog(levelsPerTheme: number) {
  const themes = [
    { id: 'theme-a', title: 'Theme A', summary: 'A', prompt: 'A' },
    { id: 'theme-b', title: 'Theme B', summary: 'B', prompt: 'B' },
  ];
  const entrants = themes.flatMap((theme) => Array.from({ length: levelsPerTheme }, (_, index) => ({
    levelId: `${theme.id}-${index}`,
    themeId: theme.id,
    configurationId: `configuration-${index}`,
    modelName: `Model ${index}`,
    workflowName: 'solo',
    generationCost: index + 1,
  })));
  return { generatedAt: 'test', themes, entrants };
}

function assertCoverage(catalog: RankCatalog, matchupCount: number, expectedLevels: number) {
  const judgedMatchupIds: string[] = [];
  const levelExposureCounts: Record<string, number> = {};
  const themeHistory: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < matchupCount; index += 1) {
    const next = nextScheduledMatchup(catalog, 'coverage-participant', { judgedMatchupIds, levelExposureCounts, themeHistory });
    assert.ok(next);
    assert.equal(index === 0 || next!.themeId !== themeHistory.at(-1), true);
    assert.equal(levelExposureCounts[next!.levelIdA] ?? 0, 0);
    assert.equal(levelExposureCounts[next!.levelIdB] ?? 0, 0);
    seen.add(next!.levelIdA); seen.add(next!.levelIdB);
    levelExposureCounts[next!.levelIdA] = 1;
    levelExposureCounts[next!.levelIdB] = 1;
    judgedMatchupIds.push(pairId(next!.themeId, next!.levelIdA, next!.levelIdB));
    themeHistory.push(next!.themeId);
  }
  assert.equal(seen.size, expectedLevels);
}

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  runBenchmarkDomainTests().then(() => console.log('Benchmark domain tests passed.')).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
