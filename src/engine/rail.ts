import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);

export function smoothRunProgress(time: number, duration: number) {
  const x = MathUtils.clamp(time / duration, 0, 1);
  return x * x * (3 - 2 * x);
}

export type RailFrame = {
  position: Vector3;
  tangent: Vector3;
  right: Vector3;
  up: Vector3;
};

// ---- authored rail frames --------------------------------------------------
//
// A rail is a plain CatmullRomCurve3 and by default its frame comes from the
// world up vector. A level that wants banking, a vertical loop, an authored
// look target, or a rail section that rides a moving body attaches a
// RailFrameConfig to its curve with attachRailFrame. Every helper in this file
// and every runner camera path reads the attached config, so one attachment
// changes the camera, offsetFromRail, and scatterAlongRail together.

/** `[u, degrees]`: bank angle at rail parameter `u`. Positive degrees roll the camera clockwise as the player sees it. */
export type RailRollKey = [u: number, degrees: number];

export type RailLookTarget = {
  /** Rail parameter range `[u0, u1]` over which the camera aims at `target`. */
  range: [number, number];
  /** World-space aim point, either fixed or a function of the rail clock. */
  target: Vector3 | ((time: number) => Vector3);
  /** Rail parameter width of the ease in after `u0` and the ease out before `u1`. Default 0.02. */
  blend?: number;
};

export type RailSection = {
  /** Rail parameter range `[u0, u1]` whose rail points are authored in the moving body's local frame. */
  range: [number, number];
  /** World transform of the moving body at rail clock `time`. Must be rigid (rotation and translation only). */
  parent: (time: number) => Matrix4;
  /** Rail parameter width of the ease in after `u0` and the ease out before `u1`. Default 0.02. */
  blend?: number;
};

export type RailFrameConfig = {
  /**
   * `parallel-transport` carries the up vector along the curve so vertical
   * segments and loops keep a continuous frame. `world-up` is the default
   * frame, offered so roll, look targets, and sections can be used on it.
   */
  frame: 'parallel-transport' | 'world-up';
  roll?: RailRollKey[];
  lookTargets?: RailLookTarget[];
  sections?: RailSection[];
};

export type AttachedRailFrame = {
  readonly config: RailFrameConfig;
  /** Rail clock in seconds. The runner assigns the run time each frame; sections and look-target functions read it. */
  time: number;
};

type TransportTable = {
  /** Transported up vector at sample `i`, sampled at uniform arc-length parameter `i / (count - 1)`. */
  ups: Vector3[];
};

type RailFrameState = AttachedRailFrame & {
  transport?: TransportTable;
  roll: RailRollKey[];
};

const DEFAULT_BLEND_U = 0.02;
const attachedFrames = new WeakMap<CatmullRomCurve3, RailFrameState>();

/** Attaches an authored frame to a rail curve and returns the same curve. */
export function attachRailFrame<T extends CatmullRomCurve3>(curve: T, config: RailFrameConfig): T {
  const roll = [...(config.roll ?? [])].sort((a, b) => a[0] - b[0]);
  for (const [u, degrees] of roll) {
    if (!Number.isFinite(u) || !Number.isFinite(degrees)) throw new Error('Rail roll keys must be finite [u, degrees] pairs');
  }
  for (const entry of [...(config.lookTargets ?? []), ...(config.sections ?? [])]) {
    const [u0, u1] = entry.range;
    if (!(u0 < u1)) throw new Error(`Rail range [${u0}, ${u1}] must have u0 < u1`);
  }
  attachedFrames.set(curve, {
    config,
    time: 0,
    roll,
    transport: config.frame === 'parallel-transport' ? buildTransportTable(curve) : undefined,
  });
  return curve;
}

/** The frame attached with attachRailFrame, or undefined for a plain world-up rail. */
export function getRailFrame(curve: CatmullRomCurve3): AttachedRailFrame | undefined {
  return attachedFrames.get(curve);
}

function buildTransportTable(curve: CatmullRomCurve3): TransportTable {
  const length = curve.getLength();
  const count = MathUtils.clamp(Math.round(length / 2), 256, 4096);
  const ups: Vector3[] = [];
  const tangent = new Vector3();
  const up = new Vector3();
  for (let i = 0; i < count; i += 1) {
    tangent.copy(curve.getTangentAt(i / (count - 1))).normalize();
    if (i === 0) {
      up.copy(UP);
      if (Math.abs(up.dot(tangent)) > 0.999) up.set(1, 0, 0);
    }
    // Remove the tangent component from the previous up: the rotation-minimizing step.
    up.addScaledVector(tangent, -up.dot(tangent)).normalize();
    ups.push(up.clone());
  }
  return { ups };
}

