/* Runnable with a TypeScript test runner (or Node's type stripping) and kept
 * dependency-free so the domain can be verified without a browser. */
// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import { createDevelopmentFixtureApi, createFixtureCatalog } from './fixtures';
import { mapVerdict, type MatchupAssignment } from './types';
import { ComparisonStateMachine } from './state';
import { BenchmarkLocalStore, createMemoryStorage } from './storage';
import { recomputePersonalCurve, paretoFrontier, type PersonalHistoryEntry } from './personal-curve';

declare const process: { argv: string[]; exitCode?: number } | undefined;

function assignment(): MatchupAssignment {
  return { matchupId: 'm', benchmarkVersion: 'v1', theme: { id: 't', title: 'T', summary: 'S', prompt: 'P' }, a: { playableRef: 'a' }, b: { playableRef: 'b' }, assignedAt: 'now' };
}

export async function runBenchmarkDomainTests(): Promise<void> {
  assert.deepEqual(mapVerdict('a-better'), { verdict: 'a-better', relative: 'a' });
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

  const storage = createMemoryStorage();
  storage.setItem('x', '{not-json');
  const recovered = new BenchmarkLocalStore(storage, 'x');
  assert.ok(recovered.participantId);
  storage.setItem('v0', JSON.stringify({ participantId: 'p', completedMatchups: [], history: [], themeHistory: [], revealedEntrants: [] }));
  assert.equal(new BenchmarkLocalStore(storage, 'v0').participantId, 'p');

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
  assert.equal(recomputePersonalCurve(history).unlocked, true);
  assert.ok(paretoFrontier([{ entrantId: 'a', meanCost: 1, rating: 1000 }, { entrantId: 'b', meanCost: 2, rating: 900 }]).some((point) => point.entrantId === 'a'));
}

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  runBenchmarkDomainTests().then(() => console.log('Benchmark domain tests passed.')).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
