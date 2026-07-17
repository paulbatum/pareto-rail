import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, CatmullRomCurve3 } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import {
  createMassDriverRail,
  MASS_DRIVER_MUZZLE_U,
  massDriverRunProgress,
  massDriverSpeedAt,
} from '../gameplay';
import {
  MASS_DRIVER_BEAT_SECONDS,
  MASS_DRIVER_DURATION,
  MASS_DRIVER_MARKERS,
} from '../timing';
import { material, PALETTE } from './models';

const Z_AXIS = new Vector3(0, 0, 1);
const BARREL_RING_COUNT = 112; // 28 bars × four quarter notes.

function heatColor(progress: number, boost = 1) {
  const color = progress < 0.6
    ? PALETTE.arc.clone().lerp(PALETTE.violet, progress / 0.6)
    : PALETTE.violet.clone().lerp(PALETTE.white, (progress - 0.6) / 0.4);
  return color.multiplyScalar((0.9 + progress * 1.25) * boost);
}

function frameQuaternion(curve: CatmullRomCurve3, u: number) {
  const frame = sampleRailFrame(curve, u);
  return new Quaternion().setFromUnitVectors(Z_AXIS, frame.tangent.clone().normalize());
}

export type MassDriverEnvironment = {
  update(dt: number, elapsed: number, runTime: number, running: boolean, camera: Camera, gunFired: boolean, detonated: boolean): void;
  flash(amount?: number): void;
  strobe(): void;
  dispose(): void;
};

