import { createMusicTime } from '../../engine/music-time';

// One authoritative clock. 128 BPM, 16 steps per bar: 32 bars is exactly
// sixty seconds, and every face of the cube gets one four-bar phrase.
export const SPEEDSOLVE_BPM = 128;
export const SPEEDSOLVE_STEPS_PER_BAR = 16;
export const SPEEDSOLVE_TIME = createMusicTime(SPEEDSOLVE_BPM, { stepsPerBar: SPEEDSOLVE_STEPS_PER_BAR });
export const BEAT = SPEEDSOLVE_TIME.beatSeconds;
export const SPEEDSOLVE_BARS_TOTAL = 32;
export const SPEEDSOLVE_RUN_DURATION = SPEEDSOLVE_TIME.bar(SPEEDSOLVE_BARS_TOTAL);

export const FACE_COUNT = 6;
export const FACE_PHRASE_BARS = 4;
/** Bar where face k's phrase begins (the camera has just swung onto it). */
export const faceBar = (face: number) => 2 + face * FACE_PHRASE_BARS;
/** Beat (from run start) where face k's phrase begins. */
export const faceBeat = (face: number) => faceBar(face) * 4;

// Beats measured from the start of a face phrase.
export const FACE_BEATS = {
  /** Glowing target brackets arm on the face. */
  tilesArm: 1.25,
  /** Unsolved rows are turned by the machine itself from here. */
  tileDeadline: 10,
  /** The exposed weakpoint retracts; the camera leaves right after. */
  weakpointDeadline: 14,
  /** The rail swings to the next face across this window. */
  swingFrom: 14.25,
  swingTo: 16.75,
} as const;

export const SPEEDSOLVE_BARS = {
  assemble: 0,
  firstFace: faceBar(0),
  shell: 26,
  coreArmed: 26.5,
  coreDeadline: 30,
  end: SPEEDSOLVE_BARS_TOTAL,
} as const;

export const SPEEDSOLVE_MARKERS = SPEEDSOLVE_TIME.markers({
  assemble: SPEEDSOLVE_BARS.assemble,
  faceF: faceBar(0),
  faceR: faceBar(1),
  faceU: faceBar(2),
  faceB: faceBar(3),
  faceL: faceBar(4),
  faceD: faceBar(5),
  core: SPEEDSOLVE_BARS.shell,
  confetti: SPEEDSOLVE_BARS.coreDeadline,
});

export const SPEEDSOLVE_SECTIONS = [
  { name: 'assembly', fromBar: 0 },
  { name: 'face 1 · red', fromBar: faceBar(0) },
  { name: 'face 2 · blue', fromBar: faceBar(1) },
  { name: 'face 3 · yellow', fromBar: faceBar(2) },
  { name: 'face 4 · green', fromBar: faceBar(3) },
  { name: 'face 5 · orange', fromBar: faceBar(4) },
  { name: 'face 6 · pink', fromBar: faceBar(5) },
  { name: 'naked core', fromBar: SPEEDSOLVE_BARS.shell },
  { name: 'confetti', fromBar: SPEEDSOLVE_BARS.coreDeadline },
] as const;
