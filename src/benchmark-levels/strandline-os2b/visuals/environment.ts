import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAtmosphereRamp, scatterAlongRail } from '../../../engine/environment-kit';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import {
  BELL_CENTER,
  BELL_FADE_NEAR,
  BELL_RADIUS,
  BELL_VISIBLE_DISTANCE,
  CROWN_CENTER,
  createStrandlineRail,
} from '../world';
import {
  ABYSS,
  BELL_JADE,
  BELL_RIM,
  BIO_GOLD,
  BIO_GREEN,
  DEEP_WATER,
  MID_WATER,
  SUNLIT_WATER,
  SUNSHAFT,
  hdr,
} from './palette';
import { createStrand, setStrandLight, type StrandMaterials } from './strands';

// The world is three things at three scales: the water you are inside (a
// graded dome, drifting matter, and shafts of surface light), the forest of
// trailing strands you fly through, and the animal itself — one enormous
// dome hanging in the blue with the crown of roots beneath it.

export type EnvironmentUpdate = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  progress: number;
  beatEnergy: number;
  /** 0 → 1 as the infestation is cleared. Drives every light in the level. */
  revival: number;
  /** 0 → 1 through the coda, where the water clears for the wide final shot. */
  finale: number;
};

export type Environment = {
  root: Group;
  update(dt: number, context: EnvironmentUpdate): void;
  /** Flares the strand nearest a world point — used when a parasite dies on it. */
  flareNear(position: Vector3, amount: number): void;
  dispose(): void;
};

const STRAND_COUNT = 22;
const SHAFT_COUNT = 7;
const SNOW_COUNT = 620;
const SNOW_BOX = 46;

const rail = createStrandlineRail();

type StrandEntry = { materials: StrandMaterials; litBase: number; flare: number; group: Group };

