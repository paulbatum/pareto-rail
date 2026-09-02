import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  BEAT_SECONDS,
  FACE_COUNT,
  FINALE_TIME,
  SS_BARS,
  SS_DURATION,
  SS_TIME,
  SWING_START_BEAT,
  faceAt,
  faceWindowStart,
} from './timing';

// The rail is an orbit around the cube. Each face window parks the camera at a
// station (drifting a few degrees so the view never freezes), then the last
// three beats swing it to the next station. After the sixth face the camera
// slides straight in along +Z toward the exposed core. Yaw runs negative so the
// finale approach looks down -Z: that is the orientation the runner falls back
// to at the very end of the rail, so the end-of-run camera never snaps.

export const CUBE_CENTER = new Vector3(0, 0, 0);
export const ORBIT_RADIUS = 31;
const SWING_RADIUS_BULGE = 4.5;
const STATION_DRIFT_DEG = 6;
const EQUATOR_SWOOP_DEG = -9;
const FINALE_START_RADIUS = 34;
const FINALE_END_RADIUS = 15.5;
// The approach keeps creeping inward past the end of the run: a rail that
// parks produces duplicate samples and breaks the runner's arc-length lookup.
const FINALE_ARRIVE_TIME = SS_DURATION + 2;
/** The cube centre sits slightly below screen centre so the top row has air. */
const AIM_LIFT = 1.7;

export type Station = { yawDeg: number; elevDeg: number; face: number };

/** Face visited in each window: +Z, -X, -Z, +X, then the top, then the bottom. */
export const STATIONS: readonly Station[] = [
  { yawDeg: 0, elevDeg: 8, face: 4 },
  { yawDeg: -90, elevDeg: 8, face: 1 },
  { yawDeg: -180, elevDeg: 8, face: 5 },
  { yawDeg: -270, elevDeg: 8, face: 0 },
  { yawDeg: -300, elevDeg: 62, face: 2 },
  { yawDeg: -330, elevDeg: -62, face: 3 },
];
export const FINALE_STATION: Station = { yawDeg: -360, elevDeg: 0, face: -1 };
export const FACE_ORDER = STATIONS.map((station) => station.face);

export type OrbitPose = {
  position: Vector3;
  aim: Vector3;
  /** 0 parked, 1 mid-swing; drives FOV swell and whoosh visuals. */
  swing: number;
  /** Window index 0–5, or 6 during the finale. */
  window: number;
};

function direction(yawDeg: number, elevDeg: number, out = new Vector3()) {
  const yaw = MathUtils.degToRad(yawDeg);
  const elev = MathUtils.degToRad(elevDeg);
  return out.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
}

