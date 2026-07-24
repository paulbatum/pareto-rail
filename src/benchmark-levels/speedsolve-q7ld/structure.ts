import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import {
  CODA_TIME,
  CORE_TIME,
  FACE_DWELL_BARS,
  FACE_SECTION_BARS,
  SPEEDSOLVE_DURATION,
  bar,
} from './timing';

// The arena is one object: a colossal twisting-puzzle cube hanging in a pale
// void, balanced on a corner (its long diagonal is vertical, so no face ever
// points straight up or down and the shared camera rig stays stable). The
// rail is a quantized orbit: it holds dead-on in front of a face for 3.5
// bars, then snaps 90° around an edge in exactly two beats to the next face —
// the camera moves the way the cube's own layers do.

export const CUBE_CENTER = new Vector3(0, 0, 0);
export const TILE_PITCH = 8;
export const TILE_SIZE = 7.0;
export const TILE_DEPTH = 1.4;
export const CUBE_HALF = 12.4; // chassis half-extent
export const TILE_SURFACE = CUBE_HALF + 0.8; // tile faces sit proud of the chassis
export const CAMERA_DISTANCE = 40;
export const FACE_COUNT = 6;

const WORLD_UP = new Vector3(0, 1, 0);

// Stand the cube on its corner: the (1,1,1) diagonal becomes vertical.
export const CUBE_TILT = new Quaternion().setFromUnitVectors(
  new Vector3(1, 1, 1).normalize(),
  WORLD_UP,
);

// Visit order is a Hamiltonian path over face adjacency, so every rail swing
// is a single 90° turn around one shared edge. Each face's in-plane axes are
// the cube's own edge directions (right-handed r×u=n), tilted with the cube —
// tile grids and chassis plates must align with the true edges or their
// corners physically poke through the neighboring faces.
const LOCAL_FACE_BASES: ReadonlyArray<readonly [Vector3, Vector3, Vector3]> = [
  [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)],
  [new Vector3(0, 0, -1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)],
  [new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 1, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, -1, 0)],
];

export type FaceFrame = {
  normal: Vector3;
  right: Vector3;
  up: Vector3;
};

export const FACE_FRAMES: FaceFrame[] = LOCAL_FACE_BASES.map(([right, up, normal]) => ({
  normal: normal.clone().applyQuaternion(CUBE_TILT).normalize(),
  right: right.clone().applyQuaternion(CUBE_TILT).normalize(),
  up: up.clone().applyQuaternion(CUBE_TILT).normalize(),
}));

/** Orientation whose local X/Y/Z axes are a face's right/up/normal. */
export const FACE_QUATS: Quaternion[] = FACE_FRAMES.map((frame) => {
  const basis = new Matrix4().makeBasis(frame.right, frame.up, frame.normal);
  return new Quaternion().setFromRotationMatrix(basis);
});

/** World position offset from a face: x along face-right, y along face-up, forward off the face surface. */
export function faceWorld(face: number, x: number, y: number, forward: number, out = new Vector3()) {
  const frame = FACE_FRAMES[face];
  return out
    .copy(CUBE_CENTER)
    .addScaledVector(frame.normal, CUBE_HALF + forward)
    .addScaledVector(frame.right, x)
    .addScaledVector(frame.up, y);
}

/** Tile indices are row-major over the 3×3 grid, 0 = bottom-left, 4 = center, 8 = top-right. */
export function tileOffset(tile: number): { x: number; y: number } {
  return { x: ((tile % 3) - 1) * TILE_PITCH, y: (Math.floor(tile / 3) - 1) * TILE_PITCH };
}

export function tileCenter(face: number, tile: number, proud = 0, out = new Vector3()) {
  const { x, y } = tileOffset(tile);
  return faceWorld(face, x, y, TILE_SURFACE - CUBE_HALF + proud, out);
}

/** The 8 outer tiles in counter-clockwise ring order (as seen from outside, +right/+up frame). */
export const RING_ORDER = [0, 1, 2, 5, 8, 7, 6, 3] as const;

// ---- camera path -------------------------------------------------------------

const SWING_BARS = FACE_SECTION_BARS - FACE_DWELL_BARS; // two beats
const FINALE_EL = 0.2; // rad — the finale orbit lifts to a slight overlook
const FINALE_AZ_RATE = 0.055; // rad per second of orbital drift around the core

const scratchDir = new Vector3();
const scratchNext = new Vector3();
const scratchRight = new Vector3();
const scratchUp = new Vector3();

