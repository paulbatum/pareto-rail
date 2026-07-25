import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Color } from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import type { OctopusPose } from '../octopus';
import { ARM_SEGMENTS, SEGMENT_GEOMETRY, mergeParts, part, type Parts } from './creatures';
import { modalLine, modalMesh } from './materials';

// The creature's body, the wreck it is holding, and the maths that turns three
// points into a limb. The mantle is scenery in the strict sense — nothing here
// is lockable — but it is the thing the whole level is about, so it breathes,
// flinches, turns to follow the player, and splits open at the end.

const UP = new Vector3(0, 1, 0);
const matrix = new Matrix4();
const quaternion = new Quaternion();
const scale = new Vector3();
const cursor = new Vector3();
const nextPoint = new Vector3();
const direction = new Vector3();
const basis = new Matrix4();
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();

export type OctopusSkin = {
  hideMurk: Color;
  hideThermal: Color;
  glowMurk: Color;
  glowThermal: Color;
  wreckMurk: Color;
  wreckThermal: Color;
  cableMurk: Color;
  cableThermal: Color;
  hurtMurk: Color;
  hurtThermal: Color;
};

export type LimbShape = {
  tip: Vector3;
  bulge: Vector3;
  shoulder: Vector3;
  /** Segment radius at the shoulder; the tip end tapers to a fifth of it. */
  thickness: number;
  /** Amplitude of the travelling ripple down the limb. */
  wobble: number;
  time: number;
  fade?: number;
};

function bezier(target: Vector3, tip: Vector3, bulge: Vector3, shoulder: Vector3, t: number) {
  const inverse = 1 - t;
  return target
    .copy(tip).multiplyScalar(inverse * inverse)
    .addScaledVector(bulge, 2 * inverse * t)
    .addScaledVector(shoulder, t * t);
}

/**
 * Lay an instanced limb along a quadratic curve from the curled tip back to the
 * shoulder. Instances are written in the parent's local space, so an arm target
 * can carry its own limb without the group's transform fighting the maths.
 */
export function poseLimb(limb: InstancedMesh, origin: Vector3, shape: LimbShape) {
  const count = ARM_SEGMENTS;
  const step = 1 / count;
  for (let i = 0; i < count; i += 1) {
    const t = i * step;
    bezier(cursor, shape.tip, shape.bulge, shape.shoulder, t);
    bezier(nextPoint, shape.tip, shape.bulge, shape.shoulder, Math.min(1, t + step));
    direction.copy(nextPoint).sub(cursor);
    const length = Math.max(0.05, direction.length());
    direction.multiplyScalar(1 / length);
    // A travelling ripple: the limb never reads as a stretched cable.
    const ripple = Math.sin(t * 7.5 - shape.time * 3.1) * shape.wobble * (0.25 + t * 0.75);
    cursor.addScaledVector(UP, ripple).sub(origin);
    const radius = MathUtils.lerp(0.3, 1.15, t ** 0.6) * shape.thickness * (shape.fade ?? 1);
    quaternion.setFromUnitVectors(UP, direction);
    scale.set(radius, length * 1.75, radius);
    matrix.compose(cursor, quaternion, scale);
    limb.setMatrixAt(i, matrix);
  }
  limb.count = count;
  limb.instanceMatrix.needsUpdate = true;
}

export type OctopusBody = {
  group: Group;
  update(pose: OctopusPose, time: number, dt: number): void;
  materials: { hide: MeshBasicNodeMaterial; glow: MeshBasicNodeMaterial };
};

function buildMantle(parts: Parts) {
  // The mass: a heavy bag of muscle, wider than it is tall, hanging forward.
  part(parts, 'body', new IcosahedronGeometry(5.8, 2), { at: [0, 0.6, -2.2], scale: [1.16, 0.82, 1.42] });
  part(parts, 'body', new ConeGeometry(4.4, 9.5, 9), { at: [0, 1.4, -9.5], rotate: [-Math.PI / 2, 0, 0] });
  // Mantle ridge and fins.
  for (const side of [-1, 1]) {
    part(parts, 'body', new ConeGeometry(1.5, 5.2, 5), { at: [side * 5.2, 2.4, -6.5], rotate: [-1.2, 0, side * 0.8], scale: [1, 1, 0.35] });
  }
  for (let i = 0; i < 4; i += 1) {
    part(parts, 'body', new TorusGeometry(4.6 - i * 0.55, 0.34, 5, 16), { at: [0, 1.0, -4.6 - i * 1.7], scale: [1.12, 0.82, 1] });
  }
  // Brow over the eyes, and the socket the beak sits in.
  part(parts, 'body', new BoxGeometry(7.4, 1.1, 2.6), { at: [0, 2.9, 1.2], rotate: [0.35, 0, 0] });
  part(parts, 'body', new CylinderGeometry(3.5, 4.6, 3.0, 10), { at: [0, -0.5, 2.0], rotate: [Math.PI / 2, 0, 0] });
  // Shoulders: the roots every limb leaves from.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    part(parts, 'body', new ConeGeometry(1.5, 3.4, 6), {
      at: [Math.cos(angle) * 4.0, Math.sin(angle) * 3.2 - 0.4, 2.6],
      rotate: [Math.PI / 2.2, 0, angle],
    });
  }

  // Eyes: horizontal lenses either side of the brow. In infrared they are the
  // hottest thing in the harbour.
  for (const side of [-1, 1]) {
    part(parts, 'core', new SphereGeometry(1.28, 12, 9), { at: [side * 4.3, 1.9, 1.5], scale: [1, 0.66, 1] });
    part(parts, 'core', new BoxGeometry(1.7, 0.24, 0.5), { at: [side * 4.3, 1.9, 2.5] });
  }
  // Gill vents down the flanks.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      part(parts, 'core', new BoxGeometry(0.22, 1.5, 0.22), { at: [side * 5.6, 0.2, -3.0 - i * 1.6], rotate: [0, 0, side * 0.4] });
    }
  }
}

