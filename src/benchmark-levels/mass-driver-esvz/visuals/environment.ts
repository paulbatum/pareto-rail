import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAtmosphereRamp, scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createMassDriverRail, FIRE_TIME, mdRunProgress, RING_COUNT, ringU, TUNNEL_RADIUS } from '../gameplay';
import { ARC_BLUE, ARC_WHITE, COIL_DARK, GUNMETAL, hdr, PLANET_BLUE, ringHeatColor, SPACE_BLACK } from './palette';

// The barrel: one accelerator ring per beat, positioned at the exact rail
// point the camera reaches on that beat — spacing widens as the payload
// accelerates while the crossing cadence stays locked to the pulse. The
// lattice is open: bus bars link the rings and stars show through the gaps.

export type Environment = {
  root: Group;
  update(cameraU: number, runTime: number, dt: number, drive: { beatEnergy: number; charge: number; running: boolean }): void;
  pulse(beatIndex: number, strength: number): void;
  /** World position on ring `k` at wall angle `angle` — arc endpoints. */
  ringPoint(beatIndex: number, angle: number, radiusScale?: number): Vector3;
  muzzlePosition: Vector3;
};

const RING_RADIUS = TUNNEL_RADIUS;
const GLOW_RADIUS = TUNNEL_RADIUS - 0.55;
const STRUT_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  const rail = createMassDriverRail();
  const rng = mulberry32(0x51ac);

  scene.background = SPACE_BLACK.clone();
  scene.fog = new FogExp2(0x030512, 0.0075);
  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: 0x01020a, fog: 0x030512, density: 0.0082 },
    { progress: 0.62, background: 0x020310, fog: 0x050418, density: 0.0068 },
    { progress: 0.8, background: 0x030414, fog: 0x070722, density: 0.0058 },
    { progress: 0.86, background: 0x010208, fog: 0x020310, density: 0.0012 },
    { progress: 1, background: 0x000104, fog: 0x000208, density: 0.0003 },
  ]);

  // ---- ring lattice ------------------------------------------------------------
  const frames = Array.from({ length: RING_COUNT }, (_ignored, k) => sampleRailFrame(rail, ringU(k)));
  const basis = new Matrix4();
  const compose = new Matrix4();
  const dummyScale = new Vector3(1, 1, 1);

  const structure = new InstancedMesh(
    new TorusGeometry(RING_RADIUS, 0.34, 6, 10),
    new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.2) }),
    RING_COUNT,
  );
  const glow = new InstancedMesh(
    new TorusGeometry(GLOW_RADIUS, 0.1, 4, 32),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    RING_COUNT,
  );
  glow.frustumCulled = false;
  for (let k = 0; k < RING_COUNT; k += 1) {
    const frame = frames[k];
    basis.makeBasis(frame.right, frame.up, frame.tangent);
    compose.copy(basis).setPosition(frame.position);
    // The muzzle collar is the last, heaviest ring.
    const scale = k === RING_COUNT - 1 ? 1.45 : 1;
    compose.scale(dummyScale.set(scale, scale, scale));
    structure.setMatrixAt(k, compose);
    glow.setMatrixAt(k, compose);
    glow.setColorAt(k, ringHeatColor(k / (RING_COUNT - 1)).multiplyScalar(0.4));
  }
  structure.instanceMatrix.needsUpdate = true;
  glow.instanceMatrix.needsUpdate = true;
  root.add(structure, glow);

  // ---- bus bars: struts linking consecutive rings at four wall angles ---------
  const strutCount = (RING_COUNT - 1) * STRUT_ANGLES.length;
  const struts = new InstancedMesh(
    new BoxGeometry(0.22, 0.22, 1),
    new MeshBasicMaterial({ color: COIL_DARK.clone().multiplyScalar(1.5) }),
    strutCount,
  );
  const helper = new Object3D();
  let strutIndex = 0;
  for (let k = 0; k < RING_COUNT - 1; k += 1) {
    for (const angle of STRUT_ANGLES) {
      const from = wallPoint(frames[k], angle, RING_RADIUS);
      const to = wallPoint(frames[k + 1], angle, RING_RADIUS);
      helper.position.copy(from).add(to).multiplyScalar(0.5);
      helper.lookAt(to);
      helper.scale.set(1, 1, from.distanceTo(to));
      helper.updateMatrix();
      struts.setMatrixAt(strutIndex, helper.matrix);
      strutIndex += 1;
    }
  }
  struts.instanceMatrix.needsUpdate = true;
  root.add(struts);

  // ---- muzzle brake ------------------------------------------------------------
  const muzzleFrame = frames[RING_COUNT - 1];
  const muzzle = new Group();
  const brake = new Mesh(
    new TorusGeometry(RING_RADIUS * 1.75, 0.6, 6, 12),
    new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.5) }),
  );
  const brakeGlow = new Mesh(
    new TorusGeometry(RING_RADIUS * 1.45, 0.14, 4, 40),
    createAdditiveBasicMaterial({ color: hdr(ARC_WHITE, 0.7) }),
  );
  muzzle.add(brake, brakeGlow);
  basis.makeBasis(muzzleFrame.right, muzzleFrame.up, muzzleFrame.tangent);
  muzzle.quaternion.setFromRotationMatrix(basis);
  muzzle.position.copy(muzzleFrame.position).addScaledVector(muzzleFrame.tangent, -6);
  root.add(muzzle);

  // ---- open space: starfield and the planet below -------------------------------
  const starCount = 760;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    const radius = 2200 + rng() * 700;
    starPositions[i * 3] = direction.x * radius;
    starPositions[i * 3 + 1] = direction.y * radius;
    starPositions[i * 3 + 2] = direction.z * radius - 900;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new BufferAttribute(starPositions, 3));
  const starMaterial = new PointsMaterial({
    color: 0xdfe8ff,
    size: 3.2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const stars = new Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  root.add(stars);

  const planet = new Mesh(
    new SphereGeometry(1900, 28, 20),
    new MeshBasicMaterial({ color: PLANET_BLUE.clone(), fog: false }),
  );
  planet.position.set(350, -2750, -2100);
  const planetRim = new Mesh(
    new SphereGeometry(1930, 28, 20),
    createAdditiveBasicMaterial({ color: ARC_BLUE.clone().multiplyScalar(0.06), side: BackSide }),
  );
  (planetRim.material as MeshBasicMaterial).fog = false;
  planetRim.position.copy(planet.position);
  root.add(planet, planetRim);

  // ---- dust motes whipping past for speed ---------------------------------------
  const moteGeometry = new BoxGeometry(0.05, 0.05, 1.6);
  const moteMaterial = createAdditiveBasicMaterial({ color: ARC_BLUE.clone().multiplyScalar(0.5) });
  const motes: ScatterField = scatterAlongRail(rail, {
    count: 90,
    seed: 0xd117,
    window: { behind: 14, ahead: 150 },
    place: (_index, random) => {
      const angle = random() * Math.PI * 2;
      const radius = 2 + random() * (TUNNEL_RADIUS - 2.4);
      return {
        u: random(),
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
      };
    },
    make: () => new Mesh(moteGeometry, moteMaterial),
  });
  root.add(motes.group);

  scene.add(root);

  // ---- per-frame drive -----------------------------------------------------------
  const pulses = new Float32Array(RING_COUNT);
  const scratch = new Color();
  let windowStart = 0;
  let windowEnd = 0;

  function update(cameraU: number, runTime: number, dt: number, drive: { beatEnergy: number; charge: number; running: boolean }) {
    atmosphere(cameraU);
    motes.update(cameraU, dt);

    for (let k = 0; k < RING_COUNT; k += 1) pulses[k] = Math.max(0, pulses[k] - dt * 5);

    // Recolor a window of rings around the camera; distant rings keep their
    // static ramp tint. The camera's beat position tracks runTime directly.
    const camBeat = drive.running ? runTime / (FIRE_TIME / (RING_COUNT - 1)) : 0;
    const start = Math.max(0, Math.floor(camBeat) - 6);
    const end = Math.min(RING_COUNT - 1, Math.floor(camBeat) + 60);
    // Restore rings that left the previous window.
    for (let k = windowStart; k <= windowEnd; k += 1) {
      if (k < start || k > end) glow.setColorAt(k, ringHeatColor(k / (RING_COUNT - 1)).multiplyScalar(0.4));
    }
    windowStart = start;
    windowEnd = end;
    for (let k = start; k <= end; k += 1) {
      const heat = ringHeatColor(Math.min(1, k / (RING_COUNT - 1) + drive.charge * 0.25));
      const proximity = Math.max(0, 1 - Math.abs(k - camBeat) / 14);
      const level = 0.42 + drive.charge * 0.5 + proximity * (0.55 + drive.beatEnergy * 0.5) + pulses[k] * 1.6;
      scratch.copy(heat).multiplyScalar(level);
      glow.setColorAt(k, scratch);
    }
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;

    (brakeGlow.material as MeshBasicMaterial).color
      .copy(ARC_WHITE)
      .multiplyScalar(0.5 + drive.charge * 1.3 + drive.beatEnergy * drive.charge * 0.6);
  }

  return {
    root,
    update,
    pulse(beatIndex, strength) {
      if (beatIndex >= 0 && beatIndex < RING_COUNT) pulses[beatIndex] = Math.max(pulses[beatIndex], strength);
    },
    ringPoint(beatIndex, angle, radiusScale = 1) {
      const frame = frames[Math.max(0, Math.min(RING_COUNT - 1, beatIndex))];
      return wallPoint(frame, angle, GLOW_RADIUS * radiusScale);
    },
    muzzlePosition: muzzleFrame.position.clone(),
  };
}

function wallPoint(frame: { position: Vector3; right: Vector3; up: Vector3 }, angle: number, radius: number) {
  return frame.position
    .clone()
    .addScaledVector(frame.right, Math.cos(angle) * radius)
    .addScaledVector(frame.up, Math.sin(angle) * radius);
}

export { mdRunProgress };
