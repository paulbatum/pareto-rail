import { createMusicTime } from '../../engine/music-time';

// One authoritative tempo. 128 BPM puts exactly 32 bars in the 60-second run,
// so every phrase boundary lands on a whole bar and the run ends on the last
// downbeat of the coda.
export const TINKER_BPM = 128;
export const TINKER_STEPS_PER_BAR = 16;
export const TINKER_TIME = createMusicTime(TINKER_BPM, { stepsPerBar: TINKER_STEPS_PER_BAR });

// The arc, in bars. Each size tier is its own act; the ball grows on the
// phrase boundary that opens the next one.
export const TINKER_BARS = {
  windup: 0,
  marble: 1,
  marbleDrive: 5,
  growTennis: 9,
  tennisDrive: 14,
  growMelon: 19,
  spillReveal: 21,
  spill: 22,
  spillDrive: 25,
  heart: 27,
  heartCut: 30,
  coda: 30,
  end: 32,
} as const;

export const TINKER_MARKERS = TINKER_TIME.markers({
  windup: TINKER_BARS.windup,
  marble: TINKER_BARS.marble,
  marbleDrive: TINKER_BARS.marbleDrive,
  growTennis: TINKER_BARS.growTennis,
  tennisDrive: TINKER_BARS.tennisDrive,
  growMelon: TINKER_BARS.growMelon,
  spillReveal: TINKER_BARS.spillReveal,
  spill: TINKER_BARS.spill,
  spillDrive: TINKER_BARS.spillDrive,
  heart: TINKER_BARS.heart,
  coda: TINKER_BARS.coda,
});

export const TINKER_RUN_DURATION = TINKER_TIME.bar(TINKER_BARS.end);

// Score sections drive the player's instrument: the kill voice grows with the
// ball (glockenspiel → marimba → vibraphone → the spill's tubular bells).
export const TINKER_SCORE_SECTIONS = [
  { index: 0, fromBar: 0 },
  { index: 1, fromBar: TINKER_BARS.growTennis },
  { index: 2, fromBar: TINKER_BARS.growMelon },
  { index: 3, fromBar: TINKER_BARS.spill, crossfadeBars: 1 },
  { index: 4, fromBar: TINKER_BARS.coda },
] as const;

export const TINKER_RUN_SECTIONS = [
  { name: 'windup', fromBar: TINKER_BARS.windup, toBar: TINKER_BARS.marble },
  { name: 'marble', fromBar: TINKER_BARS.marble, toBar: TINKER_BARS.marbleDrive },
  { name: 'marble-drive', fromBar: TINKER_BARS.marbleDrive, toBar: TINKER_BARS.growTennis },
  { name: 'tennis', fromBar: TINKER_BARS.growTennis, toBar: TINKER_BARS.tennisDrive },
  { name: 'tennis-drive', fromBar: TINKER_BARS.tennisDrive, toBar: TINKER_BARS.growMelon },
  { name: 'melon', fromBar: TINKER_BARS.growMelon, toBar: TINKER_BARS.spill },
  { name: 'spill', fromBar: TINKER_BARS.spill, toBar: TINKER_BARS.heart },
  { name: 'heart', fromBar: TINKER_BARS.heart, toBar: TINKER_BARS.coda },
  { name: 'coda', fromBar: TINKER_BARS.coda, toBar: TINKER_BARS.end },
] as const;

export const bar = TINKER_TIME.bar;
export const BAR_SECONDS = TINKER_TIME.barSeconds;
export const BEAT_SECONDS = TINKER_TIME.beatSeconds;

/** Run time → continuous bar position (bar 3.5 = halfway through bar 3). */
export function barAt(runTime: number) {
  return runTime / BAR_SECONDS;
}