function transportedUp(table: TransportTable, u: number, tangent: Vector3, out: Vector3) {
  const scaled = u * (table.ups.length - 1);
  const index = Math.min(table.ups.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  out.copy(table.ups[index]).lerp(table.ups[index + 1], fraction);
  out.addScaledVector(tangent, -out.dot(tangent));
  if (out.lengthSq() < 1e-8) out.copy(table.ups[index]);
  return out.normalize();
}

function rollDegreesAt(keys: RailRollKey[], u: number) {
  if (keys.length === 0) return 0;
  if (u <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (u >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i += 1) {
    const [u0, a] = keys[i];
    const [u1, b] = keys[i + 1];
    if (u < u0 || u > u1) continue;
    const span = u1 - u0;
    const x = span <= 0 ? 1 : (u - u0) / span;
    return a + (b - a) * x * x * (3 - 2 * x);
  }
  return last[1];
}

/** Weight 0..1 of an authored range at `u`: eased in over `blend` after `u0` and eased out over `blend` before `u1`. */
function rangeWeight(range: [number, number], blend: number | undefined, u: number) {
  const [u0, u1] = range;
  if (u <= u0 || u >= u1) return 0;
  const width = Math.min(blend ?? DEFAULT_BLEND_U, (u1 - u0) / 2);
  if (width <= 0) return 1;
  const x = MathUtils.clamp(Math.min(u - u0, u1 - u) / width, 0, 1);
  return x * x * (3 - 2 * x);
}

const sectionRotation = new Matrix4();
const sectionPosition = new Vector3();
const sectionTangent = new Vector3();
const sectionUp = new Vector3();

function applySections(sections: RailSection[], time: number, u: number, frame: RailFrame) {
  for (const section of sections) {
    const weight = rangeWeight(section.range, section.blend, u);
    if (weight <= 0) continue;
    const parent = section.parent(time);
    sectionRotation.extractRotation(parent);
    sectionPosition.copy(frame.position).applyMatrix4(parent);
    sectionTangent.copy(frame.tangent).applyMatrix4(sectionRotation);
    sectionUp.copy(frame.up).applyMatrix4(sectionRotation);
    frame.position.lerp(sectionPosition, weight);
    frame.tangent.lerp(sectionTangent, weight).normalize();
    frame.up.lerp(sectionUp, weight);
    frame.up.addScaledVector(frame.tangent, -frame.up.dot(frame.tangent)).normalize();
    frame.right.crossVectors(frame.tangent, frame.up).normalize();
  }
}

export function sampleRailFrame(curve: CatmullRomCurve3, u: number, time?: number): RailFrame {
  const attached = attachedFrames.get(curve);
  if (attached === undefined) {
    const clamped = MathUtils.clamp(u, 0, 1);
    const position = curve.getPointAt(clamped);
    const tangent = curve.getTangentAt(clamped).normalize();
    const right = new Vector3().crossVectors(tangent, UP).normalize();
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
    const up = new Vector3().crossVectors(right, tangent).normalize();
    return { position, tangent, right, up };
  }
  return sampleAttachedFrame(curve, attached, MathUtils.clamp(u, 0, 1), time ?? attached.time);
}

function sampleAttachedFrame(curve: CatmullRomCurve3, attached: RailFrameState, u: number, time: number): RailFrame {
  const position = curve.getPointAt(u);
  const tangent = curve.getTangentAt(u).normalize();
  const up = new Vector3();
  const right = new Vector3();
  if (attached.transport) {
    transportedUp(attached.transport, u, tangent, up);
    right.crossVectors(tangent, up).normalize();
  } else {
    right.crossVectors(tangent, UP).normalize();
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
    up.crossVectors(right, tangent).normalize();
  }
  const rollDegrees = rollDegreesAt(attached.roll, u);
  if (rollDegrees !== 0) {
    const roll = new Quaternion().setFromAxisAngle(tangent, MathUtils.degToRad(rollDegrees));
    up.applyQuaternion(roll);
    right.applyQuaternion(roll);
  }
  const frame = { position, tangent, right, up };
  const sections = attached.config.sections;
  if (sections && sections.length > 0) applySections(sections, time, u, frame);
  return frame;
}

export function offsetFromRail(curve: CatmullRomCurve3, u: number, offset: Vector3, time?: number) {
  const frame = sampleRailFrame(curve, u, time);
  return frame.position
    .clone()
    .addScaledVector(frame.right, offset.x)
    .addScaledVector(frame.up, offset.y)
    .addScaledVector(frame.tangent, offset.z);
}

export type RailCameraPose = {
  position: Vector3;
  quaternion: Quaternion;
};

const poseLookAt = new Vector3();
const poseForward = new Vector3();
const poseTargetDirection = new Vector3();
const poseMatrix = new Matrix4();

/**
 * Camera pose on a rail with an attached frame: seated at `u`, facing the rail
 * point `lookAheadU` further along, rolled with the frame, and turned toward
 * any look target whose range covers `u`.
 */
export function railCameraPose(curve: CatmullRomCurve3, u: number, lookAheadU: number, out: RailCameraPose, time?: number): RailCameraPose {
  const attached = attachedFrames.get(curve);
  if (attached === undefined) throw new Error('railCameraPose requires a curve with an attached rail frame');
  const clock = time ?? attached.time;
  const clamped = MathUtils.clamp(u, 0, 1);
  const frame = sampleAttachedFrame(curve, attached, clamped, clock);
  const ahead = sampleAttachedFrame(curve, attached, MathUtils.clamp(clamped + lookAheadU, 0, 1), clock);
  poseForward.subVectors(ahead.position, frame.position);
  if (poseForward.lengthSq() < 1e-10) poseForward.copy(frame.tangent);
  poseForward.normalize();
  for (const lookTarget of attached.config.lookTargets ?? []) {
    const weight = rangeWeight(lookTarget.range, lookTarget.blend, clamped);
    if (weight <= 0) continue;
    const target = typeof lookTarget.target === 'function' ? lookTarget.target(clock) : lookTarget.target;
    poseTargetDirection.subVectors(target, frame.position);
    if (poseTargetDirection.lengthSq() < 1e-10) continue;
    poseForward.lerp(poseTargetDirection.normalize(), weight).normalize();
  }
  poseLookAt.copy(frame.position).add(poseForward);
  poseMatrix.lookAt(frame.position, poseLookAt, frame.up);
  out.position.copy(frame.position);
  out.quaternion.setFromRotationMatrix(poseMatrix);
  return out;
}
