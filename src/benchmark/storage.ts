import type { ComparisonState, MatchupVote, RevealPayload } from './types';

export const BENCHMARK_STORAGE_KEY = 'pareto-rail-benchmark';
export const BENCHMARK_STORAGE_VERSION = 2;

export interface CompletedMatchup {
  matchupId: string;
  vote: MatchupVote;
  reveal: RevealPayload;
}

export interface LevelRun {
  levelId: string;
  score?: number;
  completedAt: string;
  count: number;
}

export interface LocalBenchmarkData {
  participantId: string;
  unfinishedMatchup?: ComparisonState;
  levelRuns: LevelRun[];
  completedMatchups: CompletedMatchup[];
  /** Raw votes are retained so display ratings can be recomputed later. */
  history: MatchupVote[];
  themeHistory: string[];
  /** Number of completed judgments in which each level was exposed. */
  levelExposureCounts: Record<string, number>;
  revealedEntrants: RevealPayload['a'][];
}

export interface StorageEnvelope {
  version: number;
  data: LocalBenchmarkData;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const emptyData = (participantId: string): LocalBenchmarkData => ({
  participantId,
  levelRuns: [],
  completedMatchups: [],
  history: [],
  themeHistory: [],
  levelExposureCounts: {},
  revealedEntrants: [],
});

function randomParticipantId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isData(value: unknown): value is LocalBenchmarkData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<LocalBenchmarkData>;
  return typeof data.participantId === 'string' && Array.isArray(data.completedMatchups)
    && Array.isArray(data.history) && Array.isArray(data.themeHistory) && Array.isArray(data.revealedEntrants);
}

/** Versioned, corruption-tolerant local persistence. Storage failures (for
 * example private browsing quota errors) leave the in-memory state usable. */
export class BenchmarkLocalStore {
  private readonly storage: KeyValueStorage;
  private data: LocalBenchmarkData;

  constructor(storage?: KeyValueStorage, key = BENCHMARK_STORAGE_KEY) {
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : new MemoryStorage());
    this.key = key;
    this.data = this.read();
  }

  private readonly key: string;

  private read(): LocalBenchmarkData {
    let raw: string | null = null;
    try { raw = this.storage.getItem(this.key); } catch { /* inaccessible storage */ }
    if (!raw) return emptyData(randomParticipantId());
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && (parsed as StorageEnvelope).version === BENCHMARK_STORAGE_VERSION && isData((parsed as StorageEnvelope).data)) {
        return this.normalize((parsed as StorageEnvelope).data);
      }
    } catch { /* recover below */ }
    return emptyData(randomParticipantId());
  }

  private normalize(data: LocalBenchmarkData): LocalBenchmarkData {
    return {
      participantId: data.participantId || randomParticipantId(),
      unfinishedMatchup: normalizeUnfinishedMatchup(data.unfinishedMatchup),
      completedMatchups: [...data.completedMatchups],
      history: [...data.history],
      themeHistory: [...data.themeHistory],
      levelRuns: mergeLevelRuns(levelRunsFromCompletedMatchups(data.completedMatchups), normalizeLevelRuns(data.levelRuns)),
      levelExposureCounts: exposureCounts(data),
      revealedEntrants: [...data.revealedEntrants],
    };
  }

  get snapshot(): LocalBenchmarkData { return this.normalize(this.data); }
  get participantId(): string { return this.data.participantId; }

  save(data: Partial<LocalBenchmarkData>): LocalBenchmarkData {
    this.data = this.normalize({ ...this.data, ...data });
    const envelope: StorageEnvelope = { version: BENCHMARK_STORAGE_VERSION, data: this.data };
    try { this.storage.setItem(this.key, JSON.stringify(envelope)); } catch { /* memory remains authoritative */ }
    return this.snapshot;
  }

  setUnfinishedMatchup(state: ComparisonState | undefined): LocalBenchmarkData { return this.save({ unfinishedMatchup: state }); }
  recordLevelRun(levelId: string, score: number, completedAt = new Date().toISOString()): LocalBenchmarkData {
    const prior = this.data.levelRuns.find((run) => run.levelId === levelId);
    const run: LevelRun = { levelId, score, completedAt, count: (prior?.count ?? 0) + 1 };
    return this.save({ levelRuns: [...this.data.levelRuns.filter((item) => item.levelId !== levelId), run] });
  }
  completeMatchup(completed: CompletedMatchup): LocalBenchmarkData {
    const prior = this.data.completedMatchups.find((item) => item.matchupId === completed.matchupId);
    const existing = this.data.completedMatchups.filter((item) => item.matchupId !== completed.matchupId);
    const revealed = [...this.data.revealedEntrants, completed.reveal.a, completed.reveal.b]
      .filter((entrant, index, all) => all.findIndex((other) => other.entrantId === entrant.entrantId) === index);
    const levelExposureCounts = { ...this.data.levelExposureCounts };
    if (!prior) {
      for (const levelId of [completed.reveal.a.levelId, completed.reveal.b.levelId]) {
        levelExposureCounts[levelId] = (levelExposureCounts[levelId] ?? 0) + 1;
      }
    }
    return this.save({ completedMatchups: [...existing, completed], history: [...this.data.history.filter((item) => item.matchupId !== completed.matchupId), completed.vote], levelExposureCounts, revealedEntrants: revealed, unfinishedMatchup: undefined });
  }
  /** Remove the newest local judgment for development-only correction tools. */
  undoLastVerdict(): CompletedMatchup | undefined {
    const undone = this.data.completedMatchups.at(-1);
    if (!undone) return undefined;
    const completedMatchups = this.data.completedMatchups.slice(0, -1);
    const completedIds = new Set(completedMatchups.map((item) => item.matchupId));
    this.save({
      completedMatchups,
      history: this.data.history.filter((vote) => completedIds.has(vote.matchupId)),
      levelExposureCounts: exposureCountsFromMatchups(completedMatchups),
      revealedEntrants: revealedEntrantsFromMatchups(completedMatchups),
    });
    return undone;
  }

  /** Drop persisted rounds, votes, and reveals that reference levels or themes
   * absent from the published catalog (for example retired rehearsal data). */
  pruneToCatalog(knownLevelIds: ReadonlySet<string>, knownThemeIds: ReadonlySet<string>): LocalBenchmarkData {
    const data = this.data;
    const revealKnown = (reveal: RevealPayload) => knownLevelIds.has(reveal.a.levelId) && knownLevelIds.has(reveal.b.levelId);
    const completedMatchups = data.completedMatchups.filter((item) => revealKnown(item.reveal));
    const keptMatchupIds = new Set(completedMatchups.map((item) => item.matchupId));
    const unfinished = data.unfinishedMatchup;
    const unfinishedValid = !!unfinished
      && knownThemeIds.has(unfinished.assignment.theme.id)
      && knownLevelIds.has(unfinished.assignment.a.playableRef)
      && knownLevelIds.has(unfinished.assignment.b.playableRef);
    return this.save({
      unfinishedMatchup: unfinishedValid ? unfinished : undefined,
      levelRuns: data.levelRuns.filter((run) => knownLevelIds.has(run.levelId)),
      completedMatchups,
      history: data.history.filter((vote) => keptMatchupIds.has(vote.matchupId)),
      themeHistory: data.themeHistory.filter((themeId) => knownThemeIds.has(themeId)),
      levelExposureCounts: Object.fromEntries(Object.entries(data.levelExposureCounts).filter(([levelId]) => knownLevelIds.has(levelId))),
      revealedEntrants: data.revealedEntrants.filter((entrant) => knownLevelIds.has(entrant.levelId)),
    });
  }

  clear(): void {
    this.data = emptyData(randomParticipantId());
    try { this.storage.removeItem?.(this.key); } catch { /* ignore */ }
  }
}

