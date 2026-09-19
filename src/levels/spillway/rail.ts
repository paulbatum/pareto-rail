import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { attachRailFrame, sampleRailFrame, type RailFrame, type RailFrameConfig } from '../../engine/rail';
import { createSpeedProfile, type SpeedKey } from '../../engine/speed-profile';
import {
  BASE_SPEED,
  DAM,
  DAM_S,
  GORGE_MOUTH_S,
  RAIL_BANKS,
  RAIL_KNOTS,
  RAIL_TAGS,
  SPINE,
  SPINE_START_S,
  SPINE_STEP,
  LIP_A,
  LIP_HEIGHT,
  chuteFloor,
  damPoint,
  headingVector,
  rightVector,
  spinePoint,
} from './route';
import { SPILLWAY_DURATION, bar } from './timing';

// The rail rides the river 2–3 units above the water, orbits the dam for the
// boss and dives the spillway. Its speed is solved from the route: every
// tagged knot in route.ts is reached exactly on its bar, and between tags the
// speed holds flat with a short ramp at each boundary. The ramps are where the
// kicks live: the cascade at bar 20 and the drop off the crest at bar 61.

const DIVISIONS = 8000;

function buildCurve() {
  const curve = new CatmullRomCurve3(RAIL_KNOTS.map((point) => point.clone()), false, 'centripetal');
  curve.arcLengthDivisions = DIVISIONS;
  return curve;
}

const template = buildCurve();
const lengths = template.getLengths(DIVISIONS);
export const RAIL_LENGTH = lengths[DIVISIONS];

function uAtKnot(index: number) {
  const scaled = (index / (RAIL_KNOTS.length - 1)) * DIVISIONS;
  const i = Math.min(DIVISIONS - 1, Math.floor(scaled));
  return MathUtils.lerp(lengths[i], lengths[i + 1], scaled - i) / RAIL_LENGTH;
}

// ---- speed profile ---------------------------------------------------------------

/** Ramp width in seconds at the boundary that starts on this bar; 0.9 s elsewhere. */
const RAMPS: Record<number, number> = { 20: 0.3, 61.5: 0.6, 63: 0.6 };

const tags = [...RAIL_TAGS].sort((a, b) => a.bar - b.bar);
const tagTimes = tags.map((tag) => bar(tag.bar));
const tagU = tags.map((tag) => uAtKnot(tag.knot));
if (tagTimes[0] !== 0 || Math.abs(tagTimes[tagTimes.length - 1] - SPILLWAY_DURATION) > 1e-6) {
  throw new Error('Spillway rail tags must start on bar 0 and end on the last bar');
}

function speedKeys(speeds: number[]): SpeedKey[] {
  const keys: SpeedKey[] = [[0, speeds[0]]];
  for (let b = 1; b < speeds.length; b += 1) {
    const room = Math.min(tagTimes[b] - tagTimes[b - 1], tagTimes[b + 1] - tagTimes[b]) * 0.8;
    const half = Math.min(RAMPS[tags[b].bar] ?? 0.9, room) / 2;
    keys.push([tagTimes[b] - half, speeds[b - 1]], [tagTimes[b] + half, speeds[b]]);
  }
  keys.push([SPILLWAY_DURATION, speeds[speeds.length - 1]]);
  return keys;
}

function integrate(keys: SpeedKey[], from: number, to: number) {
  const value = (t: number) => {
    for (let i = 1; i < keys.length; i += 1) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        return MathUtils.lerp(v0, v1, (t - t0) / Math.max(1e-6, t1 - t0));
      }
    }
    return keys[keys.length - 1][1];
  };
  const points = [from, ...keys.map((key) => key[0]).filter((t) => t > from && t < to), to];
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += ((value(points[i - 1]) + value(points[i])) / 2) * (points[i] - points[i - 1]);
  return sum;
}

const targets = tags.slice(0, -1).map((_, k) => tagU[k + 1] - tagU[k]);
const speeds = targets.map((target, k) => target / (tagTimes[k + 1] - tagTimes[k]));
for (let iteration = 0; iteration < 60; iteration += 1) {
  const keys = speedKeys(speeds);
  for (let k = 0; k < speeds.length; k += 1) speeds[k] *= targets[k] / integrate(keys, tagTimes[k], tagTimes[k + 1]);
}

const profile = createSpeedProfile(speedKeys(speeds), SPILLWAY_DURATION, { samples: 4000 });

