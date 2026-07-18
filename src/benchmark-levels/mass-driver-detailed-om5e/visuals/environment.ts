import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  Fog,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { createAtmosphereRamp } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { BORE_RADIUS, MUZZLE_U, createMassDriverRail, railU } from '../gameplay';
import { BEAT_SECONDS, MASS_DRIVER_MARKERS, RING_COUNT, SHOT_TIME } from '../timing';
import { ARC_BLUE, GUNMETAL, ION_WHITE, IGNITION, VOLT_VIOLET, heat, hdr } from './palette';

// The barrel is built once, statically, from the same curve the camera rides —
// so every ring, rail, and wall panel is placed by rail parameter rather than by
// world coordinates, and the geometry stops exactly where the run's muzzle is.

const RING_TUBE = 0.3;
const DOWNBEAT_TUBE = 0.46;
const LUG_COUNT = 4;
const WALL_PANELS = 320;
const STREAK_COUNT = 300;
const STREAK_INNER = 3.4;
const STREAK_OUTER = 17;
const STREAK_DEPTH = 110;
const STAR_COUNT = 1400;
const STAR_STREAKS = 90;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchPosition = new Vector3();

export type MassDriverEnvironment = {
  root: Group;
  /** Per-frame: rings, rails, streaks, charge glow, atmosphere. */
  update(context: {
    dt: number;
    camera: PerspectiveCamera;
    runTime: number;
    runProgress: number;
    running: boolean;
    /** 0 → 1 across the interlock bars; the visible firing charge. */
    charge: number;
    /** 0 → 1 white strobe sweep, fired by the sixth interlock kill. */
    strobe: number;
    fired: boolean;
    beatEnergy: number;
  }): void;
  dispose(): void;
};

