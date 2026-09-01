import { createMusicTime } from '../../engine/music-time';

// SKYHOOK — one authoritative tempo. 128 BPM in 4/4: one bar is 1.875 s, so a
// 32-bar arrangement is exactly the 60-second climb from the weather to the
// dock. Everything below (spawns, set pieces, sky phases, boss lurches) is
// authored in bars and converted to seconds through SKYHOOK_TIME.
export const SKYHOOK_BPM = 128;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });
export const bar = SKYHOOK_TIME.bar;

export const SKYHOOK_BARS = {
  weather: 0, // storm grey, rain, lightning — the mix is wide and full
  deck: 8, // punch through the cloud deck into sunlit blue
  thin: 14, // the air thins: indigo sky, snare gone, hats sparse
  latch: 18.5, // the Tetherjack latches on far above
  vacuum: 20, // black sky, stars; the music is nearly gone
  dock: 28, // the station opens; deceleration
  end: 32,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers({
  weather: SKYHOOK_BARS.weather,
  deck: SKYHOOK_BARS.deck,
  thin: SKYHOOK_BARS.thin,
  latch: [18, 2],
  vacuum: SKYHOOK_BARS.vacuum,
  dock: SKYHOOK_BARS.dock,
  end: SKYHOOK_BARS.end,
});

export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;
export const DECK_TIME = SKYHOOK_MARKERS.deck;
export const THIN_TIME = SKYHOOK_MARKERS.thin;
export const LATCH_TIME = SKYHOOK_MARKERS.latch;
export const VACUUM_TIME = SKYHOOK_MARKERS.vacuum;
export const DOCK_TIME = SKYHOOK_MARKERS.dock;

// Lightning strikes in the weather, authored against the downbeat grid so the
// thunder in the score and the flash on screen are the same event.
export const LIGHTNING_STEPS: ReadonlyArray<readonly [bar: number, step: number]> = [[1, 0], [2, 8], [4, 0], [5, 12], [7, 0], [7, 14]];
export const LIGHTNING_TIMES = LIGHTNING_STEPS.map(([lightningBar, step]) => SKYHOOK_TIME.step(lightningBar, step));

// The Tetherjack climbs down in lurches, one per downbeat once the sky goes
// black. Distances are rail units ahead of the climber; sizes shrink as it
// nears so the last stretch reads as it tightening its grip.
export const BOSS_START_DISTANCE = 240;
export const BOSS_LURCH_SECONDS = 0.5;
export const BOSS_LURCHES: ReadonlyArray<{ time: number; size: number }> = [38, 34, 30, 28, 26, 24, 22, 22].map((size, index) => ({
  time: bar(SKYHOOK_BARS.vacuum + index),
  size,
}));
export const BOSS_ENGAGE_DISTANCE = 140; // claws become lockable inside this range
export const BOSS_REACH_DISTANCE = 16; // it has the climber

export const SKYHOOK_SCORE_SECTIONS = [
  { index: 0, fromBar: SKYHOOK_BARS.weather },
  { index: 1, fromBar: SKYHOOK_BARS.deck, crossfadeBars: 1 },
  { index: 2, fromBar: SKYHOOK_BARS.thin, crossfadeBars: 2 },
  { index: 3, fromBar: SKYHOOK_BARS.vacuum, crossfadeBars: 1 },
  { index: 4, fromBar: SKYHOOK_BARS.dock, crossfadeBars: 1 },
] as const;

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'weather', fromBar: SKYHOOK_BARS.weather, toBar: SKYHOOK_BARS.deck },
  { name: 'sunlit', fromBar: SKYHOOK_BARS.deck, toBar: SKYHOOK_BARS.thin },
  { name: 'thin', fromBar: SKYHOOK_BARS.thin, toBar: SKYHOOK_BARS.vacuum },
  { name: 'vacuum', fromBar: SKYHOOK_BARS.vacuum, toBar: SKYHOOK_BARS.dock },
  { name: 'dock', fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end },
] as const;
