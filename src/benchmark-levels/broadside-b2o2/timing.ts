import { createMusicTime } from '../../engine/music-time';

// Broadside rides a 132 BPM grid: one bar = 1.8181… s, 33 bars = exactly the
// 60-second run. Every set piece is a bar boundary first and a place second:
// the launch catapult fires on the bar-0 downbeat, RELENTLESS opens her
// broadside at bar 9, the eye of the battle holds bars 13–15, the belly run
// starts at bar 21, the SOVEREIGN's shield pass at bar 25, the trench dive at
// bar 31, and the victory pull-out crests at bar 32.4.
export const BROADSIDE_BPM = 132;
export const BROADSIDE_STEPS_PER_BAR = 16;
export const BROADSIDE_TIME = createMusicTime(BROADSIDE_BPM, { stepsPerBar: BROADSIDE_STEPS_PER_BAR });
export const BROADSIDE_BAR = BROADSIDE_TIME.barSeconds;
export const BROADSIDE_BEAT = BROADSIDE_TIME.beatSeconds;

export const BROADSIDE_BARS = {
  launch: 0,
  melee1: 4,
  broadside: 9,
  eye: 13,
  melee2: 16,
  belly: 21,
  flagship: 25,
  screen: 29,
  trench: 31,
  pullout: 32.4,
  end: 33,
} as const;

export const BROADSIDE_MARKERS = BROADSIDE_TIME.markers({
  launch: BROADSIDE_BARS.launch,
  melee1: BROADSIDE_BARS.melee1,
  broadside: BROADSIDE_BARS.broadside,
  eye: BROADSIDE_BARS.eye,
  melee2: BROADSIDE_BARS.melee2,
  belly: BROADSIDE_BARS.belly,
  flagship: BROADSIDE_BARS.flagship,
  screen: BROADSIDE_BARS.screen,
  trench: BROADSIDE_BARS.trench,
  pullout: [32, 1.6],
  end: BROADSIDE_BARS.end,
});

export const BROADSIDE_DURATION = BROADSIDE_MARKERS.end;
export const MELEE1_TIME = BROADSIDE_MARKERS.melee1;
export const BROADSIDE_RUN_TIME = BROADSIDE_MARKERS.broadside;
export const EYE_TIME = BROADSIDE_MARKERS.eye;
export const MELEE2_TIME = BROADSIDE_MARKERS.melee2;
export const BELLY_TIME = BROADSIDE_MARKERS.belly;
export const FLAGSHIP_TIME = BROADSIDE_MARKERS.flagship;
export const SCREEN_TIME = BROADSIDE_MARKERS.screen;
export const TRENCH_TIME = BROADSIDE_MARKERS.trench;
export const PULLOUT_TIME = BROADSIDE_MARKERS.pullout;
/** The core's cradle opens only once the run commits to the trench dive. */
export const CORE_REVEAL_TIME = TRENCH_TIME + 0.35;

// The RELENTLESS fires her starboard broadside in authored salvos across the
// flank run — each is a musical hit and a wall of light overhead. Times are
// bars; both the arrangement (the boom) and the environment (muzzle flashes
// and shell arcs) read this one list.
export const SALVO_BARS = [9.5, 10, 10.5, 11, 11.5, 12] as const;
export const SALVO_TIMES = SALVO_BARS.map((b) => BROADSIDE_TIME.bar(b));

export const BROADSIDE_SCORE_SECTIONS = [
  { index: 0, fromBar: BROADSIDE_BARS.launch },
  { index: 1, fromBar: BROADSIDE_BARS.melee1, crossfadeBars: 1 },
  { index: 2, fromBar: BROADSIDE_BARS.broadside, crossfadeBars: 1 },
  { index: 3, fromBar: BROADSIDE_BARS.eye, crossfadeBars: 1 },
  { index: 4, fromBar: BROADSIDE_BARS.melee2, crossfadeBars: 1 },
  { index: 5, fromBar: BROADSIDE_BARS.belly, crossfadeBars: 1 },
  { index: 6, fromBar: BROADSIDE_BARS.flagship, crossfadeBars: 1 },
  { index: 7, fromBar: BROADSIDE_BARS.trench, crossfadeBars: 1 },
] as const;

export const BROADSIDE_RUN_SECTIONS = [
  { name: 'launch', fromBar: BROADSIDE_BARS.launch, toBar: BROADSIDE_BARS.melee1 },
  { name: 'melee1', fromBar: BROADSIDE_BARS.melee1, toBar: BROADSIDE_BARS.broadside },
  { name: 'broadside', fromBar: BROADSIDE_BARS.broadside, toBar: BROADSIDE_BARS.eye },
  { name: 'eye', fromBar: BROADSIDE_BARS.eye, toBar: BROADSIDE_BARS.melee2 },
  { name: 'melee2', fromBar: BROADSIDE_BARS.melee2, toBar: BROADSIDE_BARS.belly },
  { name: 'belly', fromBar: BROADSIDE_BARS.belly, toBar: BROADSIDE_BARS.flagship },
  { name: 'flagship', fromBar: BROADSIDE_BARS.flagship, toBar: BROADSIDE_BARS.screen },
  { name: 'screen', fromBar: BROADSIDE_BARS.screen, toBar: BROADSIDE_BARS.trench },
  { name: 'trench', fromBar: BROADSIDE_BARS.trench, toBar: BROADSIDE_BARS.end },
] as const;

export const bar = BROADSIDE_TIME.bar;
