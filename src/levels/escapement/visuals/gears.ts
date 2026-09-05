import {
  BoxGeometry,
  BufferGeometry,
  Group,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Path,
  Quaternion,
  RingGeometry,
  Shape,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, cos, cross, dot, normalGeometry, positionGeometry, positionLocal, sin, normalLocal } from 'three/tsl';
import { createDisplacementClock, displacedPosition } from '../../../engine/displaced-velocity';
import type { FloatNode, Vec3Node } from '../../../engine/tsl-surface';
import { createBrassMaterial, createPreviewLights, createSteelMaterial, pinSnapshotView, strikeDisplaceLocal, withPreviewEnvironment, type MetalOptions } from './materials';

// ---- spin shader -------------------------------------------------------------------
//
// Every spinning part carries four attributes: `spinCenter` and `spinAxis` in
// the mesh's local space, `spinRate` in radians per second, and `spinPhase` in
// radians. The vertex shader rotates the part about its axis by
// `gearClock * spinRate + spinPhase`. On an InstancedMesh the attributes are
// per instance; on a merged mesh they are per vertex, so one draw call can
// carry parts that spin at different rates about different centres. The spin
// goes through `displacedPosition`, so the velocity pass sees only the change
// between frames.

/** Integrated gear time in seconds. `update` advances it by dt times the spin rate and calls `set`. */
export const gearClock = createDisplacementClock(0);

function rotateAboutAxis(v: Vec3Node, axis: Vec3Node, angle: FloatNode): Vec3Node {
  const c = cos(angle);
  const s = sin(angle);
  return v.mul(c).add(cross(axis, v).mul(s)).add(axis.mul(dot(axis, v).mul(c.oneMinus())));
}

/** Spins a local position by the part's attributes at clock value `clock`; rotates the normal too when asked. */
function spinAt(local: Vec3Node, clock: FloatNode, rotateNormal: boolean): Vec3Node {
  const center = attribute<'vec3'>('spinCenter', 'vec3');
  const axis = attribute<'vec3'>('spinAxis', 'vec3');
  const rate = attribute<'float'>('spinRate', 'float');
  const phase = attribute<'float'>('spinPhase', 'float');
  const angle: FloatNode = clock.mul(rate).add(phase);
  if (rotateNormal) normalLocal.assign(rotateAboutAxis(normalLocal, axis, angle));
  return rotateAboutAxis(local.sub(center), axis, angle).add(center);
}

/** Position node for spinning parts: spin at the gear clock, then the strike wave, with velocity-correct previous positions. */
export function spinPositionNode(): Vec3Node {
  return displacedPosition((position, clock) => {
    // The velocity pass evaluates the previous frame first; only the current evaluation may rotate the normal.
    const current = position === positionLocal;
    return strikeDisplaceLocal(spinAt(position as Vec3Node, clock as FloatNode, current));
  }, gearClock) as Vec3Node;
}

/** Brass material for spinning parts: patterns sample the pre-spin geometry so they do not slide; no plate seams on a gear. */
export function createSpinningBrassMaterial(options: MetalOptions = {}) {
  return createBrassMaterial({ patternPosition: positionGeometry, patternNormal: normalGeometry, tarnish: 0.3, ...options, positionNode: spinPositionNode() });
}

/** Steel material for spinning parts. */
export function createSpinningSteelMaterial(options: MetalOptions = {}) {
  return createSteelMaterial({ patternPosition: positionGeometry, patternNormal: normalGeometry, ...options, positionNode: spinPositionNode() });
}

// ---- involute gear geometry ---------------------------------------------------------

export type GearSpec = {
  teeth: number;
  /** Gear module: pitch diameter divided by tooth count, in world units. */
  module: number;
  /** Axial thickness of the rim and teeth. */
  width: number;
  /** Radial depth of the rim inside the tooth roots. */
  rimWidth: number;
  hubRadius: number;
  spokes: number;
  spokeWidth?: number;
  /** Axial thickness of the spokes; defaults to 0.55 of `width`. */
  spokeDepth?: number;
};

