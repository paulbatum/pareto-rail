import { createHash } from 'node:crypto';
import { RankDataClass, RankRelative, RankSentiment, RankVerdict, type PrismaClient } from '../src/generated/prisma/client.js';
import { mapVerdict, type VoteVerdict } from '../src/benchmark/types.js';
import { RANK_VOTE_SCHEMA_VERSION, type ValidatedRankVote, resolveDataClass } from './rank-vote-validation.js';

export interface RankVoteResponse {
  ok: true;
  duplicate: boolean;
}

export interface RankStatsResponse {
  ok: true;
  votes: number;
  matchups: number;
  latestVoteAt: string | null;
}

export interface RankHandlerResult<Body> {
  status: 200;
  body: Body;
}

const verdictToPrisma: Record<VoteVerdict, RankVerdict> = {
  'a-better': RankVerdict.A_BETTER,
  'b-better': RankVerdict.B_BETTER,
  'both-good': RankVerdict.BOTH_GOOD,
  'both-bad': RankVerdict.BOTH_BAD,
};

const relativeToPrisma = {
  a: RankRelative.A,
  b: RankRelative.B,
  tie: RankRelative.TIE,
} as const;

const sentimentToPrisma = {
  positive: RankSentiment.POSITIVE,
  negative: RankSentiment.NEGATIVE,
} as const;

const dataClassToPrisma = {
  eligible: RankDataClass.ELIGIBLE,
  rehearsal: RankDataClass.REHEARSAL,
  development: RankDataClass.DEVELOPMENT,
} as const;

export async function recordRankVote(input: ValidatedRankVote, prisma: PrismaClient): Promise<RankHandlerResult<RankVoteResponse>> {
  const mapping = mapVerdict(input.verdict);
  const participantHash = hashParticipant(input.participantId);
  const [levelIdFirst, levelIdSecond] = [input.aLevelId, input.bLevelId].sort((left, right) => left.localeCompare(right));
  let duplicate = false;

  await prisma.$transaction(async (transaction) => {
    await transaction.rankMatchup.upsert({
      where: { id: input.matchupId },
      update: {},
      create: {
        id: input.matchupId,
        benchmarkVersion: input.benchmarkVersion,
        themeId: input.themeId,
        levelIdFirst,
        levelIdSecond,
      },
    });

    const inserted = await transaction.rankVote.createMany({
      data: {
        matchupId: input.matchupId,
        participantHash,
        schemaVersion: RANK_VOTE_SCHEMA_VERSION,
        aLevelId: input.aLevelId,
        bLevelId: input.bLevelId,
        verdict: verdictToPrisma[input.verdict],
        relative: relativeToPrisma[mapping.relative],
        sentiment: mapping.sentiment ? sentimentToPrisma[mapping.sentiment] : undefined,
        playCountA: input.playCounts.a,
        playCountB: input.playCounts.b,
        bestScoreA: input.bestScores?.a,
        bestScoreB: input.bestScores?.b,
        dataClass: dataClassToPrisma[resolveDataClass(input.aEntrant, input.bEntrant)],
        assignedAt: input.assignedAt ? new Date(input.assignedAt) : undefined,
        clientSubmittedAt: input.clientSubmittedAt ? new Date(input.clientSubmittedAt) : undefined,
        idempotencyKey: input.idempotencyKey,
      },
      skipDuplicates: true,
    });
    duplicate = inserted.count === 0;
  });

  return { status: 200, body: { ok: true, duplicate } };
}

export async function readRankStats(prisma: PrismaClient): Promise<RankHandlerResult<RankStatsResponse>> {
  const [votes, matchups, latestVote] = await Promise.all([
    prisma.rankVote.count(),
    prisma.rankMatchup.count(),
    prisma.rankVote.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  return {
    status: 200,
    body: {
      ok: true,
      votes,
      matchups,
      latestVoteAt: latestVote?.createdAt.toISOString() ?? null,
    },
  };
}

export function hashParticipant(participantId: string, salt = process.env.PARTICIPANT_SALT): string {
  if (!salt) throw new Error('PARTICIPANT_SALT is not configured');
  return createHash('sha256').update(`${salt}${participantId}`, 'utf8').digest('hex');
}
