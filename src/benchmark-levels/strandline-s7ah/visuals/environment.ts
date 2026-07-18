import {
  BackSide,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAtmosphereRamp } from '../../../engine/environment-kit';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import {
  BELL_CENTER,
  BELL_RADIUS,
  BELL_SQUASH,
  STRAND_BOTTOM_Y,
  STRAND_TOP_Y,
  createStrandlineRail,
} from '../gameplay';
import {
  BELL_GLOW,
  JELLY_GOLD,
  JELLY_GREEN,
  PARASITE_BRUISE,
  PARASITE_VIOLET,
  STRAND_TEAL,
  SUN_SHAFT,
  WATER_DEEP,
  WATER_MID,
  hdr,
  mulberry32,
} from './palette';

// The world is one animal. A bell the size of a moon overhead, a forest of
// strands trailing beneath it, sunlight coming down in shafts through open
// water, marine snow drifting past the camera — and the infestation's violet
// nodules crusting the strands until the run burns them off. `cleanse` is the
// world's one dial: 0 is the sick colony you arrive in, 1 is the clean,
// green-gold animal the ending pulls back to show.

export type EnvironmentUpdateContext = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  progress: number;
  beatEnergy: number;
  cleanse: number;
};

export type Environment = {
  root: Group;
  update(dt: number, context: EnvironmentUpdateContext): void;
  dispose(): void;
};

type StrandGroupRecord = {
  material: MeshBasicMaterial;
  phase: number;
  glowBias: number;
};