const PRESSURE_ANGLE = (20 * Math.PI) / 180;
const FLANK_STEPS = 5;

function involuteAngle(pressure: number) {
  return Math.tan(pressure) - pressure;
}

export function pitchRadius(spec: GearSpec) {
  return (spec.teeth * spec.module) / 2;
}

export function tipRadius(spec: GearSpec) {
  return pitchRadius(spec) + spec.module;
}

/**
 * One tooth's outline in polar coordinates (radius, angle) from the root gap on
 * the trailing side to the root gap on the leading side, tooth centred at angle 0.
 */
function toothOutline(spec: GearSpec): Array<[number, number]> {
  const rp = pitchRadius(spec);
  const rb = rp * Math.cos(PRESSURE_ANGLE);
  const ra = rp + spec.module;
  const rf = rp - 1.25 * spec.module;
  const pitchAngle = (2 * Math.PI) / spec.teeth;
  const halfAtPitch = pitchAngle / 4;
  const halfAngle = (r: number) => {
    const clamped = Math.max(r, rb);
    const pressure = Math.acos(rb / clamped);
    return halfAtPitch + involuteAngle(PRESSURE_ANGLE) - involuteAngle(pressure);
  };

  const flankStart = Math.max(rb, rf);
  const flank: Array<[number, number]> = [];
  for (let i = 0; i <= FLANK_STEPS; i += 1) {
    const r = flankStart + ((ra - flankStart) * i) / FLANK_STEPS;
    flank.push([r, halfAngle(r)]);
  }

  const points: Array<[number, number]> = [];
  points.push([rf, -pitchAngle / 2]);
  points.push([rf, -halfAngle(flankStart) - 0.004]);
  for (const [r, a] of flank) points.push([r, -a]);
  for (let i = flank.length - 1; i >= 0; i -= 1) points.push([flank[i][0], flank[i][1]]);
  points.push([rf, halfAngle(flankStart) + 0.004]);
  return points;
}

