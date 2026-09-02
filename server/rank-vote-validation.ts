import { allCatalogEntrants, allCatalogThemes, rankCatalog, type RankCatalog, type RankCatalogEntrant, type RankCatalogTheme } from '../src/benchmark/catalog.js';
import { pairId } from '../src/benchmark/scheduler.js';
import { VOTE_SOURCES, type BenchmarkDataClass, type VoteSource, type VoteVerdict } from '../src/benchmark/types.js';

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
  'source',
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
  /** Absent from clients deployed before custom matches recorded votes; those
   * were all ranked votes, so an absent field reads as `rank`. */
  source?: VoteSource;
};

export type ValidatedRankVote = RankVoteBody & {
  source: VoteSource;
  aEntrant: RankCatalogEntrant;
  bEntrant: RankCatalogEntrant;
  theme: RankCatalogTheme;
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

  const source = value.source === undefined ? 'rank' : value.source;
  if (typeof source !== 'string' || !VOTE_SOURCES.includes(source as VoteSource)) return invalid(400, 'Unknown vote source');

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
      source: source as VoteSource,
      aEntrant,
      bEntrant,
      theme,
    },
  };
}

/**
 * The data class stamped on a stored vote, taken as the strongest of the three
 * inputs. An experimental theme is one the scheduler never serves, so the only
 * way to vote on it is a custom match; such a vote is stored as `unranked` and
 * no leaderboard counts it.
 */
export function resolveDataClass(a: RankCatalogEntrant, b: RankCatalogEntrant, theme: RankCatalogTheme): BenchmarkDataClass {
  const strength: Record<BenchmarkDataClass, number> = { eligible: 0, unranked: 1, rehearsal: 2, development: 3 };
  const classOf = (entrant: RankCatalogEntrant): BenchmarkDataClass => entrant.dataClass && entrant.dataClass in strength ? entrant.dataClass : 'eligible';
  const classes: BenchmarkDataClass[] = [classOf(a), classOf(b), theme.experimental === true ? 'unranked' : 'eligible'];
  return classes.reduce((strongest, candidate) => (strength[candidate] > strength[strongest] ? candidate : strongest), 'eligible');
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
