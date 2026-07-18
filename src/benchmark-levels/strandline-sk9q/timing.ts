import { createMusicTime } from '../../engine/music-time';
import type { ScoreSection } from '../../engine/score';

// One authoritative clock for the whole level. 28 bars at 112 BPM is exactly
// 60.00 s; the run ends on the phrase boundary as the freed jelly drifts on.
//
//   drift      (0–4)    Slow pulse in sunlit water; sparse latched parasites.
//   strandwood (4–8)    The strand forest; heartbeat and skitters arrive.
//   greenmoon  (8–12)   A wide swing: the bell fills the view. The mix brightens.
//   souring    (12–16)  Deeper water, denser violet: husks and spitters.
//   crown      (16–19)  Second wide swing; the crown and its webbing ahead.
//   parent     (19–26)  The parent organism pumps out broods behind its web.
//   release    (26–28)  Serene coda: camera falls back, every strand clean.
export const STRANDLINE_SK9Q_BPM = 112;
export const STRANDLINE_SK9Q_STEPS_PER_BAR = 16;
export const STRANDLINE_SK9Q_TIME = createMusicTime(STRANDLINE_SK9Q_BPM, { stepsPerBar: STRANDLINE_SK9Q_STEPS_PER_BAR });
export const bar = STRANDLINE_SK9Q_TIME.bar;

export const STRANDLINE_SK9Q_BARS = {
  drift: 0,
  strandwood: 4,
  reveal1: 8,
  souring: 12,
  reveal2: 16,
  approach: 18,
  parent: 19,
  brood2: 21,
  brood3: 23,
  /** If the parent is still alive here it burrows and the run closes unresolved. */
  deadline: [25, 2],
  release: 26,
  end: 28,
} as const;

export const STRANDLINE_SK9Q_MARKERS = STRANDLINE_SK9Q_TIME.markers(STRANDLINE_SK9Q_BARS);
export const STRANDLINE_SK9Q_DURATION = STRANDLINE_SK9Q_MARKERS.end;

export type StrandlineSection = 'drift' | 'strandwood' | 'greenmoon' | 'souring' | 'crown' | 'parent' | 'release';

export const STRANDLINE_SK9Q_SCORE_SECTIONS: ReadonlyArray<ScoreSection<StrandlineSection>> = [
  { index: 'drift', fromBar: STRANDLINE_SK9Q_BARS.drift },
  { index: 'strandwood', fromBar: STRANDLINE_SK9Q_BARS.strandwood, crossfadeBars: 1 },
  { index: 'greenmoon', fromBar: STRANDLINE_SK9Q_BARS.reveal1 },
  { index: 'souring', fromBar: STRANDLINE_SK9Q_BARS.souring, crossfadeBars: 1 },
  { index: 'crown', fromBar: STRANDLINE_SK9Q_BARS.reveal2, crossfadeBars: 1 },
  { index: 'parent', fromBar: STRANDLINE_SK9Q_BARS.parent },
  { index: 'release', fromBar: STRANDLINE_SK9Q_BARS.release },
];

export const STRANDLINE_SK9Q_RUN_SECTIONS: ReadonlyArray<{ name: string; fromBar: number }> = [
  { name: 'drift', fromBar: STRANDLINE_SK9Q_BARS.drift },
  { name: 'strandwood', fromBar: STRANDLINE_SK9Q_BARS.strandwood },
  { name: 'green moon', fromBar: STRANDLINE_SK9Q_BARS.reveal1 },
  { name: 'the souring', fromBar: STRANDLINE_SK9Q_BARS.souring },
  { name: 'crown approach', fromBar: STRANDLINE_SK9Q_BARS.reveal2 },
  { name: 'the parent', fromBar: STRANDLINE_SK9Q_BARS.parent },
  { name: 'release', fromBar: STRANDLINE_SK9Q_BARS.release },
];

export const STRANDLINE_SK9Q_PLAYER_HEALTH = 4;

// Shared world layout: gameplay (boss anchor, lunge lines) and visuals (bell,
// strands, crown, webbing) must agree on where the animal hangs in the water.
export const CROWN_X = 6;
export const CROWN_Y = 33;
export const CROWN_Z = -535;
export const BELL_RADIUS = 30;
export const BELL_CENTER_Y = 54;
export const BELL_CENTER_Z = -547;
