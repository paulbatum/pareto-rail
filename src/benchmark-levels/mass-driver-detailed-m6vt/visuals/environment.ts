import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { additiveMaterialParameters, createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { createMassDriverRail } from '../gameplay';
import {
  BARREL_BEATS,
  MASS_DRIVER_RUN_DURATION,
  MASS_DRIVER_TIME,
  massDriverSpeedFactorAt,
  MUZZLE_U,
  ringU,
  SHOT_TIME,
} from '../timing';
import { ARC_BLUE, BACKGROUND, GUNMETAL, heatRamp, hdr, ION_WHITE, VOLT_VIOLET } from './palette';

// The environment is the gun: one accelerator ring per quarter-note beat down
// the bore, four conductor rails at the diagonals, dark rib panels on the
// barrel wall, camera-riding speed streaks, the growing charge at the muzzle,
// and — hidden by fog until the shot — the starfield and the beacon.

const BORE_RADIUS = 11.5;
const RIB_COUNT = 130;
const STREAK_COUNT = 170;

export type MassDriverEnvironment = {
  root: Group;
  update(options: {
    dt: number;
    camera: PerspectiveCamera;
    runTime: number;
    running: boolean;
    charge: number;
    elapsed: number;
  }): void;
  ringPosition(beat: number): Vector3;
  dispose(): void;
};

export function createEnvironmentInternal(scene: Scene): MassDriverEnvironment {
  scene.background = BACKGROUND.clone();
  scene.fog = new Fog(BACKGROUND.clone(), 30, 300);
  const root = new Group();
  const rng = mulberry32(20260718);
  const curve = createMassDriverRail();

  // --- Accelerator rings: one at every beat position. Downbeat rings are a
  // touch larger and deeper and carry four coil-housing lugs at the diagonals.
  const ringGeometry = new TorusGeometry(BORE_RADIUS, 0.16, 6, 44);
  const downbeatGeometry = new TorusGeometry(BORE_RADIUS + 0.4, 0.26, 6, 44);
  const lugGeometry = new TorusGeometry(0.55, 0.16, 6, 10);
  type RingRecord = { mesh: Mesh; material: MeshBasicMaterial; base: Color; beat: number; position: Vector3 };
  const ringRecords: RingRecord[] = [];
  const basis = new Vector3();
  for (let beat = 0; beat <= BARREL_BEATS; beat += 1) {
    const u = ringU(beat);
    const frame = sampleRailFrame(curve, u);
    const isDownbeat = beat % 4 === 0;
    const base = heatRamp(beat / BARREL_BEATS);
    const material = createAdditiveBasicMaterial({ color: base.clone() });
    const mesh = new Mesh(isDownbeat ? downbeatGeometry : ringGeometry, material);
    mesh.position.copy(frame.position);
    basis.copy(frame.position).add(frame.tangent);
    mesh.lookAt(basis);
    if (isDownbeat) {
      for (let lug = 0; lug < 4; lug += 1) {
        const angle = Math.PI / 4 + (lug * Math.PI) / 2;
        const housing = new Mesh(lugGeometry, material);
        housing.position.set(Math.cos(angle) * (BORE_RADIUS + 0.4), Math.sin(angle) * (BORE_RADIUS + 0.4), 0);
        mesh.add(housing);
      }
    }
    root.add(mesh);
    ringRecords.push({ mesh, material, base, beat, position: frame.position.clone() });
  }

  // --- Conductor rails: four thin bright tubes at the diagonals running the
  // whole barrel, gradient arc blue -> violet down the bore.
  const railPositions: number[] = [];
  const railColors: number[] = [];
  const RAIL_SEGMENTS = 220;
  for (let angleIndex = 0; angleIndex < 4; angleIndex += 1) {
    const angle = Math.PI / 4 + (angleIndex * Math.PI) / 2;
    let previous: Vector3 | null = null;
    for (let i = 0; i <= RAIL_SEGMENTS; i += 1) {
      const u = (i / RAIL_SEGMENTS) * MUZZLE_U;
      const frame = sampleRailFrame(curve, u);
      const point = frame.position
        .clone()
        .addScaledVector(frame.right, Math.cos(angle) * (BORE_RADIUS - 0.6))
        .addScaledVector(frame.up, Math.sin(angle) * (BORE_RADIUS - 0.6));
      if (previous) {
        const color = ARC_BLUE.clone().lerp(VOLT_VIOLET, i / RAIL_SEGMENTS).multiplyScalar(0.75);
        railPositions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
        for (let k = 0; k < 2; k += 1) railColors.push(color.r, color.g, color.b);
      }
      previous = point;
    }
  }
  const railGeometry = new BufferGeometry();
  railGeometry.setAttribute('position', new Float32BufferAttribute(railPositions, 3));
  railGeometry.setAttribute('color', new Float32BufferAttribute(railColors, 3));
  const railMaterial = new LineBasicMaterial(additiveMaterialParameters({ vertexColors: true }));
  const conductorRails = new LineSegments(railGeometry, railMaterial);
  conductorRails.frustumCulled = false;
  root.add(conductorRails);

  // --- Barrel wall: dark gunmetal rib panels scattered around the bore just
  // outside the drones' reach; a scattered few carry a dim arc-blue light.
  const ribGroup = new Group();
  const ribGeometry = new BufferGeometry();
  {
    const ribMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.4) });
    const lightMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.5) });
    for (let i = 0; i < RIB_COUNT; i += 1) {
      const u = (rng() * 0.98) * MUZZLE_U;
      const angle = rng() * Math.PI * 2;
      const frame = sampleRailFrame(curve, u);
      const width = 2.2 + rng() * 3.4;
      const depth = 4 + rng() * 9;
      const panel = new Mesh(new BoxGeometry(width, 0.8 + rng() * 1.2, depth), ribMaterial);
      panel.position
        .copy(frame.position)
        .addScaledVector(frame.right, Math.cos(angle) * (BORE_RADIUS + 5))
        .addScaledVector(frame.up, Math.sin(angle) * (BORE_RADIUS + 5));
      panel.lookAt(frame.position);
      ribGroup.add(panel);
      if (rng() < 0.22) {
        const light = new Mesh(new SphereGeometry(0.16, 6, 6), lightMaterial);
        light.position.copy(panel.position).multiplyScalar(0.985).addScaledVector(frame.position, 0.015);
        ribGroup.add(light);
      }
    }
  }
  root.add(ribGroup);
  void ribGeometry;

  // --- Camera-riding speed streaks: a shell of thin line streaks scrolled
  // faster the faster the gun runs. Rendered as LineSegments in a group that
  // follows the camera.
  const streakGroup = new Group();
  const streakLocal: Array<{ x: number; y: number; z: number; length: number }> = [];
  const streakPositions = new Float32Array(STREAK_COUNT * 6);
  for (let i = 0; i < STREAK_COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * 7;
    streakLocal.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: -40 + rng() * 80,
      length: 2 + rng() * 4,
    });
  }
  const streakGeometry = new BufferGeometry();
  streakGeometry.setAttribute('position', new Float32BufferAttribute(streakPositions, 3));
  const streakMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 0.25), transparent: true, opacity: 1 }));
  const streaks = new LineSegments(streakGeometry, streakMaterial);
  streaks.frustumCulled = false;
  streakGroup.add(streaks);
  root.add(streakGroup);

  // --- Charge glow: a growing, brightening disc parked at the muzzle through
  // the interlock bars — the visible firing charge.
  const muzzleFrame = sampleRailFrame(curve, MUZZLE_U);
  const chargeMaterial = createAdditiveBasicMaterial({ color: new Color(0, 0, 0) });
  const chargeDisc = new Mesh(new SphereGeometry(1, 18, 14), chargeMaterial);
  chargeDisc.position.copy(muzzleFrame.position).addScaledVector(muzzleFrame.tangent, 24);
  root.add(chargeDisc);

  // --- Muzzle field: a deep starfield with arc-blue and violet stars, star
  // streaks, and one distant pulsing ion-white beacon dead ahead.
  const starGroup = new Group();
  {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const origin = muzzleFrame.position.clone();
    for (let i = 0; i < count; i += 1) {
      const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const distance = 180 + rng() * 1400;
      const point = origin.clone().addScaledVector(muzzleFrame.tangent, distance * 0.7).addScaledVector(direction, distance * 0.7);
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
      const roll = rng();
      const base = roll < 0.55 ? ARC_BLUE : roll < 0.85 ? VOLT_VIOLET : ION_WHITE;
      const intensity = rng() < 0.05 ? 1.8 : 0.15 + rng() * 0.35;
      colors[i * 3] = base.r * intensity;
      colors[i * 3 + 1] = base.g * intensity;
      colors[i * 3 + 2] = base.b * intensity;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const material = new PointsMaterial(additiveMaterialParameters({ size: 1.4, vertexColors: true, sizeAttenuation: true }));
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    starGroup.add(points);
  }
  const beaconMaterial = createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 2.2) });
  const beacon = new Mesh(new SphereGeometry(6, 12, 10), beaconMaterial);
  beacon.position.copy(muzzleFrame.position).addScaledVector(muzzleFrame.tangent, 1500);
  starGroup.add(beacon);
  starGroup.visible = false;
  root.add(starGroup);

  scene.add(root);

  // ---- per-frame drive ------------------------------------------------------

  const fog = scene.fog as Fog;
  const scratch = new Vector3();

  function update({ dt, camera, runTime, running, charge, elapsed }: {
    dt: number;
    camera: PerspectiveCamera;
    runTime: number;
    running: boolean;
    charge: number;
    elapsed: number;
  }) {
    const beatFloat = running ? runTime / MASS_DRIVER_TIME.beatSeconds : 0;
    const shotDone = running && runTime >= SHOT_TIME;

    // Rings: flash the just-passed ring, pre-glow the next; through the
    // interlock bars the rings ahead lean toward white with the charge. In
    // attract mode they idle-shimmer.
    for (const record of ringRecords) {
      const distanceBeats = record.beat - beatFloat;
      let intensity: number;
      if (!running) {
        intensity = 0.35 + 0.25 * Math.sin(elapsed * 1.4 + record.beat * 0.7);
      } else if (distanceBeats < -6 || distanceBeats > 26) {
        intensity = 0.4;
      } else if (distanceBeats <= 0) {
        // Just passed: hot flash decaying over a beat and a half.
        intensity = 0.4 + 2.6 * Math.max(0, 1 + distanceBeats / 1.5);
      } else {
        // Ahead: pre-glow the next ring on the approach.
        intensity = 0.4 + Math.max(0, 1 - distanceBeats) * 1.1;
      }
      const chargeLean = running ? charge * 0.85 : 0;
      scratch.set(record.base.r, record.base.g, record.base.b);
      record.material.color
        .copy(record.base)
        .lerp(ION_WHITE, MathUtils.clamp(chargeLean, 0, 1) * 0.8)
        .multiplyScalar(intensity);
      record.mesh.visible = !shotDone || record.beat >= BARREL_BEATS - 1;
    }
    if (shotDone) {
      conductorRails.visible = false;
      ribGroup.visible = false;
    } else {
      conductorRails.visible = true;
      ribGroup.visible = true;
    }

    // Speed streaks ride the camera and scroll with speed; dim at idle,
    // brightening with speed and charge, blazing past the muzzle.
    streakGroup.position.copy(camera.position);
    streakGroup.quaternion.copy(camera.quaternion);
    const factor = running ? massDriverSpeedFactorAt(runTime) : 0.3;
    const scroll = factor * 55 * dt;
    const attribute = streakGeometry.getAttribute('position') as Float32BufferAttribute;
    for (let i = 0; i < STREAK_COUNT; i += 1) {
      const streak = streakLocal[i];
      streak.z += scroll;
      if (streak.z > 40) streak.z -= 80;
      const stretch = streak.length * (0.4 + factor * 0.9);
      const base = i * 6;
      attribute.array[base] = streak.x;
      attribute.array[base + 1] = streak.y;
      attribute.array[base + 2] = streak.z;
      attribute.array[base + 3] = streak.x;
      attribute.array[base + 4] = streak.y;
      attribute.array[base + 5] = streak.z - stretch;
    }
    attribute.needsUpdate = true;
    streakMaterial.color.copy(ARC_BLUE).lerp(ION_WHITE, charge * 0.5).multiplyScalar(0.1 + factor * 0.14 + charge * 0.3);

    // The charge glow grows through the interlock bars; its apparent size is
    // capped so the last interlocks stay legible against it.
    if (charge > 0.001 && !shotDone) {
      chargeDisc.visible = true;
      chargeDisc.scale.setScalar(1 + charge * 9);
      chargeMaterial.color.copy(VOLT_VIOLET).lerp(ION_WHITE, charge * 0.8).multiplyScalar(charge * 1.9);
    } else {
      chargeDisc.visible = false;
    }

    // Atmosphere: blue-black at the breech, warming toward violet by the
    // interlocks, whitening at the charge peak, then a hard cut to
    // near-vacuum black past the muzzle.
    if (shotDone) {
      starGroup.visible = true;
      fog.near = 200;
      fog.far = 4000;
      fog.color.set(0.002, 0.002, 0.005);
      (scene.background as Color).set(0.002, 0.002, 0.005);
    } else {
      starGroup.visible = false;
      fog.near = 30;
      fog.far = 300;
      const warm = running ? MathUtils.clamp((runTime - 20) / 30, 0, 1) : 0;
      fog.color.copy(BACKGROUND).lerp(VOLT_VIOLET.clone().multiplyScalar(0.06), warm).lerp(ION_WHITE.clone().multiplyScalar(0.12), charge * 0.6);
      (scene.background as Color).copy(fog.color);
    }

    // The beacon dead ahead pulses — the thing you were launched toward.
    if (starGroup.visible) {
      beaconMaterial.color.copy(ION_WHITE).multiplyScalar(1.6 + Math.sin(elapsed * 3.2) * 0.9);
    }
  }

  return {
    root,
    update,
    ringPosition(beat: number) {
      const index = MathUtils.clamp(Math.round(beat), 0, ringRecords.length - 1);
      return ringRecords[index].position;
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
}

void MASS_DRIVER_RUN_DURATION;
