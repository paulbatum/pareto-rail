import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { bar, STRANDLINE_DURATION } from './timing';

// The animal and the path through it. Everything here is pure geometry and
// deterministic: gameplay seats parasites on strands with it, visuals grow
// the strands from it, and the camera path uses the same numbers, so a
// parasite authored "on the strand ahead, upper left" really is on a strand.
//
// The jellyfish hangs with its bell at the top of the world. Its strands fall
// from the subumbrella, spread as they descend, and trail back toward +z in a
// slow current. The rail enters low among the trailing tips, winds up and
// around the animal's axis, swings out into open water on the bar-8 phrase to
// face the bell, dives back in, and climbs to the crown where the parent is
// dug in under the bell.

// ---- the animal ------------------------------------------------------------

export const BELL_AXIS_X = 0;
export const BELL_AXIS_Z = -400;
export const BELL_MARGIN_Y = 150;
export const BELL_RADIUS = 62;
export const BELL_HEIGHT = 50;
/** Where eyes go when the bell is the subject. */
export const BELL_LOOK = new Vector3(BELL_AXIS_X, BELL_MARGIN_Y + 18, BELL_AXIS_Z);
/** Centre of the whole animal, bell and strands, for the finale framing. */
export const JELLY_HEART = new Vector3(BELL_AXIS_X, 12, BELL_AXIS_Z + 38);
/** Where the finale camera settles its gaze: a little above the animal's middle, so the bell crowns the frame. */
export const FINALE_GAZE = new Vector3(BELL_AXIS_X, 34, BELL_AXIS_Z + 30);

const HANG = 300;
const TRAIL_REACH = 110;
const TRAIL_POWER = 1.6;
const SPREAD_GAIN = 0.9;

export function depthBelowMargin(y: number) {
  return MathUtils.clamp((BELL_MARGIN_Y - y) / HANG, 0, 1.45);
}

export function trailAt(y: number) {
  return TRAIL_REACH * depthBelowMargin(y) ** TRAIL_POWER;
}

export function spreadAt(y: number) {
  return 1 + SPREAD_GAIN * depthBelowMargin(y);
}

export function axisAt(y: number, out = new Vector3()) {
  return out.set(BELL_AXIS_X, y, BELL_AXIS_Z + trailAt(y));
}

/** Height of the bell's underside at a root radius: shallowly concave. */
export function subumbrellaY(radius: number) {
  const k = MathUtils.clamp(radius / BELL_RADIUS, 0, 1);
  return BELL_MARGIN_Y + 9 * (1 - k * k);
}

// ---- strands ------------------------------------------------------------------

export type StrandKind = 'tentacle' | 'arm';

export type StrandSpec = {
  kind: StrandKind;
  /** Root position on the subumbrella, polar about the bell axis. */
  rootRadius: number;
  rootAngle: number;
  /** Vertical reach below the root. */
  length: number;
  /** Height where the static meander crosses zero (host strands: the latch height). */
  anchorY: number;
  wobbleA: number;
  wobbleB: number;
  wobbleK: number;
  /** A tighter curl on top of the meander, so strands read as tentacles, not cables. */
  curlA: number;
  curlK: number;
  thickness: number;
  seed: number;
  /** Host strands carry parasites and start infected around these heights. */
  infections: number[];
};

export function strandRootY(spec: StrandSpec) {
  return subumbrellaY(spec.rootRadius);
}

export function strandTipY(spec: StrandSpec) {
  return strandRootY(spec) - spec.length;
}

export function strandPointAt(spec: StrandSpec, y: number, out = new Vector3()) {
  axisAt(y, out);
  const r = spec.rootRadius * spreadAt(y);
  const dy = y - spec.anchorY;
  const w1 = spec.wobbleA * Math.sin(dy * spec.wobbleK) + spec.curlA * Math.sin(dy * spec.curlK);
  const w2 = spec.wobbleB * Math.sin(dy * spec.wobbleK * 1.7) + spec.curlA * 0.8 * Math.sin(dy * spec.curlK * 1.3);
  out.x += Math.cos(spec.rootAngle) * r + w1;
  out.z += Math.sin(spec.rootAngle) * r + w2;
  return out;
}

