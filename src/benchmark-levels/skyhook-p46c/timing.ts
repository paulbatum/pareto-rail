import { createMusicTime } from '../../engine/music-time';

// SKYHOOK — 128 BPM, 32 bars = exactly 60 seconds of climb.
// One bar = 1.875 s. The acts are strapped to 8-bar phrases:
//   storm  (0–8)    inside the weather, buffeted, full wide mix
//   blue   (8–16)   punch the cloud deck on the drop, sunlit climb
//   thin   (16–24)  air runs out, boss latches at bar 18
//   vacuum (24–28)  barely-there music, boss endgame
//   dock   (28–32)  deceleration, the station swallows the car
export const SKYHOOK_BPM = 128;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });
export const SKYHOOK_BAR = SKYHOOK_TIME.barSeconds;

export const SKYHOOK_BARS = {
  storm: 0,
  build: 4,
  cloudbreak: 8,
  thin: 16,
  bossLatch: 18,
  vacuum: 24,
  dock: 28,
  end: 32,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers({
  storm: SKYHOOK_BARS.storm,
  build: SKYHOOK_BARS.build,
  cloudbreak: SKYHOOK_BARS.cloudbreak,
  thin: SKYHOOK_BARS.thin,
  bossLatch: SKYHOOK_BARS.bossLatch,
  vacuum: SKYHOOK_BARS.vacuum,
  dock: SKYHOOK_BARS.dock,
  end: SKYHOOK_BARS.end,
});

export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;
export const CLOUDBREAK_TIME = SKYHOOK_MARKERS.cloudbreak;
export const THIN_TIME = SKYHOOK_MARKERS.thin;
export const BOSS_LATCH_TIME = SKYHOOK_MARKERS.bossLatch;
export const VACUUM_TIME = SKYHOOK_MARKERS.vacuum;
export const DOCK_TIME = SKYHOOK_MARKERS.dock;
/** If the Tetherjack still lives at this time, it is on the car. */
export const BOSS_REACH_TIME = SKYHOOK_TIME.bar(27.5);

/** Storm lightning strikes: authored once, consumed by both the visuals (flash) and the score (thunder). */
export const LIGHTNING_BARS = [2.5, 5.25, 7.0] as const;
export const LIGHTNING_TIMES = LIGHTNING_BARS.map((atBar) => SKYHOOK_TIME.bar(atBar));

export const SKYHOOK_SCORE_SECTIONS = [
  { index: 0, fromBar: SKYHOOK_BARS.storm },
  { index: 1, fromBar: SKYHOOK_BARS.cloudbreak, crossfadeBars: 1 },
  { index: 2, fromBar: SKYHOOK_BARS.thin, crossfadeBars: 2 },
  { index: 3, fromBar: SKYHOOK_BARS.vacuum, crossfadeBars: 2 },
] as const;

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'storm', fromBar: SKYHOOK_BARS.storm, toBar: SKYHOOK_BARS.cloudbreak },
  { name: 'blue', fromBar: SKYHOOK_BARS.cloudbreak, toBar: SKYHOOK_BARS.thin },
  { name: 'thin', fromBar: SKYHOOK_BARS.thin, toBar: SKYHOOK_BARS.vacuum },
  { name: 'vacuum', fromBar: SKYHOOK_BARS.vacuum, toBar: SKYHOOK_BARS.dock },
  { name: 'dock', fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end },
] as const;

export const bar = SKYHOOK_TIME.bar;
