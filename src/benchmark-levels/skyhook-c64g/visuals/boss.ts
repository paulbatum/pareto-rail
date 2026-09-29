import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { BOSS_GRIP, BOSS_SCALE, bossState, clampLocal } from '../boss';
import { MergeBuilder, addMerged } from './merge';
import { CHARCOAL, GUNMETAL, HAZARD, HAZARD_HOT, PANEL_SHADE, PANEL_WHITE, hdr } from './palette';

// THE RIPPER. A salvage tug that has gone hunting: a gunmetal barrel hull, a
// shredder maw where the climber should be, and four long legs that grip the
// guy cables hand over hand. Modelled with +Z toward the car; gameplay's local
// z runs the other way (see boss.ts), so the frame flips z on the way in.
//
// The clamps (targets) live in gameplay; the legs here are inverse-kinematic
// to those same hand positions, so what you shoot is what is gripping.

const Y = new Vector3(0, 1, 0);
const scratch = new Vector3();
const scratchB = new Vector3();
const basisMatrix = new Matrix4();
const localFoot = new Vector3();

const HULL_RADIUS = 13;
const THIGH = 34;
const SHIN = 34;

type Leg = {
  thigh: Mesh;
  shin: Mesh;
  knee: Mesh;
  claw: Mesh;
  hip: Vector3;
  outward: Vector3;
  sy: number;
};

export type BossBody = {
  group: Group;
  /** World positions of the four knees (for spark effects on severed legs). */
  kneeWorld: Vector3[];
  update(dt: number, elapsed: number, camera: Camera, beat: number, running: boolean, sinceLatch: number): void;
  reset(): void;
  /** Called once when the core dies: the body tumbles free of the cable. */
  release(): void;
};

function segment(mesh: Mesh, from: Vector3, to: Vector3, radius: number) {
  const length = from.distanceTo(to);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y, scratch.copy(to).sub(from).normalize());
  mesh.scale.set(radius, Math.max(0.01, length), radius);
}

