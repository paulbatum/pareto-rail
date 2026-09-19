import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { WALKER_BELLY, WALKER_DAM, WALKER_STRIDE, railFrameAt, walkerTrack, type WalkerPose, type WalkerState } from './rail';
import { DAM, chuteFloor, damPoint } from './route';
import { bar } from './timing';

// The walker's skeleton: where its body, hips, knees, feet and crane are at a
// run time, given the fight's damage. Gameplay seats the leg and core targets
// and the launch points on it; the visuals pose the model on it. It is a pure
// function of time and `walkerDamage`, so both sides always agree.
//
// Body frame: origin at the centre of the belly, x to the right, y up, and
// forward along -z (the rear, with the launch rack and the core, is +z).

/** The body is built in its own units and drawn this much larger; body-local points below are in those units. */
export const BODY_SCALE = 1.2;
/** Hip pivots, mirrored in x and z. */
export const HIP = { x: 7.5, y: 3.5, z: 13 };
export const THIGH = 18;
export const SHIN = 42;
/** The chassis box: half-width, deck height above the belly, half-length. */
export const CHASSIS = { halfWidth: 7.5, height: 8, halfLength: 17 };
/** The crane's slewing ring on the deck, its boom foot on the ring, and the boom. */
export const CRANE = { ring: new Vector3(0, 8.4, -1), foot: 3.2, boom: 34 };
export const CORE_LOCAL = new Vector3(0, 3.6, 17.2);
export const HATCH_LOCAL = new Vector3(0, -0.4, -1);

const NEUTRAL_FOOT = { x: 19, z: 19 };
/** Share of the gait cycle each foot is planted: a walk, three feet down at a time. */
const DUTY = 0.72;
/** Half the distance a planted foot travels under the body: the body's advance while it is down, so it stays put. */
const STANCE_HALF = (DUTY * WALKER_STRIDE) / 2;
const LIFT = 7;
/** Planted feet sink this far below the water. */
const PLANT_DEPTH = 1.2;
/** Astride the gates the walker crouches: belly this far above the crest. */
const DAM_BELLY = 18;
/** Resting on the hoist houses once it falls. */
const WRECK_BELLY = 13.5;
/** Feet on the crest, dam-local offsets from WALKER_DAM: rear on the bridge deck, front on the pier tops past the hoist houses. */
const DAM_FEET = { l: 22, rearA: -11, frontA: 14 };
/** Where the front feet first grip the crest on the climb, before stepping over. */
const GRIP_A = -16;

export type LegSpec = { side: 1 | -1; end: 1 | -1; phase: number; name: string };

/** In fight order. Phases make a lateral-sequence walk: rear left, front left, rear right, front right. */
export const WALKER_LEGS: readonly LegSpec[] = [
  { side: -1, end: 1, phase: 0, name: 'rear left' },
  { side: 1, end: 1, phase: 0.5, name: 'rear right' },
  { side: 1, end: -1, phase: 0.75, name: 'front right' },
  { side: -1, end: -1, phase: 0.25, name: 'front left' },
];

// ---- damage ------------------------------------------------------------------------

/** Written by the fight (boss.ts), read by the rig. Times are run seconds; Infinity means not yet. */
export type WalkerDamage = {
  legOpen: boolean[];
  legStage: number[];
  legHitAt: number[];
  legDownAt: number[];
  coreOpenAt: number;
  coreStage: number;
  coreHitAt: number;
  coreDownAt: number;
  /** The crane's current cycle: it starts at `throwFrom` and lets go of a slab at `throwAt`. */
  throwFrom: number;
  throwAt: number;
  throwCount: number;
  /** Bumped on every write, so cached rigs are re-solved. */
  version: number;
};

export const walkerDamage: WalkerDamage = {
  legOpen: [], legStage: [], legHitAt: [], legDownAt: [],
  coreOpenAt: Infinity, coreStage: 0, coreHitAt: -Infinity, coreDownAt: Infinity,
  throwFrom: Infinity, throwAt: Infinity, throwCount: 0, version: 0,
};

