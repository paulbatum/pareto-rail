import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
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
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import {
  createAtmosphereRamp,
  scatterAlongRail,
  type ScatterField,
} from '../../../engine/environment-kit';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { createSkyhookRail, skyhookRunProgress } from '../gameplay';
import { SKYHOOK_MARKERS } from '../timing';
import { hdr, mulberry32, SIGNAL_AMBER } from './palette';

// The sky does the colouring. The atmosphere ramp carries the whole altitude arc
// — storm grey-blue → sunlit blue → indigo → black — while scenery fields supply
// the motion: rain and wisps low, debris the whole way up, stars and the planet
// limb high. Everything that could cross a target is additive or sub-0.35 opacity
// (never an occluder); the planet limb is flagged raildIgnoreOcclusion.

// Sky keyframe colours (see design doc palette discipline).
const STORM_SKY = 0x2b3138;
const CLOUD_SKY = 0x9fb0c4;
const SUNLIT_BLUE = 0x4d84c9;
const DEEP_BLUE = 0x27508f;
const INDIGO = 0x1b2450;
const NEAR_BLACK = 0x05060d;
const SPACE_BLACK = 0x02030a;

const RAIN_SPAN = 34;
const RAIN_BACK = 17;
const DEBRIS_COUNT = 160;
const DEBRIS_RANGE = 26;
const STAR_COUNT = 620;

// Module-scope uniforms written by the runtime each frame.
const rainOffsetUniform = uniform(0);
const rainFadeUniform = uniform(0);
const planetRimUniform = uniform(0);

let lightningEnergy = 0;

export type Environment = {
  root: Group;
  ramp: (progress: number) => void;
  rain: Group;
  wisps: ScatterField;
  cloudPunch: Mesh;
  cloudFloor: Mesh;
  lightningPlane: Mesh;
  debris: InstancedMesh;
  debrisState: Array<{ offset: Vector3; fall: number; size: number }>;
  stars: Points;
  starMaterial: PointsMaterial;
  planet: Group;
  punchProgress: number;
  thinProgress: number;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  const curve = createSkyhookRail();
  const rng = mulberry32(0x5c7a11);

  scene.background = new Color(STORM_SKY);
  scene.fog = new FogExp2(STORM_SKY, 0.02);

  const punchProgress = skyhookRunProgress(SKYHOOK_MARKERS.cloudPunch);
  const thinProgress = skyhookRunProgress(SKYHOOK_MARKERS.thinAir);

  const ramp = createAtmosphereRamp(scene, [
    { progress: 0, background: STORM_SKY, fog: STORM_SKY, density: 0.02 },
    { progress: Math.max(0.01, punchProgress - 0.03), background: STORM_SKY, fog: 0x3a444d, density: 0.024 },
    { progress: punchProgress, background: CLOUD_SKY, fog: CLOUD_SKY, density: 0.05 },
    { progress: punchProgress + 0.03, background: SUNLIT_BLUE, fog: SUNLIT_BLUE, density: 0.01 },
    { progress: (punchProgress + thinProgress) / 2, background: DEEP_BLUE, fog: DEEP_BLUE, density: 0.005 },
    { progress: thinProgress, background: INDIGO, fog: INDIGO, density: 0.0022 },
    { progress: 0.8, background: NEAR_BLACK, fog: NEAR_BLACK, density: 0.0008 },
    { progress: 1, background: SPACE_BLACK, fog: SPACE_BLACK, density: 0.0004 },
  ]);

  const root = new Group();

  const rain = createRain(rng);
  root.add(rain);

  const wisps = createWisps(curve, rng);
  root.add(wisps.group);

  const { cloudPunch, cloudFloor } = createCloudDeck(curve, punchProgress);
  root.add(cloudPunch, cloudFloor);

  const lightningPlane = createLightningPlane(curve, punchProgress);
  root.add(lightningPlane);

  const { debris, debrisState } = createDebris(rng);
  root.add(debris);

  const { stars, starMaterial } = createStars(curve, rng);
  root.add(stars);

  const planet = createPlanetLimb(curve);
  root.add(planet);

  scene.add(root);

  return {
    root,
    ramp,
    rain,
    wisps,
    cloudPunch,
    cloudFloor,
    lightningPlane,
    debris,
    debrisState,
    stars,
    starMaterial,
    planet,
    punchProgress,
    thinProgress,
  };
}