function buildShellPlate(parts: Parts) {
  part(parts, 'body', new ConeGeometry(2.1, 3.4, 4, 1, true), { rotate: [Math.PI / 2, 0, 0], scale: [1, 1, 0.55] });
  part(parts, 'body', new BoxGeometry(1.5, 0.3, 2.6), { at: [0, -0.5, 0.2] });
}

function buildWreck(parts: Parts) {
  // A snapped hull section with its ribs showing, plus the crane boom that came
  // down with it. The creature is holding all of it.
  part(parts, 'body', new BoxGeometry(13, 5.2, 6.4), { at: [1.5, -7.5, -6.5], rotate: [0.16, 0.3, 0.22] });
  part(parts, 'body', new CylinderGeometry(2.6, 3.1, 9.5, 8), { at: [-7.5, -6.2, -3.5], rotate: [0.2, 0, 1.25] });
  for (let i = 0; i < 5; i += 1) {
    part(parts, 'body', new TorusGeometry(2.9, 0.22, 4, 12), { at: [-3 + i * 2.3, -8.2, -3.0], rotate: [0, Math.PI / 2, 0.2] });
  }
  part(parts, 'body', new BoxGeometry(1.1, 1.1, 17), { at: [6.5, -4.5, -10], rotate: [0.32, 0.24, 0] });
  part(parts, 'body', new BoxGeometry(0.7, 0.7, 9), { at: [-5.0, -10.5, -12], rotate: [-0.2, -0.4, 0] });
  part(parts, 'body', new CylinderGeometry(0.55, 0.55, 12, 6), { at: [8.5, -9.0, -2.5], rotate: [0.1, 0, 1.4] });
}

