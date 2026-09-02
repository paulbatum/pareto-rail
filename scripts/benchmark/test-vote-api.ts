// Runnable against the local Prisma dev database without a test framework.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPrismaClient } from '../../server/prisma.ts';
import { handleRankStatsRequest, handleRankVotesRequest } from '../../server/rank-http.ts';
import { hashIdempotencyKey, hashParticipant } from '../../server/rank-votes.ts';
import { readRankAggregate } from '../../server/rank-aggregate.ts';
import { allCatalogEntrants, allCatalogThemes, rankCatalog, schedulingPool } from '../../src/benchmark/catalog.ts';
import { compareIds, pairId } from '../../src/benchmark/scheduler.ts';

const prisma = getPrismaClient();
const pool = schedulingPool(rankCatalog);
const theme = pool.themes[0];
const entrants = pool.entrants.filter((entrant) => entrant.themeId === theme?.id).slice(0, 2);
assert.ok(theme && entrants.length === 2, 'the published catalog needs two entrants for a vote test');

const [a, b] = entrants;
const participantId = `vote-api-${randomUUID()}`;
const matchupId = pairId(theme.id, a.levelId, b.levelId);
const payload = {
  matchupId,
  participantId,
  benchmarkVersion: 'rank-catalog-v2',
  themeId: theme.id,
  aLevelId: a.levelId,
  bLevelId: b.levelId,
  verdict: 'both-good',
  playCounts: { a: 2, b: 1 },
  bestScores: { a: 1200 },
  assignedAt: new Date().toISOString(),
  clientSubmittedAt: new Date().toISOString(),
  idempotencyKey: `${matchupId}:${participantId}`,
};

/** A payload from a participant no other case has used, with a matching
 * idempotency key: the key carries the unique constraint, so a case that reused
 * one would be recorded as a retry instead of a new vote. */
function freshPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = `vote-api-${randomUUID()}`;
  return { ...payload, participantId: id, idempotencyKey: `${matchupId}:${id}`, ...overrides };
}

const statsBefore = await stats();
const first = await vote(payload);
assert.equal(first.status, 200);
assert.deepEqual(await first.json(), { ok: true, duplicate: false });

const duplicate = await vote(payload);
assert.equal(duplicate.status, 200);
assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });

const participantHash = hashParticipant(participantId);
assert.equal(await prisma.rankVote.count({ where: { matchupId, participantHash } }), 1, 'duplicate submit created another vote');
assert.equal(await prisma.rankMatchup.count({ where: { id: matchupId } }), 1, 'duplicate submit created another matchup');

const storedVote = await prisma.rankVote.findFirstOrThrow({ where: { matchupId, participantHash }, select: { idempotencyKey: true } });
assert.equal(storedVote.idempotencyKey, hashIdempotencyKey(payload.idempotencyKey), 'idempotencyKey not stored as its salted hash');
assert.ok(!storedVote.idempotencyKey?.includes(participantId), 'stored idempotencyKey leaked the raw participant id');

const crossOrigin = await vote(payload, { origin: 'https://evil.example' });
assert.equal(crossOrigin.status, 403, 'cross-origin POST was not rejected');

const nullOrigin = await vote(freshPayload(), { origin: 'null' });
assert.equal(nullOrigin.status, 403, 'opaque null Origin was not rejected');

const sameOrigin = await vote(freshPayload(), { origin: 'http://localhost' });
assert.equal(sameOrigin.status, 200, 'same-origin POST was rejected');

// benchmarkVersion is now optional and ignored: absent is accepted, any string is accepted.
const payloadWithoutVersion = freshPayload();
delete payloadWithoutVersion.benchmarkVersion;
const noVersion = await vote(payloadWithoutVersion);
assert.equal(noVersion.status, 200, 'vote without benchmarkVersion was rejected');

const staleVersion = await vote(freshPayload({ benchmarkVersion: 'rank-catalog-v9' }));
assert.equal(staleVersion.status, 200, 'vote with an ignored benchmarkVersion string was rejected');

const emptyVersion = await vote(freshPayload({ benchmarkVersion: '' }));
assert.equal(emptyVersion.status, 400, 'a present-but-empty benchmarkVersion was accepted');

const forged = await vote({ ...payload, matchupId: `${theme.id}:forged__pair` });
assert.equal(forged.status, 422);

const otherTheme = pool.themes.find((candidate) => candidate.id !== theme?.id);
const otherEntrant = pool.entrants.find((entrant) => entrant.themeId === otherTheme?.id);
assert.ok(otherTheme && otherEntrant);
const wrongTheme = await vote({ ...payload, bLevelId: otherEntrant.levelId });
assert.equal(wrongTheme.status, 422);

const zeroPlay = await vote(freshPayload({ playCounts: { a: 0, b: 1 } }));
assert.equal(zeroPlay.status, 422);

// A vote carries the flow it came from. An absent source reads as a ranked vote,
// which is what every client deployed before custom matches recorded votes sends.
const rankedSource = await prisma.rankVote.findFirstOrThrow({ where: { matchupId, participantHash }, select: { source: true } });
assert.equal(rankedSource.source, 'RANK', 'an absent source was not stored as a ranked vote');

