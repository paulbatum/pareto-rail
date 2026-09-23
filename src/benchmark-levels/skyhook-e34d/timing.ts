import { createMusicTime } from '../../engine/music-time';

// One authoritative tempo. 128 BPM, 16 steps per bar: a bar is 1.875 s, so
// the 33-bar climb is 61.9 s — 32 bars of music plus one bar of ring-out
// while the car sits docked.
export const SKYHOOK_BPM = 128;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });
export const BAR = SKYHOOK_TIME.barSeconds;
export const BEAT = SKYHOOK_TIME.beatSeconds;
export const bar = SKYHOOK_TIME.bar;

// The climb, in bars. Every altitude band is a phrase of the score.
export const SKYHOOK_BARS = {
  liftoff: 0, // the car leaves the pad; gantries fall away
  storm: 2, // wind-riders in the weather
  punch: 7.5, // the cloud deck — the only fractional mark: the whiteout straddles the downbeat
  sunlit: 8, // above the weather, blue sky, full band
  thin: 16, // the air thins: indigo, first vacuum-hardened things
  contact: 20, // something latches onto the tether far above
  boss: 22, // the Descender is in reach
  dock: 29, // the station opens overhead
  docked: 32, // clamps close; the last chord
  end: 33,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers({
  liftoff: SKYHOOK_BARS.liftoff,
  storm: SKYHOOK_BARS.storm,
  punch: [7, 2],
  sunlit: SKYHOOK_BARS.sunlit,
  thin: SKYHOOK_BARS.thin,
  contact: SKYHOOK_BARS.contact,
  boss: SKYHOOK_BARS.boss,
  dock: SKYHOOK_BARS.dock,
  docked: SKYHOOK_BARS.docked,
  end: SKYHOOK_BARS.end,
});

export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;

// Score sections track air density, not action: the arrangement loses a layer
// each time the sky does.
export type SkyhookSection = 0 | 1 | 2 | 3 | 4;
export const SECTION_WEATHER = 0;
export const SECTION_SUNLIT = 1;
export const SECTION_THIN = 2;
export const SECTION_VACUUM = 3;
export const SECTION_DOCK = 4;

export const SKYHOOK_SCORE_SECTIONS = [
  { index: SECTION_WEATHER, fromBar: SKYHOOK_BARS.liftoff },
  { index: SECTION_SUNLIT, fromBar: SKYHOOK_BARS.sunlit },
  { index: SECTION_THIN, fromBar: SKYHOOK_BARS.thin, crossfadeBars: 2 },
  { index: SECTION_VACUUM, fromBar: SKYHOOK_BARS.boss, crossfadeBars: 2 },
  { index: SECTION_DOCK, fromBar: SKYHOOK_BARS.dock },
] as const;

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'liftoff', fromBar: SKYHOOK_BARS.liftoff, toBar: SKYHOOK_BARS.storm },
  { name: 'storm', fromBar: SKYHOOK_BARS.storm, toBar: SKYHOOK_BARS.sunlit },
  { name: 'sunlit', fromBar: SKYHOOK_BARS.sunlit, toBar: SKYHOOK_BARS.thin },
  { name: 'thin', fromBar: SKYHOOK_BARS.thin, toBar: SKYHOOK_BARS.contact },
  { name: 'contact', fromBar: SKYHOOK_BARS.contact, toBar: SKYHOOK_BARS.boss },
  { name: 'descender', fromBar: SKYHOOK_BARS.boss, toBar: SKYHOOK_BARS.dock },
  { name: 'dock', fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end },
] as const;

// Storm lightning, as [bar, step]. Visuals strike and the score thunders on
// the same grid positions, so every flash has its roll.
export const LIGHTNING_HITS: ReadonlyArray<readonly [number, number]> = [
  [0, 8],
  [2, 0],
  [3, 10],
  [4, 0],
  [5, 12],
  [6, 0],
  [6, 14],
  [7, 0],
  [7, 8],
];
export const LIGHTNING_STRIKES = LIGHTNING_HITS.map(([barIndex, step]) => SKYHOOK_TIME.step(barIndex, step));