function cableGeometry(rng: () => number) {
  const positions: number[] = [];
  for (let strand = 0; strand < 9; strand += 1) {
    const anchor = new Vector3(
      (rng() - 0.5) * 9,
      -4 - rng() * 5,
      -6 - rng() * 6,
    );
    let previous = anchor.clone();
    const drift = new Vector3((rng() - 0.5) * 2.2, -1.2 - rng() * 1.4, -3.2 - rng() * 2.4);
    for (let i = 0; i < 7; i += 1) {
      const next = previous.clone().add(drift).add(new Vector3((rng() - 0.5) * 1.6, (rng() - 0.5) * 1.1, 0));
      positions.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
      previous = next;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

export function createOctopusBody(skin: OctopusSkin, rng: () => number): OctopusBody {
  const group = new Group();
  group.name = 'octopus';
  group.frustumCulled = false;

  const hide = modalMesh(skin.hideMurk, skin.hideThermal, { swallow: 0.9, shade: 0.95, rim: 0.8 });
  const glow = modalMesh(skin.glowMurk, skin.glowThermal, { swallow: 0.82, shade: 0.2, rim: 0.5 });
  const wreckMaterial = modalMesh(skin.wreckMurk, skin.wreckThermal, { swallow: 0.95, shade: 0.85, rim: 0.16 });
  const cableMaterial = modalLine(skin.cableMurk, skin.cableThermal, { swallow: 0.96 });

  const mantleParts: Parts = { body: [], core: [] };
  buildMantle(mantleParts);
  const mantle = mergeParts(mantleParts);
  const hull = mantle.body ? new Mesh(mantle.body, hide) : new Mesh();
  const lights = mantle.core ? new Mesh(mantle.core, glow) : new Mesh();
  const mantleGroup = new Group();
  mantleGroup.name = 'mantle';
  mantleGroup.add(hull, lights);
  group.add(mantleGroup);

  // Four plates over the beak socket. They stay shut until the creature has
  // nothing left to hide behind.
  const plates: Mesh[] = [];
  const plateParts: Parts = { body: [], core: [] };
  buildShellPlate(plateParts);
  const plateGeometry = mergeParts(plateParts).body;
  for (let i = 0; i < 4; i += 1) {
    const plate = new Mesh(plateGeometry ?? new BufferGeometry(), hide);
    plate.name = 'shell-plate';
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    plate.userData.angle = angle;
    plates.push(plate);
    group.add(plate);
  }

  const wreckParts: Parts = { body: [], core: [] };
  buildWreck(wreckParts);
  const wreckGeometry = mergeParts(wreckParts).body ?? new BufferGeometry();
  const wreck = new Mesh(wreckGeometry, wreckMaterial);
  wreck.name = 'held-wreck';
  const wreckEdges = new LineSegments(new EdgesGeometry(wreckGeometry, 32), cableMaterial);
  group.add(wreck, wreckEdges);

  const cables = new LineSegments(cableGeometry(rng), cableMaterial);
  cables.frustumCulled = false;
  group.add(cables);

  // Two limbs that never let go of the wreck: the fight's silhouette needs the
  // creature to be holding something even when every free arm is severed.
  const gripLimbs: InstancedMesh[] = [];
  const gripShapes: LimbShape[] = [];
  for (let i = 0; i < 2; i += 1) {
    const limb = new InstancedMesh(SEGMENT_GEOMETRY, hide, ARM_SEGMENTS);
    limb.name = 'grip-limb';
    limb.frustumCulled = false;
    limb.count = 0;
    gripLimbs.push(limb);
    group.add(limb);
    const side = i === 0 ? -1 : 1;
    gripShapes.push({
      tip: new Vector3(side * 9.5, -9.5, -9),
      bulge: new Vector3(side * 9.0, -4.5, 1.5),
      shoulder: new Vector3(side * 3.6, -1.0, 2.6),
      thickness: 1.5,
      wobble: 0.35,
      time: 0,
    });
  }

  const origin = new Vector3();

  return {
    group,
    materials: { hide, glow },
    update(pose, time, dt) {
      axisZ.copy(pose.facing).normalize();
      axisX.copy(pose.up).cross(axisZ);
      if (axisX.lengthSq() < 0.0001) axisX.set(1, 0, 0);
      axisX.normalize();
      axisY.copy(axisZ).cross(axisX).normalize();
      basis.makeBasis(axisX, axisY, axisZ);
      group.position.copy(pose.anchor);
      group.quaternion.setFromRotationMatrix(basis);

      const swell = 1 + Math.sin(time * 1.05) * 0.035 + pose.flinch * 0.06;
      mantleGroup.scale.set(swell, 1 / swell ** 0.4, 1 + Math.sin(time * 1.05 + 1.2) * 0.05);
      mantleGroup.rotation.z = Math.sin(time * 0.42) * 0.09 + pose.flinch * 0.05;
      mantleGroup.rotation.x = Math.sin(time * 0.31 + 0.8) * 0.06;

      const openness = pose.shell;
      for (const plate of plates) {
        const angle = plate.userData.angle as number;
        const spread = MathUtils.lerp(2.0, 4.6, openness);
        plate.position.set(Math.cos(angle) * spread, Math.sin(angle) * spread * 0.85, MathUtils.lerp(3.4, 1.4, openness));
        plate.rotation.z = angle;
        plate.rotation.x = MathUtils.lerp(0, -1.15, openness);
        plate.rotation.y = Math.cos(angle) * openness * 0.9;
        plate.scale.setScalar(MathUtils.lerp(1, 0.82, openness));
      }

      cables.rotation.z = Math.sin(time * 0.5) * 0.05;
      wreck.rotation.z = Math.sin(time * 0.33 + 2.1) * 0.03;

      for (let i = 0; i < gripLimbs.length; i += 1) {
        const shape = gripShapes[i];
        shape.time = time + i * 1.7;
        shape.tip.y = -9.5 + Math.sin(time * 0.6 + i) * 0.9;
        poseLimb(gripLimbs[i], origin, shape);
      }

      // The whole body reddens as it takes damage; in infrared it just runs
      // hotter, which is the only tell the imager gives you.
      const heat = MathUtils.clamp(pose.flinch * 0.55 + pose.coreHurt * 0.5, 0, 1);
      writeModal(hide, skin.hideMurk, skin.hideThermal, skin.hurtMurk, skin.hurtThermal, heat * 0.7);
      writeModal(glow, skin.glowMurk, skin.glowThermal, skin.hurtMurk, skin.hurtThermal, heat);
      void dt;
    },
  };
}

type ModalHandles = { murk: { value: Color }; thermal: { value: Color } };

function writeModal(
  material: MeshBasicNodeMaterial,
  murk: Color,
  thermal: Color,
  flashMurk: Color,
  flashThermal: Color,
  amount: number,
) {
  const modal = material.userData.modal as ModalHandles | undefined;
  if (!modal) return;
  modal.murk.value.copy(murk).lerp(flashMurk, amount);
  modal.thermal.value.copy(thermal).lerp(flashThermal, amount);
}