const badSource = await vote(freshPayload({ source: 'leaderboard' }));
assert.equal(badSource.status, 400, 'an unknown vote source was accepted');

const customParticipant = `vote-api-${randomUUID()}`;
const customKey = `${matchupId}:${customParticipant}:${new Date().toISOString()}`;
const customVote = await vote({ ...payload, participantId: customParticipant, idempotencyKey: customKey, source: 'custom' });
assert.equal(customVote.status, 200, 'a custom-match vote was rejected');
const customHash = hashParticipant(customParticipant);
const storedCustom = await prisma.rankVote.findFirstOrThrow({ where: { matchupId, participantHash: customHash }, select: { source: true, dataClass: true } });
assert.equal(storedCustom.source, 'CUSTOM', 'the custom source was not stored');
assert.equal(storedCustom.dataClass, 'ELIGIBLE', 'a custom vote on a ranked theme was not stored as eligible');

// A custom match can repeat a pair the participant already judged. Both rows are
// kept and only the newest counts, so the tally moves by one win, not two.
const aggregateBefore = await readRankAggregate(prisma);
const repeatKey = `${matchupId}:${customParticipant}:${new Date(Date.now() + 1000).toISOString()}`;
const repeat = await vote({ ...payload, participantId: customParticipant, idempotencyKey: repeatKey, verdict: 'a-better', source: 'custom' });
assert.equal(repeat.status, 200);
assert.deepEqual(await repeat.json(), { ok: true, duplicate: false }, 'a repeat vote on the same matchup was refused');
assert.equal(await prisma.rankVote.count({ where: { matchupId, participantHash: customHash } }), 2, 'the superseded vote was not kept');

const aggregateAfter = await readRankAggregate(prisma);
assert.equal(aggregateAfter.votes, aggregateBefore.votes, 'the repeat vote was counted as a second vote');
const [firstLevelId, secondLevelId] = [a.levelId, b.levelId].sort(compareIds);
const pairBefore = aggregateBefore.pairs.find((pair) => pair.a === firstLevelId && pair.b === secondLevelId);
const pairAfter = aggregateAfter.pairs.find((pair) => pair.a === firstLevelId && pair.b === secondLevelId);
assert.ok(pairBefore && pairAfter);
const winsBefore = a.levelId === firstLevelId ? pairBefore.aWins : pairBefore.bWins;
const winsAfter = a.levelId === firstLevelId ? pairAfter.aWins : pairAfter.bWins;
assert.equal(winsAfter, winsBefore + 1, 'the newest verdict did not replace the superseded one');
assert.equal(pairAfter.ties, pairBefore.ties - 1, 'the superseded tie was still counted');

// An experimental theme is one the scheduler never serves, so only a custom match
// can produce a vote on it. The vote is stored and no leaderboard counts it.
const experimentalTheme = allCatalogThemes(rankCatalog).find((candidate) => candidate.experimental === true);
const experimentalEntrants = experimentalTheme ? allCatalogEntrants(rankCatalog).filter((entrant) => entrant.themeId === experimentalTheme.id).slice(0, 2) : [];
assert.ok(experimentalTheme && experimentalEntrants.length === 2, 'the published catalog needs an experimental theme with two entrants');
const [expA, expB] = experimentalEntrants;
const expParticipant = `vote-api-${randomUUID()}`;
const expMatchupId = pairId(experimentalTheme.id, expA.levelId, expB.levelId);
const experimental = await vote({
  ...payload,
  matchupId: expMatchupId,
  participantId: expParticipant,
  themeId: experimentalTheme.id,
  aLevelId: expA.levelId,
  bLevelId: expB.levelId,
  idempotencyKey: `${expMatchupId}:${expParticipant}`,
  source: 'custom',
});
assert.equal(experimental.status, 200, 'a custom vote on an experimental theme was rejected');
const storedExperimental = await prisma.rankVote.findFirstOrThrow({ where: { matchupId: expMatchupId, participantHash: hashParticipant(expParticipant) }, select: { dataClass: true } });
assert.equal(storedExperimental.dataClass, 'UNRANKED', 'an experimental-theme vote was not stored as unranked');
const aggregateWithExperimental = await readRankAggregate(prisma);
assert.equal(aggregateWithExperimental.votes, aggregateAfter.votes, 'an unranked vote reached the public tally');

const statsAfter = await stats();
assert.equal(statsAfter.votes, statsBefore.votes + 7, 'stats did not count the new votes');
assert.ok(statsAfter.matchups >= statsBefore.matchups && statsAfter.matchups > 0, 'stats did not expose matchup count');
assert.ok(statsAfter.latestVoteAt, 'stats did not expose the latest vote timestamp');

await prisma.$disconnect();
console.log('Vote API tests passed.');

async function vote(body: unknown, options: { origin?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.origin !== undefined) headers.origin = options.origin;
  return handleRankVotesRequest(
    new Request('http://localhost/api/rank/votes', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    prisma,
    'vote-api-test',
  );
}

async function stats(): Promise<{ votes: number; matchups: number; latestVoteAt: string | null }> {
  const response = await handleRankStatsRequest(new Request('http://localhost/api/rank/stats'), prisma);
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; votes: number; matchups: number; latestVoteAt: string | null };
  assert.equal(body.ok, true);
  return body;
}