export function createBossBody(): BossBody {
  const root = new Group(); // world-space carrier: follows the cable, or tumbles free
  const model = new Group(); // right-handed model frame, +Z toward the car
  model.scale.setScalar(BOSS_SCALE);
  root.add(model);
  root.visible = false;

  const hullMaterial = new MeshLambertMaterial({ color: GUNMETAL.clone().multiplyScalar(1.5), emissive: new Color(0.03, 0.032, 0.04) });
  const plateMaterial = new MeshLambertMaterial({ color: PANEL_SHADE.clone().multiplyScalar(0.85), emissive: new Color(0.05, 0.05, 0.055) });
  const darkMaterial = new MeshLambertMaterial({ color: CHARCOAL.clone().multiplyScalar(2), emissive: new Color(0.012, 0.012, 0.015) });
  const hazardMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 1.0) });
  const glowMaterial = new MeshBasicMaterial({ color: hdr(HAZARD_HOT, 2.2) });
  const steelMaterial = new MeshLambertMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.75), emissive: new Color(0.08, 0.08, 0.09) });

  // Static hull, baked into one mesh per material.
  const builder = new MergeBuilder();
  builder.add(new CylinderGeometry(HULL_RADIUS, HULL_RADIUS * 1.06, 42, 20, 1), 'hull', { position: [0, 0, -4], rotation: [Math.PI / 2, 0, 0] });
  for (const z of [-16, -6, 4, 12]) {
    builder.add(new TorusGeometry(HULL_RADIUS * 1.03, 1.1, 8, 28), z === 4 ? 'hazard' : 'plate', { position: [0, 0, z] });
  }
  builder.add(new BoxGeometry(26, 22, 16), 'dark', { position: [0, 0, -27] });
  for (const side of [-1, 1]) {
    builder.add(new BoxGeometry(9, 14, 30), 'plate', { position: [side * 15.5, 0, -10] });
    builder.add(new BoxGeometry(9.2, 3, 8), 'hazard', { position: [side * 15.5, 0, -1] });
    builder.add(new ConeGeometry(5, 8, 10), 'glow', { position: [side * 8, 0, -37], rotation: [-Math.PI / 2, 0, 0] });
  }
  // The maw: collar, well, and hip sockets.
  builder.add(new TorusGeometry(HULL_RADIUS * 0.95, 2.6, 10, 32), 'hazard', { position: [0, 0, 22] });
  builder.add(new CylinderGeometry(HULL_RADIUS * 0.72, HULL_RADIUS * 0.72, 3, 24), 'dark', { position: [0, 0, 21], rotation: [Math.PI / 2, 0, 0] });
  const hips = BOSS_GRIP.map(([gx, gy]) => new Vector3(Math.sign(gx) * 11, Math.sign(gy) * 8, 6));
  for (const hip of hips) builder.add(new SphereGeometry(3.4, 12, 10), 'dark', { position: [hip.x, hip.y, hip.z] });
  addMerged(model, builder, { hull: hullMaterial, plate: plateMaterial, dark: darkMaterial, hazard: hazardMaterial, glow: glowMaterial });

  // Beacons along the spine: two sets, alternating on the beat.
  const beaconBuilder = new MergeBuilder();
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    beaconBuilder.add(new BoxGeometry(2.4, 2.4, 2.4), i % 2 === 0 ? 'even' : 'odd', {
      position: [Math.cos(angle) * (HULL_RADIUS + 1.2), Math.sin(angle) * (HULL_RADIUS + 1.2), i % 2 === 0 ? 8 : -12],
    });
  }
  const beaconMaterials = { even: new MeshBasicMaterial({ color: HAZARD.clone() }), odd: new MeshBasicMaterial({ color: HAZARD.clone() }) };
  addMerged(model, beaconBuilder, beaconMaterials);

  // Shredder teeth: one rotating mesh around the core well.
  const teeth = new Group();
  teeth.position.z = 22;
  const toothBuilder = new MergeBuilder();
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    toothBuilder.add(new ConeGeometry(1.9, 9, 4), 'teeth', {
      position: [Math.cos(angle) * (HULL_RADIUS * 0.82), Math.sin(angle) * (HULL_RADIUS * 0.82), 3.4],
      rotation: [Math.PI / 2, 0, angle],
    });
  }
  addMerged(teeth, toothBuilder, { teeth: steelMaterial });
  model.add(teeth);

  // Hatch leaves that slide open when the clamps are gone.
  const leaves: Mesh[] = [];
  const leafGeometry = new BoxGeometry(8.4, 8.4, 1.6);
  for (let i = 0; i < 4; i += 1) {
    const leaf = new Mesh(leafGeometry, plateMaterial);
    leaf.userData.sx = i % 2 === 0 ? -1 : 1;
    leaf.userData.sy = i < 2 ? -1 : 1;
    leaf.position.set(leaf.userData.sx * 4.3, leaf.userData.sy * 4.3, 23.4);
    model.add(leaf);
    leaves.push(leaf);
  }

  // Legs.
  const legs: Leg[] = [];
  const thighGeometry = new CylinderGeometry(1, 1, 1, 10);
  const shinGeometry = new CylinderGeometry(1, 0.8, 1, 10);
  const kneeGeometry = new SphereGeometry(2.6, 12, 10);
  const clawGeometry = new TorusGeometry(2.7, 0.75, 8, 16);
  BOSS_GRIP.forEach(([gx, gy], index) => {
    const sx = Math.sign(gx);
    const sy = Math.sign(gy);
    const thigh = new Mesh(thighGeometry, plateMaterial);
    const shin = new Mesh(shinGeometry, hullMaterial);
    const knee = new Mesh(kneeGeometry, hazardMaterial);
    const claw = new Mesh(clawGeometry, hazardMaterial);
    model.add(thigh, shin, knee, claw);
    legs.push({ thigh, shin, knee, claw, hip: hips[index], outward: new Vector3(sx, sy * 0.7, -0.2).normalize(), sy });
  });

  // A far-visible beacon so the thing can be seen the whole way down.
  const haloGeometry = new CircleGeometry(1, 40);
  const haloColors = new Float32Array(haloGeometry.attributes.position.count * 3);
  for (let i = 0; i < haloGeometry.attributes.position.count; i += 1) {
    const r = Math.hypot(haloGeometry.attributes.position.getX(i), haloGeometry.attributes.position.getY(i));
    const v = Math.pow(Math.max(0, 1 - r), 2.4);
    haloColors[i * 3] = 1.0 * v;
    haloColors[i * 3 + 1] = 0.42 * v;
    haloColors[i * 3 + 2] = 0.08 * v;
  }
  haloGeometry.setAttribute('color', new BufferAttribute(haloColors, 3));
  const haloMaterial = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const halo = new Mesh(haloGeometry, haloMaterial);
  halo.renderOrder = 5;
  root.add(halo);

  root.traverse((object) => {
    object.userData.raildIgnoreOcclusion = true;
    object.frustumCulled = false;
  });

  // Free-flight state after the kill.
  let released = false;
  const drift = new Vector3();
  const tumble = new Vector3(0.4, 0.7, 0.3).normalize();
  const tumbleQuat = new Quaternion();
  let tumbleSpin = 0;
  let freePosition = new Vector3();
  let freeAge = 0;

  const cameraForward = new Vector3();
  const kneeWorld = legs.map(() => new Vector3());

  function release() {
    released = true;
    freeAge = 0;
    freePosition = root.position.clone();
    drift.copy(bossState.right).multiplyScalar(11).addScaledVector(bossState.up, 6);
    tumbleSpin = 0.35;
  }

  return {
    group: root,
    kneeWorld,
    reset() {
      released = false;
      freeAge = 0;
      root.visible = false;
      model.position.set(0, 0, 0);
      model.quaternion.identity();
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      for (const leaf of leaves) leaf.position.set(leaf.userData.sx * 4.3, leaf.userData.sy * 4.3, 23.4);
    },
    release,
    update(dt, elapsed, camera, beat, running, sinceLatch) {
      const alive = running && bossState.phase !== 'idle' && bossState.phase !== 'gone';
      root.visible = alive;
      if (!alive) return;

      // It arrives with a lurch: the strike lands, then it unfolds to full size.
      const arrive = MathUtils.clamp(sinceLatch / 0.8, 0, 1);
      root.scale.setScalar(0.25 + 0.75 * (1 - (1 - arrive) ** 3));

      if (!released) {
        // Follow the cable: right-handed basis (right, up, -tangent) at the body origin.
        basisMatrix.makeBasis(bossState.right, bossState.up, scratch.copy(bossState.tangent).negate());
        root.position.copy(bossState.origin);
        root.quaternion.setFromRotationMatrix(basisMatrix);
      } else {
        freeAge += dt;
        freePosition.addScaledVector(drift, dt);
        root.position.copy(freePosition);
        tumbleQuat.setFromAxisAngle(tumble, tumbleSpin * dt);
        root.quaternion.premultiply(tumbleQuat);
        tumbleSpin += dt * 0.35;
      }

      // Legs: two-bone IK from the hip to the gameplay clamp position.
      legs.forEach((leg, index) => {
        const gone = bossState.clampGone[index];
        clampLocal(index, bossState.strides, bossState.stride, localFoot);
        const foot = scratchB.set(localFoot.x, localFoot.y, -localFoot.z).divideScalar(BOSS_SCALE);
        if (gone) {
          // Torn off: the leg hangs from the hip, sparking, the shin sheared away.
          foot.copy(leg.hip).addScaledVector(leg.outward, 22).add(scratch.set(0, -12 * Math.sign(leg.sy || 1), -14 - Math.sin(elapsed * 3 + index) * 3));
        }
        const hip = leg.hip;
        const toFoot = scratch.copy(foot).sub(hip);
        const distance = Math.min(toFoot.length(), THIGH + SHIN - 0.5);
        const dir = toFoot.clone().normalize();
        const mid = hip.clone().addScaledVector(dir, distance / 2);
        const perp = leg.outward.clone().addScaledVector(dir, -leg.outward.dot(dir)).normalize();
        const height = Math.sqrt(Math.max(1, THIGH * THIGH - (distance / 2) * (distance / 2)));
        const knee = mid.addScaledVector(perp, height);
        segment(leg.thigh, hip, knee, 2.3);
        leg.knee.position.copy(knee);
        model.localToWorld(kneeWorld[index].copy(knee));
        if (gone) {
          leg.shin.visible = false;
          leg.claw.visible = false;
        } else {
          leg.shin.visible = true;
          leg.claw.visible = true;
          segment(leg.shin, knee, dir.clone().multiplyScalar(distance).add(hip), 1.7);
          leg.claw.position.copy(foot);
          // Claws open while swinging, clamp shut as they plant.
          leg.claw.scale.setScalar(1 + Math.sin(bossState.stride * Math.PI) * 0.1);
        }
      });

      // Teeth: idle churn, a scream when the maw reaches the car.
      teeth.rotation.z += dt * (bossState.tearing ? 9 : bossState.exposed ? 1.6 : 0.6);
      // Hatch: closed while clamps hold, open once exposed.
      const open = bossState.exposed || bossState.killed ? 1 : 0;
      for (const leaf of leaves) {
        const target = open ? 9.5 : 4.3;
        leaf.position.x += (leaf.userData.sx * target - leaf.position.x) * Math.min(1, dt * 3);
        leaf.position.y += (leaf.userData.sy * target - leaf.position.y) * Math.min(1, dt * 3);
      }
      // Beacons flash on the beat; alarm-fast while tearing.
      const pulse = (odd: boolean) =>
        bossState.tearing ? (Math.sin(elapsed * 18 + (odd ? 1 : 0)) > 0 ? 1 : 0.15) : 0.2 + (odd ? 1 - beat : beat) * 0.9;
      beaconMaterials.even.color.copy(HAZARD).multiplyScalar(0.4 + pulse(false) * 2.4);
      beaconMaterials.odd.color.copy(HAZARD).multiplyScalar(0.4 + pulse(true) * 2.4);

      // Halo: constant apparent size, pulsing with each grip.
      camera.getWorldDirection(cameraForward);
      const distance = camera.position.distanceTo(root.position);
      const angular = 0.045 + bossState.flinch * 0.04;
      const radius = Math.max(16, distance * angular);
      halo.scale.setScalar(radius * (distance > 120 ? 1 : Math.max(0.2, distance / 120)));
      halo.quaternion.copy(camera.quaternion).premultiply(root.quaternion.clone().invert());
      haloMaterial.opacity = (released ? Math.max(0, 1 - freeAge / 2.5) : 1) * (0.3 + beat * 0.3);
      halo.position.set(0, 0, 8);
    },
  };
}