/**
 * Invert the strand model: the root that makes a hanging strand pass exactly
 * through `point`. Returns null when the point lies outside the reach of the
 * bell (the rail's swing into open water has no strands to latch onto).
 */
export function hostRootFor(point: Vector3) {
  const axis = axisAt(point.y);
  const dx = point.x - axis.x;
  const dz = point.z - axis.z;
  const rootRadius = Math.hypot(dx, dz) / spreadAt(point.y);
  if (rootRadius > BELL_RADIUS * 1.02) return null;
  return { rootRadius, rootAngle: Math.atan2(dz, dx) };
}

// ---- the rail -------------------------------------------------------------------

// The path is grown by a guided turtle: it orbits the animal's axis
// counter-clockwise (the axis always to the camera's left), holding an
// authored orbit radius and climb slope per stretch of arc length. The final
// stretch leaves the orbit and seeks the parent at the crown; the rail ends in
// the parent itself.
type Guide = readonly [s: number, radius: number, slope: number];

const GUIDES: readonly Guide[] = [
  [0, 58, 0.3],
  [150, 50, 0.34],
  [192, 52, 0.4],
  [228, 96, 0.6],
  [262, 124, 0.6],
  [292, 112, 0.15],
  [320, 68, -0.1],
  [348, 46, 0.45],
  [405, 36, 0.62],
  [455, 30, 0.72],
];

const RAIL_START = new Vector3(BELL_AXIS_X + 58, -62, 0);
const SEEK_FROM = 455;
const STEP = 0.5;
const CONTROL_SPACING = 7;

function guideAt(s: number) {
  if (s <= GUIDES[0][0]) return { radius: GUIDES[0][1], slope: GUIDES[0][2] };
  for (let i = 1; i < GUIDES.length; i += 1) {
    const [s1, r1, k1] = GUIDES[i];
    if (s <= s1) {
      const [s0, r0, k0] = GUIDES[i - 1];
      const t = smooth01((s - s0) / (s1 - s0));
      return { radius: MathUtils.lerp(r0, r1, t), slope: MathUtils.lerp(k0, k1, t) };
    }
  }
  const last = GUIDES[GUIDES.length - 1];
  return { radius: last[1], slope: last[2] };
}

export type RailBuild = {
  curve: CatmullRomCurve3;
  length: number;
  parent: Vector3;
};

function growRail(): RailBuild {
  const start = RAIL_START.clone();
  start.z = axisAt(start.y).z;
  const position = start.clone();
  const heading = new Vector3(0, 0, -1);
  const controls: Vector3[] = [position.clone()];
  let s = 0;
  let sinceControl = 0;

  const axis = new Vector3();
  const radial = new Vector3();
  const tangent = new Vector3();
  const desired = new Vector3();

  // Orbit phase.
  while (s < SEEK_FROM) {
    const guide = guideAt(s);
    axisAt(position.y, axis);
    radial.set(position.x - axis.x, 0, position.z - axis.z);
    const rho = Math.max(0.001, radial.length());
    radial.divideScalar(rho);
    tangent.set(radial.z, 0, -radial.x);
    const correction = MathUtils.clamp((guide.radius - rho) * 0.06, -1.1, 1.1);
    desired.copy(tangent).addScaledVector(radial, correction).normalize();
    heading.lerp(desired, Math.min(1, STEP * 0.12)).normalize();
    const horizontal = STEP / Math.sqrt(1 + guide.slope * guide.slope);
    position.addScaledVector(heading, horizontal);
    position.y += guide.slope * horizontal;
    s += STEP;
    sinceControl += STEP;
    if (sinceControl >= CONTROL_SPACING) {
      controls.push(position.clone());
      sinceControl = 0;
    }
  }

  // The parent digs in under the bell a little ahead of and inward from
  // where the orbit leaves off; the last approach is one climbing Bézier, so
  // the camera settles onto it without a final turn.
  axisAt(position.y, axis);
  const inward = new Vector3(axis.x - position.x, 0, axis.z - position.z).normalize();
  const parentXZ = position.clone().addScaledVector(heading, 44).addScaledVector(inward, 17);
  const parentRadius = Math.hypot(parentXZ.x - BELL_AXIS_X, parentXZ.z - BELL_AXIS_Z);
  const parent = new Vector3(parentXZ.x, subumbrellaY(parentRadius) - 3.5, parentXZ.z);
  const p0 = position.clone();
  const p1 = position.clone().addScaledVector(heading, 26);
  p1.y += 26 * 0.72;
  const samples = 48;
  let previous = p0.clone();
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    const point = new Vector3()
      .addScaledVector(p0, u * u)
      .addScaledVector(p1, 2 * u * t)
      .addScaledVector(parent, t * t);
    sinceControl += point.distanceTo(previous);
    previous = point;
    if (sinceControl >= CONTROL_SPACING && i < samples) {
      controls.push(point.clone());
      sinceControl = 0;
    }
  }
  controls.push(parent.clone());

  const curve = new CatmullRomCurve3(controls, false, 'centripetal');
  return { curve, length: curve.getLength(), parent };
}

