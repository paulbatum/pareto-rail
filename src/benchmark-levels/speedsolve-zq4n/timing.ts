import { createMusicTime } from '../../engine/music-time';

// Speedsolve runs on a 144 BPM grid: one bar = 1.6667 s, and 36 bars is
// exactly the 60-second solve. The whole level is one clock:
//
//   bar  0        the cube wakes, first face already presented
//   bar  1..31    six five-bar face blocks
//   bar 31..36    the naked core
//
// A face block is always the same five bars, so the player learns the shape
// once and then reads it everywhere:
//
//   +0.00  the cube quarter-turns the next face into the frame
//   +0.45  the face scrambles; five sticker pips follow, one per solve move,
//          overlapping three-deep so a volley can take a whole run of squares
//   +3.38  whatever is unsolved is force-solved and the cube takes a bow
//   +3.75  the solved face falls away in loose cubies
//   +3.88  the weakpoint under it is exposed
//   +4.99  the socket shutters closed again
export const SPEEDSOLVE_BPM = 144;
export const SPEEDSOLVE_STEPS_PER_BAR = 16;
export const SPEEDSOLVE_TIME = createMusicTime(SPEEDSOLVE_BPM, { stepsPerBar: SPEEDSOLVE_STEPS_PER_BAR });

export const bar = SPEEDSOLVE_TIME.bar;
export const SPEEDSOLVE_BEAT = SPEEDSOLVE_TIME.beatSeconds;
export const SPEEDSOLVE_SIXTEENTH = SPEEDSOLVE_TIME.stepSeconds;

export const FACE_COUNT = 6;
export const FACE_BARS = 5;
export const FIRST_FACE_BAR = 1;
export const CORE_BAR = 31;
export const END_BAR = 36;

/** Arrangement bar where face `index` (0-based) takes the frame. */
export const faceBar = (index: number) => FIRST_FACE_BAR + index * FACE_BARS;
/** Run seconds where face `index` takes the frame. */
export const faceTime = (index: number) => bar(faceBar(index));

// Face-block offsets in bars, measured from the block's own start.
export const FACE_ARM_BAR = 0.45;
export const FACE_PIP_BARS = [0.5, 0.875, 1.3125, 1.75, 2.1875] as const;
export const FACE_PIP_LIFE = 1.85;
export const FACE_SEAL_BAR = 3.375;
export const FACE_FALL_BAR = 3.75;
export const FACE_WEAK_BAR = 3.875;
export const FACE_WEAK_LIFE = 1.85;

export const SPEEDSOLVE_DURATION = bar(END_BAR);
export const CORE_TIME = bar(CORE_BAR);

export const SPEEDSOLVE_MARKERS = SPEEDSOLVE_TIME.markers({
  wake: 0,
  face1: faceBar(0),
  face2: faceBar(1),
  face3: faceBar(2),
  face4: faceBar(3),
  face5: faceBar(4),
  face6: faceBar(5),
  core: CORE_BAR,
  end: END_BAR,
});

// Score sections pair the faces up: the arrangement thickens every ten bars
// while the per-face layer count (one per conquered face) does the fine work.
export const SPEEDSOLVE_SCORE_SECTIONS = [
  { index: 0, fromBar: 0 },
  { index: 1, fromBar: faceBar(0) },
  { index: 2, fromBar: faceBar(2), crossfadeBars: 1 },
  { index: 3, fromBar: faceBar(4), crossfadeBars: 1 },
  { index: 4, fromBar: CORE_BAR, crossfadeBars: 1 },
] as const;

export const SPEEDSOLVE_RUN_SECTIONS = [
  { name: 'wake', fromBar: 0, toBar: faceBar(0) },
  { name: 'inspection', fromBar: faceBar(0), toBar: faceBar(2) },
  { name: 'drive', fromBar: faceBar(2), toBar: faceBar(4) },
  { name: 'press', fromBar: faceBar(4), toBar: CORE_BAR },
  { name: 'core', fromBar: CORE_BAR, toBar: END_BAR },
] as const;
