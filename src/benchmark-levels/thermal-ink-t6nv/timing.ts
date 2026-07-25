import { createMusicTime } from '../../engine/music-time';

export const THERMAL_INK_T6NV_BPM = 116;
export const THERMAL_INK_T6NV_TIME = createMusicTime(THERMAL_INK_T6NV_BPM, { stepsPerBar: 16 });

// 29 bars at 116 BPM = exactly 60.00 seconds playable duration
export const THERMAL_INK_T6NV_RUN_BARS = 29;
export const THERMAL_INK_T6NV_RUN_DURATION = THERMAL_INK_T6NV_TIME.bar(THERMAL_INK_T6NV_RUN_BARS);

export const THERMAL_INK_T6NV_SECTIONS = [
  { name: 'HARBOR APPROACH', bar: 1 },
  { name: 'OUTER ARMS', bar: 5 },
  { name: 'FIRST BLACKOUT', bar: 9 },
  { name: 'SKIMMING STEEL', bar: 14 },
  { name: 'DEEP INK STORM', bar: 19 },
  { name: 'CORE EXPOSED', bar: 24 },
  { name: 'FINAL VOLLEY', bar: 27 },
  { name: 'COLLAPSE', bar: 29 },
] as const;

export const THERMAL_INK_T6NV_MARKERS: Record<string, number> = Object.fromEntries(
  THERMAL_INK_T6NV_SECTIONS.map((sec) => [sec.name, THERMAL_INK_T6NV_TIME.bar(sec.bar)]),
);
