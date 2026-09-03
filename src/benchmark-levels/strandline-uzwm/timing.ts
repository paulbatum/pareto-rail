import { createMusicTime } from '../../engine/music-time';

// Strandline rides a 120 BPM grid: one bar = 2 s, 30 bars = exactly the
// 60-second run from the strands to the crown and back out again. Set pieces
// are bar boundaries first and water second — the first bell vista opens at
// bar 6, the green-moon vista at bar 14, the water wakes at bar 16, the
// parent surfaces at bar 23, and the resolve pulls back over bars 28–30.
export const STRANDLINE_UZWM_BPM = 120;
export const STRANDLINE_UZWM_STEPS_PER_BAR = 16;
export const STRANDLINE_UZWM_TIME = createMusicTime(STRANDLINE_UZWM_BPM, {
  stepsPerBar: STRANDLINE_UZWM_STEPS_PER_BAR,
});

export const STRANDLINE_UZWM_BARS = {
  drift: 0,
  vista1: 6,
  thicket: 8,
  vista2: 14,
  wake: 16,
  crown: 22,
  boss: 23,
  coda: 28,
  end: 30,
} as const;

export const STRANDLINE_UZWM_MARKERS = STRANDLINE_UZWM_TIME.markers({
  drift: STRANDLINE_UZWM_BARS.drift,
  vista1: STRANDLINE_UZWM_BARS.vista1,
  thicket: STRANDLINE_UZWM_BARS.thicket,
  vista2: STRANDLINE_UZWM_BARS.vista2,
  wake: STRANDLINE_UZWM_BARS.wake,
  crown: STRANDLINE_UZWM_BARS.crown,
  boss: STRANDLINE_UZWM_BARS.boss,
  coda: STRANDLINE_UZWM_BARS.coda,
  end: STRANDLINE_UZWM_BARS.end,
});

export const STRANDLINE_UZWM_RUN_DURATION = STRANDLINE_UZWM_MARKERS.end;
export const STRANDLINE_UZWM_VISTA1_TIME = STRANDLINE_UZWM_MARKERS.vista1;
export const STRANDLINE_UZWM_VISTA2_TIME = STRANDLINE_UZWM_MARKERS.vista2;
export const STRANDLINE_UZWM_WAKE_TIME = STRANDLINE_UZWM_MARKERS.wake;
export const STRANDLINE_UZWM_BOSS_TIME = STRANDLINE_UZWM_MARKERS.boss;
export const STRANDLINE_UZWM_CODA_TIME = STRANDLINE_UZWM_MARKERS.coda;

// Player-instrument timbres follow the water: dim glass in the drift,
// sunlit shimmer in the thicket, hard neon in the wake, tolling weight for
// the parent, and a soft major wash for the resolve.
export const STRANDLINE_UZWM_SCORE_SECTIONS = [
  { index: 0, fromBar: STRANDLINE_UZWM_BARS.drift },
  { index: 1, fromBar: STRANDLINE_UZWM_BARS.thicket, crossfadeBars: 1 },
  { index: 2, fromBar: STRANDLINE_UZWM_BARS.wake, crossfadeBars: 1 },
  { index: 3, fromBar: STRANDLINE_UZWM_BARS.boss, crossfadeBars: 1 },
  { index: 4, fromBar: STRANDLINE_UZWM_BARS.coda, crossfadeBars: 1 },
] as const;

export const STRANDLINE_UZWM_RUN_SECTIONS = [
  { name: 'drift', fromBar: STRANDLINE_UZWM_BARS.drift, toBar: STRANDLINE_UZWM_BARS.vista1 },
  { name: 'vista', fromBar: STRANDLINE_UZWM_BARS.vista1, toBar: STRANDLINE_UZWM_BARS.thicket },
  { name: 'thicket', fromBar: STRANDLINE_UZWM_BARS.thicket, toBar: STRANDLINE_UZWM_BARS.vista2 },
  { name: 'moon', fromBar: STRANDLINE_UZWM_BARS.vista2, toBar: STRANDLINE_UZWM_BARS.wake },
  { name: 'wake', fromBar: STRANDLINE_UZWM_BARS.wake, toBar: STRANDLINE_UZWM_BARS.crown },
  { name: 'crown', fromBar: STRANDLINE_UZWM_BARS.crown, toBar: STRANDLINE_UZWM_BARS.boss },
  { name: 'parent', fromBar: STRANDLINE_UZWM_BARS.boss, toBar: STRANDLINE_UZWM_BARS.coda },
  { name: 'resolve', fromBar: STRANDLINE_UZWM_BARS.coda, toBar: STRANDLINE_UZWM_BARS.end },
] as const;

export const bar = STRANDLINE_UZWM_TIME.bar;
