import { createMusicTime } from '../../engine/music-time';
import type { ScoreSection } from '../../engine/score';

// One authoritative clock for the whole level. 30 bars at 112 BPM = 64.29 s,
// ending on the phrase boundary where the car seals into the station.
export const SKYHOOK_BPM = 112;
export const SKYHOOK_STEPS_PER_BAR = 16;
export const SKYHOOK_TIME = createMusicTime(SKYHOOK_BPM, { stepsPerBar: SKYHOOK_STEPS_PER_BAR });
export const bar = SKYHOOK_TIME.bar;

export const SKYHOOK_BARS = {
  liftoff: 0,
  firstWave: 1,
  cloudPunch: 8,
  thinAir: 14,
  bossClank: [17, 2],
  bossFight: 19,
  klaxon: 24,
  bossDeadline: 26,
  dock: 26,
  dockSeal: [28, 2],
  end: 30,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_TIME.markers(SKYHOOK_BARS);
export const SKYHOOK_DURATION = SKYHOOK_MARKERS.end;

export type SkyhookSection = 'storm' | 'cloud' | 'thin' | 'lamprey' | 'dock';

export const SKYHOOK_SCORE_SECTIONS: ReadonlyArray<ScoreSection<SkyhookSection>> = [
  { index: 'storm', fromBar: 0 },
  { index: 'cloud', fromBar: SKYHOOK_BARS.cloudPunch },
  { index: 'thin', fromBar: SKYHOOK_BARS.thinAir, crossfadeBars: 1 },
  { index: 'lamprey', fromBar: 18, crossfadeBars: 1 },
  { index: 'dock', fromBar: SKYHOOK_BARS.dock },
];

export const SKYHOOK_RUN_SECTIONS: ReadonlyArray<{ name: string; fromBar: number }> = [
  { name: 'stormline', fromBar: 0 },
  { name: 'cloudbreak', fromBar: SKYHOOK_BARS.cloudPunch },
  { name: 'thin air', fromBar: SKYHOOK_BARS.thinAir },
  { name: 'the lamprey', fromBar: 18 },
  { name: 'docking', fromBar: SKYHOOK_BARS.dock },
];

// Shared placement constants: gameplay (leech latch points, boss descent line)
// and visuals (tether, climber car, station) must agree on where the tether is.
export const TETHER_OFFSET_Y = -2.6;
export const CAR_AHEAD_UNITS = 7;

// Tether-leech schedule, shared by gameplay (latch + damage) and audio (whine cue):
// spiral-in for one bar, telegraphed wind-up for two, then a bite every two bars.
export const LEECH_APPROACH_SECONDS = SKYHOOK_TIME.barSeconds;
export const LEECH_WINDUP_SECONDS = SKYHOOK_TIME.barSeconds * 2;
export const LEECH_BITE_PERIOD_SECONDS = SKYHOOK_TIME.barSeconds * 2;

export const SKYHOOK_PLAYER_HEALTH = 4;