export function spillwayRunProgress(time: number, duration = SPILLWAY_DURATION) {
  return profile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t`. */
export const railU = (time: number) => spillwayRunProgress(time);

/** Camera speed along the rail in world units per second. */
export const railSpeedAt = (time: number) => profile.speedAt(time) * RAIL_LENGTH;

/** Camera speed relative to the base cruise speed of the narrows. */
export const speedFactorAt = (time: number) => railSpeedAt(time) / BASE_SPEED;

/** Rail frame the camera occupies at run time `t`, for placing set pieces. */
export function railFrameAt(time: number): RailFrame {
  return sampleRailFrame(template, railU(time), time);
}

// ---- walker track ----------------------------------------------------------------

/** Height of the walker's belly above its feet, and its body length. The body is built to these. */
export const WALKER_BELLY = 30;
export const WALKER_BODY_LENGTH = 34;
const WALKER_STRIDE = 36;
const CLIMB_FROM_S = DAM_S - 26;

export type WalkerState = 'wading' | 'climbing' | 'on-dam';

export type WalkerPose = {
  /** Centre of the footprint, on the water surface or the dam crest. */
  position: Vector3;
  /** Radians clockwise from -Z. */
  heading: number;
  forward: Vector3;
  right: Vector3;
  /** Distance walked divided by stride length; one gait cycle per unit. */
  gaitPhase: number;
  /** World units per second along the river. */
  speed: number;
  state: WalkerState;
};

// Gap ahead of the camera along the river, by bar: far ahead early, closing
// through the narrows, directly overhead for the under-pass at bars 28–31,
// then pulling away to reach the dam at bar 42.
const WALKER_GAP: Array<[bar: number, gap: number]> = [
  [0, 330], [8, 290], [14, 250], [20, 190], [22, 170], [25, 105], [27, 42],
  [28.5, 12], [30, 1], [31, 2], [32.5, 30], [34, 75], [36, 130],
];

function nearestSpineS(point: Vector3, hint: number) {
  let best = hint;
  let bestDistance = Infinity;
  const from = Math.max(0, Math.round((hint - SPINE_START_S) / SPINE_STEP) - 80);
  const to = Math.min(SPINE.length - 1, from + 400);
  for (let i = from; i <= to; i += 1) {
    const sample = SPINE[i];
    const distance = (sample.x - point.x) ** 2 + (sample.z - point.z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = sample.s;
    }
  }
  return best;
}

const walkerKeys: Array<[time: number, s: number]> = (() => {
  const keys: Array<[number, number]> = [];
  let hint = 0;
  for (const [barValue, gap] of WALKER_GAP) {
    const time = bar(barValue);
    hint = nearestSpineS(railFrameAt(time).position, hint);
    keys.push([time, hint + gap]);
  }
  keys.push([bar(42), CLIMB_FROM_S]);
  return keys;
})();

// Fritsch–Carlson slopes, so the walker never steps backwards between keys.
const walkerSlopes = (() => {
  const n = walkerKeys.length;
  const secant = walkerKeys.slice(0, -1).map(([t, s], i) => (walkerKeys[i + 1][1] - s) / (walkerKeys[i + 1][0] - t));
  const slopes = [secant[0]];
  for (let i = 1; i < n - 1; i += 1) slopes.push(secant[i - 1] * secant[i] <= 0 ? 0 : (2 * secant[i - 1] * secant[i]) / (secant[i - 1] + secant[i]));
  slopes.push(secant[n - 2] * 0.5);
  return slopes;
})();

function walkerS(time: number) {
  const n = walkerKeys.length;
  const t = MathUtils.clamp(time, walkerKeys[0][0], walkerKeys[n - 1][0]);
  let i = 0;
  while (i < n - 2 && t > walkerKeys[i + 1][0]) i += 1;
  const [t0, s0] = walkerKeys[i];
  const [t1, s1] = walkerKeys[i + 1];
  const h = t1 - t0;
  const x = (t - t0) / h;
  const x2 = x * x;
  const x3 = x2 * x;
  return (2 * x3 - 3 * x2 + 1) * s0 + (x3 - 2 * x2 + x) * h * walkerSlopes[i] + (-2 * x3 + 3 * x2) * s1 + (x3 - x2) * h * walkerSlopes[i + 1];
}

const smooth = (x: number) => {
  const t = MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

const climbFrom = new Vector3();
const climbTo = damPoint(-3, 0, DAM.crestHeight);
const climbRight = new Vector3();

/** Out on the reservoir the walker bears to the right, so the dam behind it stays in view for the reveal. */
const LAKE_OFFSET = 55;
const lakeOffset = (s: number) => LAKE_OFFSET * smooth((s - GORGE_MOUTH_S) / 160);

/** The walker's pose at run time `time`. Pass `out` to avoid allocation. */
export function walkerTrack(time: number, out?: WalkerPose): WalkerPose {
  const pose = out ?? { position: new Vector3(), heading: 0, forward: new Vector3(), right: new Vector3(), gaitPhase: 0, speed: 0, state: 'wading' as WalkerState };
  const climbStart = bar(42);
  const climbEnd = bar(44);
  if (time < climbStart) {
    const s = walkerS(time);
    const { point, heading, sample } = spinePoint(s, pose.position);
    // Wander across the river, held on the centreline for the under-pass and the dam approach.
    const hold = 1 - smooth((time - bar(26)) / bar(1)) * (1 - smooth((time - bar(32)) / bar(1.5)));
    const nearDam = 1 - smooth((s - (DAM_S - 160)) / 100);
    const wander = (Math.sin(time * 0.31) * 0.6 + Math.sin(time * 0.83 + 1.3) * 0.4) * Math.min(sample.halfWidth * 0.28, 9) * hold * nearDam + lakeOffset(s);
    pose.heading = heading + Math.sin(time * 0.27 + 0.4) * 0.06 * hold;
    rightVector(heading, pose.right);
    point.addScaledVector(pose.right, wander);
    pose.gaitPhase = s / WALKER_STRIDE;
    pose.speed = (walkerS(time + 0.05) - walkerS(time - 0.05)) / 0.1;
    pose.state = 'wading';
  } else if (time < climbEnd) {
    const t = (time - climbStart) / (climbEnd - climbStart);
    const { heading } = spinePoint(CLIMB_FROM_S, climbFrom);
    climbFrom.addScaledVector(rightVector(heading, climbRight), lakeOffset(CLIMB_FROM_S));
    pose.position.lerpVectors(climbFrom, climbTo, smooth(t));
    pose.position.y = MathUtils.lerp(climbFrom.y, climbTo.y, smooth(t * 1.4)) + Math.sin(Math.PI * t) * 4;
    pose.heading = DAM.heading;
    pose.gaitPhase = CLIMB_FROM_S / WALKER_STRIDE + t * 1.5;
    pose.speed = 0;
    pose.state = 'climbing';
  } else {
    pose.position.copy(climbTo);
    pose.heading = DAM.heading;
    pose.gaitPhase = CLIMB_FROM_S / WALKER_STRIDE + 1.5;
    pose.speed = 0;
    pose.state = 'on-dam';
  }
  headingVector(pose.heading, pose.forward);
  rightVector(pose.heading, pose.right);
  return pose;
}

// ---- rail frame ------------------------------------------------------------------

const scratchPose = walkerTrack(0);
const aimPoint = new Vector3();

/** Just ahead of the walker's belly: the under-pass tilts the camera up at it. */
function bellyTarget(time: number) {
  walkerTrack(time, scratchPose);
  return aimPoint.copy(scratchPose.position).addScaledVector(scratchPose.forward, WALKER_BODY_LENGTH * 0.5).setY(scratchPose.position.y + WALKER_BELLY);
}

/** The walker's hips, pulled a third of the way toward the rail ahead: the walker, the crest and the water stay in frame. */
function bossTarget(time: number) {
  walkerTrack(time, scratchPose);
  const ahead = template.getPointAt(Math.min(1, railU(time) + 0.02));
  return aimPoint.copy(scratchPose.position).setY(scratchPose.position.y + WALKER_BELLY * 0.3).lerp(ahead, 0.35);
}

const DAM_REVEAL_TARGET = damPoint(0, 0, DAM.crestHeight * 0.55);
const BREACH_TARGET = damPoint(6, 0, 2);
/** Down the chute: crossing the sill, the camera tips over to look at the drop. */
const CHUTE_TARGET = damPoint(70, 0, chuteFloor(70));
/** Off the lip the camera lifts toward the open sky and the sun, up and to the right. */
const LAUNCH_TARGET = damPoint(LIP_A + 260, 60, LIP_HEIGHT + 95);

function frameConfig(): RailFrameConfig {
  const u = (barValue: number) => railU(bar(barValue));
  const roll = RAIL_BANKS.map(({ knot, degrees }) => [uAtKnot(knot), degrees] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((key, index, list) => index === 0 || key[0] - list[index - 1][0] > 1e-5);
  return {
    frame: 'parallel-transport',
    levelOver: 40,
    roll,
    lookTargets: [
      { range: [u(27.4), u(31.6)], target: bellyTarget, blend: 0.008 },
      { range: [u(35.7), u(41.2)], target: DAM_REVEAL_TARGET, blend: 0.008 },
      // From the lake end the loop swings left, away from the dam; the walker's climb stays in frame.
      { range: [u(41), u(57.9)], target: bossTarget, blend: 0.006 },
      { range: [u(57.4), u(59.9)], target: BREACH_TARGET, blend: 0.004 },
      { range: [u(59.7), u(61.4)], target: CHUTE_TARGET, blend: 0.003 },
      { range: [u(62.8), u(64.6)], target: LAUNCH_TARGET, blend: 0.005 },
    ],
  };
}

const FRAME = frameConfig();
attachRailFrame(template, FRAME);

export function createSpillwayRail() {
  return attachRailFrame(buildCurve(), FRAME);
}

/** Rail parameter of the camera on a bar, for authoring against the section map. */
export const uAtBar = (barValue: number) => railU(bar(barValue));
