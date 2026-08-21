import { createMusicTime } from '../../engine/music-time';

// THERMAL INK runs at 96 BPM — a slow industrial stomp. One bar is 2.5 s and
// the fight lasts exactly 24 bars: 60 seconds from first lamp to blackout.

export const THERMAL_INK_V1D2_BPM = 96;
export const THERMAL_INK_V1D2_STEPS_PER_BAR = 16;
export const THERMAL_INK_V1D2_TIME = createMusicTime(THERMAL_INK_V1D2_BPM, {
  stepsPerBar: THERMAL_INK_V1D2_STEPS_PER_BAR,
});
export const THERMAL_INK_V1D2_BAR = THERMAL_INK_V1D2_TIME.barSeconds;

export const THERMAL_INK_V1D2_BARS = {
  descent: 0, // bars 0–4: the drowned harbor, the octopus looming far ahead
  engage: 4, // bar 4: first ink blast, the arms come alive
  hunt: 6, // bars 6–12: scavenger waves over the wreck field
  dive: 12, // bars 12–16: the rail dives beneath the hanging arms
  enrage: 16, // bars 16–20: blackout, relentless spawn pressure
  exposed: 20, // bar 20: the central core burns open
  blackout: 22, // bar 22.5: the final ink wall
  finale: 23, // bar 23: expected kill window, lamps return
  end: 24,
} as const;

export const THERMAL_INK_V1D2_MARKERS = THERMAL_INK_V1D2_TIME.markers({
  descent: THERMAL_INK_V1D2_BARS.descent,
  engage: THERMAL_INK_V1D2_BARS.engage,
  hunt: THERMAL_INK_V1D2_BARS.hunt,
  dive: THERMAL_INK_V1D2_BARS.dive,
  enrage: THERMAL_INK_V1D2_BARS.enrage,
  exposed: THERMAL_INK_V1D2_BARS.exposed,
  blackout: THERMAL_INK_V1D2_BARS.blackout,
  finale: THERMAL_INK_V1D2_BARS.finale,
  end: THERMAL_INK_V1D2_BARS.end,
});

export const THERMAL_INK_V1D2_DURATION = THERMAL_INK_V1D2_MARKERS.end;
export const ENGAGE_TIME = THERMAL_INK_V1D2_MARKERS.engage;
export const DIVE_TIME = THERMAL_INK_V1D2_MARKERS.dive;
export const ENRAGE_TIME = THERMAL_INK_V1D2_MARKERS.enrage;
export const EXPOSED_TIME = THERMAL_INK_V1D2_MARKERS.exposed;
/** The scripted final ink wall. */
export const BLACKOUT_TIME = THERMAL_INK_V1D2_TIME.bar(22, 2);
/** Fallback: the core unlocks here even if arms survive. */
export const CORE_FORCE_TIME = THERMAL_INK_V1D2_TIME.bar(21);

// Player-timbre sections. Index 4 ('thermal') is never entered by position —
// the level overrides into it while the camera is inside ink.
export const THERMAL_INK_V1D2_SCORE_SECTIONS = [
  { index: 0, fromBar: THERMAL_INK_V1D2_BARS.descent },
  { index: 1, fromBar: THERMAL_INK_V1D2_BARS.engage, crossfadeBars: 1 },
  { index: 2, fromBar: THERMAL_INK_V1D2_BARS.dive, crossfadeBars: 1 },
  { index: 3, fromBar: THERMAL_INK_V1D2_BARS.exposed, crossfadeBars: 1 },
  { index: 4, fromBar: THERMAL_INK_V1D2_BARS.end },
] as const;

export const THERMAL_INK_V1D2_RUN_SECTIONS = [
  { name: 'descent', fromBar: THERMAL_INK_V1D2_BARS.descent, toBar: THERMAL_INK_V1D2_BARS.engage },
  { name: 'engage', fromBar: THERMAL_INK_V1D2_BARS.engage, toBar: THERMAL_INK_V1D2_BARS.hunt },
  { name: 'hunt', fromBar: THERMAL_INK_V1D2_BARS.hunt, toBar: THERMAL_INK_V1D2_BARS.dive },
  { name: 'dive', fromBar: THERMAL_INK_V1D2_BARS.dive, toBar: THERMAL_INK_V1D2_BARS.enrage },
  { name: 'enrage', fromBar: THERMAL_INK_V1D2_BARS.enrage, toBar: THERMAL_INK_V1D2_BARS.exposed },
  { name: 'exposed', fromBar: THERMAL_INK_V1D2_BARS.exposed, toBar: THERMAL_INK_V1D2_BARS.blackout },
  { name: 'blackout', fromBar: THERMAL_INK_V1D2_BARS.blackout, toBar: THERMAL_INK_V1D2_BARS.end },
] as const;

export const bar = THERMAL_INK_V1D2_TIME.bar;