function smootherstep(t: number) {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function poseFrom(yawDeg: number, elevDeg: number, radius: number, liftScale: number, swing: number, window: number): OrbitPose {
  const dir = direction(yawDeg, elevDeg);
  const position = CUBE_CENTER.clone().addScaledVector(dir, radius);
  // Screen-up in the camera frame: world up with the view direction removed.
  const screenUp = new Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
  const aim = CUBE_CENTER.clone().addScaledVector(screenUp, AIM_LIFT * liftScale);
  return { position, aim, swing, window };
}

/** The finale approach runs along a line this far below the core, so the core
 *  hangs in the upper half of the frame and the run-end word floats over the void. */
const FINALE_LINE_DROP = 5.5;
const FINALE_DIRECTION = new Vector3(0, 0, -1);

function finalePose(runTime: number): OrbitPose {
  const s = MathUtils.clamp((runTime - FINALE_TIME) / (FINALE_ARRIVE_TIME - FINALE_TIME), 0, 1);
  const eased = 1 - (1 - s) * (1 - s) * (1 - s);
  const radius = MathUtils.lerp(FINALE_START_RADIUS, FINALE_END_RADIUS, eased);
  const position = CUBE_CENTER.clone().add(new Vector3(0, -FINALE_LINE_DROP, radius));
  // Look straight along the line: this matches the rail tangent, so the
  // runner's own end-of-run orientation coincides with ours.
  const aim = position.clone().add(FINALE_DIRECTION);
  return { position, aim, swing: 0, window: FACE_COUNT };
}

export function orbitPose(runTime: number): OrbitPose {
  const t = MathUtils.clamp(runTime, 0, SS_DURATION + 2);
  if (t >= FINALE_TIME) return finalePose(t);

  const window = faceAt(t);
  const station = STATIONS[window];
  const next = window + 1 < STATIONS.length ? STATIONS[window + 1] : FINALE_STATION;
  const beat = (t - faceWindowStart(window)) / BEAT_SECONDS;

  if (beat < SWING_START_BEAT) {
    const s = beat / SWING_START_BEAT;
    const yaw = station.yawDeg - STATION_DRIFT_DEG + 2 * STATION_DRIFT_DEG * s;
    return poseFrom(yaw, station.elevDeg, ORBIT_RADIUS, 1, 0, window);
  }

  const s = MathUtils.clamp((beat - SWING_START_BEAT) / (16 - SWING_START_BEAT), 0, 1);
  const eased = smootherstep(s);
  const toFinale = next === FINALE_STATION;
  if (toFinale) {
    // Swing from the last station onto the finale line: blend position and
    // aim so the camera settles exactly onto the straight approach.
    const from = poseFrom(station.yawDeg + STATION_DRIFT_DEG, station.elevDeg, ORBIT_RADIUS, 1, 0, window);
    const to = finalePose(FINALE_TIME);
    const arc = poseFrom(
      MathUtils.lerp(station.yawDeg + STATION_DRIFT_DEG, FINALE_STATION.yawDeg, eased),
      MathUtils.lerp(station.elevDeg, -Math.atan2(FINALE_LINE_DROP, FINALE_START_RADIUS) * (180 / Math.PI), eased),
      MathUtils.lerp(ORBIT_RADIUS, Math.hypot(FINALE_START_RADIUS, FINALE_LINE_DROP), eased) + SWING_RADIUS_BULGE * Math.sin(Math.PI * s),
      1,
      Math.sin(Math.PI * s),
      window,
    );
    arc.aim.copy(from.aim).lerp(to.aim, eased);
    return arc;
  }
  const fromYaw = station.yawDeg + STATION_DRIFT_DEG;
  const toYaw = next.yawDeg - STATION_DRIFT_DEG;
  const yaw = MathUtils.lerp(fromYaw, toYaw, eased);
  const equatorial = Math.abs(station.elevDeg) < 20 && Math.abs(next.elevDeg) < 20;
  const elev = MathUtils.lerp(station.elevDeg, next.elevDeg, eased) + (equatorial ? EQUATOR_SWOOP_DEG * Math.sin(Math.PI * s) : 0);
  const radius = ORBIT_RADIUS + SWING_RADIUS_BULGE * Math.sin(Math.PI * s);
  return poseFrom(yaw, elev, radius, 1, Math.sin(Math.PI * s), window);
}

/**
 * Attract mode: further out than the first station and aimed low, so the cube
 * hangs in the upper half of the frame and the SOLVE word floats over the void
 * beneath it. Starting the run eases the camera in to the orbit.
 */
export function attractPose(modeTime: number): OrbitPose {
  const station = STATIONS[0];
  const yaw = station.yawDeg - STATION_DRIFT_DEG + Math.sin(modeTime * 0.21) * 1.6;
  const elev = station.elevDeg - 3 + Math.sin(modeTime * 0.17 + 1) * 1.2;
  const pose = poseFrom(yaw, elev, ORBIT_RADIUS + 17 + Math.sin(modeTime * 0.13) * 0.6, 1, 0, 0);
  // Aim below the cube: screen-up offset pushes the cube toward the top.
  const dir = pose.position.clone().sub(CUBE_CENTER).normalize();
  const screenUp = new Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
  pose.aim.copy(CUBE_CENTER).addScaledVector(screenUp, -13);
  return pose;
}

const RAIL_SAMPLE_SECONDS = 0.1;
/** The curve runs one extra second past the run so the final tangent is defined. */
const RAIL_OVERRUN_SECONDS = 1;

let railCache: { curve: CatmullRomCurve3; uAtSample: number[]; sampleSeconds: number } | null = null;

function buildRail() {
  if (railCache) return railCache;
  const points: Vector3[] = [];
  const total = SS_DURATION + RAIL_OVERRUN_SECONDS;
  const count = Math.round(total / RAIL_SAMPLE_SECONDS);
  for (let i = 0; i <= count; i += 1) {
    const time = Math.min(total, i * RAIL_SAMPLE_SECONDS);
    points.push(orbitPose(time).position);
  }
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  curve.arcLengthDivisions = 4000;
  const lengths = curve.getLengths(curve.arcLengthDivisions);
  const totalLength = lengths[lengths.length - 1];
  const uAtSample = points.map((_point, index) => {
    const parameter = index / count;
    const position = parameter * (lengths.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(lengths.length - 1, lower + 1);
    return MathUtils.lerp(lengths[lower], lengths[upper], position - lower) / totalLength;
  });
  railCache = { curve, uAtSample, sampleSeconds: RAIL_SAMPLE_SECONDS };
  return railCache;
}

export function createOrbitRail() {
  return buildRail().curve;
}

/** Maps run time to rail progress so the runner's camera rides the same orbit. */
export function orbitRunProgress(runTime: number, _duration: number) {
  const { uAtSample, sampleSeconds } = buildRail();
  const position = MathUtils.clamp(runTime, 0, SS_DURATION) / sampleSeconds;
  const lower = Math.floor(position);
  const upper = Math.min(uAtSample.length - 1, lower + 1);
  return MathUtils.lerp(uAtSample[lower], uAtSample[upper], position - lower);
}

/** Camera-space distance from the camera to the active face plane. */
export function faceDistance() {
  return ORBIT_RADIUS - 9;
}
