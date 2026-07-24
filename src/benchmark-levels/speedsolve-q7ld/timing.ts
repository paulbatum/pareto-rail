import { createMusicTime } from '../../engine/music-time';

// Speedsolve runs on a locked 128 BPM grid: one bar = 1.875 s, 32 bars =
// exactly the 60-second solve. The run is six identical 4-bar face sections
// (the mechanical certainty is the point), then the naked core for six bars
// and a two-bar confetti coda. Inside every face section the beats are law:
//
//   beats  0–10   solve window — four glowing squares, each kill ratchets a
//                 layer rotation onto the next beat
//   beat  10      the face falls away (or the hatch is forced open)
//   beats 10–14   weakpoint exposed in the machinery underneath
//   beats 14–16   the rail snaps 90° around the cube to the next face
export const SPEEDSOLVE_BPM = 128;
export const SPEEDSOLVE_STEPS_PER_BAR = 16;
export const SPEEDSOLVE_TIME = createMusicTime(SPEEDSOLVE_BPM, { stepsPerBar: SPEEDSOLVE_STEPS_PER_BAR });

export const FACE_SECTION_BARS = 4;
export const FACE_DWELL_BARS = 3.5; // camera holds the face this long; the last half-bar is the swing

export const SPEEDSOLVE_BARS = {
  face0: 0,
  face1: 4,
  face2: 8,
  face3: 12,
  face4: 16,
  face5: 20,
  core: 24,
  coda: 30,
  end: 32,
} as const;

export const SPEEDSOLVE_MARKERS = SPEEDSOLVE_TIME.markers({
  face0: SPEEDSOLVE_BARS.face0,
  face3: SPEEDSOLVE_BARS.face3,
  core: SPEEDSOLVE_BARS.core,
  coda: SPEEDSOLVE_BARS.coda,
  end: SPEEDSOLVE_BARS.end,
});

export const SPEEDSOLVE_DURATION = SPEEDSOLVE_MARKERS.end;
export const CORE_TIME = SPEEDSOLVE_MARKERS.core;
export const CODA_TIME = SPEEDSOLVE_MARKERS.coda;

// Face-section beat anatomy (beats from section start).
export const SOLVE_DEADLINE_BEATS = 10; // face falls / hatch forced
export const WEAKPOINT_RETIRE_BEATS = 14; // weakpoint retracts as the swing starts

export const SPEEDSOLVE_SCORE_SECTIONS = [
  { index: 0, fromBar: SPEEDSOLVE_BARS.face0 },
  { index: 1, fromBar: SPEEDSOLVE_BARS.face1 },
  { index: 2, fromBar: SPEEDSOLVE_BARS.face2 },
  { index: 3, fromBar: SPEEDSOLVE_BARS.face3 },
  { index: 4, fromBar: SPEEDSOLVE_BARS.face4 },
  { index: 5, fromBar: SPEEDSOLVE_BARS.face5 },
  { index: 6, fromBar: SPEEDSOLVE_BARS.core },
  { index: 7, fromBar: SPEEDSOLVE_BARS.coda },
] as const;

export const SPEEDSOLVE_RUN_SECTIONS = [
  { name: 'face-1', fromBar: SPEEDSOLVE_BARS.face0 },
  { name: 'face-2', fromBar: SPEEDSOLVE_BARS.face1 },
  { name: 'face-3', fromBar: SPEEDSOLVE_BARS.face2 },
  { name: 'face-4', fromBar: SPEEDSOLVE_BARS.face3 },
  { name: 'face-5', fromBar: SPEEDSOLVE_BARS.face4 },
  { name: 'face-6', fromBar: SPEEDSOLVE_BARS.face5 },
  { name: 'core', fromBar: SPEEDSOLVE_BARS.core },
  { name: 'coda', fromBar: SPEEDSOLVE_BARS.coda },
] as const;

export const bar = SPEEDSOLVE_TIME.bar;
export const beats = SPEEDSOLVE_TIME.beats;
export const BEAT_SECONDS = SPEEDSOLVE_TIME.beatSeconds;

/** Section start time for a face index (0..5). */
export function faceStart(face: number) {
  return bar(face * FACE_SECTION_BARS);
}

/** Which face section a run time falls in, or -1 outside the face acts. */
export function faceAt(time: number) {
  if (time < 0 || time >= CORE_TIME) return -1;
  return Math.min(5, Math.floor(time / bar(FACE_SECTION_BARS)));
}
