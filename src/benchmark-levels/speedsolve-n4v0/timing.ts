import { createMusicTime } from '../../engine/music-time';

// SPEEDSOLVE runs at 120 BPM: 30 bars is exactly 60.000 seconds. Each of the
// six faces owns a four-bar window (8 s); the finale owns the last six bars.
// Everything — sticker arming, cube snaps, swings, the core reveal — hangs off
// this grid so the cube can be the percussion section.
export const SPEEDSOLVE_BPM = 120;
export const SPEEDSOLVE_STEPS_PER_BAR = 16;
export const SS_TIME = createMusicTime(SPEEDSOLVE_BPM, { stepsPerBar: SPEEDSOLVE_STEPS_PER_BAR });

export const FACE_COUNT = 6;
export const BARS_PER_FACE = 4;
export const WINDOW_BEATS = BARS_PER_FACE * SS_TIME.beatsPerBar; // 16
/** Beats of the window spent swinging the rail to the next face. */
export const SWING_BEATS = 3;
export const SWING_START_BEAT = WINDOW_BEATS - SWING_BEATS; // 13

export const SS_BARS = {
  face1: 0,
  face2: 4,
  face3: 8,
  face4: 12,
  face5: 16,
  face6: 20,
  finale: 24,
  lastStretch: 28,
  end: 30,
} as const;

export const SS_MARKERS = SS_TIME.markers({
  face1: SS_BARS.face1,
  face2: SS_BARS.face2,
  face3: SS_BARS.face3,
  face4: SS_BARS.face4,
  face5: SS_BARS.face5,
  face6: SS_BARS.face6,
  finale: SS_BARS.finale,
  lastStretch: SS_BARS.lastStretch,
  end: SS_BARS.end,
});

export const SS_DURATION = SS_MARKERS.end;
export const FINALE_TIME = SS_MARKERS.finale;
/** The core becomes a target one beat after the shell blows open. */
export const CORE_SPAWN_TIME = SS_TIME.bar(SS_BARS.finale, 1);
/** Earliest bar line the run may end on after the core dies. */
export const EARLIEST_END_TIME = SS_TIME.bar(SS_BARS.lastStretch);

export const BEAT_SECONDS = SS_TIME.beatSeconds;
export const EIGHTH_SECONDS = SS_TIME.beatSeconds / 2;
export const SIXTEENTH_SECONDS = SS_TIME.stepSeconds;

export function faceWindowStart(face: number) {
  return SS_TIME.bar(face * BARS_PER_FACE);
}

export function faceSwingStart(face: number) {
  return faceWindowStart(face) + SS_TIME.beats(SWING_START_BEAT);
}

export function faceWindowEnd(face: number) {
  return faceWindowStart(face + 1);
}

/** Which face window (0–5) a run time falls in, or 6 for the finale. */
export function faceAt(runTime: number) {
  return Math.min(FACE_COUNT, Math.max(0, Math.floor(runTime / SS_TIME.bar(BARS_PER_FACE))));
}

export const SS_SCORE_SECTIONS = [
  { index: 0, fromBar: SS_BARS.face1 },
  { index: 1, fromBar: SS_BARS.face3, crossfadeBars: 1 },
  { index: 2, fromBar: SS_BARS.face5, crossfadeBars: 1 },
  { index: 3, fromBar: SS_BARS.finale },
] as const;

export const SS_RUN_SECTIONS = [
  { name: 'face-1', fromBar: SS_BARS.face1, toBar: SS_BARS.face2 },
  { name: 'face-2', fromBar: SS_BARS.face2, toBar: SS_BARS.face3 },
  { name: 'face-3', fromBar: SS_BARS.face3, toBar: SS_BARS.face4 },
  { name: 'face-4', fromBar: SS_BARS.face4, toBar: SS_BARS.face5 },
  { name: 'face-5', fromBar: SS_BARS.face5, toBar: SS_BARS.face6 },
  { name: 'face-6', fromBar: SS_BARS.face6, toBar: SS_BARS.finale },
  { name: 'finale', fromBar: SS_BARS.finale, toBar: SS_BARS.lastStretch },
  { name: 'last-stretch', fromBar: SS_BARS.lastStretch },
] as const;
