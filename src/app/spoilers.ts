const SPOILERS_KEY = 'pr-spoilers';

/** The visitor has engaged with the benchmark once they have cast this many
 * votes or played this many distinct levels; past that a spoiler gate is moot. */
const ENGAGED_THRESHOLD = 4;

export type SpoilerGateVariant = 'intro' | 'new-additions' | 'hidden';

export interface SpoilerGateDecision {
  variant: SpoilerGateVariant;
  /** Benchmark levels displayed now but unseen at the last acknowledgment. */
  newCount: number;
}

export interface SpoilerGateInputs {
  /** Level ids of the benchmark records the surface actually renders. */
  displayedIds: readonly string[];
  /** Votes cast, from the local benchmark snapshot. */
  historyLength: number;
  /** Distinct levels played, from the local benchmark snapshot. */
  levelRunsLength: number;
  /** Ids recorded at the last acknowledgment, or null if never acknowledged. */
  seen: readonly string[] | null;
}

/** One site-wide answer to "show me the spoilers": every surface that reveals
 * which model built a level shares this decision, so a visitor is asked once.
 * Kept free of storage so it stays trivially testable. */
export function decideSpoilerGate({ displayedIds, historyLength, levelRunsLength, seen }: SpoilerGateInputs): SpoilerGateDecision {
  if (historyLength >= ENGAGED_THRESHOLD || levelRunsLength >= ENGAGED_THRESHOLD) return { variant: 'hidden', newCount: 0 };
  if (seen === null) return { variant: 'intro', newCount: 0 };
  const known = new Set(seen);
  const newCount = displayedIds.reduce((total, id) => (known.has(id) ? total : total + 1), 0);
  return newCount > 0 ? { variant: 'new-additions', newCount } : { variant: 'hidden', newCount: 0 };
}

/** Survives an acknowledgment for the rest of the session when localStorage
 * throws (private browsing), so those visitors are not re-asked on every
 * navigation. */
let memoryFallback: string[] | null = null;

interface SpoilerState {
  seen: string[];
}

function extractSeen(value: unknown): string[] | null {
  if (!value || typeof value !== 'object') return null;
  const seen = (value as Partial<SpoilerState>).seen;
  if (!Array.isArray(seen)) return null;
  return seen.filter((id): id is string => typeof id === 'string');
}

/** The ids seen at the last acknowledgment, or null if spoilers were never
 * acknowledged. Corrupt or missing storage reads as never acknowledged. */
export function readSeenSpoilerIds(): string[] | null {
  try {
    const raw = window.localStorage.getItem(SPOILERS_KEY);
    if (raw === null) return memoryFallback;
    return extractSeen(JSON.parse(raw) as unknown) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

export function acknowledgeSpoilers(displayedIds: readonly string[]): void {
  const seen = [...displayedIds];
  memoryFallback = seen;
  try {
    const state: SpoilerState = { seen };
    window.localStorage.setItem(SPOILERS_KEY, JSON.stringify(state));
  } catch {
    // The in-memory fallback keeps the acknowledgment for the rest of the session.
  }
}