export function createEnvironment(scene: Scene): MassDriverEnvironment {
  const root = new Group();
  root.name = 'mass-driver-detailed-environment';
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);
  scene.background = PALETTE.void.clone();
  scene.fog = new FogExp2(0x020716, 0.0062);
  const curve = createMassDriverRail();

  const ringGeometry = new TorusGeometry(10.85, 0.085, 5, 52);
  const rimGeometry = new TorusGeometry(10.86, 0.025, 4, 60);
  const rings = new InstancedMesh(ringGeometry, new MeshBasicMaterial({ color: 0xffffff }), BARREL_RING_COUNT);
  const rims = new InstancedMesh(rimGeometry, new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.82, blending: AdditiveBlending, depthWrite: false,
  }), BARREL_RING_COUNT);
  const ringBases: Color[] = [];
  const matrix = new Matrix4();
  for (let index = 0; index < BARREL_RING_COUNT; index += 1) {
    const time = (index + 1) * MASS_DRIVER_BEAT_SECONDS;
    const u = massDriverRunProgress(time, MASS_DRIVER_DURATION);
    const frame = sampleRailFrame(curve, u);
    const quaternion = frameQuaternion(curve, u);
    const downbeat = index % 4 === 3;
    matrix.compose(frame.position, quaternion, new Vector3(downbeat ? 1.025 : 1, downbeat ? 1.025 : 1, downbeat ? 1.12 : 1));
    rings.setMatrixAt(index, matrix);
    rims.setMatrixAt(index, matrix);
    const base = heatColor((index + 1) / BARREL_RING_COUNT, downbeat ? 1.08 : 0.92);
    ringBases.push(base);
    rings.setColorAt(index, base.clone().multiplyScalar(0.68));
    rims.setColorAt(index, base);
  }
  rings.instanceMatrix.needsUpdate = true;
  rims.instanceMatrix.needsUpdate = true;
  if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  if (rims.instanceColor) rims.instanceColor.needsUpdate = true;
  rings.frustumCulled = false;
  rims.frustumCulled = false;
  rings.raycast = () => {};
  rims.raycast = () => {};
  root.add(rings, rims);

  // Deeper downbeat collars and four diagonal coil-housing lugs.
  const downbeatCount = BARREL_RING_COUNT / 4;
  const collars = new InstancedMesh(new TorusGeometry(11.15, 0.18, 5, 40), material(PALETTE.steelEdge, 0.72), downbeatCount);
  const lugs = new InstancedMesh(new BoxGeometry(0.72, 1.25, 1.55), material(PALETTE.steel, 1.05), downbeatCount * 4);
  let lugIndex = 0;
  for (let bar = 0; bar < downbeatCount; bar += 1) {
    const ringIndex = bar * 4 + 3;
    const time = (ringIndex + 1) * MASS_DRIVER_BEAT_SECONDS;
    const frame = sampleRailFrame(curve, massDriverRunProgress(time, MASS_DRIVER_DURATION));
    const quaternion = frameQuaternion(curve, massDriverRunProgress(time, MASS_DRIVER_DURATION));
    matrix.compose(frame.position, quaternion, new Vector3(1, 1, 1));
    collars.setMatrixAt(bar, matrix);
    for (let diagonal = 0; diagonal < 4; diagonal += 1) {
      const angle = diagonal / 4 * Math.PI * 2 + Math.PI / 4;
      const position = frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * 11.25)
        .addScaledVector(frame.up, Math.sin(angle) * 11.25);
      const q = quaternion.clone().multiply(new Quaternion().setFromAxisAngle(Z_AXIS, angle));
      matrix.compose(position, q, new Vector3(1, 1, 1));
      lugs.setMatrixAt(lugIndex, matrix);
      lugIndex += 1;
    }
  }
  collars.instanceMatrix.needsUpdate = true;
  lugs.instanceMatrix.needsUpdate = true;
  collars.raycast = () => {};
  lugs.raycast = () => {};
  root.add(collars, lugs);

  const conductors = createConductorRails(curve);
  conductors.raycast = () => {};
  root.add(conductors);

  // Low-poly wall ribs sit just outside the combat radius. Their dark faces
  // are the bloom-zero contrast layer; a few service lights remain arc-blue.
  const panelCount = 6 * 58;
  const panels = new InstancedMesh(new BoxGeometry(3.8, 0.32, 7.5), material(PALETTE.steel, 0.8), panelCount);
  const service = new InstancedMesh(new BoxGeometry(0.08, 0.05, 1.25), material(PALETTE.arc, 0.62, true, 0.75), Math.ceil(panelCount / 13));
  let panelIndex = 0;
  let serviceIndex = 0;
  for (let row = 0; row < 58; row += 1) {
    const u = MASS_DRIVER_MUZZLE_U * ((row + 0.5) / 58);
    const frame = sampleRailFrame(curve, u);
    const baseQ = frameQuaternion(curve, u);
    for (let side = 0; side < 6; side += 1) {
      const angle = side / 6 * Math.PI * 2 + (row % 2) * 0.08;
      const position = frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * 12.35)
        .addScaledVector(frame.up, Math.sin(angle) * 12.35);
      const q = baseQ.clone().multiply(new Quaternion().setFromAxisAngle(Z_AXIS, angle));
      matrix.compose(position, q, new Vector3(1, 1, 1));
      panels.setMatrixAt(panelIndex, matrix);
      if (panelIndex % 13 === 0) {
        const lightPosition = position.clone().addScaledVector(frame.tangent, -1.8);
        matrix.compose(lightPosition, q, new Vector3(1, 1, 1));
        service.setMatrixAt(serviceIndex, matrix);
        serviceIndex += 1;
      }
      panelIndex += 1;
    }
  }
  panels.instanceMatrix.needsUpdate = true;
  service.instanceMatrix.needsUpdate = true;
  panels.raycast = () => {};
  service.raycast = () => {};
  root.add(panels, service);

  const muzzleFrame = sampleRailFrame(curve, MASS_DRIVER_MUZZLE_U);
  const muzzleQ = frameQuaternion(curve, MASS_DRIVER_MUZZLE_U);
  const chargeMaterial = material(PALETTE.violet, 1.0, true, 0);
  const chargeDisc = new Mesh(new CircleGeometry(4.8, 48), chargeMaterial);
  chargeDisc.position.copy(muzzleFrame.position).addScaledVector(muzzleFrame.tangent, 2.5);
  chargeDisc.quaternion.copy(muzzleQ);
  chargeDisc.raycast = () => {};
  root.add(chargeDisc);

  const muzzleCrown = new Group();
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    const petal = new Mesh(new BoxGeometry(1.0, 4.7, 10), material(index % 2 ? PALETTE.steel : PALETTE.steelEdge, 0.78));
    petal.position.copy(muzzleFrame.position)
      .addScaledVector(muzzleFrame.right, Math.cos(angle) * 13.5)
      .addScaledVector(muzzleFrame.up, Math.sin(angle) * 13.5)
      .addScaledVector(muzzleFrame.tangent, 1.5);
    petal.quaternion.copy(muzzleQ);
    petal.rotateZ(angle);
    petal.raycast = () => {};
    muzzleCrown.add(petal);
  }
  root.add(muzzleCrown);

  const stars = createStarfield(curve.getPointAt(1));
  stars.visible = false;
  root.add(stars);

  const streaks = createCameraStreaks();
  root.add(streaks);

  const beacon = new Mesh(new SphereGeometry(1.15, 12, 8), material(PALETTE.white, 2.8, true));
  beacon.position.copy(curve.getPointAt(1)).add(new Vector3(0, 5, -260));
  beacon.visible = false;
  beacon.raycast = () => {};
  root.add(beacon);

  let flashEnergy = 0;
  let strobeEnergy = 0;
  let lastRing = -1;
  let outcomeAge = 0;
  return {
    update(dt, elapsed, runTime, running, camera, gunFired, detonated) {
      const beatFloat = running ? runTime / MASS_DRIVER_BEAT_SECONDS : elapsed / MASS_DRIVER_BEAT_SECONDS * 0.25;
      const ringIndex = running ? Math.min(BARREL_RING_COUNT - 1, Math.floor(beatFloat) - 1) : -1;
      if (ringIndex !== lastRing) {
        if (lastRing >= 0) {
          rings.setColorAt(lastRing, ringBases[lastRing].clone().multiplyScalar(0.68));
          rims.setColorAt(lastRing, ringBases[lastRing]);
        }
        if (ringIndex >= 0) {
          const downbeat = ringIndex % 4 === 3;
          rings.setColorAt(ringIndex, ringBases[ringIndex].clone().multiplyScalar(downbeat ? 2.2 : 1.55));
          rims.setColorAt(ringIndex, PALETTE.white.clone().multiplyScalar(downbeat ? 2.8 : 2.1));
          if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
          if (rims.instanceColor) rims.instanceColor.needsUpdate = true;
        }
        lastRing = ringIndex;
      }
      const charge = running
        ? MathUtilsClamp((runTime - MASS_DRIVER_MARKERS.interlock) / (MASS_DRIVER_MARKERS.shot - MASS_DRIVER_MARKERS.interlock))
        : 0;
      chargeMaterial.opacity = 0.08 + charge * 0.42;
      chargeMaterial.color.copy(PALETTE.violet).lerp(PALETTE.white, charge * 0.78).multiplyScalar(1 + charge * 1.8);
      chargeDisc.scale.setScalar(0.45 + charge * 0.55 + Math.sin(elapsed * 5.4) * 0.025);

      const speed = running ? massDriverSpeedAt(runTime) : 0.2;
      streaks.position.copy(camera.position);
      streaks.quaternion.copy(camera.quaternion);
      streaks.position.z -= (elapsed * (8 + speed * 26)) % 18;
      (streaks.userData.material as LineBasicMaterial).opacity = Math.min(0.78, 0.06 + speed * 0.09 + charge * 0.18);
      streaks.scale.z = 0.55 + speed * 0.34;

      const postShot = running && runTime >= MASS_DRIVER_MARKERS.shot;
      stars.visible = postShot && gunFired;
      beacon.visible = postShot && gunFired;
      muzzleCrown.visible = !postShot;
      chargeDisc.visible = !postShot;
      rings.visible = !postShot;
      rims.visible = !postShot;
      collars.visible = !postShot;
      lugs.visible = !postShot;
      panels.visible = !postShot || detonated;
      conductors.visible = !postShot || detonated;
      service.visible = !postShot || detonated;

      if (postShot || detonated) outcomeAge += dt;
      else outcomeAge = 0;
      if (stars.visible) {
        stars.position.copy(camera.position).multiplyScalar(0.018);
        stars.scale.z = 1.5 + Math.min(4, outcomeAge * 3.2);
        beacon.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.15);
      }
      if (detonated) {
        root.rotation.z += dt * (1.4 + Math.min(8, outcomeAge * 4));
        panels.scale.setScalar(1 + Math.sin(elapsed * 37) * 0.025 + Math.min(0.14, outcomeAge * 0.1));
      } else {
        root.rotation.z *= Math.max(0, 1 - dt * 5);
        panels.scale.setScalar(1);
      }

      flashEnergy = Math.max(0, flashEnergy - dt * 2.4);
      strobeEnergy = Math.max(0, strobeEnergy - dt * 4.5);
      const base = postShot && gunFired ? PALETTE.void : PALETTE.void.clone().lerp(PALETTE.violet, charge * 0.09);
      const overload = Math.min(0.82, flashEnergy + strobeEnergy * (0.5 + 0.5 * Math.abs(Math.sin(elapsed * 45))));
      const flashColor = detonated ? PALETTE.red : PALETTE.white;
      (scene.background as Color).copy(base).lerp(flashColor, overload);
      if (scene.fog instanceof FogExp2) scene.fog.density = postShot && gunFired ? 0.00015 : 0.0062 - charge * 0.0014;
    },
    flash(amount = 0.5) {
      flashEnergy = Math.max(flashEnergy, amount);
    },
    strobe() {
      strobeEnergy = 1;
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
      scene.fog = null;
    },
  };
}

function MathUtilsClamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function createConductorRails(curve: CatmullRomCurve3) {
  const positions: number[] = [];
  const colors: number[] = [];
  const segments = 190;
  for (let rail = 0; rail < 4; rail += 1) {
    const angle = rail / 4 * Math.PI * 2 + Math.PI / 4;
    for (let index = 0; index < segments; index += 1) {
      for (const u of [index / segments * MASS_DRIVER_MUZZLE_U, (index + 1) / segments * MASS_DRIVER_MUZZLE_U]) {
        const frame = sampleRailFrame(curve, u);
        const point = frame.position.clone()
          .addScaledVector(frame.right, Math.cos(angle) * 11.55)
          .addScaledVector(frame.up, Math.sin(angle) * 11.55);
        positions.push(point.x, point.y, point.z);
        const heat = u / MASS_DRIVER_MUZZLE_U;
        const color = heatColor(heat, 0.7);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const line = new LineSegments(geometry, new LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.78, blending: AdditiveBlending, depthWrite: false,
  }));
  line.frustumCulled = false;
  return line;
}

function createStarfield(origin: Vector3) {
  const group = new Group();
  const count = 900;
  const points: number[] = [];
  const pointColors: number[] = [];
  const streakPositions: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const theta = index * 2.399963;
    const radius = 28 + (index * 83 % 320);
    const depth = 40 + (index * 47 % 900);
    const x = origin.x + Math.cos(theta) * radius;
    const y = origin.y + Math.sin(theta) * radius;
    const z = origin.z - depth;
    points.push(x, y, z);
    const color = index % 9 === 0 ? PALETTE.violet : index % 5 === 0 ? PALETTE.arc : PALETTE.white;
    const gain = index % 37 === 0 ? 2 : 0.72;
    pointColors.push(color.r * gain, color.g * gain, color.b * gain);
    streakPositions.push(x, y, z, x, y, z - 2 - index % 18);
  }
  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  pointGeometry.setAttribute('color', new Float32BufferAttribute(pointColors, 3));
  const stars = new Points(pointGeometry, new PointsMaterial({ size: 0.72, vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false }));
  const streakGeometry = new BufferGeometry();
  streakGeometry.setAttribute('position', new Float32BufferAttribute(streakPositions, 3));
  const streaks = new LineSegments(streakGeometry, new LineBasicMaterial({ color: PALETTE.arc, transparent: true, opacity: 0.36, blending: AdditiveBlending, depthWrite: false }));
  group.add(stars, streaks);
  group.traverse((child) => { child.raycast = () => {}; });
  return group;
}

function createCameraStreaks() {
  const positions: number[] = [];
  for (let index = 0; index < 150; index += 1) {
    const angle = index * 2.399963;
    const radius = 8.5 + index % 9 * 0.55;
    const z = -8 - index % 17;
    const length = 0.7 + index % 5 * 0.55;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    positions.push(x, y, z, x, y, z + length);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const streakMaterial = new LineBasicMaterial({ color: PALETTE.arc, transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false });
  const lines = new LineSegments(geometry, streakMaterial);
  lines.userData.material = streakMaterial;
  lines.frustumCulled = false;
  lines.raycast = () => {};
  return lines;
}