export const RAIL = growRail();
export const PARENT_POS = RAIL.parent.clone();

export function createStrandlineRail() {
  return RAIL.curve;
}

// ---- time → rail distance ----------------------------------------------------------

// Camera distance along the rail at authored musical times. A monotone cubic
// through these waypoints is the speed profile: an unhurried drift, a swoop
// through the swing, a steady climb, and a long settle under the crown.
const CAMERA_STOP_GAP = 40;
const STOP_S = RAIL.length - CAMERA_STOP_GAP;

const DISTANCE_WAYPOINTS: ReadonlyArray<readonly [time: number, s: number]> = [
  [0, 0],
  [bar(4), 82],
  [bar(8), 188],
  [bar(8.75), 228],
  // Linger while the bell fills the frame, then dive back in fast.
  [bar(10), 274],
  [bar(11), 330],
  [bar(13), 404],
  [bar(14), 446],
  [bar(14.75), STOP_S - 16],
  [bar(15.5), STOP_S - 4],
  [bar(17), STOP_S - 0.6],
  [bar(22), STOP_S],
  [STRANDLINE_DURATION, STOP_S + 0.4],
];

const distanceCurve = monotoneCubic(
  DISTANCE_WAYPOINTS.map(([time]) => time),
  DISTANCE_WAYPOINTS.map(([, s]) => s),
);

export function railDistanceAt(time: number) {
  return distanceCurve.value(MathUtils.clamp(time, 0, STRANDLINE_DURATION));
}

export function railSpeedAt(time: number) {
  return distanceCurve.slope(MathUtils.clamp(time, 0, STRANDLINE_DURATION));
}

export function strandlineRunProgress(time: number, _duration = STRANDLINE_DURATION) {
  return MathUtils.clamp(railDistanceAt(time) / RAIL.length, 0, 1);
}

// ---- where the camera looks ----------------------------------------------------------

const WORLD_UP = new Vector3(0, 1, 0);
const LOOK_AHEAD = 0.025;

export type ViewDirection = { weight: number; target: Vector3 };

const SWING_TARGET = BELL_LOOK.clone().add(new Vector3(0, -30, 0));
const CROWN_TARGET = PARENT_POS.clone().add(new Vector3(0, -7, 0));

/**
 * The authored view: during the swing the camera turns to face the bell, and
 * under the crown it settles on the parent. Weight 0 means "look down the rail".
 */
