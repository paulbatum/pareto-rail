// The cube's rotations are percussion, so gameplay and audio must agree on
// exactly when each snap lands. The audio module owns the transport grid; it
// registers a provider here that quantizes a request onto that grid, schedules
// its own sound at the resulting audio time, and returns how many seconds away
// the landing is. Gameplay converts that delay into its own clock and drives the
// visual rotation to land at the same instant. Without an audio context
// (headless simulation, muted tab) the fallback quantizes against beat events.

export type SnapKind = 'arm' | 'solve' | 'fall' | 'shell' | 'core';

export type SnapRequest = {
  kind: SnapKind;
  /** Extra data the audio side may want (face colour index, chain position). */
  face?: number;
  chain?: number;
  /** Minimum seconds from now before the landing may occur. */
  minDelay: number;
  /** Grid size in sixteenths the landing must sit on. */
  gridSixteenths: number;
};

export type SnapProvider = (request: SnapRequest) => number | null;

const EIGHTH_FALLBACK = 0.25;

export function createSnapClock() {
  let provider: SnapProvider | null = null;
  let lastBeatWorld = -Infinity;
  let lastBeatSeconds = 0;
  let beatSeconds = 0.5;
  let lastLandWorld = -Infinity;

  return {
    setProvider(next: SnapProvider | null) {
      provider = next;
    },
    /** Gameplay reports beat events so the fallback grid follows the transport. */
    observeBeat(worldNow: number, beatNumber: number, seconds: number) {
      lastBeatWorld = worldNow;
      lastBeatSeconds = beatNumber * seconds;
      beatSeconds = seconds;
    },
    reset() {
      lastLandWorld = -Infinity;
    },
    /** Returns seconds from `worldNow` until the requested landing. */
    schedule(worldNow: number, request: SnapRequest): number {
      let delay = provider?.(request) ?? null;
      if (delay === null) {
        const grid = (beatSeconds / 4) * request.gridSixteenths;
        const musicNow = Number.isFinite(lastBeatWorld) ? lastBeatSeconds + (worldNow - lastBeatWorld) : worldNow;
        const earliest = musicNow + request.minDelay;
        const snapped = Math.ceil(earliest / grid - 1e-6) * grid;
        delay = snapped - musicNow;
        // Consecutive snaps never share a slot.
        const minLand = lastLandWorld + Math.max(grid, EIGHTH_FALLBACK) - 1e-4;
        if (worldNow + delay < minLand) delay = minLand - worldNow;
      }
      lastLandWorld = worldNow + delay;
      return delay;
    },
  };
}

export type SnapClock = ReturnType<typeof createSnapClock>;

export const snapClock = createSnapClock();