export function resetWalkerDamage() {
  walkerDamage.legOpen = WALKER_LEGS.map(() => false);
  walkerDamage.legStage = WALKER_LEGS.map(() => 0);
  walkerDamage.legHitAt = WALKER_LEGS.map(() => -Infinity);
  walkerDamage.legDownAt = WALKER_LEGS.map(() => Infinity);
  walkerDamage.coreOpenAt = Infinity;
  walkerDamage.coreStage = 0;
  walkerDamage.coreHitAt = -Infinity;
  walkerDamage.coreDownAt = Infinity;
  walkerDamage.throwFrom = Infinity;
  walkerDamage.throwAt = Infinity;
  walkerDamage.throwCount = 0;
  walkerDamage.version += 1;
}
resetWalkerDamage();

// ---- rig -----------------------------------------------------------------------------

export type LegPose = {
  hip: Vector3;
  knee: Vector3;
  foot: Vector3;
  /** Direction the knee bends toward. */
  pole: Vector3;
  /** 0 planted, 1 at the top of a step. */
  lift: number;
  planted: boolean;
  /** 0 standing, 1 broken and buckled. */
  give: number;
};

/** Slew and luff in radians; cable in world units from the boom head down to the claw. */
export type CranePose = { slew: number; luff: number; cable: number; open: number; holding: boolean };

export type WalkerRig = {
  time: number;
  state: WalkerState;
  pose: WalkerPose;
  position: Vector3;
  quaternion: Quaternion;
  matrix: Matrix4;
  /** Heading of the feet; they stay level. */
  footYaw: number;
  legs: LegPose[];
  crane: CranePose;
  hatch: number;
  coreDoors: number;
  /** 0 standing, 1 fallen onto the gates. */
  collapse: number;
  /** Seconds since the wreck started down the chute; negative until then. */
  swept: number;
  visible: boolean;
  /** Strain the walker puts on each dam gate, 0..1; negative leaves it alone. */
  gateStrain: number[];
};