class MemoryStorage implements KeyValueStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

export function createMemoryStorage(): KeyValueStorage { return new MemoryStorage(); }

function normalizeUnfinishedMatchup(value: unknown): ComparisonState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as { kind?: unknown };
  if (state.kind === 'assignment' || state.kind === 'playing-a' || state.kind === 'playing-b' || state.kind === 'ready-to-vote' || state.kind === 'submitting' || state.kind === 'reveal') {
    return value as ComparisonState;
  }
  return undefined;
}

function normalizeLevelRuns(value: unknown): LevelRun[] {
  if (!Array.isArray(value)) return [];
  const newest = new Map<string, LevelRun>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const run = candidate as Partial<LevelRun>;
    if (typeof run.levelId !== 'string' || (run.score !== undefined && (typeof run.score !== 'number' || !Number.isFinite(run.score)))) continue;
    const normalized: LevelRun = {
      levelId: run.levelId,
      ...(typeof run.score === 'number' ? { score: run.score } : {}),
      completedAt: typeof run.completedAt === 'string' ? run.completedAt : '',
      count: typeof run.count === 'number' && run.count > 0 ? Math.floor(run.count) : 1,
    };
    const existing = newest.get(normalized.levelId);
    if (!existing || existing.completedAt <= normalized.completedAt) newest.set(normalized.levelId, normalized);
  }
  return [...newest.values()];
}

function levelRunsFromCompletedMatchups(matchups: readonly CompletedMatchup[]): LevelRun[] {
  return matchups.flatMap((completed) => [
    { levelId: completed.reveal.a.levelId, completedAt: completed.vote.submittedAt, count: Math.max(1, completed.vote.playCounts.a) },
    { levelId: completed.reveal.b.levelId, completedAt: completed.vote.submittedAt, count: Math.max(1, completed.vote.playCounts.b) },
  ]);
}

function mergeLevelRuns(...collections: readonly LevelRun[][]): LevelRun[] {
  const runs = new Map<string, LevelRun>();
  for (const collection of collections) {
    for (const run of collection) {
      const prior = runs.get(run.levelId);
      if (!prior) { runs.set(run.levelId, run); continue; }
      const latest = prior.completedAt > run.completedAt ? prior : run;
      runs.set(run.levelId, {
        ...latest,
        ...(latest.score === undefined && prior.score !== undefined ? { score: prior.score } : {}),
        count: Math.max(prior.count, run.count),
      });
    }
  }
  return [...runs.values()];
}

function exposureCounts(data: LocalBenchmarkData): Record<string, number> {
  if (data.levelExposureCounts && Object.keys(data.levelExposureCounts).length > 0) return { ...data.levelExposureCounts };
  return exposureCountsFromMatchups(data.completedMatchups);
}

function exposureCountsFromMatchups(matchups: readonly CompletedMatchup[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const completed of matchups) {
    for (const levelId of [completed.reveal.a.levelId, completed.reveal.b.levelId]) {
      counts[levelId] = (counts[levelId] ?? 0) + 1;
    }
  }
  return counts;
}

function revealedEntrantsFromMatchups(matchups: readonly CompletedMatchup[]): RevealPayload['a'][] {
  return matchups.flatMap((completed) => [completed.reveal.a, completed.reveal.b])
    .filter((entrant, index, all) => all.findIndex((other) => other.entrantId === entrant.entrantId) === index);
}