// ---- rain --------------------------------------------------------------------

function createRain(rng: () => number): Group {
  const COUNT = 320;
  const positions: number[] = [];
  const y0: number[] = [];
  const dy: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 2 + rng() * 12;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const start = rng() * RAIN_SPAN;
    const length = 1.6 + rng() * 2.4;
    const shade = 0.35 + rng() * 0.4;
    for (const delta of [0, -length]) {
      positions.push(x, 0, z);
      y0.push(start);
      dy.push(delta);
      colors.push(shade * 0.72, shade * 0.8, shade);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('y0', new Float32BufferAttribute(y0, 1));
  geometry.setAttribute('dy', new Float32BufferAttribute(dy, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const wrapped = attribute<'float'>('y0', 'float').add(rainOffsetUniform).mod(RAIN_SPAN).sub(RAIN_BACK);
  const finalY = wrapped.add(attribute<'float'>('dy', 'float'));
  // Wind shear slants the rain as it falls.
  material.positionNode = vec3(positionLocal.x.add(finalY.mul(-0.32)), finalY, positionLocal.z);
  const envelope = smoothstep(float(-RAIN_BACK), float(-RAIN_BACK + 6), wrapped).mul(
    smoothstep(float(RAIN_SPAN - RAIN_BACK), float(RAIN_SPAN - RAIN_BACK - 5), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(rainFadeUniform);

  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  const group = new Group();
  group.add(lines);
  return group;
}

// ---- cloud wisps -------------------------------------------------------------

function createWisps(curve: ReturnType<typeof createSkyhookRail>, rng: () => number): ScatterField {
  const geometry = new PlaneGeometry(1, 1);
  return scatterAlongRail(curve, {
    count: 16,
    seed: 0x1a2b,
    rng,
    window: { behind: 6, ahead: 120 },
    alignToRail: false,
    make() {
      const material = new MeshBasicMaterial({
        color: new Color(0.12, 0.13, 0.15),
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: DoubleSide,
      });
      const wisp = new Mesh(geometry, material);
      const scale = 6 + rng() * 10;
      wisp.scale.set(scale, scale * (0.35 + rng() * 0.3), 1);
      return wisp;
    },
    place(_index, placeRng) {
      const side = placeRng() < 0.5 ? -1 : 1;
      return {
        u: placeRng(),
        offset: new Vector3(side * (4 + placeRng() * 12), (placeRng() - 0.5) * 10, 0),
      };
    },
  });
}

// ---- cloud deck --------------------------------------------------------------

function createCloudDeck(curve: ReturnType<typeof createSkyhookRail>, punchProgress: number) {
  const frame = sampleRailFrame(curve, punchProgress);

  // The slab the rail punches through: a bright additive wall across the path.
  const punchMaterial = new MeshBasicMaterial(additiveMaterialParameters({
    color: hdr(new Color(0.7, 0.76, 0.84), 0.9),
    opacity: 0.55,
    side: DoubleSide,
  }));
  const cloudPunch = new Mesh(new PlaneGeometry(260, 90), punchMaterial);
  cloudPunch.position.copy(frame.position);
  cloudPunch.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
  cloudPunch.visible = false;

  // The deck seen from above: a rolling floor that falls away below and behind.
  const floorMaterial = new MeshBasicMaterial({
    color: new Color(0.62, 0.68, 0.78),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: DoubleSide,
  });
  const cloudFloor = new Mesh(new PlaneGeometry(900, 900, 1, 1), floorMaterial);
  cloudFloor.rotation.x = -Math.PI / 2;
  cloudFloor.position.copy(frame.position).addScaledVector(frame.up, -40);
  cloudFloor.visible = false;

  return { cloudPunch, cloudFloor };
}

function createLightningPlane(curve: ReturnType<typeof createSkyhookRail>, punchProgress: number): Mesh {
  const frame = sampleRailFrame(curve, Math.min(1, punchProgress * 0.6));
  const material = new MeshBasicMaterial(additiveMaterialParameters({
    color: new Color(0.5, 0.56, 0.68),
    opacity: 0,
  }));
  const plane = new Mesh(new PlaneGeometry(220, 160), material);
  plane.position.copy(frame.position).addScaledVector(frame.tangent, -40).addScaledVector(frame.up, 20);
  plane.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
  return plane;
}

// ---- falling debris ----------------------------------------------------------

function createDebris(rng: () => number) {
  const material = new MeshBasicMaterial(additiveMaterialParameters({ color: 0xffffff }));
  const debris = new InstancedMesh(new TetrahedronGeometry(0.14, 0), material, DEBRIS_COUNT);
  debris.frustumCulled = false;
  const debrisState: Environment['debrisState'] = [];
  const colorWhite = new Color(0.9, 0.92, 0.98);
  for (let i = 0; i < DEBRIS_COUNT; i += 1) {
    debrisState.push({
      offset: new Vector3((rng() - 0.5) * DEBRIS_RANGE, (rng() - 0.5) * DEBRIS_RANGE, (rng() - 0.5) * DEBRIS_RANGE),
      fall: 8 + rng() * 12,
      size: 0.4 + rng() * 0.9,
    });
    const tint = rng() < 0.7 ? colorWhite : SIGNAL_AMBER;
    debris.setColorAt(i, tint.clone().multiplyScalar(0.3 + rng() * 0.5));
  }
  if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
  return { debris, debrisState };
}

// ---- stars -------------------------------------------------------------------

function createStars(curve: ReturnType<typeof createSkyhookRail>, rng: () => number) {
  const center = sampleRailFrame(curve, 0.85).position;
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = 340 + rng() * 120;
    positions[i * 3] = center.x + Math.cos(angle) * r * radius;
    positions[i * 3 + 1] = center.y + z * radius;
    positions[i * 3 + 2] = center.z + Math.sin(angle) * r * radius;
    const warm = rng() < 0.15;
    const intensity = 0.5 + rng() * 0.9;
    colors[i * 3] = intensity;
    colors[i * 3 + 1] = intensity * (warm ? 0.9 : 0.97);
    colors[i * 3 + 2] = intensity * (warm ? 0.8 : 1.0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const starMaterial = new PointsMaterial({
    size: 1.5,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const stars = new Points(geometry, starMaterial);
  stars.frustumCulled = false;
  stars.userData.raildIgnoreOcclusion = true;
  return { stars, starMaterial };
}

// ---- planet limb -------------------------------------------------------------

function createPlanetLimb(curve: ReturnType<typeof createSkyhookRail>): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  // Sit the planet far below the lower rail so only its curved limb shows low in
  // frame; as the camera climbs it recedes and sinks.
  const base = sampleRailFrame(curve, 0.05).position;
  const planetRadius = 620;
  const center = base.clone().addScaledVector(new Vector3(0, 1, 0), -planetRadius - 120);

  const bodyMaterial = new MeshBasicNodeMaterial();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const litSide = normalWorld.dot(vec3(0.4, 0.7, 0.3).normalize()).max(0);
  const dayColor = vec3(0.12, 0.2, 0.34).mul(litSide.mul(1.4).add(0.15));
  bodyMaterial.colorNode = dayColor.mul(planetRimUniform.mul(0.9).add(0.1));
  const body = new Mesh(new SphereGeometry(planetRadius, 64, 48), bodyMaterial);
  body.position.copy(center);
  group.add(body);

  // Atmosphere rim: an additive fresnel shell that reads as the horizon glow.
  const rimMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  const rim = float(1).sub(normalWorld.dot(viewDir).abs()).pow(2.4);
  rimMaterial.colorNode = vec3(0.35, 0.6, 1.0).mul(rim).mul(planetRimUniform.mul(1.6));
  const atmosphere = new Mesh(new SphereGeometry(planetRadius * 1.02, 64, 48), rimMaterial);
  atmosphere.position.copy(center);
  group.add(atmosphere);

  return group;
}

// ---- per-frame ---------------------------------------------------------------

export function triggerLightning(strength = 1) {
  lightningEnergy = Math.max(lightningEnergy, strength);
}

export function updateEnvironment(
  env: Environment,
  frame: { dt: number; elapsed: number; progress: number; speed: number; camera: PerspectiveCamera; running: boolean },
) {
  const { dt, elapsed, progress, speed, camera } = frame;

  env.ramp(progress);

  // Rain: world-aligned streaks around the camera, only in the storm.
  env.rain.position.copy(camera.position);
  rainOffsetUniform.value = (rainOffsetUniform.value + dt * (10 + speed * 22)) % 100000;
  const stormFade = 1 - smoothstep01((progress - env.punchProgress * 0.7) / Math.max(0.001, env.punchProgress * 0.4));
  rainFadeUniform.value = stormFade * 0.9;

  // Wisps whip past on the rail; fade them out above the deck.
  env.wisps.update(progress, dt);
  const wispFade = 1 - smoothstep01((progress - env.punchProgress) / 0.08);
  env.wisps.forEach((item) => {
    item.object.quaternion.copy(camera.quaternion);
    const material = (item.object as Mesh).material as MeshBasicMaterial;
    material.opacity = 0.3 * wispFade;
    item.object.visible = item.object.visible && wispFade > 0.02;
  });

  // Cloud deck punch window + the floor falling away afterward.
  const punchBand = 1 - Math.min(1, Math.abs(progress - env.punchProgress) / 0.05);
  env.cloudPunch.visible = punchBand > 0.02;
  (env.cloudPunch.material as MeshBasicMaterial).opacity = 0.6 * punchBand;
  const aboveDeck = smoothstep01((progress - env.punchProgress) / 0.12);
  env.cloudFloor.visible = aboveDeck > 0.02 && progress < 0.85;
  (env.cloudFloor.material as MeshBasicMaterial).opacity = 0.3 * aboveDeck * (1 - smoothstep01((progress - 0.6) / 0.25));

  // Lightning flashes inside the storm clouds.
  lightningEnergy = Math.max(0, lightningEnergy - dt * 3.2);
  (env.lightningPlane.material as MeshBasicMaterial).opacity = lightningEnergy * 0.55 * stormFade;
  env.lightningPlane.visible = lightningEnergy > 0.01 && stormFade > 0.05;

  // Falling debris: camera-relative chips streaking DOWN and drifting back.
  updateDebris(env, dt, elapsed, speed, progress, camera);

  // Stars fade in high; the planet limb glows once above the weather.
  env.starMaterial.opacity = smoothstep01((progress - 0.5) / 0.25) * 0.95;
  planetRimUniform.value = smoothstep01((progress - env.punchProgress) / 0.2);
}

const debrisMatrix = new Matrix4();
const debrisPos = new Vector3();
const debrisQuat = new Quaternion();
const debrisScale = new Vector3();
const debrisAxis = new Vector3(0.3, 1, 0.2).normalize();

function updateDebris(env: Environment, dt: number, elapsed: number, speed: number, progress: number, camera: PerspectiveCamera) {
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const spin = debrisQuat.setFromAxisAngle(debrisAxis, elapsed);
  // Fewer chips up top (sparse glints); denser in the storm.
  const active = Math.round((1 - progress * 0.55) * DEBRIS_COUNT);
  for (let i = 0; i < DEBRIS_COUNT; i += 1) {
    const chip = env.debrisState[i];
    // Fall in world down, drift backward along travel (world falls away).
    chip.offset.y -= (chip.fall + speed * 10) * dt;
    chip.offset.addScaledVector(forward, -speed * 6 * dt);
    if (chip.offset.y < -DEBRIS_RANGE || chip.offset.lengthSq() > DEBRIS_RANGE * DEBRIS_RANGE * 3) {
      chip.offset.set((Math.random() - 0.5) * DEBRIS_RANGE, DEBRIS_RANGE, (Math.random() - 0.5) * DEBRIS_RANGE);
      chip.offset.addScaledVector(forward, DEBRIS_RANGE * 0.5);
    }
    debrisPos.copy(camera.position).add(chip.offset);
    debrisScale.setScalar(i < active ? chip.size : 0);
    debrisMatrix.compose(debrisPos, spin, debrisScale);
    env.debris.setMatrixAt(i, debrisMatrix);
  }
  env.debris.instanceMatrix.needsUpdate = true;
}

export function resetEnvironment(env: Environment) {
  rainOffsetUniform.value = 0;
  lightningEnergy = 0;
  env.starMaterial.opacity = 0;
  planetRimUniform.value = 0;
  (env.lightningPlane.material as MeshBasicMaterial).opacity = 0;
  env.cloudPunch.visible = false;
  env.cloudFloor.visible = false;
}

function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