/** The gear lies in the XY plane with its axis along +Z and tooth 0 centred on +X. */
export function createGearGeometry(spec: GearSpec): BufferGeometry {
  const outline = toothOutline(spec);
  const shape = new Shape();
  let first = true;
  for (let tooth = 0; tooth < spec.teeth; tooth += 1) {
    const base = (tooth * 2 * Math.PI) / spec.teeth;
    for (const [r, a] of outline) {
      const x = r * Math.cos(base + a);
      const y = r * Math.sin(base + a);
      if (first) {
        shape.moveTo(x, y);
        first = false;
      } else {
        shape.lineTo(x, y);
      }
    }
  }
  shape.closePath();

  const rootRadius = pitchRadius(spec) - 1.25 * spec.module;
  const innerRadius = Math.max(spec.hubRadius + 1, rootRadius - spec.rimWidth);
  const hole = new Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  // Chamfered teeth: the bevel takes a small fraction of the module off every edge.
  const bevel = spec.module * 0.09;
  const rim = new ExtrudeGeometry(shape, {
    depth: spec.width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 48,
  });
  rim.translate(0, 0, -(spec.width - bevel * 2) / 2);

  const parts: BufferGeometry[] = [rim];
  const spokeDepth = spec.spokeDepth ?? spec.width * 0.55;
  const spokeWidth = spec.spokeWidth ?? Math.max(1, spec.module * 0.9);
  const spokeLength = innerRadius - spec.hubRadius + 2;
  for (let i = 0; i < spec.spokes; i += 1) {
    const angle = (i * 2 * Math.PI) / spec.spokes;
    const spoke = new BoxGeometry(spokeLength, spokeWidth, spokeDepth);
    spoke.translate(spec.hubRadius - 1 + spokeLength / 2, 0, 0);
    spoke.rotateZ(angle);
    parts.push(spoke.toNonIndexed());
    spoke.dispose();
    // Fillet: a wider, thinner root where the spoke meets the rim and the hub.
    for (const [radius, length] of [
      [innerRadius - spokeWidth * 0.9, spokeWidth * 1.8],
      [spec.hubRadius + spokeWidth * 0.9, spokeWidth * 1.8],
    ]) {
      const fillet = new BoxGeometry(length, spokeWidth * 2.2, spokeDepth * 0.7);
      fillet.translate(radius, 0, 0);
      fillet.rotateZ(angle);
      parts.push(fillet.toNonIndexed());
      fillet.dispose();
    }
  }
  // Hub boss, a thinner web ring around it, and the arbor through it.
  const hub = new CylinderGeometry(spec.hubRadius, spec.hubRadius * 1.08, spec.width * 1.4, 32);
  hub.rotateX(Math.PI / 2);
  parts.push(hub.toNonIndexed());
  const webOuter = spec.hubRadius + (innerRadius - spec.hubRadius) * 0.3;
  const web = new RingGeometry(spec.hubRadius - 0.5, webOuter, 32, 1);
  const webDepth = spokeDepth * 0.5;
  for (const side of [-1, 1]) {
    const face = web.clone();
    face.translate(0, 0, side * webDepth * 0.5);
    if (side < 0) face.rotateY(Math.PI);
    parts.push(face.toNonIndexed());
    face.dispose();
  }
  web.dispose();
  const arbor = new CylinderGeometry(spec.hubRadius * 0.42, spec.hubRadius * 0.42, spec.width * 3.2, 20);
  arbor.rotateX(Math.PI / 2);
  parts.push(arbor.toNonIndexed());

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

// ---- gear families --------------------------------------------------------------------

export type GearInstance = {
  position: Vector3;
  /** Unit axis the gear spins about. */
  axis: Vector3;
  /** Signed radians per second about `axis` at spin rate 1. */
  rate: number;
  /** Radians. Tooth 0 sits at `gearBasis(axis).u` rotated by this about the axis. */
  phase?: number;
  scale?: number;
};

/**
 * Orthonormal basis for a gear axis: `u` is where tooth 0 points at phase 0, `v`
 * completes the right-handed frame (u, v, axis).
 */
export function gearBasis(axis: Vector3) {
  const helper = Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(helper, axis).normalize();
  const v = new Vector3().crossVectors(axis, u).normalize();
  return { u, v };
}

/** Signed angle from `gearBasis(axis).u` to `direction` about `axis`. */
export function phaseToward(axis: Vector3, direction: Vector3) {
  const { u } = gearBasis(axis);
  const flat = direction.clone().addScaledVector(axis, -direction.dot(axis)).normalize();
  const sign = new Vector3().crossVectors(u, flat).dot(axis);
  return Math.atan2(sign, u.dot(flat));
}

/**
 * Phase that centres a tooth of `spec` on `direction`. Add `toothPitch / 2` to
 * centre a gap there instead, which is what the meshing partner needs.
 */
export function toothPhase(spec: GearSpec, axis: Vector3, direction: Vector3, gap = false) {
  const pitch = (2 * Math.PI) / spec.teeth;
  const base = phaseToward(axis, direction);
  return base + (gap ? pitch / 2 : 0);
}

function wrapAngle(angle: number, period: number) {
  const wrapped = angle % period;
  const positive = wrapped < 0 ? wrapped + period : wrapped;
  return positive > period / 2 ? positive - period : positive;
}

/**
 * Phase for a gear driven by `driver`, whose centre lies along `direction` from
 * the driver. The driver's nearest tooth is offset from the contact line by some
 * angle; the driven gear's gap must sit at the same rim distance along the
 * shared tangent, which is the same offset scaled by the tooth ratio and
 * reversed because the rims face each other.
 */
export function meshedPhase(
  driver: { spec: GearSpec; axis: Vector3; phase: number },
  direction: Vector3,
  driven: GearSpec,
) {
  const driverPitch = (2 * Math.PI) / driver.spec.teeth;
  const drivenPitch = (2 * Math.PI) / driven.teeth;
  const contact = phaseToward(driver.axis, direction);
  const toothOffset = wrapAngle(driver.phase - contact, driverPitch);
  const gapOffset = (-toothOffset * driver.spec.teeth) / driven.teeth;
  return phaseToward(driver.axis, direction.clone().negate()) + drivenPitch / 2 + gapOffset;
}

/**
 * A pinion riding on a wheel's arbor: same centre line, axis and rate, offset
 * `along` units up the axis so it sits above the wheel and meshes with the
 * next wheel of the train.
 */
export function pinionOn(wheel: GearInstance, along: number): GearInstance {
  return {
    position: wheel.position.clone().addScaledVector(wheel.axis, along),
    axis: wheel.axis,
    rate: wheel.rate,
    phase: wheel.phase,
  };
}

export type GearFamily = {
  mesh: InstancedMesh;
  spec: GearSpec;
  instances: GearInstance[];
  /** Rewrites one instance's phase; the escape wheel is stepped this way. */
  setPhase(index: number, phase: number): void;
};

function instanceMatrix(instance: GearInstance, out: Matrix4) {
  const { u, v } = gearBasis(instance.axis);
  const rotation = new Matrix4().makeBasis(u, v, instance.axis);
  const quaternion = new Quaternion().setFromRotationMatrix(rotation);
  const scale = instance.scale ?? 1;
  return out.compose(instance.position, quaternion, new Vector3(scale, scale, scale));
}

/** One InstancedMesh holding every gear of one spec. */
export function createGearFamily(spec: GearSpec, instances: GearInstance[], material?: Material): GearFamily {
  const geometry = createGearGeometry(spec);
  const count = instances.length;
  const centers = new Float32Array(count * 3);
  const axes = new Float32Array(count * 3);
  const rates = new Float32Array(count);
  const phases = new Float32Array(count);
  const mesh = new InstancedMesh(geometry, material ?? createSpinningBrassMaterial(), count);
  const matrix = new Matrix4();
  instances.forEach((instance, index) => {
    mesh.setMatrixAt(index, instanceMatrix(instance, matrix));
    centers.set([instance.position.x, instance.position.y, instance.position.z], index * 3);
    axes.set([instance.axis.x, instance.axis.y, instance.axis.z], index * 3);
    rates[index] = instance.rate;
    phases[index] = instance.phase ?? 0;
  });
  const phaseAttribute = new InstancedBufferAttribute(phases, 1);
  geometry.setAttribute('spinCenter', new InstancedBufferAttribute(centers, 3));
  geometry.setAttribute('spinAxis', new InstancedBufferAttribute(axes, 3));
  geometry.setAttribute('spinRate', new InstancedBufferAttribute(rates, 1));
  geometry.setAttribute('spinPhase', phaseAttribute);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    spec,
    instances,
    setPhase(index, phase) {
      phases[index] = phase;
      phaseAttribute.needsUpdate = true;
    },
  };
}