export function createEnvironmentInternal(scene: Scene): Environment {
  let swayClock = 0;
  const root = new Group();
  root.name = 'strandline-environment';
  scene.add(root);

  scene.fog = new FogExp2(MID_WATER.getHex(), 0.0066);
  scene.background = DEEP_WATER.clone();
  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0.0, background: DEEP_WATER, fog: MID_WATER, density: 0.0072 },
    { progress: 0.28, background: DEEP_WATER, fog: MID_WATER, density: 0.0062 },
    // Open water: the murk thins and you can see the whole animal.
    { progress: 0.4, background: SUNLIT_WATER, fog: SUNLIT_WATER, density: 0.0032 },
    { progress: 0.5, background: DEEP_WATER, fog: MID_WATER, density: 0.0074 },
    { progress: 0.68, background: DEEP_WATER, fog: MID_WATER, density: 0.0062 },
    { progress: 0.88, background: DEEP_WATER, fog: MID_WATER, density: 0.0046 },
    { progress: 1.0, background: DEEP_WATER, fog: MID_WATER, density: 0.0034 },
  ]);

  // ---- the water itself ----------------------------------------------------
  const dome = createWaterDome();
  root.add(dome.mesh);

  const snow = createMarineSnow();
  root.add(snow.points);

  // ---- the strand forest ---------------------------------------------------
  const strandEntries: StrandEntry[] = [];
  const strandRng = mulberry32(0x5747);
  const strands = scatterAlongRail(rail, {
    count: STRAND_COUNT,
    seed: 0x5747,
    alignToRail: false,
    place: (_index, rng) => {
      // A ring of strands around the swim lane, never inside it.
      const angle = rng() * Math.PI * 2;
      const radius = 13 + rng() * 62;
      return {
        u: rng(),
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.45 + 24 + rng() * 40, 0),
      };
    },
    make: () => {
      const build = createStrand(strandRng);
      strandEntries.push({ materials: build.materials, litBase: build.litBase, flare: 0, group: build.group });
      return build.group;
    },
    window: { behind: 110, ahead: 300 },
    onUpdate: (item, dt) => {
      const group = item.object as Group;
      const sway = (group.userData.sway as number) ?? 0;
      const rate = (group.userData.swayRate as number) ?? 0.3;
      group.rotation.z = Math.sin(swayClock * rate + sway) * 0.07 + ((group.userData.baseRoll as number) ?? 0);
      void dt;
    },
  });
  for (const item of strands.items) {
    (item.object as Group).userData.baseRoll = (item.object as Group).rotation.z;
  }
  root.add(strands.group);

  // ---- sunlight from somewhere above --------------------------------------
  const shafts = scatterAlongRail(rail, {
    count: SHAFT_COUNT,
    seed: 0x1f3a,
    alignToRail: false,
    place: (_index, rng) => ({
      u: rng(),
      offset: new Vector3((rng() - 0.5) * 150, 55 + rng() * 40, 0),
    }),
    make: (_index, rng) => createSunShaft(38 + rng() * 46, 200 + rng() * 90),
    window: { behind: 60, ahead: 330 },
  });
  root.add(shafts.group);

  // ---- the animal ----------------------------------------------------------
  const animal = createAnimal();
  root.add(animal.group);

  const cameraPosition = new Vector3();
  const flareScratch = new Vector3();

  function update(dt: number, context: EnvironmentUpdate) {
    swayClock += dt;
    const camera = context.camera;
    cameraPosition.copy(camera.position);
    atmosphere(context.progress);
    // The coda pulls the camera hundreds of units back, so the murk has to
    // lift with it or the animal would be a silhouette in soup.
    if (scene.fog instanceof FogExp2 && context.finale > 0) {
      scene.fog.density = MathUtils.lerp(scene.fog.density, 0.0013, context.finale);
    }

    const railU = context.running ? context.progress : 0;
    strands.update(railU, dt);
    shafts.update(railU, dt);

    // Sun shafts stay edge-on-proof: they yaw to face the swimmer.
    for (const item of shafts.items) {
      const object = item.object;
      object.rotation.y = Math.atan2(cameraPosition.x - object.position.x, cameraPosition.z - object.position.z);
    }

    // Strand light: the level's whole mood is this one number.
    const breath = 0.5 + Math.sin(swayClock * 0.9) * 0.5;
    for (const entry of strandEntries) {
      entry.flare = Math.max(0, entry.flare - dt * 1.7);
      const lit = MathUtils.clamp(entry.litBase * (0.24 + context.revival * 0.86) + breath * 0.05, 0, 1);
      setStrandLight(entry.materials, lit, entry.flare + context.beatEnergy * 0.045);
    }

    dome.mesh.position.copy(cameraPosition);
    snow.update(dt, cameraPosition, context.beatEnergy);
    animal.update(dt, context, cameraPosition, swayClock);
  }

  function flareNear(position: Vector3, amount: number) {
    let best: StrandEntry | null = null;
    let bestDistance = Infinity;
    for (const entry of strandEntries) {
      if (!entry.group.visible) continue;
      const distance = flareScratch.copy(entry.group.position).setY(position.y).distanceToSquared(position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    if (best) best.flare = Math.min(1.6, best.flare + amount);
  }

  return {
    root,
    update,
    flareNear,
    dispose() {
      strands.dispose();
      shafts.dispose();
      root.removeFromParent();
      disposeObject3D(root);
      scene.fog = null;
      scene.background = null;
    },
  };
}

// ---- water dome -------------------------------------------------------------

function createWaterDome() {
  const geometry = new SphereGeometry(430, 28, 20);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const position = geometry.attributes.position;
  const top = SUNLIT_WATER.clone().multiplyScalar(1.05);
  const middle = MID_WATER.clone();
  const bottom = ABYSS.clone();
  const scratch = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const t = MathUtils.clamp(position.getY(i) / 430 * 0.5 + 0.5, 0, 1);
    if (t > 0.55) scratch.copy(middle).lerp(top, (t - 0.55) / 0.45);
    else scratch.copy(bottom).lerp(middle, t / 0.55);
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = -2;
  return { mesh, material };
}

// ---- marine snow ------------------------------------------------------------

function createMarineSnow() {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(SNOW_COUNT * 3);
  const drifts = new Float32Array(SNOW_COUNT * 3);
  const rng = mulberry32(0x9a12);
  for (let i = 0; i < SNOW_COUNT; i += 1) {
    positions[i * 3] = (rng() - 0.5) * 2 * SNOW_BOX;
    positions[i * 3 + 1] = (rng() - 0.5) * 2 * SNOW_BOX;
    positions[i * 3 + 2] = (rng() - 0.5) * 2 * SNOW_BOX;
    drifts[i * 3] = (rng() - 0.5) * 0.7;
    drifts[i * 3 + 1] = -0.35 - rng() * 0.6;
    drifts[i * 3 + 2] = (rng() - 0.5) * 0.7;
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: hdr(SUNSHAFT, 0.5),
    size: 0.3,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.3,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;

  function update(dt: number, cameraPosition: Vector3, beatEnergy: number) {
    const array = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < SNOW_COUNT; i += 1) {
      const base = i * 3;
      array[base] += drifts[base] * dt;
      array[base + 1] += drifts[base + 1] * dt;
      array[base + 2] += drifts[base + 2] * dt;
      // Wrap into a box that follows the swimmer, so density never changes.
      for (let axis = 0; axis < 3; axis += 1) {
        const delta = array[base + axis] - cameraPosition.getComponent(axis);
        if (Math.abs(delta) > SNOW_BOX) array[base + axis] -= Math.round(delta / (SNOW_BOX * 2)) * SNOW_BOX * 2;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    material.opacity = 0.26 + beatEnergy * 0.1;
  }

  return { points, update };
}

// ---- the animal --------------------------------------------------------------

function createAnimal() {
  const group = new Group();

  // The bell: a translucent dome graded from a lit crest to a dark margin,
  // wrapped in the radial canal structure that makes it read as an animal.
  const domeGeometry = new SphereGeometry(BELL_RADIUS, 44, 26, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const domeColors = new Float32Array(domeGeometry.attributes.position.count * 3);
  const domePosition = domeGeometry.attributes.position;
  // The rail is always under the animal, so the margin is the lit edge and the
  // crest is the dark mass of the bell above it.
  const crest = BELL_JADE.clone().multiplyScalar(0.26);
  const flank = BELL_JADE.clone().multiplyScalar(1.05);
  const margin = BELL_RIM.clone().multiplyScalar(1.0);
  const scratch = new Color();
  for (let i = 0; i < domePosition.count; i += 1) {
    const t = MathUtils.clamp(domePosition.getY(i) / BELL_RADIUS, 0, 1);
    if (t > 0.6) scratch.copy(flank).lerp(crest, (t - 0.6) / 0.4);
    else scratch.copy(margin).lerp(flank, t / 0.6);
    domeColors[i * 3] = scratch.r;
    domeColors[i * 3 + 1] = scratch.g;
    domeColors[i * 3 + 2] = scratch.b;
  }
  domeGeometry.setAttribute('color', new BufferAttribute(domeColors, 3));
  const domeMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    side: DoubleSide,
    fog: false,
  });
  const dome = new Mesh(domeGeometry, domeMaterial);
  dome.position.copy(BELL_CENTER);
  group.add(dome);

  // Radial canals, as a wire shell just off the surface.
  const canalMaterial = createAdditiveBasicMaterial({ color: hdr(BIO_GREEN, 0.5), opacity: 0.35 });
  canalMaterial.wireframe = true;
  canalMaterial.fog = false;
  const canals = new Mesh(
    new SphereGeometry(BELL_RADIUS * 1.006, 22, 11, 0, Math.PI * 2, 0, Math.PI * 0.52),
    canalMaterial,
  );
  canals.position.copy(BELL_CENTER);
  group.add(canals);

  // The margin: a bright ring of light around the bell's rim.
  const rimMaterial = createAdditiveBasicMaterial({ color: hdr(BELL_RIM, 0.85), opacity: 0.7, side: DoubleSide });
  rimMaterial.fog = false;
  const rim = new Mesh(new CylinderGeometry(BELL_RADIUS * 0.93, BELL_RADIUS * 0.97, 5.5, 60, 1, true), rimMaterial);
  rim.position.copy(BELL_CENTER).y += BELL_RADIUS * Math.cos(Math.PI * 0.52);
  group.add(rim);

  // Halo: the glow the bell pushes into the water around it.
  const halo = createRadialDisc(BELL_RADIUS * 1.85, hdr(BELL_JADE, 0.6));
  halo.position.copy(BELL_CENTER);
  halo.renderOrder = -1;
  group.add(halo);

  // Oral arms: broad ribbons hanging under the bell, distinct from the strands.
  const armMaterial = createAdditiveBasicMaterial({ color: hdr(BELL_JADE, 0.42), opacity: 0.4, side: DoubleSide });
  armMaterial.fog = false;
  const arms: BufferGeometry[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    const radius = BELL_RADIUS * 0.34;
    const plane = new PlaneGeometry(26, 210, 1, 1);
    arms.push(plane.applyMatrix4(
      new Matrix4()
        .makeTranslation(Math.cos(angle) * radius, -125, Math.sin(angle) * radius)
        .multiply(new Matrix4().makeRotationY(-angle)),
    ));
  }
  const armMesh = new Mesh(mergeGeometries(arms), armMaterial);
  armMesh.position.copy(BELL_CENTER);
  group.add(armMesh);
  for (const geometry of arms) geometry.dispose();

  // The crown: the thick knot of roots where every strand enters the bell.
  const crownMaterial = createAdditiveBasicMaterial({ color: hdr(BIO_GOLD, 0.3), opacity: 0.3 });
  const roots: BufferGeometry[] = [];
  // The roots run the whole way down from the bell's margin past the swim
  // lane, so the parent fight happens inside the bundle rather than under it.
  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2;
    const spread = 20 + (i % 3) * 11;
    roots.push(new CylinderGeometry(3.4, 0.9, 300, 4, 1, true).applyMatrix4(
      new Matrix4()
        .makeTranslation(Math.cos(angle) * spread, 60, Math.sin(angle) * spread)
        .multiply(new Matrix4().makeRotationZ(Math.cos(angle) * 0.16))
        .multiply(new Matrix4().makeRotationX(-Math.sin(angle) * 0.16)),
    ));
  }
  const crown = new Mesh(mergeGeometries(roots), crownMaterial);
  crown.position.copy(CROWN_CENTER);
  group.add(crown);
  for (const geometry of roots) geometry.dispose();

  const haloMaterial = halo.material as MeshBasicMaterial;

  function update(dt: number, context: EnvironmentUpdate, cameraPosition: Vector3, clock: number) {
    void dt;
    const distance = cameraPosition.distanceTo(BELL_CENTER);
    // Nothing this large should pop into being: it surfaces out of the blue as
    // the rail leaves the forest, and it is fogless so the murk cannot eat it.
    const visibility = MathUtils.clamp(
      (BELL_VISIBLE_DISTANCE - distance) / (BELL_VISIBLE_DISTANCE - BELL_FADE_NEAR),
      0,
      1,
    );
    group.visible = visibility > 0.002;
    if (!group.visible) return;

    // Slow bell contraction — the animal is swimming, not floating.
    const pulse = Math.sin(clock * 0.52) * 0.5 + 0.5;
    const squash = 1 + pulse * 0.024;
    dome.scale.set(1 / squash, squash, 1 / squash);
    canals.scale.copy(dome.scale);
    rim.scale.set(1 / squash, 1, 1 / squash);
    halo.lookAt(cameraPosition);

    const life = 0.42 + context.revival * 0.72;
    domeMaterial.opacity = 0.9 * visibility;
    canalMaterial.opacity = (0.3 + 0.34 * life + pulse * 0.1) * visibility;
    canalMaterial.color.copy(hdr(BIO_GREEN, 0.32 + life * 0.55));
    rimMaterial.opacity = (0.34 + 0.3 * life) * visibility;
    rimMaterial.color.copy(hdr(BELL_RIM, 0.4 + life * 0.5 + pulse * 0.1));
    haloMaterial.opacity = (0.14 + 0.16 * life) * visibility;
    haloMaterial.color.copy(hdr(BELL_JADE, 0.35 + life * 0.4));
    armMaterial.opacity = (0.16 + 0.26 * life) * visibility;
    crownMaterial.opacity = (0.14 + 0.2 * life) * visibility;
    crownMaterial.color.copy(hdr(BIO_GOLD, 0.22 + life * 0.4));
  }

  return { group, update };
}

/**
 * A shaft of surface light: a tall plane, brightest at the top and gone by the
 * bottom, faded at both vertical edges so it has no visible border in water.
 */
function createSunShaft(width: number, height: number) {
  const geometry = new PlaneGeometry(width, height, 4, 4);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const tint = hdr(SUNSHAFT, 0.15);
  for (let i = 0; i < position.count; i += 1) {
    const u = MathUtils.clamp(Math.abs(position.getX(i)) / (width * 0.5), 0, 1);
    const v = MathUtils.clamp(position.getY(i) / (height * 0.5) * 0.5 + 0.5, 0, 1);
    const strength = (1 - u) ** 1.6 * v ** 1.7;
    colors[i * 3] = tint.r * strength;
    colors[i * 3 + 1] = tint.g * strength;
    colors[i * 3 + 2] = tint.b * strength;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = createAdditiveBasicMaterial({ color: new Color(1, 1, 1), opacity: 0.34, side: DoubleSide });
  material.vertexColors = true;
  const mesh = new Mesh(geometry, material);
  mesh.rotation.z = 0.06;
  return mesh;
}

/** An additive disc that is bright at the middle and gone at the rim. */
function createRadialDisc(radius: number, color: Color) {
  const segments = 48;
  const positions: number[] = [0, 0, 0];
  const colors: number[] = [color.r, color.g, color.b];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    colors.push(0, 0, 0);
    if (i > 0) indices.push(0, i, i + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = createAdditiveBasicMaterial({ color: new Color(1, 1, 1), opacity: 0.25, side: DoubleSide });
  material.vertexColors = true;
  material.fog = false;
  return new Mesh(geometry, material);
}
