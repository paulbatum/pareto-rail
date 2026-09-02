import { createMusicTime } from '../../engine/music-time';

export const BROADSIDE_BPM = 120;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });

// 30 bars at 120 BPM = exactly 60.0 seconds of gameplay.
export const BROADSIDE_BARS = {
  deck: 0,        // 0.0s: Flight deck catapult lock
  launch: 3,      // 6.0s: Clear the bow / catapult launch into void
  broadside: 4,   // 8.0s: Fleet melee / friendly cruiser flank broadside
  eye: 10,        // 20.0s: Eye of battle / enemy dreadnought belly run
  flagship: 16,   // 32.0s: Boss Phase 1: Shield generator assault
  escort: 22,     // 44.0s: Shield collapse & emergency escort swarm
  trench: 25,     // 50.0s: Boss Phase 2: Trench dive & core destruction
  victory: 28,    // 56.0s: Final core explosion & victory pullout
  end: 30,        // 60.0s: Level ends on glorious victory resolution
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers(BROADSIDE_BARS);
export const BROADSIDE_DURATION = BROADSIDE_MARKERS.end;

export const BROADSIDE_SCORE_SECTIONS = [
  { index: 'deck', fromBar: BROADSIDE_BARS.deck },
  { index: 'broadside', fromBar: BROADSIDE_BARS.broadside },
  { index: 'eye', fromBar: BROADSIDE_BARS.eye, crossfadeBars: 1 },
  { index: 'flagship', fromBar: BROADSIDE_BARS.flagship },
  { index: 'escort', fromBar: BROADSIDE_BARS.escort },
  { index: 'trench', fromBar: BROADSIDE_BARS.trench },
  { index: 'victory', fromBar: BROADSIDE_BARS.victory },
] as const;

export type BroadsideSection = (typeof BROADSIDE_SCORE_SECTIONS)[number]['index'];

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'flight-deck', fromBar: 0, toBar: 4 },
  { name: 'crossfire-broadside', fromBar: 4, toBar: 10 },
  { name: 'eye-of-battle', fromBar: 10, toBar: 16 },
  { name: 'flagship-shields', fromBar: 16, toBar: 22 },
  { name: 'escort-intercept', fromBar: 22, toBar: 25 },
  { name: 'trench-run', fromBar: 25, toBar: 28 },
  { name: 'victory-pullout', fromBar: 28, toBar: 30 },
] as const;

export type Chord = {
  bass: number;
  pad: readonly number[];
  lead: readonly number[];
};

export const CHORDS: readonly Chord[] = [
  // 0: Dm (Bars 0-3)
  { bass: 38, pad: [50, 57, 62, 65], lead: [62, 65, 69, 72, 74, 77, 81, 84] },
  // 1: Bbmaj7 (Bars 4-7)
  { bass: 34, pad: [46, 53, 58, 62], lead: [58, 62, 65, 69, 70, 74, 77, 81] },
  // 2: Gm7 (Bars 8-9)
  { bass: 31, pad: [43, 50, 55, 58], lead: [58, 62, 65, 67, 70, 74, 77, 79] },
  // 3: Dm/A (Bars 10-13)
  { bass: 33, pad: [45, 50, 57, 62], lead: [57, 62, 65, 69, 72, 74, 77, 81] },
  // 4: Asus4-A7 (Bars 14-15)
  { bass: 33, pad: [45, 52, 57, 61], lead: [57, 61, 64, 69, 73, 76, 81, 85] },
  // 5: Dm (Bars 16-19)
  { bass: 38, pad: [50, 57, 62, 65], lead: [62, 65, 69, 72, 74, 77, 81, 84] },
  // 6: Ebmaj7 (Bars 20-21) - Neapolitan dramatic push
  { bass: 39, pad: [51, 55, 58, 62], lead: [58, 62, 63, 67, 70, 74, 75, 79] },
  // 7: Gm (Bars 22-24)
  { bass: 31, pad: [43, 50, 55, 58], lead: [58, 62, 65, 67, 70, 74, 77, 79] },
  // 8: Dm (Bars 25-27) - Trench drive
  { bass: 38, pad: [50, 57, 62, 65], lead: [62, 65, 69, 72, 74, 77, 81, 84] },
  // 9: D Major (Bars 28-30) - Soaring Victory Fanfare
  { bass: 38, pad: [50, 57, 62, 66], lead: [62, 66, 69, 74, 78, 81, 86, 90] },
];

export const KILL_LANES: Record<BroadsideSection, readonly number[]> = {
  deck: [0, 1, 2, 3, 2, 4, 3, 5, 2, 3, 4, 5, 4, 6, 5, 7],
  broadside: [0, 2, 4, 6, 5, 3, 1, 2, 3, 5, 4, 6, 7, 5, 6, 7],
  eye: [7, 6, 5, 4, 3, 4, 5, 2, 3, 4, 2, 1, 2, 3, 1, 0],
  flagship: [0, 3, 2, 5, 4, 6, 5, 7, 4, 6, 7, 5, 6, 7, 6, 7],
  escort: [7, 4, 6, 3, 5, 2, 4, 1, 3, 5, 6, 4, 7, 5, 6, 7],
  trench: [0, 1, 3, 4, 2, 4, 5, 6, 4, 5, 6, 7, 5, 6, 7, 7],
  victory: [0, 2, 4, 7, 4, 7, 5, 7, 4, 6, 7, 7, 7, 7, 7, 7],
};

export const bar = BROADSIDE_TIME.bar;