export function viewDirectionAt(time: number): ViewDirection {
  const swingIn = smooth01((time - bar(8.5)) / (bar(9.3) - bar(8.5)));
  const swingOut = 1 - smooth01((time - bar(10.15)) / (bar(10.95) - bar(10.15)));
  const swing = Math.min(swingIn, swingOut) * 0.82;
  if (swing > 0.0001) return { weight: swing, target: SWING_TARGET };
  const crown = smooth01((time - bar(13.9)) / (bar(15.1) - bar(13.9)));
  if (crown > 0.0001) return { weight: crown, target: CROWN_TARGET };
  return { weight: 0, target: SWING_TARGET };
}

export type RailFrame = {
  position: Vector3;
  quaternion: Quaternion;
  forward: Vector3;
  right: Vector3;
  up: Vector3;
};

const lookMatrix = new Matrix4();

export function lookQuaternion(from: Vector3, to: Vector3, out = new Quaternion()) {
  lookMatrix.lookAt(from, to, WORLD_UP);
  return out.setFromRotationMatrix(lookMatrix);
}

/** The rail camera's own orientation (what the runner computes before edge-look). */
export function railBaseFrame(progress: number, out: { position: Vector3; quaternion: Quaternion }) {
  RAIL.curve.getPointAt(MathUtils.clamp(progress, 0, 1), out.position);
  const look = RAIL.curve.getPointAt(MathUtils.clamp(progress + LOOK_AHEAD, 0, 1));
  lookQuaternion(out.position, look, out.quaternion);
  return out;
}

let cachedFrameTime = Number.NaN;
const cachedFrame: RailFrame = {
  position: new Vector3(),
  quaternion: new Quaternion(),
  forward: new Vector3(),
  right: new Vector3(),
  up: new Vector3(),
};
const viewQuaternion = new Quaternion();

/**
 * The authored camera frame at a run time (rail + view direction, no player
 * edge-look or shake). "Rail space" for swimmers is this frame: a parasite
 * swimming at (x, y, -depth) in rail space holds that screen spot while the
 * camera moves, and the player's edge-look slides it across the frame.
 */
export function cameraFrameAt(time: number, out?: RailFrame): RailFrame {
  const frame = out ?? cachedFrame;
  if (!out && time === cachedFrameTime) return frame;
  railBaseFrame(strandlineRunProgress(time), frame);
  const view = viewDirectionAt(time);
  if (view.weight > 0) {
    lookQuaternion(frame.position, view.target, viewQuaternion);
    frame.quaternion.slerp(viewQuaternion, view.weight);
  }
  frame.forward.set(0, 0, -1).applyQuaternion(frame.quaternion);
  frame.right.set(1, 0, 0).applyQuaternion(frame.quaternion);
  frame.up.set(0, 1, 0).applyQuaternion(frame.quaternion);
  if (!out) cachedFrameTime = time;
  return frame;
}

/** Rail space → world. */
export function railToWorld(time: number, local: Vector3, out = new Vector3()) {
  const frame = cameraFrameAt(time);
  return out.copy(local).applyQuaternion(frame.quaternion).add(frame.position);
}

/** World → rail space. */
export function worldToRail(time: number, world: Vector3, out = new Vector3()) {
  const frame = cameraFrameAt(time);
  const inverse = frame.quaternion.clone().invert();
  return out.copy(world).sub(frame.position).applyQuaternion(inverse);
}

/** Half-extents of the view at unit depth (62° vertical FOV, 16:9 authoring frame). */
export const VIEW_TAN_Y = Math.tan(MathUtils.degToRad(31));
export const VIEW_TAN_X = VIEW_TAN_Y * (16 / 9);


// ---- clearance -------------------------------------------------------------------------

let pathSamples: Vector3[] | null = null;

/** Authored camera positions through the run, every 0.2 s. */
export function cameraPathSamples() {
  if (!pathSamples) {
    pathSamples = [];
    for (let t = 0; t <= STRANDLINE_DURATION; t += 0.2) {
      pathSamples.push(cameraFrameAt(t, {
        position: new Vector3(),
        quaternion: new Quaternion(),
        forward: new Vector3(),
        right: new Vector3(),
        up: new Vector3(),
      }).position.clone());
    }
  }
  return pathSamples;
}