const STRAND_COUNT = 82;
const STRAND_GROUPS = 6;
const NODULE_CAPACITY = 170;
// Strands stay clear of the whole lock corridor (targets hold up to ~23 to
// either side of the rail), so the occlusion gate keeps a clean line of fire.
const RAIL_CLEARANCE = 21;

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  scene.add(root);
  const rng = mulberry32(0x5EA11FE);
  const rail = createStrandlineRail();

  scene.fog = new FogExp2(WATER_MID.getHex(), 0.012);
  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: WATER_DEEP.clone().multiplyScalar(0.8), fog: new Color(0.03, 0.12, 0.15), density: 0.014 },
    { progress: 0.38, background: WATER_DEEP, fog: new Color(0.045, 0.16, 0.18), density: 0.0115 },
    { progress: 0.52, background: new Color(0.03, 0.1, 0.14), fog: new Color(0.06, 0.2, 0.2), density: 0.009 },
    { progress: 0.8, background: new Color(0.02, 0.08, 0.12), fog: new Color(0.05, 0.19, 0.17), density: 0.0105 },
    { progress: 1, background: new Color(0.015, 0.07, 0.12), fog: new Color(0.07, 0.22, 0.19), density: 0.008 },
  ]);

  // Rail samples for strand clearance testing (horizontal distance only —
  // strands are vertical, the rail must thread between them, and the lock
  // corridor has to stay open for the occlusion gate).
  const railSamples: Vector3[] = [];
  for (let i = 0; i <= 240; i += 1) railSamples.push(rail.getPointAt(i / 240));
  const clearOfRail = (x: number, z: number, clearance: number) => {
    for (const sample of railSamples) {
      const dx = sample.x - x;
      const dz = sample.z - z;
      if (dx * dx + dz * dz < clearance * clearance) return false;
    }
    return true;
  };

  // ---- the bell ---------------------------------------------------------------

  const bell = new Group();
  bell.position.copy(BELL_CENTER);
  root.add(bell);

  // Dome skin: a dark translucent outside and a luminous inner volume — the
  // "green moon" when the reveal swings wide of the colony.
  const skinMaterial = new MeshBasicMaterial({
    color: new Color(0.05, 0.2, 0.13),
    transparent: true,
    opacity: 0.62,
    side: DoubleSide,
    depthWrite: false,
  });
  const skin = new Mesh(new SphereGeometry(BELL_RADIUS, 40, 22, 0, Math.PI * 2, 0, Math.PI * 0.52), skinMaterial);
  skin.name = 'bell-skin';
  skin.scale.y = BELL_SQUASH;
  bell.add(skin);

  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(BELL_GLOW, 0.28), side: BackSide });
  const glow = new Mesh(new SphereGeometry(BELL_RADIUS * 0.93, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.55), glowMaterial);
  glow.name = 'bell-glow';
  glow.scale.y = BELL_SQUASH;
  bell.add(glow);

  const heartMaterial = createAdditiveBasicMaterial({ color: hdr(BELL_GLOW, 0.5) });
  const bellHeart = new Mesh(new SphereGeometry(BELL_RADIUS * 0.3, 20, 14), heartMaterial);
  bellHeart.position.y = BELL_RADIUS * 0.22;
  bellHeart.scale.y = 0.7;
  bell.add(bellHeart);

  // Meridian ribs: the bell's radial canals, glowing lines over the dome —
  // merged into one mesh (they move rigidly with the bell).
  const ribMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.5) });
  const RIBS = 12;
  const ribGeometries: BufferGeometry[] = [];
  for (let i = 0; i < RIBS; i += 1) {
    const rib = new TorusGeometry(BELL_RADIUS * 0.985, 0.55, 5, 40, Math.PI * 0.5);
    rib.applyMatrix4(new Matrix4().makeRotationZ(Math.PI * 0.5));
    rib.applyMatrix4(new Matrix4().makeRotationY((i / RIBS) * Math.PI * 2));
    rib.applyMatrix4(new Matrix4().makeScale(1, BELL_SQUASH, 1));
    ribGeometries.push(rib);
  }
  bell.add(new Mesh(mergeGeometries(ribGeometries), ribMaterial));
  for (const geometry of ribGeometries) geometry.dispose();

  // Rim fringe: a bright margin ring where the strands root.
  const rimMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.65) });
  const rim = new Mesh(new TorusGeometry(BELL_RADIUS * 0.99, 0.9, 8, 64), rimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.5;
  bell.add(rim);

  // ---- the strands ------------------------------------------------------------

  // Strands merge into a handful of draw calls: per-strand color variation is
  // baked into vertex colors, and each merged group animates its own pulse
  // phase through the material color multiplier.
  const strandGroup = new Group();
  root.add(strandGroup);
  const strands: StrandGroupRecord[] = [];
  const groupGeometries: BufferGeometry[][] = Array.from({ length: STRAND_GROUPS }, () => []);
  const nodulePoints: Vector3[] = [];

  let placed = 0;
  let attempts = 0;
  while (placed < STRAND_COUNT && attempts < STRAND_COUNT * 40) {
    attempts += 1;
    const angle = rng() * Math.PI * 2;
    const radius = 13 + rng() * 52;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (!clearOfRail(x, z, RAIL_CLEARANCE)) continue;

    const topY = STRAND_TOP_Y - rng() * 6;
    const bottomY = STRAND_BOTTOM_Y + rng() * 46;
    const driftPhase = rng() * Math.PI * 2;
    const driftAmp = 2.5 + rng() * 5;
    const points: Vector3[] = [];
    const SEGS = 7;
    for (let i = 0; i <= SEGS; i += 1) {
      const t = i / SEGS;
      const y = MathUtils.lerp(topY, bottomY, t);
      points.push(new Vector3(
        x + Math.sin(driftPhase + t * 2.6) * driftAmp * t,
        y,
        z + Math.cos(driftPhase * 1.3 + t * 2.2) * driftAmp * t,
      ));
    }
    const curve = new CatmullRomCurve3(points);
    const thickness = 0.32 + rng() * 0.45;
    const tint = STRAND_TEAL.clone().lerp(JELLY_GREEN, rng() * 0.45).multiplyScalar(0.55 + rng() * 0.4);
    const tube = new TubeGeometry(curve, 20, thickness, 5, false);
    const vertexCount = tube.getAttribute('position').count;
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i += 1) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    tube.setAttribute('color', new Float32BufferAttribute(colors, 3));
    groupGeometries[placed % STRAND_GROUPS].push(tube);

    // Nodule sites: infestation crusting the upper half of some strands.
    const noduleCount = rng() < 0.62 ? 2 + Math.floor(rng() * 3) : 0;
    for (let i = 0; i < noduleCount && nodulePoints.length < NODULE_CAPACITY; i += 1) {
      const t = 0.08 + rng() * 0.5;
      nodulePoints.push(curve.getPointAt(t).add(new Vector3(rng() - 0.5, 0, rng() - 0.5).multiplyScalar(thickness * 2)));
    }
    placed += 1;
  }

  for (let groupIndex = 0; groupIndex < STRAND_GROUPS; groupIndex += 1) {
    const geometries = groupGeometries[groupIndex];
    if (geometries.length === 0) continue;
    const material = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    const strandMesh = new Mesh(mergeGeometries(geometries), material);
    strandMesh.name = `strand-group-${groupIndex}`;
    strandGroup.add(strandMesh);
    for (const geometry of geometries) geometry.dispose();
    strands.push({ material, phase: (groupIndex / STRAND_GROUPS) * Math.PI * 2, glowBias: rng() });
  }

  // ---- infestation nodules ----------------------------------------------------

  const noduleMaterial = new MeshBasicMaterial({
    color: PARASITE_VIOLET.clone().multiplyScalar(0.85),
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  const noduleMesh = new InstancedMesh(new SphereGeometry(0.55, 6, 5), noduleMaterial, NODULE_CAPACITY);
  const scratch = new Matrix4();
  const scratchQuat = new Quaternion();
  const scratchScaleV = new Vector3();
  nodulePoints.forEach((point, index) => {
    scratchQuat.setFromAxisAngle(new Vector3(0, 1, 0), index * 2.4);
    scratchScaleV.setScalar(0.6 + (index % 5) * 0.22);
    scratch.compose(point, scratchQuat, scratchScaleV);
    noduleMesh.setMatrixAt(index, scratch);
    noduleMesh.setColorAt(index, (index % 3 === 0 ? PARASITE_BRUISE : PARASITE_VIOLET).clone().multiplyScalar(0.7 + (index % 4) * 0.12));
  });
  noduleMesh.count = nodulePoints.length;
  noduleMesh.instanceMatrix.needsUpdate = true;
  // Instances spread across the whole colony; the shared geometry bounds
  // would cull them wrongly.
  noduleMesh.frustumCulled = false;
  root.add(noduleMesh);

  // ---- light shafts -----------------------------------------------------------

  const shaftGroup = new Group();
  root.add(shaftGroup);
  const shafts: Array<{ mesh: Mesh; material: MeshBasicMaterial; base: number; phase: number }> = [];
  // One crossed-plane geometry shared by every shaft, with a baked vertical
  // fade (bright at the surface, gone at depth) so they read as falling light
  // instead of solid columns. One draw call each.
  const shaftBlade = new PlaneGeometry(1, 1, 1, 4);
  const shaftCrossed = mergeGeometries([
    shaftBlade.clone(),
    shaftBlade.clone().applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2)),
  ]);
  shaftBlade.dispose();
  {
    const positionAttribute = shaftCrossed.getAttribute('position');
    const fade = new Float32Array(positionAttribute.count * 3);
    for (let i = 0; i < positionAttribute.count; i += 1) {
      const level = MathUtils.clamp(positionAttribute.getY(i) + 0.5, 0, 1) ** 1.7;
      fade[i * 3] = level;
      fade[i * 3 + 1] = level;
      fade[i * 3 + 2] = level;
    }
    shaftCrossed.setAttribute('color', new Float32BufferAttribute(fade, 3));
  }
  for (let i = 0; i < 9; i += 1) {
    // Shafts are enormous quads; keep their columns out of the lock corridor
    // so the occlusion raycasts never graze them.
    let angle = rng() * Math.PI * 2;
    let radius = 28 + rng() * 62;
    for (let attempt = 0; attempt < 30 && !clearOfRail(Math.cos(angle) * radius, Math.sin(angle) * radius, 26); attempt += 1) {
      angle = rng() * Math.PI * 2;
      radius = 28 + rng() * 62;
    }
    const material = createAdditiveBasicMaterial({ color: hdr(SUN_SHAFT, 0.028 + rng() * 0.03), side: DoubleSide });
    material.vertexColors = true;
    const shaft = new Mesh(shaftCrossed, material);
    shaft.name = `sun-shaft-${i}`;
    shaft.position.set(Math.cos(angle) * radius, 30, Math.sin(angle) * radius);
    shaft.scale.set(3.5 + rng() * 6, 175, 3.5 + rng() * 6);
    shaft.rotation.z = (rng() - 0.5) * 0.1;
    shaftGroup.add(shaft);
    shafts.push({ mesh: shaft, material, base: material.color.r / SUN_SHAFT.r, phase: rng() * Math.PI * 2 });
  }

  // ---- marine snow and bubbles ------------------------------------------------

  // Both particle fields are one InstancedMesh each, living in a wrapping box
  // around the camera: one draw call, one scene object, no late-run pile-up.
  const SNOW_COUNT = 130;
  const SNOW_HALF = 42;
  const snowMesh = new InstancedMesh(
    new TetrahedronGeometry(0.09, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SNOW_COUNT,
  );
  snowMesh.frustumCulled = false;
  const snowPositions: Vector3[] = [];
  const snowSpin: number[] = [];
  for (let i = 0; i < SNOW_COUNT; i += 1) {
    snowPositions.push(new Vector3((rng() - 0.5) * 2 * SNOW_HALF, (rng() - 0.5) * 2 * SNOW_HALF, (rng() - 0.5) * 2 * SNOW_HALF));
    snowSpin.push(rng() * Math.PI * 2);
    const dim = 0.1 + rng() * 0.22;
    const size = 0.6 + rng() * 1.1;
    snowMesh.setColorAt(i, new Color(dim * 0.8, dim, dim * 0.95));
    const matrix = new Matrix4().makeScale(size, size, size);
    snowMesh.setMatrixAt(i, matrix);
  }
  root.add(snowMesh);

  const BUBBLE_COUNT = 36;
  const BUBBLE_HALF = 34;
  const bubbleMesh = new InstancedMesh(
    new SphereGeometry(0.11, 6, 5),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    BUBBLE_COUNT,
  );
  bubbleMesh.frustumCulled = false;
  const bubblePositions: Vector3[] = [];
  for (let i = 0; i < BUBBLE_COUNT; i += 1) {
    bubblePositions.push(new Vector3((rng() - 0.5) * 2 * BUBBLE_HALF, (rng() - 0.5) * 2 * BUBBLE_HALF, (rng() - 0.5) * 2 * BUBBLE_HALF));
    bubbleMesh.setColorAt(i, new Color(0.14, 0.2, 0.2).multiplyScalar(0.7 + rng() * 0.6));
  }
  root.add(bubbleMesh);

  const scratchQuaternion = new Quaternion();
  const SNOW_AXIS = new Vector3(0.36, 0.8, 0.48).normalize();
  const wrapAxis = (value: number, center: number, half: number) => {
    let d = value - center;
    const span = half * 2;
    d = ((d % span) + span * 1.5) % span - half;
    return center + d;
  };

  function updateParticles(dt: number, camera: PerspectiveCamera, elapsed: number) {
    for (let i = 0; i < SNOW_COUNT; i += 1) {
      const position = snowPositions[i];
      position.y -= dt * (0.25 + (i % 4) * 0.1);
      position.x += Math.sin(elapsed * 0.4 + i) * dt * 0.35;
      position.set(
        wrapAxis(position.x, camera.position.x, SNOW_HALF),
        wrapAxis(position.y, camera.position.y, SNOW_HALF),
        wrapAxis(position.z, camera.position.z, SNOW_HALF),
      );
      snowMesh.getMatrixAt(i, scratch);
      const scale = scratchScaleV.setFromMatrixScale(scratch);
      scratchQuaternion.setFromAxisAngle(SNOW_AXIS, snowSpin[i] + elapsed * 0.5);
      scratch.compose(position, scratchQuaternion, scale);
      snowMesh.setMatrixAt(i, scratch);
    }
    snowMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < BUBBLE_COUNT; i += 1) {
      const position = bubblePositions[i];
      position.y += dt * (2.0 + (i % 5) * 0.5);
      position.x += Math.sin(elapsed * 0.9 + i * 2.1) * dt * 0.5;
      position.set(
        wrapAxis(position.x, camera.position.x, BUBBLE_HALF),
        wrapAxis(position.y, camera.position.y, BUBBLE_HALF),
        wrapAxis(position.z, camera.position.z, BUBBLE_HALF),
      );
      scratch.makeTranslation(position.x, position.y, position.z);
      bubbleMesh.setMatrixAt(i, scratch);
    }
    bubbleMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- update -----------------------------------------------------------------

  const skinBase = skinMaterial.color.clone();
  const glowBase = BELL_GLOW.clone();

  function update(dt: number, context: EnvironmentUpdateContext) {
    const { elapsed, progress, beatEnergy, cleanse } = context;
    atmosphere(progress);

    // The bell breathes on a long period; the beat shivers its light.
    const breath = Math.sin(elapsed * 0.55) * 0.5 + 0.5;
    const pulse = 1 + breath * 0.035 + beatEnergy * 0.006;
    bell.scale.set(pulse, 1 + breath * 0.05, pulse);
    const glowLevel = 0.24 + breath * 0.08 + cleanse * 0.3 + beatEnergy * 0.05;
    glowMaterial.color.copy(hdr(glowBase, glowLevel));
    heartMaterial.color.copy(hdr(glowBase, glowLevel * 1.1));
    ribMaterial.color.copy(hdr(JELLY_GREEN.clone().lerp(JELLY_GOLD, cleanse * 0.5), 0.4 + cleanse * 0.5 + breath * 0.1));
    rimMaterial.color.copy(hdr(JELLY_GREEN.clone().lerp(JELLY_GOLD, cleanse * 0.4), 0.5 + cleanse * 0.45));
    skinMaterial.color.copy(skinBase).multiplyScalar(1 + cleanse * 0.7);

    // Strands: a slow luminous pulse travels across the colony group by
    // group; the cleanse turns their light from dim teal toward green-gold.
    // Per-strand tint lives in vertex colors; this multiplier is the pulse.
    for (const strand of strands) {
      const travel = Math.sin(elapsed * 0.8 + strand.phase) * 0.5 + 0.5;
      const lift = 0.7 + travel * 0.45 + beatEnergy * 0.1 * strand.glowBias;
      strand.material.color
        .setRGB(1, 1, 1)
        .lerp(new Color(1.5, 1.25, 0.65), cleanse * (0.4 + strand.glowBias * 0.25))
        .multiplyScalar(lift * (1 + cleanse * 0.5));
    }

    // The infestation dies back as the run cleanses the colony.
    noduleMaterial.opacity = Math.max(0, 1 - cleanse * 1.25);
    noduleMesh.visible = noduleMaterial.opacity > 0.02;

    // Sun shafts sway and brighten as the water clears.
    for (const shaft of shafts) {
      const sway = Math.sin(elapsed * 0.1 + shaft.phase);
      shaft.mesh.rotation.z = sway * 0.1;
      shaft.material.color.copy(hdr(SUN_SHAFT, shaft.base * (0.65 + progress * 0.6 + cleanse * 0.35) * (0.8 + 0.2 * Math.sin(elapsed * 0.5 + shaft.phase * 3))));
    }

    updateParticles(dt, context.camera, elapsed);
  }

  return {
    root,
    update,
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
}
