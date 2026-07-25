import { createMusicTime } from '../../engine/music-time';

// One clock for the whole fight: 96 BPM, 16 steps per bar, 24 bars = 60.0 s.
// The ink blackouts are bar-aligned so gameplay, visuals, and the arrangement
// all read the same windows.
export const THERMAL_INK_BPM = 96;
export const INK_STEPS_PER_BAR = 16;
export const INK_TIME = createMusicTime(THERMAL_INK_BPM, { stepsPerBar: INK_STEPS_PER_BAR });

export const INK_BARS = {
  run: 0,
  armsA: 1.6,
  ink1: 6,
  murkB: 8,
  armsB: 8.4,
  ink2: 12,
  murkC: 14,
  armsC: 14.4,
  coreReveal: 18,
  ink3: 20,
  outro: 23,
} as const;

export const THERMAL_INK_RUN_DURATION = INK_TIME.bar(24);

export const INK_MARKERS = INK_TIME.markers({
  run: INK_BARS.run,
  armsA: INK_BARS.armsA,
  ink1: INK_BARS.ink1,
  murkB: INK_BARS.murkB,
  ink2: INK_BARS.ink2,
  murkC: INK_BARS.murkC,
  bossEntrance: INK_BARS.coreReveal,
  ink3: INK_BARS.ink3,
  outro: INK_BARS.outro,
});

// The three ink ejections. `from`/`to` bound the cloud itself; infrared snaps
// in IR_DELAY seconds after the ink swallows the view (the blind beat) and
// releases as the cloud thins after `to`.
export type InkWindow = { from: number; to: number };

export const INK_WINDOWS: readonly InkWindow[] = [
  { from: INK_TIME.bar(INK_BARS.ink1), to: INK_TIME.bar(INK_BARS.murkB) },
  { from: INK_TIME.bar(INK_BARS.ink2), to: INK_TIME.bar(INK_BARS.murkC) },
  { from: INK_TIME.bar(INK_BARS.ink3), to: INK_TIME.bar(INK_BARS.outro) },
];

const INK_RISE = 0.7;
const INK_FALL = 1.5;
const IR_DELAY = 0.9;
const IR_RISE = 0.14;
const IR_FALL = 0.6;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smooth(t: number) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Ink cloud density at run time `t`, 0..1. Ramps up fast at each ejection and thins slowly after the window. */
export function inkAt(t: number) {
  let level = 0;
  for (const window of INK_WINDOWS) {
    const rise = smooth((t - window.from) / INK_RISE);
    const fall = 1 - smooth((t - window.to) / INK_FALL);
    level = Math.max(level, Math.min(rise, fall));
  }
  return level;
}

/** Infrared engagement at run time `t`, 0..1. Snaps on after the blind beat, releases as the cloud thins. */
export function infraredAt(t: number) {
  let level = 0;
  for (const window of INK_WINDOWS) {
    const rise = smooth((t - window.from - IR_DELAY) / IR_RISE);
    const fall = 1 - smooth((t - window.to - IR_FALL * 0.4) / IR_FALL);
    level = Math.max(level, Math.min(rise, fall));
  }
  return level;
}

/** True while any ink window (cloud plus thinning tail) is active. */
export function inInkWindow(t: number) {
  return inkAt(t) > 0.02;
}

// Score sections: kill-lane and player-voice handover points. Ink sections get
// their own lanes; the finale owns the last four bars.
export type ThermalSection = 'm0' | 'i1' | 'm1' | 'i2' | 'm2' | 'fin';

export const THERMAL_SCORE_SECTIONS = [
  { index: 'm0', fromBar: INK_BARS.run },
  { index: 'i1', fromBar: INK_BARS.ink1 },
  { index: 'm1', fromBar: INK_BARS.murkB },
  { index: 'i2', fromBar: INK_BARS.ink2 },
  { index: 'm2', fromBar: INK_BARS.murkC },
  { index: 'fin', fromBar: INK_BARS.ink3 },
] as const;

export const THERMAL_RUN_SECTIONS = [
  { name: 'reveal', fromBar: INK_BARS.run, toBar: INK_BARS.armsA },
  { name: 'murk-a', fromBar: INK_BARS.armsA, toBar: INK_BARS.ink1 },
  { name: 'ink-1', fromBar: INK_BARS.ink1, toBar: INK_BARS.murkB },
  { name: 'murk-b', fromBar: INK_BARS.murkB, toBar: INK_BARS.ink2 },
  { name: 'ink-2', fromBar: INK_BARS.ink2, toBar: INK_BARS.murkC },
  { name: 'murk-c', fromBar: INK_BARS.murkC, toBar: INK_BARS.coreReveal },
  { name: 'core-reveal', fromBar: INK_BARS.coreReveal, toBar: INK_BARS.ink3 },
  { name: 'ink-3', fromBar: INK_BARS.ink3, toBar: INK_BARS.outro },
  { name: 'lamps-return', fromBar: INK_BARS.outro },
] as const;
