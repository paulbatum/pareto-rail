import { createMusicTime } from '../../engine/music-time';

// Thermal Ink runs on one slow industrial clock: 96 BPM, 4/4, sixteen steps a
// bar. One bar is exactly 2.5 s, so the 24-bar fight is exactly 60 s and every
// set piece below is authored in bars.
export const THERMAL_INK_BPM = 96;
export const STEPS_PER_BAR = 16;
export const TIME = createMusicTime(THERMAL_INK_BPM, { stepsPerBar: STEPS_PER_BAR });
export const BAR = TIME.barSeconds;
export const BEAT = TIME.beatSeconds;
export const bar = (index: number, beat = 0) => TIME.bar(index, beat);

// The fight, act by act.
//   0–6   Sodium Murk   — approach across the harbor; the octopus is wrapped on
//                         the capsized freighter; arm 1 rises out of the water.
//   5.5   first ink jet — the creature turns and ejects ink across the route.
//   6–10  First Ink     — blind inside the cloud; thermal or nothing. Arm 2
//                         arches over the dive.
//   10–16 The Circling  — the rail orbits the creature; the crane comes down;
//                         arms 3 and 4; a short second ink burst.
//   16–20 The Mantle    — every arm is spent; it rears and bares the core.
//   20–22 Blackout      — the final ink. The last volley lands in the dark.
//   22–24 Lamps         — the silhouette collapses and the harbor relights.
export const BARS = {
  intro: 0,
  murk: 2,
  inkJet: 5.5,
  ink: 6,
  circling: 10,
  crane: 12,
  inkTwo: 13.75,
  mantle: 16,
  coreOpen: 16.5,
  finalJet: 19.5,
  blackout: 20,
  escape: 22.75,
  lamps: 22,
  end: 24,
} as const;

export const RUN_DURATION = bar(BARS.end);

export const MARKERS = TIME.markers({
  intro: BARS.intro,
  murk: BARS.murk,
  ink: BARS.ink,
  circling: BARS.circling,
  crane: BARS.crane,
  mantle: BARS.mantle,
  blackout: BARS.blackout,
  lamps: BARS.lamps,
  end: BARS.end,
});

export const RUN_SECTIONS = [
  { name: 'sodium-murk', fromBar: 0, toBar: 6 },
  { name: 'first-ink', fromBar: 6, toBar: 10 },
  { name: 'circling', fromBar: 10, toBar: 16 },
  { name: 'mantle', fromBar: 16, toBar: 20 },
  { name: 'blackout', fromBar: 20, toBar: 22 },
  { name: 'lamps', fromBar: 22, toBar: 24 },
] as const;

// Score sections: which player-instrument voice and kill lane speaks where.
// 0 murk, 1 ink, 2 circling, 3 mantle, 4 blackout/finale.
export type ScoreSectionIndex = 0 | 1 | 2 | 3 | 4;
export const SCORE_SECTIONS = [
  { index: 0 as ScoreSectionIndex, fromBar: 0 },
  { index: 1 as ScoreSectionIndex, fromBar: 6, crossfadeBars: 1 },
  { index: 2 as ScoreSectionIndex, fromBar: 10, crossfadeBars: 1 },
  { index: 3 as ScoreSectionIndex, fromBar: 16, crossfadeBars: 1 },
  { index: 4 as ScoreSectionIndex, fromBar: 20 },
] as const;

// Ink clouds the camera flies through, as [enterStart, full, thinStart, clear]
// in bars. Density ramps linearly between the keys. The finale cloud's clearing
// is decided live by the fight (see inkDensityAt in gameplay.ts).
export const INK_CLOUDS: ReadonlyArray<readonly [number, number, number, number]> = [
  [5.8, 6.15, 8.9, 9.8],
  [13.8, 14.15, 15.0, 15.8],
  [19.8, 20.05, BARS.escape, BARS.escape + 0.9],
];
