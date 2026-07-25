import { createMusicTime } from '../../engine/music-time';

// One 60-second solve, laid out as an exact bar grid so every rotation, snap and
// face transition can be authored on a beat: 36 bars at 144 BPM is 60.000 s.
//
//   bar  0 .. 2   intro      the cube arrives and presents its first face
//   bar  2 .. 32  six faces  5 bars each: solve, conquer, break the weakpoint
//   bar 32 .. 36  core       the shell blooms open and the naked core dies
export const SPEEDSOLVE_BPM = 144;
export const SPEEDSOLVE_STEPS_PER_BAR = 16;
export const SPEEDSOLVE_TIME = createMusicTime(SPEEDSOLVE_BPM, { stepsPerBar: SPEEDSOLVE_STEPS_PER_BAR });

export const FACE_COUNT = 6;
export const FACE_BARS = 5;

export const SPEEDSOLVE_BARS = {
  intro: 0,
  firstFace: 2,
  core: 32,
  end: 36,
} as const;

/** Absolute arrangement bar where each face becomes the presented face. */
export const FACE_START_BARS = Array.from(
  { length: FACE_COUNT },
  (_unused, index) => SPEEDSOLVE_BARS.firstFace + index * FACE_BARS,
);

/**
 * A presentation swing occupies the last three quarters of the previous section:
 * the camera rolls 60 degrees, the cube quarter-turns, and the incoming face
 * riffles its squares into a scramble before it faces the player.
 */
export const SWING_BARS = 0.75;
export const SWING_SECONDS = SPEEDSOLVE_TIME.bar(0, SWING_BARS * SPEEDSOLVE_TIME.beatsPerBar);

export const SPEEDSOLVE_RUN_DURATION = SPEEDSOLVE_TIME.bar(SPEEDSOLVE_BARS.end);

/** Player-instrument voicings; the backing arrangement layers per face section. */
export type SpeedsolveSection = 0 | 1 | 2 | 3;
export const SPEEDSOLVE_SCORE_SECTIONS = [
  { index: 0, fromBar: SPEEDSOLVE_BARS.intro },
  { index: 1, fromBar: FACE_START_BARS[2], crossfadeBars: 2 },
  { index: 2, fromBar: FACE_START_BARS[4], crossfadeBars: 2 },
  { index: 3, fromBar: SPEEDSOLVE_BARS.core },
] as const satisfies ReadonlyArray<{ index: SpeedsolveSection; fromBar: number; crossfadeBars?: number }>;

export const SPEEDSOLVE_RUN_SECTIONS = [
  { name: 'intro', fromBar: SPEEDSOLVE_BARS.intro, toBar: FACE_START_BARS[0] },
  { name: 'face-1', fromBar: FACE_START_BARS[0], toBar: FACE_START_BARS[1] },
  { name: 'face-2', fromBar: FACE_START_BARS[1], toBar: FACE_START_BARS[2] },
  { name: 'face-3', fromBar: FACE_START_BARS[2], toBar: FACE_START_BARS[3] },
  { name: 'face-4', fromBar: FACE_START_BARS[3], toBar: FACE_START_BARS[4] },
  { name: 'face-5', fromBar: FACE_START_BARS[4], toBar: FACE_START_BARS[5] },
  { name: 'face-6', fromBar: FACE_START_BARS[5], toBar: SPEEDSOLVE_BARS.core },
  { name: 'core', fromBar: SPEEDSOLVE_BARS.core },
] as const;

export const SPEEDSOLVE_MARKERS = SPEEDSOLVE_TIME.markers({
  cubeArrival: SPEEDSOLVE_BARS.intro,
  firstFace: FACE_START_BARS[0],
  thirdFace: FACE_START_BARS[2],
  fifthFace: FACE_START_BARS[4],
  lastFace: FACE_START_BARS[5],
  coreExposed: [SPEEDSOLVE_BARS.core, 3],
});