export function createMassDriverEnvironment(scene: Scene): MassDriverEnvironment {
  const curve = createMassDriverRail();
  const root = new Group();
  scene.add(root);

  scene.fog = new Fog(0x030616, 34, 152);
  const atmosphere = createAtmosphereRamp(scene, [
    // Blue-black void at the breech...
    { progress: 0, background: 0x01030a, fog: 0x030616, near: 30, far: 150 },
    { progress: railU(MASS_DRIVER_MARKERS.stage2), background: 0x05041a, fog: 0x0a0824, near: 28, far: 158 },
    // ...warming toward violet by the interlocks...
    { progress: railU(MASS_DRIVER_MARKERS.interlock), background: 0x10062c, fog: 0x1a0c3c, near: 24, far: 150 },
    // ...whitening as the charge peaks...
    { progress: MUZZLE_U - 0.004, background: 0x2c1c56, fog: 0x3d2a70, near: 18, far: 128 },
    // ...then a hard cut to near-vacuum black past the muzzle.
    { progress: MUZZLE_U, background: 0x000000, fog: 0x000000, near: 600, far: 16000 },
    { progress: 1, background: 0x000000, fog: 0x000000, near: 700, far: 18000 },
  ]);

  // ---- accelerator rings: the level's soul --------------------------------
  //
  // One ring per quarter note, placed at the rail parameter the camera occupies
  // on that beat. The crossing lands on the beat by construction, and because
  // the speed curve only rises, the spacing physically widens down the bore.

  const ringUs: number[] = [];
  for (let index = 0; index < RING_COUNT; index += 1) {
    ringUs.push(Math.min(MUZZLE_U, railU(index * BEAT_SECONDS)));
  }

  // Unit tori: the instance matrix scales them to the bore, so the tube radius
  // is authored as a RATIO of the ring radius. Get this wrong and the rings are
  // fat donuts that swallow every target behind them.
  const ringBodies = new InstancedMesh(
    new TorusGeometry(1, RING_TUBE / BORE_RADIUS, 6, 30),
    new MeshBasicMaterial({ color: 0xffffff }),
    RING_COUNT,
  );
  const ringRims = new InstancedMesh(
    new TorusGeometry(1, 0.075 / BORE_RADIUS, 4, 34),
    createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide }),
    RING_COUNT,
  );
  const downbeatIndexes = ringUs.map((_u, index) => index).filter((index) => index % 4 === 0);
  const lugs = new InstancedMesh(
    new BoxGeometry(1.25, 0.75, 1.35),
    new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.5) }),
    downbeatIndexes.length * LUG_COUNT,
  );
  for (const mesh of [ringBodies, ringRims, lugs]) {
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  let lugInstance = 0;
  for (let index = 0; index < RING_COUNT; index += 1) {
    const frame = sampleRailFrame(curve, ringUs[index]);
    scratchMatrix.makeBasis(frame.right, frame.up, frame.tangent);
    scratchQuaternion.setFromRotationMatrix(scratchMatrix);
    // Downbeat rings are a touch larger and deeper.
    const downbeat = index % 4 === 0;
    const radius = BORE_RADIUS + (downbeat ? 0.85 : 0);
    scratchScale.set(radius, radius, downbeat ? DOWNBEAT_TUBE / RING_TUBE : 1);
    scratchMatrix.compose(frame.position, scratchQuaternion, scratchScale);
    ringBodies.setMatrixAt(index, scratchMatrix);
    scratchScale.set(radius + 0.34, radius + 0.34, 1);
    scratchMatrix.compose(frame.position, scratchQuaternion, scratchScale);
    ringRims.setMatrixAt(index, scratchMatrix);

    if (!downbeat) continue;
    // Four coil-housing lugs bolted at the diagonals of every downbeat ring.
    for (let corner = 0; corner < LUG_COUNT; corner += 1) {
      const angle = (corner / LUG_COUNT) * Math.PI * 2 + Math.PI / 4;
      const offset = frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * (radius + 0.7))
        .addScaledVector(frame.up, Math.sin(angle) * (radius + 0.7));
      scratchMatrix.makeBasis(frame.right, frame.up, frame.tangent);
      scratchQuaternion.setFromRotationMatrix(scratchMatrix);
      scratchScale.set(1, 1, 1);
      scratchMatrix.compose(offset, scratchQuaternion, scratchScale);
      lugs.setMatrixAt(lugInstance, scratchMatrix);
      lugInstance += 1;
    }
  }
  ringBodies.instanceMatrix.needsUpdate = true;
  ringRims.instanceMatrix.needsUpdate = true;
  lugs.instanceMatrix.needsUpdate = true;
  // setColorAt lazily allocates instanceColor on first use; seed both so the
  // per-frame writes below never hit a null buffer.
  for (let index = 0; index < RING_COUNT; index += 1) {
    ringBodies.setColorAt(index, scratchColor.setRGB(0, 0, 0));
    ringRims.setColorAt(index, scratchColor);
  }
  ringBodies.instanceColor?.setUsage(DynamicDrawUsage);
  ringRims.instanceColor?.setUsage(DynamicDrawUsage);

  // ---- conductor rails: the actual railgun rails ---------------------------

  const railGroup = new Group();
  const railMaterial = new MeshBasicMaterial({ vertexColors: true });
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    const points: Vector3[] = [];
    const samples = 96;
    for (let s = 0; s <= samples; s += 1) {
      const frame = sampleRailFrame(curve, (s / samples) * MUZZLE_U);
      points.push(frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * (BORE_RADIUS - 0.55))
        .addScaledVector(frame.up, Math.sin(angle) * (BORE_RADIUS - 0.55)));
    }
    const geometry = new TubeGeometry(new CatmullRomCurve3(points), samples * 2, 0.19, 5, false);
    // Gradient arc blue → violet down the bore, baked into vertex colors so the
    // material colour is free to carry the beat pulse.
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    const start = points[0];
    const totalSpan = start.distanceTo(points[points.length - 1]);
    for (let v = 0; v < position.count; v += 1) {
      scratchPosition.fromBufferAttribute(position, v);
      const t = Math.min(1, scratchPosition.distanceTo(start) / Math.max(1, totalSpan));
      scratchColor.copy(ARC_BLUE).lerp(VOLT_VIOLET, t).multiplyScalar(1.15);
      colors[v * 3] = scratchColor.r;
      colors[v * 3 + 1] = scratchColor.g;
      colors[v * 3 + 2] = scratchColor.b;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    railGroup.add(new Mesh(geometry, railMaterial));
  }
  root.add(railGroup);

  // ---- barrel wall: dark rib panels just outside the drones' reach ---------

  const wallGroup = new Group();
  const rng = mulberry32(0x5a17c0);
  const panelGeometry = new BoxGeometry(3.1, 1.05, 6.4);
  const panelEdgeGeometry = new EdgesGeometry(new BoxGeometry(3.16, 1.11, 6.46));
  const panelMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone() });
  const panelEdgeMaterial = new LineBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(2.4) });
  const serviceLightMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.8), opacity: 0.85 });
  const serviceLightGeometry = new PlaneGeometry(0.5, 0.16);
  for (let index = 0; index < WALL_PANELS; index += 1) {
    const u = (index + rng() * 0.9) / WALL_PANELS * MUZZLE_U;
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = BORE_RADIUS + 2.1 + rng() * 1.6;
    const panel = new Mesh(panelGeometry, panelMaterial);
    panel.position.copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius);
    scratchMatrix.makeBasis(frame.right, frame.up, frame.tangent);
    panel.quaternion.setFromRotationMatrix(scratchMatrix);
    panel.rotateZ(-angle + Math.PI / 2);
    panel.add(new LineSegments(panelEdgeGeometry, panelEdgeMaterial));
    if (rng() < 0.16) {
      const light = new Mesh(serviceLightGeometry, serviceLightMaterial);
      light.position.set(0, -0.56, 0);
      light.rotation.x = Math.PI / 2;
      panel.add(light);
    }
    wallGroup.add(panel);
  }
  root.add(wallGroup);

  // ---- camera-riding speed streaks ----------------------------------------

  const streakRig = new Group();
  const streakMesh = new InstancedMesh(
    new PlaneGeometry(0.055, 1),
    createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide }),
    STREAK_COUNT,
  );
  streakMesh.frustumCulled = false;
  for (let index = 0; index < STREAK_COUNT; index += 1) streakMesh.setColorAt(index, scratchColor.setRGB(0, 0, 0));
  streakMesh.instanceColor?.setUsage(DynamicDrawUsage);
  const streaks = Array.from({ length: STREAK_COUNT }, () => {
    const angle = rng() * Math.PI * 2;
    const radius = STREAK_INNER + rng() * (STREAK_OUTER - STREAK_INNER);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: -rng() * STREAK_DEPTH,
      speed: 0.75 + rng() * 0.6,
      tint: rng(),
    };
  });
  streakRig.add(streakMesh);
  scene.add(streakRig);

  // ---- charge glow: the visible firing charge, parked at the muzzle --------

  const muzzlePosition = curve.getPointAt(MUZZLE_U).clone();
  const chargeMaterial = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
  const chargeDisc = new Mesh(new CircleGeometry(1, 44), chargeMaterial);
  chargeDisc.position.copy(muzzlePosition);
  chargeDisc.visible = false;
  chargeDisc.frustumCulled = false;
  root.add(chargeDisc);
  const chargeCoreMaterial = createAdditiveBasicMaterial({ color: 0x000000 });
  const chargeCore = new Mesh(new SphereGeometry(1, 14, 10), chargeCoreMaterial);
  chargeCore.position.copy(muzzlePosition);
  chargeCore.visible = false;
  chargeCore.frustumCulled = false;
  root.add(chargeCore);

  // ---- muzzle field: what you were launched toward ------------------------
  //
  // The engine camera's far plane is 500 units and the payload covers more than
  // that in the muzzle bars, so open space is a camera-riding rig rather than
  // fixed geometry: the field recentres on the camera every frame while keeping
  // world orientation, which is exactly how a genuinely distant sky behaves. Fog
  // hides all of it inside the barrel and stops hiding it at the muzzle.

  const exitFrame = sampleRailFrame(curve, 1);
  const exitDirection = exitFrame.tangent.clone().normalize();
  const starRig = new Group();
  const starPositions = new Float32Array(STAR_COUNT * 3);
  const starColors = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    const point = direction.multiplyScalar(255 + rng() * 200);
    starPositions[index * 3] = point.x;
    starPositions[index * 3 + 1] = point.y;
    starPositions[index * 3 + 2] = point.z;
    const roll = rng();
    scratchColor.copy(roll < 0.62 ? ARC_BLUE : VOLT_VIOLET).multiplyScalar(roll < 0.05 ? 4.0 : 0.8 + rng());
    starColors[index * 3] = scratchColor.r;
    starColors[index * 3 + 1] = scratchColor.g;
    starColors[index * 3 + 2] = scratchColor.b;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new BufferAttribute(starColors, 3));
  starRig.add(new Points(starGeometry, new PointsMaterial({
    size: 2.2,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })));

  // Star-streaks: short lines pointing back down the exit vector.
  const streakLinePositions = new Float32Array(STAR_STREAKS * 6);
  for (let index = 0; index < STAR_STREAKS; index += 1) {
    const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    const point = direction.multiplyScalar(240 + rng() * 200);
    const tail = point.clone().addScaledVector(exitDirection, -(14 + rng() * 42));
    streakLinePositions.set([point.x, point.y, point.z, tail.x, tail.y, tail.z], index * 6);
  }
  const streakLineGeometry = new BufferGeometry();
  streakLineGeometry.setAttribute('position', new BufferAttribute(streakLinePositions, 3));
  starRig.add(new LineSegments(streakLineGeometry, new LineBasicMaterial({
    color: hdr(ARC_BLUE, 0.9),
    transparent: true,
    opacity: 0.7,
    blending: AdditiveBlending,
    depthWrite: false,
  })));

  // One distant pulsing beacon dead ahead: the thing you were launched toward.
  const beaconMaterial = createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 2.4) });
  const beacon = new Mesh(new SphereGeometry(7, 14, 10), beaconMaterial);
  beacon.position.copy(exitDirection).multiplyScalar(400);
  const beaconHaloMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.7), opacity: 0.5 });
  const beaconHalo = new Mesh(new CircleGeometry(34, 30), beaconHaloMaterial);
  beaconHalo.position.copy(beacon.position);
  starRig.add(beacon, beaconHalo);
  scene.add(starRig);

  // ---- per-frame -----------------------------------------------------------

  const ringColor = new Color();
  const rimColor = new Color();

  function update(context: Parameters<MassDriverEnvironment['update']>[0]) {
    const { camera, runTime, runProgress, running, charge, strobe, fired, beatEnergy, dt } = context;
    atmosphere(runProgress);

    const beatPosition = running ? runTime / BEAT_SECONDS : -1;
    const idleShimmer = running ? 0 : 0.35 + Math.sin(runTime * 1.6) * 0.15;

    for (let index = 0; index < RING_COUNT; index += 1) {
      const along = index / (RING_COUNT - 1);
      // The ramp climbs down the bore, and the charge drags the rings ahead of
      // the payload toward white as the gun spools up.
      const chargeLean = charge * Math.min(1, Math.max(0, (index - beatPosition) / 18)) * 0.55;
      heat(Math.min(1, along * 0.72 + chargeLean + strobe * 0.9), ringColor);

      let energy = 0.55 + idleShimmer;
      if (running) {
        const delta = index - beatPosition;
        // Flash the ring the payload just crossed; pre-glow the next one.
        if (delta <= 0 && delta > -0.6) energy += (1 + delta / 0.6) * (index % 4 === 0 ? 3.0 : 2.0);
        else if (delta > 0 && delta <= 1.2) energy += (1 - delta / 1.2) ** 2 * 0.9;
        else energy = 0.5;
      }
      energy += strobe * 3.4;

      ringBodies.setColorAt(index, scratchColor.copy(ringColor).multiplyScalar(0.16 + energy * 0.1));
      rimColor.copy(ringColor).multiplyScalar(0.5 + energy * 0.55);
      ringRims.setColorAt(index, rimColor);
    }
    if (ringBodies.instanceColor) ringBodies.instanceColor.needsUpdate = true;
    if (ringRims.instanceColor) ringRims.instanceColor.needsUpdate = true;

    // Conductor rails pulse with the beat and brighten with the charge.
    railMaterial.color.setScalar(0.5 + beatEnergy * 0.42 + charge * 0.45 + strobe * 1.6);

    // Speed streaks: scrolled faster the faster the gun runs, slammed by the
    // post-shot surge, blazing past the muzzle.
    streakRig.position.copy(camera.position);
    streakRig.quaternion.copy(camera.quaternion);
    const airspeed = running ? speedReading(runTime) : 0.18;
    const streakLength = 2.5 + airspeed * 12;
    // Past the muzzle the streaks are the only light in frame, so they read as
    // speed by being long and fast rather than by being bright.
    const brightness = fired ? 0.2 : 0.06 + airspeed * 0.34 + charge * 0.22;
    for (let index = 0; index < STREAK_COUNT; index += 1) {
      const streak = streaks[index];
      streak.z += airspeed * streak.speed * 165 * dt;
      if (streak.z > 12) streak.z -= STREAK_DEPTH;
      scratchPosition.set(streak.x, streak.y, streak.z);
      scratchQuaternion.set(0.7071068, 0, 0, 0.7071068);
      scratchScale.set(1, streakLength * streak.speed, 1);
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
      streakMesh.setMatrixAt(index, scratchMatrix);
      heat(streak.tint * 0.5 + (fired ? 0 : charge * 0.45), scratchColor)
        .multiplyScalar(brightness * (0.6 + streak.tint * 0.8));
      streakMesh.setColorAt(index, scratchColor);
    }
    streakMesh.instanceMatrix.needsUpdate = true;
    if (streakMesh.instanceColor) streakMesh.instanceColor.needsUpdate = true;

    // Charge glow, size-capped so the last interlocks stay legible against it.
    const showCharge = charge > 0.001 && !fired;
    chargeDisc.visible = showCharge;
    chargeCore.visible = showCharge;
    if (showCharge) {
      const distance = Math.max(6, camera.position.distanceTo(muzzlePosition));
      const capped = Math.min(distance * 0.19, 46) * (0.35 + charge * 0.65);
      chargeDisc.scale.setScalar(capped);
      chargeDisc.quaternion.copy(camera.quaternion);
      chargeCore.scale.setScalar(capped * 0.34);
      const pulse = 0.85 + Math.sin(runTime * 9) * 0.15;
      chargeMaterial.color.copy(heat(0.55 + charge * 0.45, scratchColor)).multiplyScalar(charge * charge * 0.5 * pulse);
      chargeCoreMaterial.color.copy(IGNITION).multiplyScalar(charge * charge * 1.6 * pulse);
    }

    // Open space rides with the camera: recentred every frame, world-aligned, so
    // nothing in it ever slides past even though the payload is covering ground.
    starRig.position.copy(camera.position);

    // The beacon breathes; everything else out there is still.
    const beaconPulse = 1.6 + Math.sin(runTime * 2.1) * 0.9;
    beaconMaterial.color.copy(ION_WHITE).multiplyScalar(beaconPulse);
    beaconHaloMaterial.color.copy(ARC_BLUE).multiplyScalar(beaconPulse * 0.28);
    beaconHalo.quaternion.copy(camera.quaternion);
  }

  return {
    root,
    update,
    dispose() {
      for (const group of [root, streakRig, starRig]) {
        group.removeFromParent();
        disposeObject3D(group);
      }
      scene.fog = null;
    },
  };
}

// Normalized airspeed for the streak field: 0 at rest, ~1 at the peak of the shot.
function speedReading(runTime: number) {
  const preShot = 0.16 + Math.min(1, runTime / SHOT_TIME) * 0.34;
  if (runTime < SHOT_TIME) return preShot;
  return 0.5 + Math.min(1, (runTime - SHOT_TIME) / 0.35) * 0.5;
}