const UP = new Vector3(0, 1, 0);
const smooth = (x: number) => {
  const t = MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const window01 = (t: number, from: number, to: number) => MathUtils.clamp((t - from) / (to - from), 0, 1);

const CLIMB_START = bar(42);
const CLIMB_END = bar(44);
const BREACH = bar(58);
/** The claws bite into the gates from here, and the crane starts its first cycle. */
export const WALKER_WORK_FROM = bar(43.5);
/** Bars the fight drops a flock out of the belly hatch. */
export const BELLY_DROP_BARS = [46, 49, 51.75, 54.25];
/** The belly hatch: held open through the under-pass, and briefly for each drop in the fight. */
const HATCH_KEYS: Array<[open: number, close: number]> = [[27.5, 31.6], ...BELLY_DROP_BARS.map((at): [number, number] => [at - 0.7, at + 0.9])];

function newRig(): WalkerRig {
  return {
    time: Number.NaN,
    state: 'wading',
    pose: walkerTrack(0),
    position: new Vector3(),
    quaternion: new Quaternion(),
    matrix: new Matrix4(),
    footYaw: 0,
    legs: WALKER_LEGS.map(() => ({ hip: new Vector3(), knee: new Vector3(), foot: new Vector3(), pole: new Vector3(), lift: 0, planted: true, give: 0 })),
    crane: { slew: 0, luff: 0.8, cable: 6, open: 0, holding: false },
    hatch: 0,
    coreDoors: 0,
    collapse: 0,
    swept: -1,
    visible: true,
    gateStrain: [-1, -1, -1, -1, -1],
  };
}

const euler = new Euler(0, 0, 0, 'YXZ');
const scratch = new Vector3();
const scratch2 = new Vector3();
const inverse = new Matrix4();

/** A body-local point in world space. */
export function walkerPoint(rig: WalkerRig, local: Vector3, out = new Vector3()) {
  return out.copy(local).applyMatrix4(rig.matrix);
}

function footprintPoint(pose: WalkerPose, x: number, z: number, y: number, out: Vector3) {
  return out.copy(pose.position).addScaledVector(pose.right, x).addScaledVector(pose.forward, -z).setY(pose.position.y + y);
}

/** Dam-local foot offsets from WALKER_DAM, in world space at crest height. */
function damFoot(leg: LegSpec, a: number, out: Vector3) {
  return damPoint(WALKER_DAM.a + a, WALKER_DAM.l + leg.side * DAM_FEET.l, DAM.crestHeight + 0.3, out);
}

/** Feet of the walk: planted feet slide back under the body as it moves, lifted feet swing forward. */
function gaitFeet(rig: WalkerRig, amp: number) {
  const pose = rig.pose;
  WALKER_LEGS.forEach((leg, i) => {
    const out = rig.legs[i];
    const cycle = MathUtils.euclideanModulo(pose.gaitPhase + leg.phase, 1);
    let z = leg.end * NEUTRAL_FOOT.z;
    let lift = 0;
    if (cycle < DUTY) {
      z += STANCE_HALF * amp * ((2 * cycle) / DUTY - 1);
    } else {
      const v = (cycle - DUTY) / (1 - DUTY);
      z += STANCE_HALF * amp * (1 - 2 * smooth(v));
      lift = Math.sin(Math.PI * v) * amp;
    }
    out.lift = lift;
    out.planted = lift < 0.04;
    footprintPoint(pose, leg.side * NEUTRAL_FOOT.x, z, -PLANT_DEPTH + lift * LIFT, out.foot);
  });
}

let climbStartFeet: Vector3[] | null = null;

/** Where each foot stands when the climb begins: the last step of the walk. */
function climbStart() {
  if (climbStartFeet) return climbStartFeet;
  const rig = newRig();
  walkerTrack(CLIMB_START - 1e-3, rig.pose);
  gaitFeet(rig, 1);
  climbStartFeet = rig.legs.map((leg) => leg.foot.clone().setY(rig.pose.position.y - PLANT_DEPTH));
  return climbStartFeet;
}

/** The climb, per leg: [from, to, window] steps. Front feet grip the crest edge first, then step over it. */
const CLIMB_STEPS: Array<Array<{ to: 'grip' | 'crest'; from: number; until: number }>> = [
  [{ to: 'crest', from: 0.42, until: 0.74 }],
  [{ to: 'crest', from: 0.56, until: 0.9 }],
  [{ to: 'grip', from: 0.1, until: 0.36 }, { to: 'crest', from: 0.64, until: 0.86 }],
  [{ to: 'grip', from: 0, until: 0.28 }, { to: 'crest', from: 0.52, until: 0.76 }],
];

const stepFrom = new Vector3();
const stepTo = new Vector3();

function climbFeet(rig: WalkerRig, t: number) {
  const start = climbStart();
  WALKER_LEGS.forEach((leg, i) => {
    const out = rig.legs[i];
    let from = stepFrom.copy(start[i]);
    out.lift = 0;
    out.planted = true;
    for (const step of CLIMB_STEPS[i]) {
      damFoot(leg, step.to === 'grip' ? GRIP_A : leg.end > 0 ? DAM_FEET.rearA : DAM_FEET.frontA, stepTo);
      const u = window01(t, step.from, step.until);
      if (u <= 0) break;
      if (u >= 1) {
        from.copy(stepTo);
        continue;
      }
      // Up the face first, then over: height leads the reach, with a hook over the lip.
      out.foot.lerpVectors(from, stepTo, smooth(u));
      out.foot.y = MathUtils.lerp(from.y, stepTo.y, smooth(u * 1.6)) + Math.sin(Math.PI * u) * 6;
      out.lift = Math.sin(Math.PI * u);
      out.planted = false;
      from = out.foot;
      break;
    }
    if (out.planted) out.foot.copy(from);
  });
}

/** 0 → 1 with a sag and a small rebound after a break at `at`. */
function buckle(time: number, at: number) {
  const x = time - at;
  if (!(x > 0)) return 0;
  return Math.min(1.08, 1 - Math.exp(-5 * x) * Math.cos(7 * x));
}

/** Crane pose that hangs the claw over `point`, from the boom foot on the body. */
function craneToward(rig: WalkerRig, point: Vector3, out: CranePose) {
  inverse.copy(rig.matrix).invert();
  const local = scratch.copy(point).applyMatrix4(inverse).sub(CRANE.ring);
  local.y -= CRANE.foot;
  out.slew = Math.atan2(-local.x, -local.z);
  const reach = Math.hypot(local.x, local.z);
  out.luff = Math.acos(MathUtils.clamp(reach / CRANE.boom, 0.12, 0.97));
  out.cable = Math.max(3, (Math.sin(out.luff) * CRANE.boom - local.y) * BODY_SCALE);
  return out;
}

const keyA: CranePose = { slew: 0, luff: 0, cable: 0, open: 0, holding: false };
const keyB: CranePose = { slew: 0, luff: 0, cable: 0, open: 0, holding: false };

function blendCrane(a: CranePose, b: CranePose, t: number, out: CranePose) {
  const k = smooth(t);
  const turn = MathUtils.euclideanModulo(b.slew - a.slew + Math.PI, Math.PI * 2) - Math.PI;
  out.slew = a.slew + turn * k;
  out.luff = MathUtils.lerp(a.luff, b.luff, k);
  out.cable = MathUtils.lerp(a.cable, b.cable, k);
}

function idleCrane(time: number, out: CranePose) {
  out.slew = Math.sin(time * 0.21) * 0.5;
  out.luff = 0.72 + Math.sin(time * 0.37) * 0.08;
  out.cable = 7 + Math.sin(time * 0.9) * 0.6;
  out.open = 0;
  out.holding = false;
  return out;
}

/** The slab the crane grabs on cycle `count`: alternately the centre gate and the gate under its right side. */
function throwGate(count: number) {
  return count % 2 === 0 ? 2 : 4;
}

const gateGrab = new Vector3();
const throwAim = new Vector3();

function gatePoint(gate: number, lift: number, out: Vector3) {
  const l = (gate - (DAM.gateCount - 1) / 2) * (DAM.gateWidth + DAM.pierWidth);
  return damPoint(-2, l, DAM.gateTop + 1.5 + lift, out);
}

/** Where the claw lets go: out toward where the camera will be, boom high. */
function releasePoint(rig: WalkerRig, at: number, out: Vector3) {
  const camera = railFrameAt(at).position;
  const origin = walkerPoint(rig, CRANE.ring, scratch2);
  throwAim.copy(camera).sub(origin).setY(0).normalize();
  return out.copy(origin).addScaledVector(throwAim, 20).setY(origin.y + 17);
}

const keyC: CranePose = { slew: 0, luff: 0, cable: 0, open: 0, holding: false };

/** Between jobs: idling, or settling back to idle from the last throw. */
function restCrane(rig: WalkerRig, time: number, out: CranePose) {
  const d = walkerDamage;
  idleCrane(time, out);
  if (d.throwCount > 0 && !Number.isFinite(d.throwAt)) {
    craneToward(rig, releasePoint(rig, d.throwFrom, gateGrab), keyC);
    blendCrane(keyC, out, (time - d.throwFrom) / 1.5, out);
  }
  return out;
}

/** The crane's working cycle: down to a gate, grab, lift, swing round at the camera and throw. */
function workCrane(rig: WalkerRig, time: number) {
  const d = walkerDamage;
  const crane = rig.crane;
  crane.open = 0;
  crane.holding = false;
  if (!Number.isFinite(d.coreDownAt) && time > bar(56.75)) {
    // Nobody stopped it: it hooks the centre gate and hauls until the gates go.
    craneToward(rig, gatePoint(2, 0, gateGrab), keyA);
    restCrane(rig, time, keyB);
    blendCrane(keyB, keyA, window01(time, bar(56.75), bar(57.4)), crane);
    const haul = smooth((time - bar(56.75)) / bar(1.25));
    const yank = time > BREACH ? smooth((time - BREACH) / 0.6) : 0;
    crane.cable -= haul * 3 + yank * 14;
    crane.luff += yank * 0.35;
    if (time < BREACH) rig.gateStrain[2] = 0.3 + 0.7 * haul;
    return;
  }
  if (!(time >= d.throwFrom) || !Number.isFinite(d.throwAt)) {
    restCrane(rig, time, crane);
    return;
  }
  const p = MathUtils.clamp((time - d.throwFrom) / Math.max(0.1, d.throwAt - d.throwFrom), 0, 1.2);
  const gate = throwGate(d.throwCount);
  // Keyframes, by share of the cycle: [0] where the last throw left it, [0.3] over the gate, [0.45] grab,
  // [0.7] lifted clear, [0.9] wound back toward the camera, [1] the whip.
  const keys: Array<[number, (out: CranePose) => CranePose]> = [
    [0, (out) => (d.throwCount === 0 ? idleCrane(d.throwFrom, out) : craneToward(rig, releasePoint(rig, d.throwFrom, gateGrab), out))],
    [0.3, (out) => craneToward(rig, gatePoint(gate, 7, gateGrab), out)],
    [0.45, (out) => craneToward(rig, gatePoint(gate, 0, gateGrab), out)],
    [0.7, (out) => craneToward(rig, gatePoint(gate, 16, gateGrab), out)],
    [0.9, (out) => {
      craneToward(rig, releasePoint(rig, d.throwAt, gateGrab), out);
      out.luff -= 0.35;
      out.cable += 3;
      return out;
    }],
    [1, (out) => craneToward(rig, releasePoint(rig, d.throwAt, gateGrab), out)],
  ];
  let k = 0;
  while (k < keys.length - 2 && p > keys[k + 1][0]) k += 1;
  keys[k][1](keyA);
  keys[k + 1][1](keyB);
  blendCrane(keyA, keyB, (p - keys[k][0]) / (keys[k + 1][0] - keys[k][0]), crane);
  crane.open = p < 0.4 ? 1 : p < 0.46 ? 1 - (p - 0.4) / 0.06 : p > 0.98 ? 1 : 0;
  crane.holding = p >= 0.46 && p < 1;
  // The slab tears out of the gate: strain climbs as the claw hauls, then lets go.
  if (time < BREACH) rig.gateStrain[gate] = Math.max(rig.gateStrain[gate], smooth((p - 0.42) / 0.12) * (1 - smooth((p - 0.6) / 0.08)) * 0.85);
}

const rigCache = newRig();
let cacheVersion = -1;

/** The walker at run time `time`. The result is shared; copy what you keep. */
export function solveWalker(time: number): WalkerRig {
  if (rigCache.time === time && cacheVersion === walkerDamage.version) return rigCache;
  rigCache.time = time;
  cacheVersion = walkerDamage.version;
  solveInto(rigCache, time);
  return rigCache;
}

function solveInto(rig: WalkerRig, time: number) {
  const d = walkerDamage;
  const pose = walkerTrack(time, rig.pose);
  rig.state = pose.state;
  rig.gateStrain.fill(-1);
  rig.visible = true;
  rig.swept = -1;
  rig.collapse = 0;
  let belly = WALKER_BELLY;
  let yaw = -pose.heading;
  let pitch = 0;
  let roll = 0;
  let sway = 0;

  if (pose.state === 'wading') {
    // Stride shortens to nothing as the walker stops; the body bobs twice a cycle and rolls onto the planted side.
    const amp = smooth(pose.speed / 10);
    gaitFeet(rig, amp);
    const g = pose.gaitPhase * Math.PI * 2;
    belly += (Math.cos(g * 2) * 0.7 - 0.3) * amp;
    roll = Math.sin(g) * 0.035 * amp;
    pitch = Math.sin(g * 2 + 1) * 0.015 * amp;
    yaw += Math.sin(g) * 0.02 * amp;
    sway = Math.sin(g) * 0.6 * amp;
  } else if (pose.state === 'climbing') {
    const t = (time - CLIMB_START) / (CLIMB_END - CLIMB_START);
    climbFeet(rig, t);
    belly = MathUtils.lerp(WALKER_BELLY, DAM_BELLY, smooth(t));
    // Nose up while the front feet are on the crest and the rear still in the water.
    const front = (rig.legs[2].foot.y + rig.legs[3].foot.y) / 2;
    const rear = (rig.legs[0].foot.y + rig.legs[1].foot.y) / 2;
    pitch = Math.atan2(front - rear, 2 * NEUTRAL_FOOT.z) * 0.75;
    const wading = walkerTrack(CLIMB_START - 1e-3, scratchPose);
    yaw = MathUtils.lerp(-wading.heading, -DAM.heading, smooth(t * 3));
  } else {
    // Braced astride the gates, rocking as it wrenches at them.
    WALKER_LEGS.forEach((leg, i) => {
      damFoot(leg, leg.end > 0 ? DAM_FEET.rearA : DAM_FEET.frontA, rig.legs[i].foot);
      rig.legs[i].lift = 0;
      rig.legs[i].planted = true;
    });
    belly = DAM_BELLY + Math.sin(time * 2.1) * 0.35;
    sway = Math.sin(time * 1.3) * 0.7;
    roll = Math.sin(time * 1.3 + 0.6) * 0.012;
    // Recoil from the last throw.
    const since = time - d.throwFrom;
    if (since > 0) pitch += Math.exp(-since * 5) * Math.sin(since * 12) * 0.03;
    if (time < BREACH) rig.gateStrain[3] = rig.gateStrain[4] = 0.12 + 0.06 * Math.sin(time * 3.1);
  }

  // Broken legs: the body sags toward each broken corner, and a hit makes it flinch.
  let sag = 0;
  WALKER_LEGS.forEach((leg, i) => {
    const give = buckle(time, d.legDownAt[i]);
    rig.legs[i].give = MathUtils.clamp(give, 0, 1);
    sag += give;
    roll -= leg.side * give * 0.075;
    pitch += leg.end * give * 0.06;
    const flinch = Math.exp(-Math.max(0, time - d.legHitAt[i]) * 9) * (time >= d.legHitAt[i] ? 1 : 0);
    belly -= flinch * 0.5;
    roll -= leg.side * flinch * 0.01;
    // A broken foot skids out from under it.
    if (give > 0) rig.legs[i].foot.addScaledVector(pose.right, leg.side * 2.5 * give).addScaledVector(pose.forward, -leg.end * 1.5 * give);
  });
  belly -= sag * 2.4;

  // The core dies: it drops onto the hoist houses, nose down over the spillway.
  const collapse = Number.isFinite(d.coreDownAt) ? buckle(time, d.coreDownAt + 0.15) : 0;
  rig.collapse = MathUtils.clamp(collapse, 0, 1);
  if (collapse > 0) {
    belly = MathUtils.lerp(belly, WRECK_BELLY, collapse);
    pitch = MathUtils.lerp(pitch, -0.09, collapse);
    roll = MathUtils.lerp(roll, 0.04, collapse);
    sway *= 1 - rig.collapse;
    WALKER_LEGS.forEach((leg, i) => rig.legs[i].foot.addScaledVector(pose.right, leg.side * 4 * rig.collapse));
  }

  rig.position.copy(pose.position).addScaledVector(pose.right, sway).addScaledVector(UP, belly);
  rig.quaternion.setFromEuler(euler.set(pitch, yaw, roll, 'YXZ'));
  rig.footYaw = yaw;
  rig.matrix.compose(rig.position, rig.quaternion, bodyScale);

  // The crane: idle while wading, working the gates on the dam, dead once it falls.
  if (pose.state === 'on-dam' || time >= d.throwFrom) workCrane(rig, time);
  else idleCrane(time, rig.crane);
  if (rig.collapse > 0) {
    rig.crane.luff = MathUtils.lerp(rig.crane.luff, -0.28, rig.collapse);
    rig.crane.cable = MathUtils.lerp(rig.crane.cable, 2, rig.collapse);
    rig.crane.holding = false;
    rig.crane.open = 1;
  }

  // The swept wreck: after the gates burst it slides off the crest and down the chute with the flood.
  const swept = collapse > 0 ? time - BREACH - 0.3 : -1;
  if (swept > 0) {
    rig.swept = swept;
    rig.visible = swept < 6.5;
    sweepWreck(rig, swept);
  }

  // Legs last: hips ride the body, knees solved between hip and foot.
  WALKER_LEGS.forEach((leg, i) => {
    const out = rig.legs[i];
    walkerPoint(rig, scratch.set(leg.side * HIP.x, HIP.y, leg.end * HIP.z), out.hip);
    const splay = Math.max(out.give, rig.collapse);
    // A broken knee buckles the wrong way: out and down, below the line from hip to foot.
    out.pole.set(leg.side, MathUtils.lerp(1.25, -0.6, splay), leg.end * MathUtils.lerp(0.35, 0.5, splay)).applyQuaternion(rig.quaternion).normalize();
    solveKnee(out);
  });

  rig.hatch = 0;
  for (const [open, close] of HATCH_KEYS) rig.hatch = Math.max(rig.hatch, smooth((time - bar(open)) / bar(0.6)) * (1 - smooth((time - bar(close)) / bar(0.8))));
  rig.coreDoors = Number.isFinite(d.coreOpenAt) ? smooth((time - d.coreOpenAt) / bar(0.6)) : 0;
}

const bodyScale = new Vector3(BODY_SCALE, BODY_SCALE, BODY_SCALE);
const scratchPose = walkerTrack(0);
const sweep = new Matrix4();
const sweepRotation = new Quaternion();
const pivot = new Vector3();
const moved = new Vector3();

function sweepWreck(rig: WalkerRig, t: number) {
  const along = 3 * t + 6 * t * t;
  const a = WALKER_DAM.a + along;
  const drop = smooth(t / 1.6);
  const height = MathUtils.lerp(DAM.crestHeight, chuteFloor(a) + 4, drop) - DAM.crestHeight;
  damPoint(WALKER_DAM.a, WALKER_DAM.l, DAM.crestHeight, pivot);
  moved.copy(pivot).addScaledVector(DAM.axis, along).addScaledVector(UP, height);
  sweepRotation.setFromAxisAngle(DAM.right, -Math.min(0.75, 0.5 * t));
  sweep.makeTranslation(moved.x, moved.y, moved.z)
    .multiply(new Matrix4().makeRotationFromQuaternion(sweepRotation))
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  rig.matrix.premultiply(sweep);
  rig.matrix.decompose(rig.position, rig.quaternion, moved);
  for (const leg of rig.legs) leg.foot.applyMatrix4(sweep);
}

const toFoot = new Vector3();
const bend = new Vector3();

/** Two-bone IK: the knee in the plane of hip, foot and pole. A foot out of reach is pulled in. */
function solveKnee(leg: LegPose) {
  toFoot.copy(leg.foot).sub(leg.hip);
  const reach = MathUtils.clamp(toFoot.length(), SHIN - THIGH + 0.5, (THIGH + SHIN) * 0.998);
  toFoot.normalize();
  leg.foot.copy(leg.hip).addScaledVector(toFoot, reach);
  const along = (THIGH * THIGH - SHIN * SHIN + reach * reach) / (2 * reach);
  const out = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
  bend.copy(leg.pole).addScaledVector(toFoot, -leg.pole.dot(toFoot)).normalize();
  leg.knee.copy(leg.hip).addScaledVector(toFoot, along).addScaledVector(bend, out);
}

// ---- attachment points ------------------------------------------------------------------

/** The launch rack on the rear deck; `rack` picks the slot. */
export function rackPoint(time: number, rack: number, out = new Vector3()) {
  return walkerPoint(solveWalker(time), scratch.set(((rack % 3) - 1) * 3.2, 13, 6 + (rack % 2) * 4), out);
}

/** The stern chute under the rear, for skiffs dropped straight into the river. */
export function sternPoint(time: number, rack: number, out = new Vector3()) {
  return walkerPoint(solveWalker(time), scratch.set(((rack % 3) - 1) * 3.2, -1.5, CHASSIS.halfLength - 1), out);
}

/** Just below the belly hatch. */
export function hatchPoint(time: number, out = new Vector3()) {
  return walkerPoint(solveWalker(time), scratch.copy(HATCH_LOCAL).setY(HATCH_LOCAL.y - 3), out);
}

/** The leg's target: the knee joint, just down the shin where its armour and ram lug sit. */
export function kneePoint(time: number, leg: number, out = new Vector3()) {
  const pose = solveWalker(time).legs[leg];
  return out.lerpVectors(pose.knee, pose.foot, 0.15);
}

export function corePoint(time: number, out = new Vector3()) {
  return walkerPoint(solveWalker(time), CORE_LOCAL, out);
}

/** Body-local tip of the boom for a crane pose. */
export function boomTipLocal(crane: CranePose, out = new Vector3()) {
  const reach = Math.cos(crane.luff) * CRANE.boom;
  return out.set(-Math.sin(crane.slew) * reach, CRANE.ring.y + CRANE.foot + Math.sin(crane.luff) * CRANE.boom, CRANE.ring.z - Math.cos(crane.slew) * reach);
}

/** The claw hanging under the boom tip. */
export function clawPoint(time: number, out = new Vector3()) {
  const rig = solveWalker(time);
  walkerPoint(rig, boomTipLocal(rig.crane, scratch2), out);
  return out.addScaledVector(UP, -rig.crane.cable);
}
