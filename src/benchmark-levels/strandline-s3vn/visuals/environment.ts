import {
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { createAtmosphereRamp, scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { createStrandlineRail } from '../gameplay';
import { createAnimal, type Animal } from './animal';
import { DEEP_WATER, MID_WATER, OPEN_WATER, SUNLIT_WATER, SURFACE_LIGHT, hdr } from './palette';

// The water. Two nested domes carry the colour — a deep base and a sunlit
// gradient washing down from above — with volumetric shafts hanging through it
// and plankton streaming past the camera to make the glide legible. Everything
// is depth-write-free or additive: the world is water, and water never hides a
// target from you.

const SHAFT_COUNT = 16;
const MOTE_COUNT = 420;
const MOTE_RANGE = 46;
const SKY_RADIUS = 1400;

export type EnvironmentUpdate = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  /** Normalized run time, used for the water's colour arc. */
  arc: number;
  /** Rail parameter the camera occupies, used to recycle scenery. */
  railU: number;
  /** Where the animal's crown belongs this frame. */
  crown: Vector3;
  life: number;
  pulse: number;
  drift: number;
  beatEnergy: number;
};

export type Environment = {
  root: Group;
  animal: Animal;
  update(dt: number, context: EnvironmentUpdate): void;
  dispose(): void;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  const rng = mulberry32(0x517a2d);
  const root = new Group();
  root.name = 'water';
  scene.add(root);

  scene.fog = new FogExp2(SUNLIT_WATER.getHex(), 0.0042);
  scene.background = new Color().copy(DEEP_WATER);

  // Clear blue-green near, deep blue far; the open-water bar clears it right
  // out so the animal can be seen whole, and the coda opens it further still.
  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0.00, background: DEEP_WATER, fog: SUNLIT_WATER.clone().multiplyScalar(0.8), density: 0.0042 },
    { progress: 0.28, background: DEEP_WATER, fog: SUNLIT_WATER.clone().multiplyScalar(0.7), density: 0.0038 },
    { progress: 0.34, background: DEEP_WATER, fog: OPEN_WATER, density: 0.0020 },
    { progress: 0.46, background: DEEP_WATER, fog: OPEN_WATER.clone().multiplyScalar(0.85), density: 0.0026 },
    { progress: 0.62, background: DEEP_WATER, fog: MID_WATER, density: 0.0041 },
    { progress: 0.72, background: DEEP_WATER, fog: MID_WATER.clone().multiplyScalar(0.85), density: 0.0045 },
    { progress: 0.89, background: DEEP_WATER, fog: MID_WATER, density: 0.0038 },
    // The clear: the water opens right up so the animal stays legible as it
    // pulls away, instead of dissolving into haze at four hundred units.
    { progress: 0.93, background: DEEP_WATER, fog: OPEN_WATER, density: 0.0018 },
    { progress: 1.00, background: DEEP_WATER, fog: OPEN_WATER, density: 0.0005 },
  ]);

  // ---- the water column ----------------------------------------------------------
  const deepDomeMaterial = new MeshBasicMaterial({
    color: DEEP_WATER.clone(),
    side: BackSide,
    depthWrite: false,
    fog: false,
    transparent: true,
  });
  const deepDome = new Mesh(new SphereGeometry(SKY_RADIUS, 24, 16), deepDomeMaterial);
  deepDome.renderOrder = -2;
  deepDome.frustumCulled = false;
  deepDome.userData.raildIgnoreOcclusion = true;
  root.add(deepDome);

  const lightDomeGeometry = new SphereGeometry(SKY_RADIUS * 0.96, 24, 16);
  paintVerticalRamp(lightDomeGeometry, SKY_RADIUS * 0.96);
  const lightDomeMaterial = createAdditiveBasicMaterial({ color: hdr(SUNLIT_WATER, 1.0), side: BackSide });
  lightDomeMaterial.vertexColors = true;
  lightDomeMaterial.fog = false;
  const lightDome = new Mesh(lightDomeGeometry, lightDomeMaterial);
  lightDome.renderOrder = -1;
  lightDome.frustumCulled = false;
  root.add(lightDome);

  // ---- sun shafts ------------------------------------------------------------------
  const rail = createStrandlineRail();
  const shaftGeometry = buildShaftGeometry();
  const shaftMaterial = createAdditiveBasicMaterial({ color: hdr(SURFACE_LIGHT, 0.05), side: DoubleSide });
  shaftMaterial.vertexColors = true;

  let shaftCamera: PerspectiveCamera | null = null;
  const shafts: ScatterField = scatterAlongRail(rail, {
    count: SHAFT_COUNT,
    seed: 0x2b81f,
    alignToRail: false,
    window: { behind: 90, ahead: 520 },
    place: (_index, random) => ({
      u: random(),
      offset: new Vector3((random() - 0.5) * 320, 60 + random() * 150, 0),
    }),
    make: (_index, random) => {
      const mesh = new Mesh(shaftGeometry, shaftMaterial);
      mesh.scale.set(7 + random() * 15, 220 + random() * 220, 1);
      mesh.frustumCulled = false;
      return mesh;
    },
    onUpdate: (item) => {
      if (!shaftCamera) return;
      // Billboard around the vertical: a shaft of light has no side to it.
      item.object.rotation.set(0, Math.atan2(
        shaftCamera.position.x - item.object.position.x,
        shaftCamera.position.z - item.object.position.z,
      ), 0);
    },
  });
  root.add(shafts.group);

  // ---- plankton -----------------------------------------------------------------------
  const motes = new InstancedMesh(
    new SphereGeometry(0.085, 4, 3),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    MOTE_COUNT,
  );
  motes.frustumCulled = false;
  root.add(motes);
  const motePositions: Vector3[] = [];
  const moteSpeeds: number[] = [];
  const moteSizes: number[] = [];
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    motePositions.push(new Vector3((rng() - 0.5) * 2 * MOTE_RANGE, (rng() - 0.5) * 2 * MOTE_RANGE, (rng() - 0.5) * 2 * MOTE_RANGE));
    moteSpeeds.push(0.5 + rng() * 1.6);
    moteSizes.push(0.5 + rng() * 1.5);
  }

  const moteMatrix = new Matrix4();
  const moteScale = new Vector3();
  const moteColor = new Color();
  const identity = new Quaternion();
  const cameraPosition = new Vector3();

  const animal = createAnimal();
  root.add(animal.group);

  function update(dt: number, context: EnvironmentUpdate) {
    const { camera } = context;
    shaftCamera = camera;
    atmosphere(context.arc);

    cameraPosition.copy(camera.position);
    deepDome.position.copy(cameraPosition);
    lightDome.position.copy(cameraPosition);

    const surfaceGlow = 0.6 + context.life * 0.5 + context.beatEnergy * 0.12;
    lightDomeMaterial.color.copy(SUNLIT_WATER).lerp(OPEN_WATER, 0.3).multiplyScalar(surfaceGlow * (1 + context.drift * 0.35));
    deepDomeMaterial.color.copy(DEEP_WATER).multiplyScalar(1 + context.drift * 0.6);
    shaftMaterial.color.copy(SURFACE_LIGHT).multiplyScalar(0.045 + context.beatEnergy * 0.012 + context.life * 0.022);

    shafts.update(context.railU, dt);

    // Plankton: it does not move, you do. Recycling in a box around the camera
    // keeps a constant density of near-field parallax at any speed.
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      const position = motePositions[i];
      const relative = position.clone().sub(cameraPosition);
      if (Math.abs(relative.x) > MOTE_RANGE) position.x -= Math.sign(relative.x) * MOTE_RANGE * 2;
      if (Math.abs(relative.y) > MOTE_RANGE) position.y -= Math.sign(relative.y) * MOTE_RANGE * 2;
      if (Math.abs(relative.z) > MOTE_RANGE) position.z -= Math.sign(relative.z) * MOTE_RANGE * 2;
      position.y += moteSpeeds[i] * dt * 0.6;
      position.x += Math.sin(context.elapsed * 0.5 + i) * dt * 0.4;

      const size = moteSizes[i];
      moteScale.setScalar(size);
      moteMatrix.compose(position, identity, moteScale);
      motes.setMatrixAt(i, moteMatrix);
      const twinkle = 0.35 + Math.abs(Math.sin(context.elapsed * 1.4 + i * 2.3)) * 0.65;
      moteColor.copy(SURFACE_LIGHT).multiplyScalar(twinkle * (0.28 + context.life * 0.3));
      motes.setColorAt(i, moteColor);
    }
    motes.instanceMatrix.needsUpdate = true;
    if (motes.instanceColor) motes.instanceColor.needsUpdate = true;

    animal.update(dt, {
      camera,
      crown: context.crown,
      elapsed: context.elapsed,
      life: context.life,
      pulse: context.pulse,
      drift: context.drift,
    });
  }

  return {
    root,
    animal,
    update,
    dispose() {
      shafts.dispose();
      animal.dispose();
      shaftGeometry.dispose();
      shaftMaterial.dispose();
      root.removeFromParent();
      disposeObject3D(root);
      root.clear();
      scene.fog = null;
      scene.background = null;
    },
  };
}

/**
 * A single shaft: four columns wide so it can fade to nothing at both side
 * edges as well as at the bottom. A hard-edged quad reads as a wall; a shaft
 * of light in water has no edges at all.
 */
function buildShaftGeometry() {
  const columns = [-0.5, -0.16, 0.16, 0.5];
  const across = [0, 1, 1, 0];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const [index, x] of columns.entries()) {
    positions.push(x, 0.5, 0, x, -0.5, 0);
    colors.push(across[index], across[index], across[index], 0, 0, 0);
  }
  for (let i = 0; i < columns.length - 1; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Sunlight arriving from above: full strength at the zenith, gone below the horizon. */
function paintVerticalRamp(geometry: BufferGeometry, radius: number) {
  const position = geometry.getAttribute('position');
  const colors: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i) / radius;
    const ramp = Math.max(0, Math.min(1, (y + 0.25) / 1.25)) ** 2.1;
    colors.push(ramp, ramp, ramp);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}
