import { createMusicTime } from '../../engine/music-time';

// Vespers moves at an organist's pace: 84 BPM, common time, sixteen steps to
// the bar. The whole run is 22 bars (~63s) so the finale can land on the last
// held chord of the progression instead of being cut off by the clock.
export const VESPERS_BPM = 84;
export const VESPERS_STEPS_PER_BAR = 16;
export const VESPERS_TIME = createMusicTime(VESPERS_BPM, { stepsPerBar: VESPERS_STEPS_PER_BAR });

// Arrangement bars. The voices of the organ enter one at a time across the
// processional, the full choir holds the feast, the nave goes quiet, and the
// rose section builds back into the tutti that carries the ignition.
export const VESPERS_BARS = {
  run: 0,
  voice2: 2,
  voice3: 4,
  voice4: 6,
  feast: 8,
  silence: 14,
  rose: 17,
  tutti: 20,
  ignition: 21,
} as const;

export const VESPERS_MARKERS = VESPERS_TIME.markers({
  run: VESPERS_BARS.run,
  feast: VESPERS_BARS.feast,
  silence: VESPERS_BARS.silence,
  rose: VESPERS_BARS.rose,
  tutti: VESPERS_BARS.tutti,
  ignition: VESPERS_BARS.ignition,
});

// 22 bars plus a held half-bar: the ignition's major chord gets room to
// ring before the summary, and the Devourer's window stays generous.
export const VESPERS_RUN_DURATION = VESPERS_TIME.bar(22, 2);

// Player-instrument sections. The handover into the feast crossfades (the
// backing only grows there), the silence cuts hard because that IS the
// section, and the rose snaps with the boss entrance.
export const VESPERS_SCORE_SECTIONS = [
  { index: 0 as const, fromBar: VESPERS_BARS.run },
  { index: 1 as const, fromBar: VESPERS_BARS.feast, crossfadeBars: 2 },
  { index: 2 as const, fromBar: VESPERS_BARS.silence, crossfadeBars: 1 },
  { index: 3 as const, fromBar: VESPERS_BARS.rose },
];

export const VESPERS_RUN_SECTIONS = [
  { name: 'processional', fromBar: VESPERS_BARS.run, toBar: VESPERS_BARS.feast },
  { name: 'feast', fromBar: VESPERS_BARS.feast, toBar: VESPERS_BARS.silence },
  { name: 'silence', fromBar: VESPERS_BARS.silence, toBar: VESPERS_BARS.rose },
  { name: 'rose', fromBar: VESPERS_BARS.rose, toBar: VESPERS_BARS.tutti },
  { name: 'tutti', fromBar: VESPERS_BARS.tutti },
] as const;
