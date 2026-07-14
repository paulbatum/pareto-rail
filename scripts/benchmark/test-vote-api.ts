// Runnable against the local Prisma dev database without a test framework.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPrismaClient } from '../../server/prisma.ts';
import { handleRankStatsRequest, handleRankVotesRequest } from '../../server/rank-http.ts';
import { hashParticipant } from '../../server/rank-votes.ts';
import { activeCatalogVersion, rankCatalog } from '../../src/benchmark/catalog.ts';
import { pairId } from '../../src/benchmark/scheduler.ts';

const prisma = getPrismaClient();
const version = activeCatalogVersion(rankCatalog);
const theme = version?.themes[0];
const entrants = version?.entrants.filter((entrant) => entrant.themeId === theme?.id).slice(0, 2) ?? [];
assert.ok(theme && entrants.length === 2, 'the published catalog needs two entrants for a vote test');

const [a, b] = entrants;
const participantId = `vote-api-${randomUUID()}`;
const matchupId = pairId(theme.id, a.levelId, b.levelId);
const payload = {
  matchupId,
  participantId,
  benchmarkVersion: rankCatalog.activeBenchmarkVersion,
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

const forged = await vote({ ...payload, matchupId: `${theme.id}:forged__pair` });
assert.equal(forged.status, 422);

const otherTheme = version?.themes.find((candidate) => candidate.id !== theme?.id);
const otherEntrant = version?.entrants.find((entrant) => entrant.themeId === otherTheme?.id);
assert.ok(otherTheme && otherEntrant);
const wrongTheme = await vote({ ...payload, bLevelId: otherEntrant.levelId });
assert.equal(wrongTheme.status, 422);

const zeroPlay = await vote({ ...payload, participantId: `vote-api-${randomUUID()}`, playCounts: { a: 0, b: 1 } });
assert.equal(zeroPlay.status, 422);

const statsAfter = await stats();
assert.equal(statsAfter.votes, statsBefore.votes + 1, 'stats did not count the new vote');
assert.ok(statsAfter.matchups >= statsBefore.matchups && statsAfter.matchups > 0, 'stats did not expose matchup count');
assert.ok(statsAfter.latestVoteAt, 'stats did not expose the latest vote timestamp');

await prisma.$disconnect();
console.log('Vote API tests passed.');

async function vote(body: unknown): Promise<Response> {
  return handleRankVotesRequest(
    new Request('http://localhost/api/rank/votes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
