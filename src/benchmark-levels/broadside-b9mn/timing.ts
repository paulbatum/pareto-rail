import { createMusicTime } from '../../engine/music-time';

// Broadside rides a 144 BPM martial-orchestral grid: one bar = 1.667 s, and
// 36 bars is exactly the 60-second sortie. The engagement's set pieces are
// bar boundaries first and battlefield geography second — the catapult fires
// on the downbeat of bar 0, the friendly broadside opens up at bar 11, the
// eye of the battle empties bar 16, and the enemy flagship owns the last
// fourteen bars.
export const BROADSIDE_BPM = 144;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });
export const BROADSIDE_BAR = BROADSIDE_TIME.barSeconds;

export const BROADSIDE_BARS = {
  launch: 0,
  gauntlet: 4,
  broadside: 11,
  eye: 16,
  belly: 18,
  flagship: 22,
  around: 26,
  trench: 28,
  victory: 34,
  end: 36,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers({
  launch: BROADSIDE_BARS.launch,
  gauntlet: BROADSIDE_BARS.gauntlet,
  broadside: BROADSIDE_BARS.broadside,
  eye: BROADSIDE_BARS.eye,
  belly: BROADSIDE_BARS.belly,
  flagship: BROADSIDE_BARS.flagship,
  around: BROADSIDE_BARS.around,
  trench: BROADSIDE_BARS.trench,
  victory: BROADSIDE_BARS.victory,
  end: BROADSIDE_BARS.end,
});

export const BROADSIDE_DURATION = BROADSIDE_MARKERS.end;
export const BROADSIDE_TIME_OF = BROADSIDE_MARKERS;

// Audio score sections: indexes feed player-voice blends and kill lanes.
export const BROADSIDE_SCORE_SECTIONS = [
  { index: 0, fromBar: BROADSIDE_BARS.launch },
  { index: 1, fromBar: BROADSIDE_BARS.gauntlet, crossfadeBars: 1 },
  { index: 2, fromBar: BROADSIDE_BARS.broadside, crossfadeBars: 1 },
  { index: 3, fromBar: BROADSIDE_BARS.eye, crossfadeBars: 0.5 },
  { index: 4, fromBar: BROADSIDE_BARS.belly, crossfadeBars: 1 },
  { index: 5, fromBar: BROADSIDE_BARS.victory },
] as const;

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'launch', fromBar: BROADSIDE_BARS.launch, toBar: BROADSIDE_BARS.gauntlet },
  { name: 'gauntlet', fromBar: BROADSIDE_BARS.gauntlet, toBar: BROADSIDE_BARS.broadside },
  { name: 'broadside', fromBar: BROADSIDE_BARS.broadside, toBar: BROADSIDE_BARS.eye },
  { name: 'eye', fromBar: BROADSIDE_BARS.eye, toBar: BROADSIDE_BARS.belly },
  { name: 'belly', fromBar: BROADSIDE_BARS.belly, toBar: BROADSIDE_BARS.flagship },
  { name: 'flagship', fromBar: BROADSIDE_BARS.flagship, toBar: BROADSIDE_BARS.trench },
  { name: 'trench', fromBar: BROADSIDE_BARS.trench, toBar: BROADSIDE_BARS.victory },
  { name: 'victory', fromBar: BROADSIDE_BARS.victory, toBar: BROADSIDE_BARS.end },
] as const;

export const bar = BROADSIDE_TIME.bar;
