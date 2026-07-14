import type { KeyValueStorage } from './storage';
import type { VoteVerdict } from './types';

export const REMOTE_VOTE_OUTBOX_KEY = 'pareto-rail-rank-vote-outbox-v1';
export const REMOTE_VOTE_OUTBOX_VERSION = 1;
const MAX_OUTBOX_ENTRIES = 50;

export interface RemoteVotePayload {
  matchupId: string;
  participantId: string;
  benchmarkVersion: string;
  themeId: string;
  aLevelId: string;
  bLevelId: string;
  verdict: VoteVerdict;
  playCounts: { a: number; b: number };
  bestScores?: { a?: number; b?: number };
  assignedAt?: string;
  clientSubmittedAt?: string;
  idempotencyKey?: string;
}

interface RemoteVoteOutbox {
  version: number;
  entries: RemoteVotePayload[];
}

/** Best-effort remote persistence. It never participates in the comparison
 * state machine, so an unavailable API cannot block a local vote or reveal. */
export class RemoteVoteRecorder {
  private readonly storage: KeyValueStorage;
  private flushing = false;
  private loggedFailure = false;

  constructor(storage?: KeyValueStorage) {
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : new MemoryStorage());
  }

  record(payload: RemoteVotePayload): void {
    void this.sync(payload).catch(() => this.noteFailure());
  }

  retryPending(): void {
    void this.flushPending().catch(() => this.noteFailure());
  }

  private async sync(payload: RemoteVotePayload): Promise<void> {
    await this.flushPending();
    if (await this.post(payload)) {
      this.remove(payload);
      return;
    }
    this.enqueue(payload);
    this.noteFailure();
  }

  private async flushPending(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const entries = this.readEntries();
      for (const entry of entries) {
        if (!(await this.post(entry))) {
          this.noteFailure();
          break;
        }
        this.remove(entry);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async post(payload: RemoteVotePayload): Promise<boolean> {
    if (typeof fetch !== 'function') return false;
    try {
      const response = await fetch('/api/rank/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (response.ok) return true;
      // A permanently rejected payload (4xx other than rate limiting) will never
      // succeed; report it handled so it leaves the outbox instead of retrying forever.
      return response.status >= 400 && response.status < 500 && response.status !== 429;
    } catch {
      return false;
    }
  }

  private enqueue(payload: RemoteVotePayload): void {
    const entries = this.readEntries().filter((entry) => entryKey(entry) !== entryKey(payload));
    entries.push(payload);
    this.writeEntries(entries.slice(-MAX_OUTBOX_ENTRIES));
  }

  private remove(payload: RemoteVotePayload): void {
    this.writeEntries(this.readEntries().filter((entry) => entryKey(entry) !== entryKey(payload)));
  }

  private readEntries(): RemoteVotePayload[] {
    let raw: string | null = null;
    try { raw = this.storage.getItem(REMOTE_VOTE_OUTBOX_KEY); } catch { return []; }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isOutbox(parsed)) return [];
      return parsed.entries.filter(isPayload).slice(-MAX_OUTBOX_ENTRIES);
    } catch {
      return [];
    }
  }

  private writeEntries(entries: RemoteVotePayload[]): void {
    const outbox: RemoteVoteOutbox = { version: REMOTE_VOTE_OUTBOX_VERSION, entries };
    try { this.storage.setItem(REMOTE_VOTE_OUTBOX_KEY, JSON.stringify(outbox)); } catch { /* local vote remains authoritative */ }
  }

  private noteFailure(): void {
    if (this.loggedFailure) return;
    this.loggedFailure = true;
    console.debug('Rank vote remote sync deferred');
  }
}

function entryKey(payload: RemoteVotePayload): string {
  return `${payload.matchupId}\u0000${payload.participantId}`;
}

function isOutbox(value: unknown): value is RemoteVoteOutbox {
  return typeof value === 'object' && value !== null
    && (value as RemoteVoteOutbox).version === REMOTE_VOTE_OUTBOX_VERSION
    && Array.isArray((value as RemoteVoteOutbox).entries);
}

function isPayload(value: unknown): value is RemoteVotePayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RemoteVotePayload>;
  return typeof candidate.matchupId === 'string'
    && typeof candidate.participantId === 'string'
    && typeof candidate.benchmarkVersion === 'string'
    && typeof candidate.themeId === 'string'
    && typeof candidate.aLevelId === 'string'
    && typeof candidate.bLevelId === 'string'
    && (candidate.verdict === 'a-better' || candidate.verdict === 'b-better' || candidate.verdict === 'both-good' || candidate.verdict === 'both-bad')
    && isCounts(candidate.playCounts);
}

function isCounts(value: unknown): value is { a: number; b: number } {
  return typeof value === 'object' && value !== null
    && Number.isSafeInteger((value as { a?: unknown }).a)
    && Number.isSafeInteger((value as { b?: unknown }).b);
}

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
