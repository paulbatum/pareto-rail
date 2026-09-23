import type { EventBus } from '../../events';

// Leaf: maps run time onto arrangement beats. The transport starts a hair
// after runstart, so the offset is learned from the beat events themselves
// (smoothed, and re-locked if the frame clock and audio clock drift apart).

const DEFAULT_OFFSET = 0.06;
const WALL_CORRECTION_CAP = 0.05;

export function createBeatClock(bus: EventBus, beatSeconds: number) {
  let offset = DEFAULT_OFFSET;
  let locked = false;
  let rejected = 0;
  let lastRunTime = 0;
  let lastWall = 0;

  bus.on('runstart', () => {
    offset = DEFAULT_OFFSET;
    locked = false;
    rejected = 0;
    lastRunTime = 0;
    lastWall = now();
  });

  bus.on('beat', ({ beatNumber }) => {
    const eventRunTime = lastRunTime + Math.min(WALL_CORRECTION_CAP, Math.max(0, (now() - lastWall) / 1000));
    const candidate = eventRunTime - beatNumber * beatSeconds;
    if (!locked) {
      if (candidate > -0.15 && candidate < 0.6) {
        offset = candidate;
        locked = true;
      }
      return;
    }
    if (Math.abs(candidate - offset) > 0.25) {
      rejected += 1;
      // Two agreeing outliers in a row mean the clocks really moved (a long
      // frame hitch); follow them instead of ignoring the transport forever.
      if (rejected >= 2 && candidate > -1 && candidate < 8) {
        offset = candidate;
        rejected = 0;
      }
      return;
    }
    rejected = 0;
    offset += (candidate - offset) * 0.25;
  });

  return {
    frame(runTime: number) {
      lastRunTime = runTime;
      lastWall = now();
    },
    beatAt(runTime: number) {
      return (runTime - offset) / beatSeconds;
    },
    timeAt(beat: number) {
      return offset + beat * beatSeconds;
    },
  };
}

export type BeatClock = ReturnType<typeof createBeatClock>;

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
