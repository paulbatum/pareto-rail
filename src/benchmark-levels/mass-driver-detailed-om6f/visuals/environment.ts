import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
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
import { createAtmosphereRamp, scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { additiveMaterialParameters, createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import {
  MD_BEAT_SECONDS,
  MD_BORE_RADIUS,
  MD_MUZZLE_U,
  MD_RAIL_LENGTH,
  MD_RING_COUNT,
  ringProgress,
} from '../timing';
import {
  ARC_BLUE,
  GUNMETAL,
  IGNITION,
  ION_WHITE,
  VOID_BREECH,
  VOID_INTERLOCK,
  VOID_VACUUM,
  VOLT_VIOLET,
  heatRamp,
  hdr,
} from './palette';

// The bore is built from four things that all read the same beat grid: an
// accelerator ring on every quarter note, four conductor rails running the
// whole barrel, a scattered rib wall just outside the drones' reach, and a
// shell of streaks riding the camera. Ring k sits exactly where the camera is
// on beat k, which is what makes the crossings land on the beat by
// construction rather than by tuning.

const RING_TUBE = 0.03;
const RING_VISIBLE_UNITS = 420;
const RING_MAX_VISIBLE = 46;
const LUG_COUNT = 4;
const RAIL_TUBE_SEGMENTS = 420;
const WALL_RIBS = 60;
const STREAK_COUNT = 230;
const STAR_COUNT = 620;
const STREAK_SHELL_INNER = 9;
const STREAK_SHELL_OUTER = 34;
const STREAK_DEPTH = 210;
const STREAK_BEHIND = 40;

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  dt: number;
  runProgress: number;
  runTime: number;
  /** Run time shifted onto the audible transport, so ring flashes land on the beat. */
  beatTime: number;
  charge: number;
  speedFactor: number;
  running: boolean;
  gunFired: boolean;
  elapsed: number;
  /** 0..1 decaying pulse written by the beat handler. */
  beatEnergy: number;
  /** Brief full-tunnel white strobe, 0..1. */
  strobe: number;
};

export type Environment = {
  root: Group;
  update(frame: EnvironmentFrame): void;
  /** World position of ring `index`, for crossing effects. */
  ringPosition(index: number, target: Vector3): Vector3;
  ringRadius(index: number): number;
  /** World position of the muzzle mouth. */
  muzzlePosition(target: Vector3): Vector3;
  dispose(): void;
};

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchVector = new Vector3();
const scratchForward = new Vector3();
const scratchRight = new Vector3();
const scratchUp = new Vector3();

export function createEnvironment(scene: Scene, curve: CatmullRomCurve3): Environment {
  const root = new Group();
  scene.add(root);

  scene.background = VOID_BREECH.clone();
  scene.fog = new FogExp2(VOID_BREECH.clone().getHex(), 0.0055);
  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: VOID_BREECH, fog: VOID_BREECH, density: 0.0056 },
    { progress: 0.22, background: VOID_BREECH, fog: new Color(0.010, 0.010, 0.032), density: 0.0050 },
    { progress: 0.45, background: VOID_INTERLOCK, fog: new Color(0.026, 0.012, 0.050), density: 0.0042 },
    { progress: MD_MUZZLE_U - 0.02, background: VOID_INTERLOCK, fog: new Color(0.070, 0.048, 0.110), density: 0.0033 },
    { progress: MD_MUZZLE_U - 0.001, background: new Color(0.10, 0.08, 0.15), fog: new Color(0.13, 0.10, 0.19), density: 0.0030 },
    // Hard cut at the muzzle: near-vacuum black.
    { progress: MD_MUZZLE_U + 0.001, background: VOID_VACUUM, fog: VOID_VACUUM, density: 0.00022 },
    { progress: 1, background: VOID_VACUUM, fog: VOID_VACUUM, density: 0.00018 },
  ]);

  // -------------------------------------------------------------------------
  // Accelerator rings: one per beat, precomputed onto the authored speed curve.
  // -------------------------------------------------------------------------

  const ringPositions: Vector3[] = [];
  const ringQuaternions: Quaternion[] = [];
  const ringRadii: number[] = [];
  const ringProgressions: number[] = [];
  const basis = new Matrix4();

  for (let index = 0; index < MD_RING_COUNT; index += 1) {
    const u = Math.min(MD_MUZZLE_U, ringProgress(index));
    const frame = sampleRailFrame(curve, u);
    basis.makeBasis(frame.right, frame.up, frame.tangent);
    ringProgressions.push(u);
    ringPositions.push(frame.position.clone());
    ringQuaternions.push(new Quaternion().setFromRotationMatrix(basis));
    // Downbeat rings are a touch larger and deeper.
    ringRadii.push(index % 4 === 0 ? MD_BORE_RADIUS * 1.06 : MD_BORE_RADIUS);
  }

  const ringBodies = new InstancedMesh(
    new TorusGeometry(1, RING_TUBE, 5, 44),
    new MeshBasicMaterial({ color: 0xffffff }),
    RING_MAX_VISIBLE,
  );
  const ringRims = new InstancedMesh(
    new TorusGeometry(1, RING_TUBE * 2.6, 4, 40),
    createAdditiveBasicMaterial({ color: 0xffffff, opacity: 0.26 }),
    RING_MAX_VISIBLE,
  );
  const ringLugs = new InstancedMesh(
    new TorusGeometry(0.09, 0.045, 4, 8),
    new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(2.2) }),
    RING_MAX_VISIBLE * LUG_COUNT,
  );
  for (const mesh of [ringBodies, ringRims, ringLugs]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Conductor rails: the gun's actual rails, four thin tubes at the diagonals.
  // -------------------------------------------------------------------------

  const railGroup = new Group();
  root.add(railGroup);
  const railRadius = MD_BORE_RADIUS - 0.45;
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const points: Vector3[] = [];
    const samples = 150;
    for (let s = 0; s <= samples; s += 1) {
      const u = (s / samples) * MD_MUZZLE_U;
      const frame = sampleRailFrame(curve, u);
      points.push(frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * railRadius)
        .addScaledVector(frame.up, Math.sin(angle) * railRadius));
    }
    const geometry = new TubeGeometry(new CatmullRomCurve3(points), RAIL_TUBE_SEGMENTS, 0.17, 5, false);
    // Gradient down the bore, baked into the vertices: arc blue to volt violet.
    const positionCount = geometry.getAttribute('position').count;
    const colors = new Float32Array(positionCount * 3);
    const ringVertices = 6; // radialSegments + 1
    for (let v = 0; v < positionCount; v += 1) {
      const t = Math.min(1, Math.floor(v / ringVertices) / RAIL_TUBE_SEGMENTS);
      heatRamp(t * 0.62, scratchColor);
      colors[v * 3] = scratchColor.r;
      colors[v * 3 + 1] = scratchColor.g;
      colors[v * 3 + 2] = scratchColor.b;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const material = new MeshBasicMaterial(additiveMaterialParameters({ color: 0xffffff, vertexColors: true }));
    railGroup.add(new Mesh(geometry, material));
  }
  const railMaterials = railGroup.children.map((child) => (child as Mesh).material as MeshBasicMaterial);

  // -------------------------------------------------------------------------
  // Barrel wall: dark rib panels just outside the drones' reach, a scattered
  // few carrying a dim service light. Threaders weave in front of these.
  // -------------------------------------------------------------------------

  const wallRng = mulberry32(0x5f2c11);
  const ribAngles = Array.from({ length: WALL_RIBS }, (_unused, index) => index * 2.39996 + (index % 3) * 0.4);
  const ribRadii = Array.from({ length: WALL_RIBS }, () => MD_BORE_RADIUS + 1.4 + wallRng() * 1.1);
  const ribLit = Array.from({ length: WALL_RIBS }, (_unused, index) => index % 5 === 0);
  const ribPanel = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.9) });
  const ribEdge = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(GUNMETAL, 2.6) }));
  const ribLight = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.9) });

  const wall: ScatterField = scatterAlongRail(curve, {
    count: WALL_RIBS,
    seed: 0x5f2c11,
    window: { behind: 60, ahead: RING_VISIBLE_UNITS + 80 },
    place(index, rng) {
      const angle = ribAngles[index];
      const radius = ribRadii[index];
      return {
        u: rng() * MD_MUZZLE_U,
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
      };
    },
    make(index) {
      const group = new Group();
      const panel = new Mesh(RIB_GEOMETRY, ribPanel);
      panel.rotation.z = ribAngles[index];
      group.add(panel);
      const outline = new LineSegments(RIB_OUTLINE_GEOMETRY, ribEdge);
      outline.rotation.z = ribAngles[index];
      group.add(outline);
      if (ribLit[index]) {
        const lamp = new Mesh(new SphereGeometry(0.28, 6, 5), ribLight);
        lamp.position.set(Math.cos(ribAngles[index]) * -0.9, Math.sin(ribAngles[index]) * -0.9, 1.4);
        group.add(lamp);
      }
      return group;
    },
    onUpdate(item) {
      // The barrel wall ends at the muzzle, same as everything else.
      if (item.u > MD_MUZZLE_U) item.object.visible = false;
    },
  });
  root.add(wall.group);

  // -------------------------------------------------------------------------
  // Camera-riding speed streaks.
  // -------------------------------------------------------------------------

  const streakRng = mulberry32(0x11a7d3);
  const streaks = Array.from({ length: STREAK_COUNT }, () => ({
    angle: streakRng() * Math.PI * 2,
    radius: STREAK_SHELL_INNER + streakRng() * (STREAK_SHELL_OUTER - STREAK_SHELL_INNER),
    depth: -STREAK_BEHIND + streakRng() * (STREAK_DEPTH + STREAK_BEHIND),
    length: 2.2 + streakRng() * 5.5,
    tint: streakRng(),
  }));
  const streakMesh = new InstancedMesh(
    STREAK_GEOMETRY,
    createAdditiveBasicMaterial({ color: 0xffffff }),
    STREAK_COUNT,
  );
  streakMesh.frustumCulled = false;
  root.add(streakMesh);

  // -------------------------------------------------------------------------
  // Charge glow: the visible firing charge, parked at the muzzle.
  // -------------------------------------------------------------------------

  const chargeGlow = new Mesh(radialDiscGeometry(52), new MeshBasicMaterial(additiveMaterialParameters({
    color: 0xffffff,
    vertexColors: true,
    side: DoubleSide,
  })));
  chargeGlow.frustumCulled = false;
  chargeGlow.visible = false;
  root.add(chargeGlow);
  const chargeMaterial = chargeGlow.material as MeshBasicMaterial;

  // -------------------------------------------------------------------------
  // Muzzle field: deep starfield, star streaks, and the beacon dead ahead.
  // -------------------------------------------------------------------------

  const starRng = mulberry32(0x2b91ff);
  const starPositions = new Float32Array(STAR_COUNT * 3);
  const starColors = new Float32Array(STAR_COUNT * 3);
  const starDirections: Vector3[] = [];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const direction = new Vector3(
      starRng() * 2 - 1,
      starRng() * 2 - 1,
      -0.15 - starRng() * 1.4,
    ).normalize();
    starDirections.push(direction);
    const bright = starRng();
    const tint = bright > 0.94 ? IGNITION : starRng() > 0.5 ? ARC_BLUE : VOLT_VIOLET;
    const scale = bright > 0.94 ? 1.7 : 0.4 + bright * 0.6;
    starColors[i * 3] = tint.r * scale;
    starColors[i * 3 + 1] = tint.g * scale;
    starColors[i * 3 + 2] = tint.b * scale;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new BufferAttribute(starColors, 3));
  const stars = new Points(starGeometry, new PointsMaterial({
    size: 2.4,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  stars.frustumCulled = false;
  stars.visible = false;
  root.add(stars);

  const STAR_STREAK_COUNT = 90;
  const streakLineGeometry = new BufferGeometry();
  streakLineGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(STAR_STREAK_COUNT * 6), 3));
  const starStreakMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ION_WHITE, 0.8) }));
  const starStreaks = new LineSegments(streakLineGeometry, starStreakMaterial);
  starStreaks.frustumCulled = false;
  starStreaks.visible = false;
  root.add(starStreaks);

  const beacon = new Group();
  const beaconCore = new Mesh(new SphereGeometry(1.5, 10, 8), new MeshBasicMaterial({ color: hdr(ION_WHITE, 3) }));
  const beaconGlow = new Mesh(new SphereGeometry(4.2, 10, 8), createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 0.5), opacity: 0.5 }));
  beacon.add(beaconCore, beaconGlow);
  beacon.frustumCulled = false;
  beacon.visible = false;
  root.add(beacon);
  const beaconGlowMaterial = beaconGlow.material as MeshBasicMaterial;

  const exitDirection = sampleRailFrame(curve, 0.999).tangent.clone();

  let ringCursor = 0;

  function update(frame: EnvironmentFrame) {
    const { camera, runProgress, charge, speedFactor, dt } = frame;
    atmosphere(runProgress);

    camera.getWorldDirection(scratchForward);
    scratchRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    scratchUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    updateRings(frame);
    updateRails(frame);
    wall.update(runProgress, dt);
    updateStreaks(frame);
    updateCharge(frame);
    updateMuzzleField(frame);
    void speedFactor;
    void charge;
  }

  function updateRings(frame: EnvironmentFrame) {
    const { runProgress, beatTime, charge, strobe, elapsed, running } = frame;
    // Idle shimmer in attract mode; a real crossing cadence during a run.
    const beat = running ? Math.max(0, beatTime) / MD_BEAT_SECONDS : 0;
    const passedIndex = Math.floor(beat + 1e-6);
    const beatFraction = beat - passedIndex;

    while (ringCursor > 0 && ringProgressions[ringCursor] > runProgress) ringCursor -= 1;
    while (ringCursor < MD_RING_COUNT - 1 && ringProgressions[ringCursor + 1] <= runProgress) ringCursor += 1;
    const first = Math.max(0, ringCursor - 1);
    const maxU = runProgress + RING_VISIBLE_UNITS / MD_RAIL_LENGTH;

    let count = 0;
    let lugCount = 0;
    for (let index = first; index < MD_RING_COUNT && count < RING_MAX_VISIBLE; index += 1) {
      const u = ringProgressions[index];
      if (u > maxU) break;
      if (u < runProgress - 0.0016) continue;

      const radius = ringRadii[index];
      const downbeat = index % 4 === 0;
      // Base heat climbs the ramp down the bore; the charge leans everything
      // ahead of the camera toward white.
      let heat = (index / (MD_RING_COUNT - 1)) * 0.72;
      if (charge > 0 && index > passedIndex) heat = MathUtils.lerp(heat, 1, charge * 0.85);
      heat = Math.min(1, heat + strobe);
      // The nearest rings fill the frame, so hold their energy back: a ring
      // two metres from the lens must not white out the clamps behind it.
      const nearness = MathUtils.clamp(1 - (u - runProgress) * MD_RAIL_LENGTH / 140, 0, 1);
      const nearDamp = 1 - nearness * nearness * 0.78;

      // The just-passed ring flashes; the next one pre-glows into its crossing.
      let intensity = downbeat ? 1.02 : 0.7;
      if (running) {
        if (index === passedIndex) intensity += (1 - beatFraction) ** 2 * (downbeat ? 2.6 : 1.5);
        else if (index === passedIndex + 1) intensity += beatFraction ** 3 * 1.2;
      } else {
        intensity += 0.22 + 0.22 * Math.sin(elapsed * 1.9 - index * 0.42);
      }

      heatRamp(heat, scratchColor).multiplyScalar(intensity * nearDamp);
      scratchScale.setScalar(radius);
      scratchMatrix.compose(ringPositions[index], ringQuaternions[index], scratchScale);
      ringBodies.setMatrixAt(count, scratchMatrix);
      ringBodies.setColorAt(count, scratchColor);
      ringRims.setMatrixAt(count, scratchMatrix);
      ringRims.setColorAt(count, scratchColor.multiplyScalar(0.32));

      if (downbeat) {
        // Four coil-housing lugs bolted at the diagonals.
        const frameRight = scratchRight;
        void frameRight;
        for (let lug = 0; lug < LUG_COUNT; lug += 1) {
          const angle = Math.PI / 4 + (lug / LUG_COUNT) * Math.PI * 2;
          scratchVector.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
            .applyQuaternion(ringQuaternions[index])
            .add(ringPositions[index]);
          scratchQuaternion.copy(ringQuaternions[index]);
          scratchScale.setScalar(radius * 0.34);
          scratchMatrix.compose(scratchVector, scratchQuaternion, scratchScale);
          ringLugs.setMatrixAt(lugCount, scratchMatrix);
          lugCount += 1;
        }
      }
      count += 1;
    }

    ringBodies.count = count;
    ringRims.count = count;
    ringLugs.count = lugCount;
    ringBodies.instanceMatrix.needsUpdate = true;
    ringRims.instanceMatrix.needsUpdate = true;
    ringLugs.instanceMatrix.needsUpdate = true;
    if (ringBodies.instanceColor) ringBodies.instanceColor.needsUpdate = true;
    if (ringRims.instanceColor) ringRims.instanceColor.needsUpdate = true;
  }

  function updateRails(frame: EnvironmentFrame) {
    const pulse = 0.4 + frame.beatEnergy * 0.45 + frame.charge * 0.8 + frame.strobe * 1.3;
    const fade = frame.runProgress > MD_MUZZLE_U ? 0 : 1;
    for (const material of railMaterials) material.color.setScalar(pulse * fade);
    railGroup.visible = fade > 0;
  }

  function updateStreaks(frame: EnvironmentFrame) {
    const { camera, dt, speedFactor, charge, gunFired } = frame;
    const scroll = 26 * speedFactor + charge * 20;
    const brightness = MathUtils.clamp(0.05 + speedFactor * 0.14 + charge * 0.28 + (gunFired ? 0.5 : 0), 0, 1.6);
    scratchQuaternion.copy(camera.quaternion);
    for (let i = 0; i < STREAK_COUNT; i += 1) {
      const streak = streaks[i];
      streak.depth -= scroll * dt;
      if (streak.depth < -STREAK_BEHIND) streak.depth += STREAK_DEPTH + STREAK_BEHIND;
      scratchVector.copy(camera.position)
        .addScaledVector(scratchRight, Math.cos(streak.angle) * streak.radius)
        .addScaledVector(scratchUp, Math.sin(streak.angle) * streak.radius)
        .addScaledVector(scratchForward, streak.depth);
      scratchScale.set(1, 1, streak.length * (0.6 + speedFactor * 0.5));
      scratchMatrix.compose(scratchVector, scratchQuaternion, scratchScale);
      streakMesh.setMatrixAt(i, scratchMatrix);
      heatRamp(streak.tint * 0.5 + charge * 0.45, scratchColor).multiplyScalar(brightness * (0.4 + streak.tint * 0.8));
      streakMesh.setColorAt(i, scratchColor);
    }
    streakMesh.instanceMatrix.needsUpdate = true;
    if (streakMesh.instanceColor) streakMesh.instanceColor.needsUpdate = true;
  }

  function updateCharge(frame: EnvironmentFrame) {
    const { camera, charge, runProgress } = frame;
    if (charge <= 0.001 || runProgress >= MD_MUZZLE_U) {
      chargeGlow.visible = false;
      return;
    }
    chargeGlow.visible = true;
    muzzlePosition(scratchVector);
    const distance = Math.max(6, scratchVector.distanceTo(camera.position));
    chargeGlow.position.copy(scratchVector);
    chargeGlow.quaternion.copy(camera.quaternion);
    // Cap the apparent size so the last interlocks stay legible against it; the
    // true whiteout belongs to the shot, not the buildup.
    const wanted = 14 + charge * 46;
    chargeGlow.scale.setScalar(Math.min(wanted, distance * 0.30));
    chargeMaterial.color.copy(heatRamp(0.55 + charge * 0.45, scratchColor)).multiplyScalar(0.35 + charge * 1.5);
  }

  function updateMuzzleField(frame: EnvironmentFrame) {
    const { camera, gunFired, runProgress, speedFactor } = frame;
    const visible = gunFired || runProgress > MD_MUZZLE_U;
    stars.visible = visible;
    starStreaks.visible = visible;
    beacon.visible = visible;
    if (!visible) return;

    const attribute = starGeometry.getAttribute('position') as BufferAttribute;
    const array = attribute.array as Float32Array;
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const direction = starDirections[i];
      array[i * 3] = camera.position.x + direction.x * 380;
      array[i * 3 + 1] = camera.position.y + direction.y * 380;
      array[i * 3 + 2] = camera.position.z + direction.z * 380;
    }
    attribute.needsUpdate = true;

    const streakArray = (streakLineGeometry.getAttribute('position') as BufferAttribute).array as Float32Array;
    const reach = 6 + speedFactor * 9;
    for (let i = 0; i < STAR_STREAK_COUNT; i += 1) {
      const direction = starDirections[i * 5];
      const base = 300;
      streakArray[i * 6] = camera.position.x + direction.x * base;
      streakArray[i * 6 + 1] = camera.position.y + direction.y * base;
      streakArray[i * 6 + 2] = camera.position.z + direction.z * base;
      streakArray[i * 6 + 3] = camera.position.x + direction.x * (base + reach * 4);
      streakArray[i * 6 + 4] = camera.position.y + direction.y * (base + reach * 4);
      streakArray[i * 6 + 5] = camera.position.z + direction.z * (base + reach * 4);
    }
    (streakLineGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;

    // One distant pulsing beacon dead ahead: the thing you were launched toward.
    beacon.position.copy(camera.position).addScaledVector(exitDirection, 430);
    const pulse = 0.55 + 0.45 * Math.sin(frame.elapsed * 2.4);
    beaconGlowMaterial.color.copy(ION_WHITE).multiplyScalar(0.35 + pulse * 0.55);
  }

  function ringPosition(index: number, target: Vector3) {
    const clamped = MathUtils.clamp(index, 0, MD_RING_COUNT - 1);
    return target.copy(ringPositions[clamped]);
  }

  function ringRadius(index: number) {
    return ringRadii[MathUtils.clamp(index, 0, MD_RING_COUNT - 1)];
  }

  function muzzlePosition(target: Vector3) {
    return target.copy(ringPositions[MD_RING_COUNT - 1]);
  }

  return {
    root,
    update,
    ringPosition,
    ringRadius,
    muzzlePosition,
    dispose() {
      wall.dispose();
      root.removeFromParent();
      disposeObject3D(root);
      root.clear();
    },
  };
}

// --- small geometry leaves ---------------------------------------------------

const RIB_GEOMETRY = new BoxGeometry(3.4, 0.42, 5.4);
const RIB_OUTLINE_GEOMETRY = new EdgesGeometry(RIB_GEOMETRY);
const STREAK_GEOMETRY = new BoxGeometry(0.055, 0.055, 1);

/** A camera-facing disc with a baked radial falloff: bright center, black rim. */
function radialDiscGeometry(segments: number) {
  const geometry = new CircleGeometry(1, segments);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < count; i += 1) {
    const radius = Math.hypot(positions.getX(i), positions.getY(i));
    const falloff = (1 - Math.min(1, radius)) ** 2.2;
    colors[i * 3] = falloff;
    colors[i * 3 + 1] = falloff;
    colors[i * 3 + 2] = falloff;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
