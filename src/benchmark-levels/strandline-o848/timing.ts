import { createMusicTime } from '../../engine/music-time';
import type { ScoreSection } from '../../engine/score';

// One authoritative clock for the whole level. 24 bars at 96 BPM = exactly
// 60 seconds, ending on the phrase where the strandline goes clean.
export const STRANDLINE_BPM = 96;
export const STRANDLINE_STEPS_PER_BAR = 16;
export const STRANDLINE_TIME = createMusicTime(STRANDLINE_BPM, { stepsPerBar: STRANDLINE_STEPS_PER_BAR });
export const bar = STRANDLINE_TIME.bar;

export const STRANDLINE_BARS = {
  drift: 0,
  bellReveal: 8,
  diveBack: 13,
  crownApproach: 15,
  parentEntrance: 16,
  parentFight: 16,
  cleanWater: 22,
  end: 24,
} as const;

export const STRANDLINE_MARKERS = STRANDLINE_TIME.markers(STRANDLINE_BARS);

export const STRANDLINE_DURATION = STRANDLINE_MARKERS.end;
export const BELL_REVEAL_TIME = STRANDLINE_MARKERS.bellReveal;
export const DIVE_BACK_TIME = STRANDLINE_MARKERS.diveBack;
export const PARENT_TIME = STRANDLINE_MARKERS.parentEntrance;
export const CLEAN_WATER_TIME = STRANDLINE_MARKERS.cleanWater;

export type StrandlineSection = 'drift' | 'open' | 'return' | 'parent' | 'serene';

export const STRANDLINE_SCORE_SECTIONS: ReadonlyArray<ScoreSection<StrandlineSection>> = [
  { index: 'drift', fromBar: 0 },
  { index: 'open', fromBar: STRANDLINE_BARS.bellReveal, crossfadeBars: 1 },
  { index: 'return', fromBar: STRANDLINE_BARS.diveBack, crossfadeBars: 1 },
  { index: 'parent', fromBar: STRANDLINE_BARS.parentFight, crossfadeBars: 1 },
  { index: 'serene', fromBar: STRANDLINE_BARS.cleanWater },
];

export const STRANDLINE_RUN_SECTIONS: ReadonlyArray<{ name: string; fromBar: number }> = [
  { name: 'the strands', fromBar: 0 },
  { name: 'open water', fromBar: STRANDLINE_BARS.bellReveal },
  { name: 'back in the strands', fromBar: STRANDLINE_BARS.diveBack },
  { name: 'the parent', fromBar: STRANDLINE_BARS.parentFight },
  { name: 'clean water', fromBar: STRANDLINE_BARS.cleanWater },
];

export const STRANDLINE_PLAYER_HEALTH = 4;

// ---- shared world constants -------------------------------------------------
// Gameplay (boss anchoring, brood launch points) and visuals (bell, crown,
// roots) must agree on where the animal is.

/** Center of the jellyfish bell in world space. */
export const BELL_CENTER = { x: -40, y: 60, z: -1120 } as const;
export const BELL_RADIUS = 210;
