import { mapVerdict, type MatchupVote, type VoteVerdict } from './types';

export const BENCHMARK_STORAGE_KEY = 'pareto-rail-benchmark';
export const BENCHMARK_PARTICIPANT_ID_KEY = 'pareto-rail-participant-id';
export const BENCHMARK_STORAGE_VERSION = 3;

export interface LevelRun {
  levelId: string;
  score?: number;
  completedAt: string;
  count: number;
}

export interface LocalBenchmarkData {
  participantId: string;
  /** Raw votes are retained so display ratings can be recomputed later. */
  history: MatchupVote[];
  /** Best local play results, independent of the benchmark catalog. */
  levelRuns: LevelRun[];
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
  history: [],
  levelRuns: [],
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
  return typeof data.participantId === 'string'
    && Array.isArray(data.history)
    && Array.isArray(data.levelRuns);
}

function participantIdFromEnvelope(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  const participantId = (data as { participantId?: unknown }).participantId;
  return typeof participantId === 'string' && participantId.length > 0 ? participantId : undefined;
}

function parseStoredValue(raw: string | null): unknown {
  if (!raw) return undefined;
  try { return JSON.parse(raw) as unknown; } catch { return undefined; }
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
    const raw = this.readStorageValue(this.key);
    const parsed = parseStoredValue(raw);
    const dedicatedParticipantId = this.readStorageValue(BENCHMARK_PARTICIPANT_ID_KEY);
    const participantId = dedicatedParticipantId && dedicatedParticipantId.length > 0
      ? dedicatedParticipantId
      : participantIdFromEnvelope(parsed) ?? randomParticipantId();
    this.persistParticipantId(participantId);

    if (parsed && typeof parsed === 'object' && (parsed as StorageEnvelope).version === BENCHMARK_STORAGE_VERSION && isData((parsed as StorageEnvelope).data)) {
      return this.normalize({ ...(parsed as StorageEnvelope).data, participantId });
    }
    return emptyData(participantId);
  }

  private readStorageValue(key: string): string | null {
    try { return this.storage.getItem(key); } catch { return null; }
  }

  private persistParticipantId(participantId: string): void {
    try { this.storage.setItem(BENCHMARK_PARTICIPANT_ID_KEY, participantId); } catch { /* inaccessible storage */ }
  }

  private normalize(data: LocalBenchmarkData): LocalBenchmarkData {
    return {
      participantId: data.participantId || randomParticipantId(),
      history: normalizeHistory(data.history),
      levelRuns: normalizeLevelRuns(data.levelRuns),
    };
  }

  get snapshot(): LocalBenchmarkData { return this.normalize(this.data); }
  get participantId(): string { return this.data.participantId; }

  save(data: Partial<LocalBenchmarkData>): LocalBenchmarkData {
    this.data = this.normalize({ ...this.data, ...data });
    this.persistParticipantId(this.data.participantId);
    const envelope: StorageEnvelope = { version: BENCHMARK_STORAGE_VERSION, data: this.data };
    try { this.storage.setItem(this.key, JSON.stringify(envelope)); } catch { /* memory remains authoritative */ }
    return this.snapshot;
  }

  recordLevelRun(levelId: string, score: number, completedAt = new Date().toISOString()): LocalBenchmarkData {
    const prior = this.data.levelRuns.find((run) => run.levelId === levelId);
    const bestScore = prior?.score === undefined ? score : Math.max(prior.score, score);
    const run: LevelRun = { levelId, score: bestScore, completedAt, count: (prior?.count ?? 0) + 1 };
    return this.save({ levelRuns: [...this.data.levelRuns.filter((item) => item.levelId !== levelId), run] });
  }

  /** Remove the newest local judgment for development-only correction tools. */
  undoLastVerdict(): MatchupVote | undefined {
    const undone = this.data.history.at(-1);
    if (!undone) return undefined;
    this.save({ history: this.data.history.slice(0, -1) });
    return undone;
  }

  clear(): void {
    this.data = emptyData(randomParticipantId());
    this.persistParticipantId(this.data.participantId);
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

function normalizeHistory(value: unknown): MatchupVote[] {
  if (!Array.isArray(value)) return [];
  const verdicts = new Set<VoteVerdict>(['a-better', 'b-better', 'both-good', 'both-bad']);
  return value.flatMap((candidate): MatchupVote[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const vote = candidate as Partial<MatchupVote>;
    if (typeof vote.matchupId !== 'string' || typeof vote.aEntrantId !== 'string' || typeof vote.bEntrantId !== 'string'
      || typeof vote.verdict !== 'string' || !verdicts.has(vote.verdict)
      || !vote.playCounts || typeof vote.playCounts !== 'object'
      || !validCount(vote.playCounts.a) || !validCount(vote.playCounts.b)) return [];
    const mapping = mapVerdict(vote.verdict);
    return [{
      matchupId: vote.matchupId,
      aEntrantId: vote.aEntrantId,
      bEntrantId: vote.bEntrantId,
      verdict: vote.verdict,
      relative: mapping.relative,
      ...(mapping.sentiment ? { sentiment: mapping.sentiment } : {}),
      playCounts: { a: vote.playCounts.a, b: vote.playCounts.b },
      submittedAt: typeof vote.submittedAt === 'string' ? vote.submittedAt : '',
    }];
  });
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