// ---- merged spinning parts ----------------------------------------------------------------

export type SpinPart = {
  geometry: BufferGeometry;
  center: Vector3;
  axis: Vector3;
  rate: number;
  phase?: number;
};

/**
 * Merges parts that spin independently into one geometry with per-vertex spin
 * attributes. Each part's geometry must already sit in the mesh's local space.
 */
export function mergeSpinParts(parts: SpinPart[]): BufferGeometry {
  const geometries = parts.map((part) => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const count = geometry.getAttribute('position').count;
    const centers = new Float32Array(count * 3);
    const axes = new Float32Array(count * 3);
    const rates = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      centers.set([part.center.x, part.center.y, part.center.z], i * 3);
      axes.set([part.axis.x, part.axis.y, part.axis.z], i * 3);
      rates[i] = part.rate;
      phases[i] = part.phase ?? 0;
    }
    geometry.setAttribute('spinCenter', new Float32BufferAttribute(centers, 3));
    geometry.setAttribute('spinAxis', new Float32BufferAttribute(axes, 3));
    geometry.setAttribute('spinRate', new Float32BufferAttribute(rates, 1));
    geometry.setAttribute('spinPhase', new Float32BufferAttribute(phases, 1));
    return geometry;
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

/** A single gear as a plain mesh, for previews and for parts that never spin. */
export function createGearMesh(spec: GearSpec, material?: Material) {
  return new Mesh(createGearGeometry(spec), material ?? createBrassMaterial({ patternPosition: positionGeometry, patternNormal: normalGeometry }));
}

// ---- preview ------------------------------------------------------------------------------

/** Snapshot factory: a great wheel meshing with a pinion, each with a pinion on its arbor, under the level sky. */
export function previewGears() {
  return withPreviewEnvironment(() => {
    const group = new Group();
    const big: GearSpec = { teeth: 30, module: 4, width: 10, rimWidth: 12, hubRadius: 8, spokes: 6 };
    const small: GearSpec = { teeth: 14, module: 4, width: 10, rimWidth: 6, hubRadius: 5, spokes: 4 };
    const top: GearSpec = { teeth: 9, module: 4, width: 8, rimWidth: 4, hubRadius: 4, spokes: 3 };
    const axis = new Vector3(0, 0, 1);
    const contact = new Vector3(1, 0, 0);
    const bigCenter = new Vector3(0, 0, 0);
    const smallCenter = bigCenter.clone().addScaledVector(contact, pitchRadius(big) + pitchRadius(small));
    const bigInstance: GearInstance = { position: bigCenter, axis, rate: 0.3, phase: toothPhase(big, axis, contact) };
    const smallInstance: GearInstance = {
      position: smallCenter,
      axis,
      rate: -0.3 * (big.teeth / small.teeth),
      phase: meshedPhase({ spec: big, axis, phase: bigInstance.phase ?? 0 }, contact, small),
    };
    group.add(createGearFamily(big, [bigInstance]).mesh);
    group.add(createGearFamily(small, [smallInstance]).mesh);
    group.add(createGearFamily(top, [pinionOn(bigInstance, 12), pinionOn(smallInstance, 12)]).mesh);
    group.add(createPreviewLights(new Vector3(30, 20, 0), 120));
    gearClock.set(0.8);
    return group;
  });
}

/** Snapshot factory: the mesh point between the wheel and pinion, close up. */
export function previewGearMesh() {
  return withPreviewEnvironment(() => {
    const group = new Group();
    const big: GearSpec = { teeth: 30, module: 4, width: 10, rimWidth: 12, hubRadius: 8, spokes: 6 };
    const small: GearSpec = { teeth: 14, module: 4, width: 10, rimWidth: 6, hubRadius: 5, spokes: 4 };
    const axis = new Vector3(0, 0, 1);
    const contact = new Vector3(1, 0, 0);
    const smallCenter = new Vector3().addScaledVector(contact, pitchRadius(big) + pitchRadius(small));
    const bigInstance: GearInstance = { position: new Vector3(), axis, rate: 0.3, phase: toothPhase(big, axis, contact) };
    const smallInstance: GearInstance = {
      position: smallCenter,
      axis,
      rate: -0.3 * (big.teeth / small.teeth),
      phase: meshedPhase({ spec: big, axis, phase: bigInstance.phase ?? 0 }, contact, small),
    };
    group.add(createGearFamily(big, [bigInstance]).mesh);
    group.add(createGearFamily(small, [smallInstance]).mesh);
    group.add(createPreviewLights(new Vector3(60, 0, 0), 60));
    gearClock.set(0.8);
    return pinSnapshotView(group, new Vector3(pitchRadius(big), -6, 70), new Vector3(0, 0.1, -1));
  });
}
