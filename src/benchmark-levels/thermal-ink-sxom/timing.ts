import { createMusicTime } from '../../engine/music-time';

export const THERMAL_INK_SXOM_BPM = 96;
export const THERMAL_INK_SXOM_STEPS_PER_BAR = 16;
export const THERMAL_INK_SXOM_TIME = createMusicTime(THERMAL_INK_SXOM_BPM, {
  stepsPerBar: THERMAL_INK_SXOM_STEPS_PER_BAR,
});

export const THERMAL_INK_SXOM_BARS = {
  sighting: 0,
  firstBlackout: 4,
  cableYard: 6,
  secondBlackout: 9.5,
  drownedSlip: 12,
  thirdBlackout: 14.5,
  coreBreak: 18,
  finalBlackout: 20.8,
  collapse: 23.45,
  end: 24,
} as const;

export const THERMAL_INK_SXOM_MARKERS = THERMAL_INK_SXOM_TIME.markers({
  sighting: THERMAL_INK_SXOM_BARS.sighting,
  firstInk: THERMAL_INK_SXOM_BARS.firstBlackout,
  cableYard: THERMAL_INK_SXOM_BARS.cableYard,
  secondInk: THERMAL_INK_SXOM_BARS.secondBlackout,
  underTheArms: THERMAL_INK_SXOM_BARS.drownedSlip,
  thirdInk: THERMAL_INK_SXOM_BARS.thirdBlackout,
  coreBreak: THERMAL_INK_SXOM_BARS.coreBreak,
  finalInk: THERMAL_INK_SXOM_BARS.finalBlackout,
  collapse: THERMAL_INK_SXOM_BARS.collapse,
  end: THERMAL_INK_SXOM_BARS.end,
});

export const THERMAL_INK_SXOM_RUN_DURATION = THERMAL_INK_SXOM_MARKERS.end;

export type ThermalInkSection =
  | 'sighting'
  | 'first-ink'
  | 'cable-yard'
  | 'drowned-slip'
  | 'core-break'
  | 'final-ink';

export const THERMAL_INK_SXOM_SCORE_SECTIONS = [
  { index: 'sighting', fromBar: 0 },
  { index: 'first-ink', fromBar: 4 },
  { index: 'cable-yard', fromBar: 6 },
  { index: 'drowned-slip', fromBar: 12 },
  { index: 'core-break', fromBar: 18 },
  { index: 'final-ink', fromBar: 21 },
] as const;

export const THERMAL_INK_SXOM_ARRANGEMENT_SECTIONS = [
  { name: 'sighting', fromBar: 0, toBar: 4 },
  { name: 'first-ink', fromBar: 4, toBar: 6 },
  { name: 'cable-yard', fromBar: 6, toBar: 12 },
  { name: 'drowned-slip', fromBar: 12, toBar: 18 },
  { name: 'core-break', fromBar: 18, toBar: 21 },
  { name: 'final-ink', fromBar: 21, toBar: 24 },
] as const;

export const THERMAL_INK_SXOM_INK_WINDOWS = [
  { start: THERMAL_INK_SXOM_TIME.bar(4), end: THERMAL_INK_SXOM_TIME.bar(6), label: 'INK FRONT 01' },
  { start: THERMAL_INK_SXOM_TIME.bar(9.5), end: THERMAL_INK_SXOM_TIME.bar(11.8), label: 'INK FRONT 02' },
  { start: THERMAL_INK_SXOM_TIME.bar(14.5), end: THERMAL_INK_SXOM_TIME.bar(17), label: 'INK FRONT 03' },
  { start: THERMAL_INK_SXOM_TIME.bar(20.8), end: THERMAL_INK_SXOM_TIME.bar(23.7), label: 'TOTAL BLACKOUT' },
] as const;

export const THERMAL_INK_SXOM_TIMEBASE = {
  bpm: THERMAL_INK_SXOM_BPM,
  beatsPerBar: THERMAL_INK_SXOM_TIME.beatsPerBar,
  stepsPerBar: THERMAL_INK_SXOM_STEPS_PER_BAR,
  beatSeconds: THERMAL_INK_SXOM_TIME.beatSeconds,
  barSeconds: THERMAL_INK_SXOM_TIME.barSeconds,
  stepSeconds: THERMAL_INK_SXOM_TIME.stepSeconds,
} as const;

export const THERMAL_INK_SXOM_SPAWN_SYNC = {
  bpm: THERMAL_INK_SXOM_BPM,
  beatsPerBar: THERMAL_INK_SXOM_TIME.beatsPerBar,
  duration: THERMAL_INK_SXOM_RUN_DURATION,
  durationBars: THERMAL_INK_SXOM_BARS.end,
  sections: THERMAL_INK_SXOM_ARRANGEMENT_SECTIONS.map(({ name, fromBar, toBar }) => ({
    name,
    fromBar,
    toBar,
  })),
};

function smoothstep01(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export function thermalInkDensityAt(runTime: number) {
  let density = 0;
  for (const window of THERMAL_INK_SXOM_INK_WINDOWS) {
    const rise = smoothstep01((runTime - (window.start - 0.7)) / 1.05);
    const fall = 1 - smoothstep01((runTime - (window.end - 0.8)) / 1.15);
    density = Math.max(density, Math.min(rise, fall));
  }
  return density;
}