function smoothstep01(t: number) {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Orbit direction (unit, cube-center → camera) at run time `t`. */
function orbitDirAt(time: number, out: Vector3) {
  if (time < CORE_TIME) {
    const face = Math.min(5, Math.floor(time / bar(FACE_SECTION_BARS)));
    const local = time - face * bar(FACE_SECTION_BARS);
    out.copy(FACE_FRAMES[face].normal);
    if (local > bar(FACE_DWELL_BARS) && face < 5) {
      const e = smoothstep01((local - bar(FACE_DWELL_BARS)) / bar(SWING_BARS));
      out.lerp(FACE_FRAMES[face + 1].normal, e).normalize();
    }
    return out;
  }
  // Finale and coda: a slow free orbit that starts exactly on the last face
  // normal, lifts toward a shallow overlook, and keeps circling the core.
  const last = FACE_FRAMES[5].normal;
  const az0 = Math.atan2(last.x, last.z);
  const el0 = Math.asin(MathUtils.clamp(last.y, -1, 1));
  const dt = time - CORE_TIME;
  const el = MathUtils.lerp(el0, FINALE_EL, smoothstep01(dt / bar(2.5)));
  const az = az0 + dt * FINALE_AZ_RATE;
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

function orbitRadiusAt(time: number) {
  if (time < CORE_TIME) return CAMERA_DISTANCE + Math.sin(time * 0.7) * 0.8;
  const pull = smoothstep01((time - CORE_TIME) / bar(3));
  const coda = smoothstep01((time - CODA_TIME) / bar(2));
  return CAMERA_DISTANCE + pull * 9 + coda * 4;
}

/** Authored camera position at run time `t` (the rail is sampled from this). */
export function cameraPosAt(time: number, out = new Vector3()) {
  const t = MathUtils.clamp(time, 0, SPEEDSOLVE_DURATION);
  orbitDirAt(t, scratchDir);
  scratchRight.crossVectors(WORLD_UP, scratchDir).normalize();
  scratchUp.crossVectors(scratchDir, scratchRight).normalize();
  const settle = t < CORE_TIME ? 1 : 0.5;
  const dx = Math.sin(t * 0.53 + 1.3) * 2.0 * settle;
  const dy = Math.cos(t * 0.41 + 0.6) * 1.5 * settle;
  return out
    .copy(CUBE_CENTER)
    .addScaledVector(scratchDir, orbitRadiusAt(t))
    .addScaledVector(scratchRight, dx)
    .addScaledVector(scratchUp, dy);
}

/** Where the camera should be looking at run time `t`. */
export function aimPointAt(time: number, out = new Vector3()) {
  if (time >= CORE_TIME) return out.copy(CUBE_CENTER);
  const face = Math.min(5, Math.floor(time / bar(FACE_SECTION_BARS)));
  const local = time - face * bar(FACE_SECTION_BARS);
  out.copy(FACE_FRAMES[face].normal);
  if (local > bar(FACE_DWELL_BARS) && face < 5) {
    const e = smoothstep01((local - bar(FACE_DWELL_BARS)) / bar(SWING_BARS));
    out.lerp(FACE_FRAMES[face + 1].normal, e);
  }
  return out.multiplyScalar(2.5).add(CUBE_CENTER);
}

export type SwingInfo = {
  /** Face being left. */
  from: number;
  /** 0..1 through the two-beat swing. */
  t: number;
  /** Signed roll direction for camera lean. */
  sign: number;
};

/** Non-null while the rail is snapping between faces. */
export function swingAt(time: number): SwingInfo | null {
  if (time < 0 || time >= CORE_TIME) return null;
  const face = Math.min(5, Math.floor(time / bar(FACE_SECTION_BARS)));
  if (face >= 5) return null;
  const local = time - face * bar(FACE_SECTION_BARS);
  if (local <= bar(FACE_DWELL_BARS)) return null;
  const t = (local - bar(FACE_DWELL_BARS)) / bar(SWING_BARS);
  orbitDirAt(time, scratchDir);
  scratchNext.copy(FACE_FRAMES[face + 1].normal).sub(FACE_FRAMES[face].normal);
  scratchRight.crossVectors(WORLD_UP, scratchDir).normalize();
  return { from: face, t: MathUtils.clamp(t, 0, 1), sign: Math.sign(scratchNext.dot(scratchRight)) || 1 };
}

// ---- rail construction --------------------------------------------------------

export const RAIL_SAMPLE_COUNT = 512;

export function buildRailPoints(): Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i <= RAIL_SAMPLE_COUNT; i += 1) {
    points.push(cameraPosAt((SPEEDSOLVE_DURATION * i) / RAIL_SAMPLE_COUNT));
  }
  return points;
}

// The camera must sit at cameraPosAt(t) even though the runner walks the rail
// by normalized arc length — so the easing table is the path's own cumulative
// chord length, sampled on the same grid the curve was built from.
export function buildArcLengthEase(points: Vector3[]): (time: number, duration: number) => number {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const total = cumulative[cumulative.length - 1];
  return (time: number, duration: number) => {
    const t = MathUtils.clamp(time / duration, 0, 1) * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(t));
    const frac = t - index;
    return MathUtils.lerp(cumulative[index], cumulative[index + 1], frac) / total;
  };
}
