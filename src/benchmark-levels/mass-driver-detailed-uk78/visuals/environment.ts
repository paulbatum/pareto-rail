import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  BORE_RADIUS,
  MUZZLE_U,
  createMassDriverRail,
  massDriverRunProgress,
  massDriverSpeedAt,
} from '../gameplay';
import { MASS_DRIVER_DURATION, MASS_DRIVER_TIME, SHOT_TIME } from '../timing';
import { ARC_BLUE, BORE_BLACK, GUNMETAL, GUNMETAL_LIGHT, ION_WHITE, VOID, VOLT_VIOLET, heatColor, hot, mulberry32 } from './palette';

type AcceleratorRing = {
  group: Group;
  rim: MeshBasicMaterial;
  body: MeshBasicMaterial;
  time: number;
  downbeat: boolean;
  base: Color;
};

export type MassDriverEnvironment = {
  root: Group;
  rings: AcceleratorRing[];
  update(dt: number, frame: EnvironmentFrame): void;
};

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  runTime: number;
  elapsed: number;
  running: boolean;
  beatEnergy: number;
  charge: number;
};

const Z_AXIS = new Vector3(0, 0, 1);

export function createMassDriverEnvironment(scene: Scene): MassDriverEnvironment {
  scene.background = VOID.clone();
  scene.fog = new FogExp2(BORE_BLACK.clone(), 0.0068);
  const root = new Group();
  root.name = 'mass-driver-environment';
  root.userData.raildIgnoreOcclusion = true;
  const curve = createMassDriverRail();
  const rng = mulberry32(7828128);

  const bore = new Group();
  bore.name = 'accelerator-bore';
  const rings: AcceleratorRing[] = [];
  const totalBeats = 28 * 4;
  for (let beatIndex = 0; beatIndex < totalBeats; beatIndex += 1) {
    const time = beatIndex * MASS_DRIVER_TIME.beatSeconds;
    const u = massDriverRunProgress(time, MASS_DRIVER_DURATION);
    const frame = sampleRailFrame(curve, u);
    const downbeat = beatIndex % 4 === 0;
    const heat = heatColor(beatIndex / Math.max(1, totalBeats - 1));
    const group = new Group();
    group.position.copy(frame.position);
    group.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent);
    const radius = BORE_RADIUS + (downbeat ? 0.18 : 0);
    const bodyMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().lerp(heat, 0.08) });
    const body = new Mesh(new TorusGeometry(radius, downbeat ? 0.18 : 0.12, 5, 48), bodyMaterial);
    const rimMaterial = createAdditiveBasicMaterial({ color: hot(heat, 0.85), opacity: 0.34 });
    const rim = new Mesh(new TorusGeometry(radius, downbeat ? 0.065 : 0.045, 4, 64), rimMaterial);
    group.add(body, rim);
    if (downbeat) {
      for (let lugIndex = 0; lugIndex < 4; lugIndex += 1) {
        const angle = Math.PI / 4 + lugIndex * Math.PI / 2;
        const lug = new Mesh(new BoxGeometry(0.85, 1.05, 0.7), new MeshBasicMaterial({ color: GUNMETAL_LIGHT }));
        lug.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, -0.08);
        lug.rotation.z = angle;
        group.add(lug);
      }
    }
    bore.add(group);
    rings.push({ group, rim: rimMaterial, body: bodyMaterial, time, downbeat, base: heat });
  }

  // The four diagonal conductors are continuous, but split into heat-ramp
  // thirds so their gradient remains visible without textures or shaders.
  for (let railIndex = 0; railIndex < 4; railIndex += 1) {
    const angle = Math.PI / 4 + railIndex * Math.PI / 2;
    for (let segment = 0; segment < 3; segment += 1) {
      const from = MUZZLE_U * segment / 3;
      const to = MUZZLE_U * (segment + 1) / 3;
      const points: Vector3[] = [];
      for (let i = 0; i <= 28; i += 1) {
        const u = from + (to - from) * i / 28;
        const frame = sampleRailFrame(curve, u);
        points.push(frame.position.clone()
          .addScaledVector(frame.right, Math.cos(angle) * 10.45)
          .addScaledVector(frame.up, Math.sin(angle) * 10.45));
      }
      const railCurve = new (curve.constructor as typeof import('three').CatmullRomCurve3)(points, false, 'catmullrom', 0.3);
      const geometry = new TubeGeometry(railCurve, 96, 0.075, 5, false);
      const material = createAdditiveBasicMaterial({ color: hot(heatColor((segment + 0.4) / 3), 1.2), opacity: 0.88 });
      bore.add(new Mesh(geometry, material));
    }
  }

  // Rib panels sit just beyond target reach. The gaps reveal the near-black
  // void and keep the bore from becoming a solid bright tube.
  const panelGeometry = new BoxGeometry(4.4, 2.7, 0.34);
  const lightGeometry = new BoxGeometry(0.6, 0.08, 0.08);
  for (let index = 0; index < 156; index += 1) {
    const u = MUZZLE_U * (0.008 + rng() * 0.986);
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const group = new Group();
    group.position.copy(frame.position);
    group.quaternion.setFromUnitVectors(Z_AXIS, frame.tangent);
    const panel = new Mesh(panelGeometry, new MeshBasicMaterial({ color: rng() > 0.62 ? GUNMETAL_LIGHT : GUNMETAL }));
    panel.position.set(Math.cos(angle) * (BORE_RADIUS + 1.25), Math.sin(angle) * (BORE_RADIUS + 1.25), 0);
    panel.rotation.z = angle + Math.PI / 2;
    group.add(panel);
    if (index % 13 === 0) {
      const light = new Mesh(lightGeometry, createAdditiveBasicMaterial({ color: hot(ARC_BLUE, 0.85), opacity: 0.72 }));
      light.position.copy(panel.position).multiplyScalar(0.992);
      light.position.z = -0.25;
      light.rotation.copy(panel.rotation);
      group.add(light);
    }
    bore.add(group);
  }
  root.add(bore);

  // The firing charge is physically parked at the muzzle. Its radius is
  // capped below the interlock ring so it never masks the boss silhouettes.
  const muzzleFrame = sampleRailFrame(curve, MUZZLE_U);
  const charge = new Group();
  charge.name = 'muzzle-charge';
  charge.position.copy(muzzleFrame.position).addScaledVector(muzzleFrame.tangent, 1.5);
  charge.quaternion.setFromUnitVectors(Z_AXIS, muzzleFrame.tangent.clone().negate());
  const chargeCoreMaterial = createAdditiveBasicMaterial({ color: hot(ION_WHITE, 1.15), opacity: 0 });
  const chargeHaloMaterial = createAdditiveBasicMaterial({ color: hot(VOLT_VIOLET, 0.85), opacity: 0 });
  const chargeCore = new Mesh(new CircleGeometry(4.8, 48), chargeCoreMaterial);
  const chargeHalo = new Mesh(new RingGeometry(4.4, 7.6, 64), chargeHaloMaterial);
  charge.add(chargeCore, chargeHalo);
  root.add(charge);

  // Deep field is present from frame one but swallowed by barrel fog until
  // the hard shot cut. A beacon dead ahead marks the payload's destination.
  const starCount = 720;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  for (let index = 0; index < starCount; index += 1) {
    const radius = 130 + rng() * 420;
    const angle = rng() * Math.PI * 2;
    const ahead = 220 + rng() * 1000;
    const position = muzzleFrame.position.clone()
      .addScaledVector(muzzleFrame.tangent, ahead)
      .addScaledVector(muzzleFrame.right, Math.cos(angle) * radius)
      .addScaledVector(muzzleFrame.up, Math.sin(angle) * radius);
    starPositions[index * 3] = position.x;
    starPositions[index * 3 + 1] = position.y;
    starPositions[index * 3 + 2] = position.z;
    const tint = rng() > 0.48 ? ARC_BLUE : VOLT_VIOLET;
    const level = 0.4 + rng() * 1.2;
    starColors[index * 3] = tint.r * level;
    starColors[index * 3 + 1] = tint.g * level;
    starColors[index * 3 + 2] = tint.b * level;
  }
  const starsGeometry = new BufferGeometry();
  starsGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  starsGeometry.setAttribute('color', new Float32BufferAttribute(starColors, 3));
  const starsMaterial = new PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: true });
  const stars = new Points(starsGeometry, starsMaterial);
  root.add(stars);

  const beacon = new Group();
  beacon.position.copy(muzzleFrame.position).addScaledVector(muzzleFrame.tangent, 1320);
  beacon.quaternion.setFromUnitVectors(Z_AXIS, muzzleFrame.tangent.clone().negate());
  const beaconCoreMaterial = createAdditiveBasicMaterial({ color: hot(ION_WHITE, 2.4), opacity: 0 });
  const beaconHaloMaterial = createAdditiveBasicMaterial({ color: hot(ARC_BLUE, 1.1), opacity: 0 });
  beacon.add(
    new Mesh(new CircleGeometry(2.2, 24), beaconCoreMaterial),
    new Mesh(new RingGeometry(3.4, 6.5, 40), beaconHaloMaterial),
  );
  root.add(beacon);

  // Camera-riding speed streak shell. One instanced draw keeps it dense and
  // cheap enough to blaze during the post-shot surge.
  const streakCount = 112;
  const streakGeometry = new BoxGeometry(0.026, 0.026, 4.6);
  const streakMaterial = createAdditiveBasicMaterial({ color: hot(ARC_BLUE, 1.05), opacity: 0.5 });
  const streaks = new InstancedMesh(streakGeometry, streakMaterial, streakCount);
  streaks.frustumCulled = false;
  const streakData = Array.from({ length: streakCount }, () => ({
    angle: rng() * Math.PI * 2,
    radius: 5.2 + rng() * 8.8,
    z: -6 - rng() * 88,
    speed: 0.75 + rng() * 0.7,
  }));
  const matrix = new Matrix4();
  root.add(streaks);
  scene.add(root);

  return {
    root,
    rings,
    update(dt, state) {
      const runTime = state.running ? state.runTime : 0;
      const speed = state.running ? massDriverSpeedAt(runTime) : 0.25;
      const shot = state.running && runTime >= SHOT_TIME;
      const fog = scene.fog as FogExp2;
      const chargeProgress = state.running ? MathUtilsClamp((runTime - MASS_DRIVER_TIME.bar(20)) / MASS_DRIVER_TIME.bar(8)) : 0;
      const atmosphere = MathUtilsClamp((runTime - MASS_DRIVER_TIME.bar(12)) / MASS_DRIVER_TIME.bar(16));
      fog.color.copy(BORE_BLACK).lerp(VOLT_VIOLET, atmosphere * 0.095);
      fog.density = shot ? 0.000035 : 0.0068 - atmosphere * 0.0025;
      (scene.background as Color).copy(shot ? VOID : BORE_BLACK.clone().lerp(VOLT_VIOLET, atmosphere * 0.035));

      for (const ring of rings) {
        const delta = runTime - ring.time;
        const crossing = state.running ? Math.exp(-Math.abs(delta) * 13) : 0.1 + Math.sin(state.elapsed * 1.7 + ring.time) * 0.04;
        const preglow = state.running && delta < 0 ? Math.exp(delta * 5.5) * 0.32 : 0;
        const energy = 0.3 + crossing * (ring.downbeat ? 2.5 : 1.65) + preglow + state.beatEnergy * 0.08;
        ring.rim.color.copy(ring.base).multiplyScalar(energy);
        ring.rim.opacity = Math.min(0.92, 0.22 + energy * 0.22);
        ring.body.color.copy(GUNMETAL).lerp(ring.base, 0.04 + crossing * 0.15);
        ring.group.visible = !shot || ring.time > SHOT_TIME;
      }

      charge.visible = !shot && chargeProgress > 0.001;
      const heldCharge = Math.min(1, chargeProgress * 0.82 + state.charge * 0.18);
      chargeCoreMaterial.opacity = heldCharge * 0.23;
      chargeHaloMaterial.opacity = heldCharge * 0.24;
      charge.scale.setScalar(0.62 + heldCharge * 0.38);
      charge.rotation.z += dt * (0.2 + heldCharge * 1.4);

      starsMaterial.opacity += ((shot ? 0.92 : 0) - starsMaterial.opacity) * Math.min(1, dt * 9);
      const beaconPulse = shot ? 0.72 + Math.sin(state.elapsed * 3.2) * 0.25 : 0;
      beaconCoreMaterial.opacity = beaconPulse;
      beaconHaloMaterial.opacity = beaconPulse * 0.32;
      beacon.rotation.z += dt * 0.24;

      streaks.position.copy(state.camera.position);
      streaks.quaternion.copy(state.camera.quaternion);
      const streakTravel = dt * (18 + speed * 34);
      for (let index = 0; index < streakCount; index += 1) {
        const item = streakData[index];
        item.z += streakTravel * item.speed;
        if (item.z > 4) item.z -= 98;
        const lengthScale = 0.55 + speed * 0.2;
        matrix.makeScale(1, 1, lengthScale);
        matrix.setPosition(Math.cos(item.angle) * item.radius, Math.sin(item.angle) * item.radius, item.z);
        streaks.setMatrixAt(index, matrix);
      }
      streaks.instanceMatrix.needsUpdate = true;
      streakMaterial.color.copy(shot ? ION_WHITE : heatColor(Math.min(1, runTime / SHOT_TIME))).multiplyScalar(0.55 + speed * 0.16);
      streakMaterial.opacity = Math.min(0.92, 0.18 + speed * 0.095 + chargeProgress * 0.16);
    },
  };
}

function MathUtilsClamp(value: number) {
  return Math.min(1, Math.max(0, value));
}
