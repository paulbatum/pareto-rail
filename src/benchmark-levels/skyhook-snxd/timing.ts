import { createMusicTime } from '../../engine/music-time';

// Skyhook rides a 128 BPM grid: one bar = 1.875 s, 32 bars = exactly the
// 60-second climb. The run's set pieces are bar boundaries first and
// altitudes second — the cloud deck breaks on the bar-8 drop, the air thins
// at bar 16, the Lamprey hits the tether at bar 19, and the station takes
// the car for the last three bars.
export const SKYHOOK_BPM = 128;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });
export const SKYHOOK_BAR = SKYHOOK_TIME.barSeconds;

export const SKYHOOK_BARS = {
  launch: 0,
  cloudbreak: 8,
  stratosphere: 16,
  breach: 19,
  lamprey: 20,
  dock: 29,
  end: 32,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers({
  launch: SKYHOOK_BARS.launch,
  cloudbreak: SKYHOOK_BARS.cloudbreak,
  stratosphere: SKYHOOK_BARS.stratosphere,
  breach: SKYHOOK_BARS.breach,
  lamprey: SKYHOOK_BARS.lamprey,
  dock: SKYHOOK_BARS.dock,
  end: SKYHOOK_BARS.end,
});

export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;
export const CLOUDBREAK_TIME = SKYHOOK_MARKERS.cloudbreak;
export const STRATOSPHERE_TIME = SKYHOOK_MARKERS.stratosphere;
export const BREACH_TIME = SKYHOOK_MARKERS.breach;
export const BOSS_TIME = SKYHOOK_MARKERS.lamprey;
export const DOCK_TIME = SKYHOOK_MARKERS.dock;

export const SKYHOOK_SCORE_SECTIONS = [
  { index: 0, fromBar: SKYHOOK_BARS.launch },
  { index: 1, fromBar: SKYHOOK_BARS.cloudbreak, crossfadeBars: 1 },
  { index: 2, fromBar: SKYHOOK_BARS.stratosphere, crossfadeBars: 2 },
  { index: 3, fromBar: SKYHOOK_BARS.lamprey, crossfadeBars: 1 },
  { index: 4, fromBar: SKYHOOK_BARS.dock, crossfadeBars: 1 },
] as const;

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'storm', fromBar: SKYHOOK_BARS.launch, toBar: SKYHOOK_BARS.cloudbreak },
  { name: 'jetstream', fromBar: SKYHOOK_BARS.cloudbreak, toBar: SKYHOOK_BARS.stratosphere },
  { name: 'stratosphere', fromBar: SKYHOOK_BARS.stratosphere, toBar: SKYHOOK_BARS.lamprey },
  { name: 'lamprey', fromBar: SKYHOOK_BARS.lamprey, toBar: SKYHOOK_BARS.dock },
  { name: 'dock', fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end },
] as const;

export const bar = SKYHOOK_TIME.bar;
