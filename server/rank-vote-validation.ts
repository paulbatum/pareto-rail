import { allCatalogEntrants, allCatalogThemes, rankCatalog, type RankCatalog, type RankCatalogEntrant } from '../src/benchmark/catalog.js';
import { pairId } from '../src/benchmark/scheduler.js';
import type { BenchmarkDataClass, VoteVerdict } from '../src/benchmark/types.js';

export const RANK_VOTE_SCHEMA_VERSION = 2;
export const MAX_RANK_VOTE_BODY_BYTES = 8 * 1024;

const MAX_STRING_LENGTH = 200;
const MAX_DATABASE_INT = 2_147_483_647;
const VERDICTS = new Set<VoteVerdict>(['a-better', 'b-better', 'both-good', 'both-bad']);
const TOP_LEVEL_KEYS = [
  'matchupId',
  'participantId',
  'benchmarkVersion',
  'themeId',
  'aLevelId',
  'bLevelId',
  'verdict',
  'playCounts',
  'bestScores',
  'assignedAt',
  'clientSubmittedAt',
  'idempotencyKey',
] as const;

type RankVoteBody = {
  matchupId: string;
  participantId: string;
  benchmarkVersion?: string;
  themeId: string;
  aLevelId: string;
  bLevelId: string;
  verdict: VoteVerdict;
  playCounts: { a: number; b: number };
  bestScores?: { a?: number; b?: number };
  assignedAt?: string;
  clientSubmittedAt?: string;
  idempotencyKey?: string;
};

export type ValidatedRankVote = RankVoteBody & {
  aEntrant: RankCatalogEntrant;
  bEntrant: RankCatalogEntrant;
};

export type RankVoteValidationResult =
  | { ok: true; value: ValidatedRankVote }
  | { ok: false; status: 400 | 422; error: string };

export function validateRankVoteBody(value: unknown, catalog: RankCatalog = rankCatalog): RankVoteValidationResult {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, TOP_LEVEL_KEYS)) {
    return invalid(400, 'Malformed vote payload');
  }

  const matchupId = stringField(value.matchupId);
  const participantId = stringField(value.participantId);
  const themeId = stringField(value.themeId);
  const aLevelId = stringField(value.aLevelId);
  const bLevelId = stringField(value.bLevelId);
  if (!matchupId || !participantId || !themeId || !aLevelId || !bLevelId) {
    return invalid(400, 'Malformed vote payload');
  }

  const benchmarkVersion = value.benchmarkVersion === undefined ? undefined : stringField(value.benchmarkVersion);
  if (value.benchmarkVersion !== undefined && !benchmarkVersion) {
    return invalid(400, 'Malformed vote payload');
  }

  const verdict = value.verdict;
  if (typeof verdict !== 'string' || !VERDICTS.has(verdict as VoteVerdict)) {
    return invalid(400, 'Unknown verdict');
  }

  const parsedPlayCounts = parsePairOfInts(value.playCounts, true);
  if (!parsedPlayCounts || parsedPlayCounts.a === undefined || parsedPlayCounts.b === undefined) return invalid(400, 'Malformed play counts');
  const playCounts = { a: parsedPlayCounts.a, b: parsedPlayCounts.b };

  const bestScores = value.bestScores === undefined ? undefined : parsePairOfInts(value.bestScores, false);
  if (value.bestScores !== undefined && !bestScores) return invalid(400, 'Malformed best scores');

  const assignedAt = optionalDateString(value.assignedAt);
  const clientSubmittedAt = optionalDateString(value.clientSubmittedAt);
  if (value.assignedAt !== undefined && !assignedAt) return invalid(400, 'Malformed assignedAt');
  if (value.clientSubmittedAt !== undefined && !clientSubmittedAt) return invalid(400, 'Malformed clientSubmittedAt');

  const idempotencyKey = optionalString(value.idempotencyKey);
  if (value.idempotencyKey !== undefined && !idempotencyKey) return invalid(400, 'Malformed idempotencyKey');

  const theme = allCatalogThemes(catalog).find((candidate) => candidate.id === themeId);
  const aEntrant = allCatalogEntrants(catalog).find((entrant) => entrant.levelId === aLevelId);
  const bEntrant = allCatalogEntrants(catalog).find((entrant) => entrant.levelId === bLevelId);
  if (!theme || !aEntrant || !bEntrant || aEntrant.themeId !== themeId || bEntrant.themeId !== themeId || aLevelId === bLevelId) {
    return invalid(422, 'Matchup is not in the published catalog');
  }
  if (matchupId !== pairId(themeId, aLevelId, bLevelId)) {
    return invalid(422, 'Matchup id does not match the presented pair');
  }
  if (playCounts.a < 1 || playCounts.b < 1) {
    return invalid(422, 'Both entrants must have a completed play');
  }

  return {
    ok: true,
    value: {
      matchupId,
      participantId,
      themeId,
      aLevelId,
      bLevelId,
      verdict: verdict as VoteVerdict,
      playCounts,
      ...(benchmarkVersion ? { benchmarkVersion } : {}),
      ...(bestScores ? { bestScores } : {}),
      ...(assignedAt ? { assignedAt } : {}),
      ...(clientSubmittedAt ? { clientSubmittedAt } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      aEntrant,
      bEntrant,
    },
  };
}

export function resolveDataClass(a: RankCatalogEntrant, b: RankCatalogEntrant): BenchmarkDataClass {
  const strength: Record<BenchmarkDataClass, number> = { eligible: 0, rehearsal: 1, development: 2 };
  const classOf = (entrant: RankCatalogEntrant): BenchmarkDataClass => entrant.dataClass && entrant.dataClass in strength ? entrant.dataClass : 'eligible';
  const aClass = classOf(a);
  const bClass = classOf(b);
  return strength[aClass] >= strength[bClass] ? aClass : bClass;
}

function parsePairOfInts(value: unknown, required: boolean): { a?: number; b?: number } | undefined {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, ['a', 'b'])) return undefined;
  const a = optionalDatabaseInt(value.a, required);
  const b = optionalDatabaseInt(value.b, required);
  if (a === undefined && b === undefined && !required) return {};
  if (required && (a === undefined || b === undefined)) return undefined;
  return { ...(a === undefined ? {} : { a }), ...(b === undefined ? {} : { b }) };
}

function optionalDatabaseInt(value: unknown, required: boolean): number | undefined {
  if (value === undefined && !required) return undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATABASE_INT ? value : undefined;
}

function optionalDateString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING_LENGTH || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING_LENGTH ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return optionalString(value);
}

function invalid(status: 400 | 422, error: string): RankVoteValidationResult {
  return { ok: false, status, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
