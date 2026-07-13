import type { ComparisonState, MatchupVote, RevealPayload } from './types';

export const BENCHMARK_STORAGE_KEY = 'pareto-rail-benchmark';
export const BENCHMARK_STORAGE_VERSION = 1;

export interface CompletedMatchup {
  matchupId: string;
  vote: MatchupVote;
  reveal: RevealPayload;
}

export interface LocalBenchmarkData {
  participantId: string;
  unfinishedMatchup?: ComparisonState;
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
      const legacy = parsed && typeof parsed === 'object' && 'data' in parsed ? (parsed as { data?: unknown }).data : parsed;
      if (isData(legacy)) return this.normalize(legacy);
      // v0 was an unwrapped data object. Migrate the useful fields if present.
      if (parsed && typeof parsed === 'object') {
        const candidate = parsed as Partial<LocalBenchmarkData> & { votes?: MatchupVote[]; unfinished?: ComparisonState };
        if (typeof candidate.participantId === 'string') {
          return this.normalize({
            participantId: candidate.participantId,
            unfinishedMatchup: candidate.unfinishedMatchup ?? candidate.unfinished,
            completedMatchups: candidate.completedMatchups ?? [],
            history: candidate.history ?? candidate.votes ?? [],
            themeHistory: candidate.themeHistory ?? [],
            levelExposureCounts: candidate.levelExposureCounts ?? {},
            revealedEntrants: candidate.revealedEntrants ?? [],
          });
        }
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
  if (state.kind === 'a-complete') return { ...value as Omit<ComparisonState, 'kind'>, kind: 'assignment' };
  if (state.kind === 'assignment' || state.kind === 'playing-a' || state.kind === 'playing-b' || state.kind === 'ready-to-vote' || state.kind === 'submitting' || state.kind === 'reveal') {
    return value as ComparisonState;
  }
  return undefined;
}

function exposureCounts(data: LocalBenchmarkData): Record<string, number> {
  if (data.levelExposureCounts && Object.keys(data.levelExposureCounts).length > 0) return { ...data.levelExposureCounts };
  const counts: Record<string, number> = {};
  for (const completed of data.completedMatchups) {
    for (const levelId of [completed.reveal.a.levelId, completed.reveal.b.levelId]) {
      counts[levelId] = (counts[levelId] ?? 0) + 1;
    }
  }
  return counts;
}