/** Closest approach of a strand to the camera path (strands hang near-vertically). */
export function strandClearance(spec: StrandSpec) {
  const rootY = strandRootY(spec);
  const tipY = rootY - spec.length;
  let min = Infinity;
  const point = new Vector3();
  for (const sample of cameraPathSamples()) {
    for (const dy of [-2.5, 0, 2.5]) {
      const y = sample.y + dy;
      if (y > rootY || y < tipY) continue;
      strandPointAt(spec, y, point);
      min = Math.min(min, point.distanceTo(sample));
    }
  }
  return min;
}

// ---- the finale -----------------------------------------------------------------------

/** Where the camera ends up when the whole animal is finally in frame. */
export function finaleVantage(out = new Vector3()) {
  const end = cameraFrameAt(bar(21)).position.clone();
  const axis = axisAt(end.y);
  const outward = new Vector3(end.x - axis.x, 0, end.z - axis.z).normalize();
  // Out past the rail's own side of the animal and a little below its middle,
  // turned a few degrees so the trailing strands sweep across the frame.
  const side = new Vector3(outward.z, 0, -outward.x);
  return out.copy(JELLY_HEART)
    .addScaledVector(outward, 300)
    .addScaledVector(side, -70)
    .add(new Vector3(0, -30, 0));
}

export const FINALE_VANTAGE = finaleVantage();

/**
 * Pull-back pose `elapsed` seconds after the parent is torn loose (or the
 * deadline passes). Three moves layered with different eases — back off the
 * crown, out of the forest, then wide — so it reads as "back, and back, and back".
 */
export function finalePose(startPosition: Vector3, elapsed: number, span: number, drift: Vector3) {
  const k = MathUtils.clamp(elapsed / span, 0, 1);
  const back = new Vector3().subVectors(startPosition, PARENT_POS).normalize();
  const c1 = startPosition.clone().addScaledVector(back, 34);
  const c2 = startPosition.clone().addScaledVector(back, 150).lerp(FINALE_VANTAGE, 0.35);
  const eased = easeOutQuint(k) * 0.72 + smooth01(k) * 0.28;
  const position = cubicBezier(startPosition, c1, c2, FINALE_VANTAGE, eased);
  // After the pull lands, keep sinking gently away as the animal drifts on.
  const after = Math.max(0, elapsed - span);
  position.addScaledVector(back, after * 1.2).add(new Vector3(0, -after * 0.6, 0));
  const lookK = smooth01(Math.min(1, k * 1.5));
  const target = PARENT_POS.clone().lerp(FINALE_GAZE, lookK).add(drift);
  return { position, target };
}

function cubicBezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number) {
  const u = 1 - t;
  return new Vector3()
    .addScaledVector(p0, u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

// ---- helpers ------------------------------------------------------------------------------

export function smooth01(x: number) {
  const t = MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutQuint(x: number) {
  return 1 - (1 - x) ** 5;
}

function monotoneCubic(xs: number[], ys: number[]) {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const segment = (x: number) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i += 1;
    return i;
  };
  return {
    value(x: number) {
      const i = segment(x);
      const h = xs[i + 1] - xs[i];
      const t = MathUtils.clamp((x - xs[i]) / h, 0, 1);
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i]
        + (t3 - 2 * t2 + t) * h * m[i]
        + (-2 * t3 + 3 * t2) * ys[i + 1]
        + (t3 - t2) * h * m[i + 1];
    },
    slope(x: number) {
      const i = segment(x);
      const h = xs[i + 1] - xs[i];
      const t = MathUtils.clamp((x - xs[i]) / h, 0, 1);
      const t2 = t * t;
      return ((6 * t2 - 6 * t) * ys[i]
        + (3 * t2 - 4 * t + 1) * h * m[i]
        + (-6 * t2 + 6 * t) * ys[i + 1]
        + (3 * t2 - 2 * t) * h * m[i + 1]) / h;
    },
  };
}
