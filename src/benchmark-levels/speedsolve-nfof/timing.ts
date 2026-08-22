import { createMusicTime } from '../../engine/music-time';

// One authoritative clock for the whole level. 128 BPM, 4/4, 32 bars = exactly
// 60.0 seconds — the run ends on the resolution of the final phrase. The cube
// is the percussion section, so every authored moment lands on this grid:
// two-bar boot, six solve phases of 3.5 bars each (bars 2–23), then the naked
// core finale (bars 23–32).

export const SPEEDSOLVE_BPM = 128;
export const SPEEDSOLVE_STEPS_PER_BAR = 16;
export const SPEEDSOLVE_TIME = createMusicTime(SPEEDSOLVE_BPM, { stepsPerBar: SPEEDSOLVE_STEPS_PER_BAR });
export const bar = SPEEDSOLVE_TIME.bar;

export const SPEEDSOLVE_BARS = {
  boot: 0,
  firstFace: 2,
  // Six solve phases, 3.5 bars each: bars 2–23.
  lastFaceEnd: 23,
  coreReveal: 23,
  coreReady: [24, 2],
  end: 32,
} as const;

export const SPEEDSOLVE_MARKERS = SPEEDSOLVE_TIME.markers(SPEEDSOLVE_BARS);
export const SPEEDSOLVE_DURATION = SPEEDSOLVE_MARKERS.end;

// Solve-phase geometry: each face owns a 3.5-bar window.
export const FACE_COUNT = 6;
export const FACE_START_BAR = SPEEDSOLVE_BARS.firstFace;
export const FACE_BARS = 3.5;
export const FACE_SECONDS = SPEEDSOLVE_TIME.barSeconds * FACE_BARS;
export const faceStartTime = (face: number) => bar(FACE_START_BAR + face * FACE_BARS);

export type SpeedsolveSection = 'boot' | 'solve' | 'climax' | 'core';

export const SPEEDSOLVE_SCORE_SECTIONS: ReadonlyArray<{ index: SpeedsolveSection; fromBar: number; crossfadeBars?: number }> = [
  { index: 'boot', fromBar: 0 },
  { index: 'solve', fromBar: SPEEDSOLVE_BARS.firstFace, crossfadeBars: 1 },
  { index: 'climax', fromBar: 16, crossfadeBars: 1 },
  { index: 'core', fromBar: SPEEDSOLVE_BARS.coreReveal },
];

// ---- shared spatial constants ------------------------------------------------

// The cube rides the rail a fixed distance ahead of the camera; the helix rail
// makes the camera genuinely revolve around it while it stays in frame.
export const CUBE_LEAD_UNITS = 36;
export const CUBE_HALF = 8.25; // shell half-size; three cells at CELL_PITCH span 16.5
export const CELL_PITCH = 5.5;
export const FACE_LIFT = 0.5; // how far proud of the shell the active cells sit
export const ORBIT_NEAR = 9.5; // polyhedra orbit between these depths off the face
export const ORBIT_FAR = 13;

export const SPEEDSOLVE_PLAYER_HEALTH = 4;

// Tetra bolt schedule (seconds after a tetra spawns): telegraphed, spaced.
export const TETRA_FIRE_AGES = [1.9, 4.4];
export const BOLT_MAX_AGE = 9;
