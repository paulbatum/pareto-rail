import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  Line,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, float, mix, mx_noise_float, positionLocal, positionWorld, smoothstep, step, time, uniform, uv, vec3 } from 'three/tsl';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { bar, DECK_U, railU, STATION_MOUTH_U } from '../gameplay';
import { RAIL_BASIS, RAIL_DIRECTION, RAIL_LENGTH, TETHER_OFFSET, railPoint } from '../rail';
import { createLightMaterial, createPanelMaterial, groundLightUniform, setColorUniform, skyLightUniform, sunDirectionUniform, sunLightUniform } from './materials';
import { HAZARD_ORANGE, hdr, INSTRUMENT, mulberry32, PANEL, PANEL_DARK, SKY, SUN_WHITE, type Rng } from './palette';

// The world is the sky. A camera-centred dome carries the gradient from storm
// grey through sunlit blue and indigo to black; a camera-relative backdrop disc
// is the cloud tops and then the planet's limb; real geometry — the cloud deck,
// puffs, debris, the tether with its collars, the station — falls past the
// climber to sell the speed. All of it is keyed on `skyPhaseUniform`:
// 0 storm, 1 sunlit, 2 indigo, 3 black.

export const skyPhaseUniform = uniform(0);
export const lightningUniform = uniform(0);
export const cameraRightUniform = uniform(new Vector3(1, 0, 0));
export const cameraUpUniform = uniform(new Vector3(0, 1, 0));
const puffAlphaUniform = uniform(1);

const DOME_RADIUS = 430;
const BACKDROP_DISTANCE = 360;
const SUN_DIRECTION = new Vector3(-0.49, 0.64, -0.59).normalize();
const SUN_LIGHT = [new Color(0.42, 0.42, 0.44), new Color(0.95, 0.9, 0.82), new Color(0.85, 0.82, 0.86), new Color(1.02, 0.98, 0.95)] as const;
const SKY_LIGHT = [new Color(0.52, 0.54, 0.58), new Color(0.42, 0.55, 0.75), new Color(0.18, 0.2, 0.36), new Color(0.07, 0.07, 0.11)] as const;
const GROUND_LIGHT = [new Color(0.34, 0.35, 0.37), new Color(0.5, 0.5, 0.52), new Color(0.14, 0.15, 0.2), new Color(0.05, 0.05, 0.07)] as const;

// Sky phase over rail progress: a sharp punch at the deck, then a long thinning.
const PHASE_KEYS = {
  punchStart: DECK_U - 0.004,
  punchEnd: DECK_U + 0.004,
  indigoStart: railU(bar(9.5)),
  indigoEnd: railU(bar(15.5)),
  blackStart: railU(bar(15.5)),
  blackEnd: railU(bar(21)),
};

export function skyPhaseForU(u: number) {
  const ramp = (from: number, to: number) => Math.min(1, Math.max(0, (u - from) / Math.max(0.0001, to - from)));
  return ramp(PHASE_KEYS.punchStart, PHASE_KEYS.punchEnd) + ramp(PHASE_KEYS.indigoStart, PHASE_KEYS.indigoEnd) + ramp(PHASE_KEYS.blackStart, PHASE_KEYS.blackEnd);
}

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  dt: number;
  elapsed: number;
  u: number;
  railDelta: number;
  running: boolean;
  beat: number;
};

export type Environment = {
  root: Group;
  stationMouth: Vector3;
  deckPosition: Vector3;
  update(frame: EnvironmentFrame): void;
  setStationOpen(open: boolean): void;
  setDocked(docked: boolean): void;
  phase(): number;
};

type StreakField = {
  lines: LineSegments;
  scroll: { value: number };
  direction: { value: Vector3 };
  density: { value: number };
  glow: { value: number };
  length: { value: number };
};

function col(color: Color | [number, number, number]) {
  const c = color instanceof Color ? color : new Color(color[0], color[1], color[2]);
  return vec3(c.r, c.g, c.b);
}

const t01 = skyPhaseUniform.clamp(0, 1);
const t12 = skyPhaseUniform.sub(1).clamp(0, 1);
const t23 = skyPhaseUniform.sub(2).clamp(0, 1);

function keyedColor(storm: Color, sunlit: Color, indigo: Color, black: Color) {
  return mix(mix(mix(col(storm), col(sunlit), t01), col(indigo), t12), col(black), t23);
}

function keyedFloat(storm: number, sunlit: number, indigo: number, black: number) {
  return mix(mix(mix(float(storm), float(sunlit), t01), float(indigo), t12), float(black), t23);
}

function lerpPhase(phase: number, values: readonly [number, number, number, number]) {
  const clamped = Math.min(3, Math.max(0, phase));
  const index = Math.min(2, Math.floor(clamped));
  const t = clamped - index;
  return values[index] + (values[index + 1] - values[index]) * t;
}

function lerpPhaseColor(phase: number, values: readonly [Color, Color, Color, Color], target: Color) {
  const clamped = Math.min(3, Math.max(0, phase));
  const index = Math.min(2, Math.floor(clamped));
  const t = clamped - index;
  return target.copy(values[index]).lerp(values[index + 1], t);
}

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  const rng = mulberry32(20260901);
  scene.background = SKY.storm.fog.clone();
  scene.fog = new FogExp2(SKY.storm.fog.clone(), 0.01);

  const dome = createSkyDome();
  root.add(dome);
  const stars = createStars(rng);
  root.add(stars.group);
  const backdrop = createBackdrop();
  root.add(backdrop.mesh);
  const deck = createCloudDeck();
  root.add(deck.group);
  const puffs = createCloudPuffs(rng);
  root.add(puffs);
  const tether = createTether();
  root.add(tether.group);
  const rain = createStreakField(rng, { count: 260, radiusMin: 2.5, radiusMax: 15, span: 36, lengthMin: 1.2, lengthMax: 2.2, color: new Color(0.42, 0.47, 0.54), colorSpread: 0.35 });
  root.add(rain.lines);
  const debris = createStreakField(rng, { count: 220, radiusMin: 2.5, radiusMax: 13, span: 70, lengthMin: 0.5, lengthMax: 1.4, color: new Color(0.85, 0.88, 0.92), colorSpread: 0.5 });
  root.add(debris.lines);
  const chunks = createDebrisChunks(rng);
  root.add(chunks.group);
  const station = createStation();
  root.add(station.group);

  scene.add(root);

  const fogColor = new Color();
  const scratchColor = new Color();
  const scratchDirection = new Vector3();
  const skyUp = new Vector3(0, 1, 0);
  let phase = 0;
  let stationOpen = 0;
  let stationOpenTarget = 0;
  let docked = false;
  let idleScroll = 0;

  return {
    root,
    stationMouth: station.mouth,
    deckPosition: deck.position,
    phase: () => phase,
    setStationOpen(open) {
      stationOpenTarget = open ? 1 : 0;
      if (!open) stationOpen = 0;
    },
    setDocked(next) {
      docked = next;
      station.setDocked(next);
    },
    update(frame) {
      const { camera, dt, elapsed, u, railDelta } = frame;
      phase = skyPhaseForU(u);
      skyPhaseUniform.value = phase;
      lightningUniform.value = Math.max(0, lightningUniform.value - dt * 7);

      // Atmosphere: fog colour and density follow the sky phase.
      lerpPhaseColor(phase, [SKY.storm.fog, SKY.sunlit.fog, SKY.indigo.fog, SKY.black.fog], fogColor);
      (scene.fog as FogExp2).color.copy(fogColor);
      (scene.fog as FogExp2).density = lerpPhase(phase, [0.0085, 0.0038, 0.0014, 0.0003]);
      (scene.background as Color).copy(fogColor);

      // Lighting: flat and grey in the storm, sunlit above the deck, hard in vacuum.
      sunDirectionUniform.value.copy(SUN_DIRECTION);
      setColorUniform(sunLightUniform, lerpPhaseColor(phase, SUN_LIGHT, scratchColor));
      setColorUniform(skyLightUniform, lerpPhaseColor(phase, SKY_LIGHT, scratchColor));
      setColorUniform(groundLightUniform, lerpPhaseColor(phase, GROUND_LIGHT, scratchColor));

      // Camera-relative sky: dome, stars, backdrop.
      dome.position.copy(camera.position);
      stars.group.position.copy(camera.position);
      stars.setOpacity(Math.min(1, Math.max(0, (phase - 1.55) / 1.1)));
      backdrop.place(camera.position, phase);

      // Billboard basis for the cloud puffs.
      cameraRightUniform.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      cameraUpUniform.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      puffAlphaUniform.value = phase < 1.1 ? 1 : Math.max(0, 1 - (phase - 1.1) / 0.8);

      // Rain: falls in the storm, thins out above the deck. Apparent direction
      // combines the fall with the climb so drops streak past, not just down.
      idleScroll += dt;
      const climb = railDelta / Math.max(dt, 1e-4);
      const fall = 22 + lerpPhase(phase, [0, 0, 6, 8]);
      scratchDirection.set(-0.22 * (1 - Math.min(1, phase)), -fall, climb * 0.9).normalize();
      rain.direction.value.copy(scratchDirection);
      rain.scroll.value = (rain.scroll.value + dt * Math.hypot(fall, climb * 0.9)) % 100000;
      rain.density.value = Math.max(0, 1 - Math.max(0, phase - 0.85) * 1.6);
      rain.glow.value = lerpPhase(phase, [0.55, 0.75, 0.6, 0.5]) * (1 + lightningUniform.value * 1.5);
      rain.length.value = 1;

      // Debris: stationary in the world, so it streaks straight down the rail
      // as the climber rises; sparse in the weather, everywhere in vacuum.
      debris.direction.value.set(0, 0, 1);
      debris.scroll.value = (debris.scroll.value + railDelta + dt * 1.5) % 100000;
      debris.density.value = lerpPhase(phase, [0.18, 0.35, 0.7, 1.0]);
      debris.glow.value = lerpPhase(phase, [0.35, 0.6, 0.9, 1.2]);
      debris.length.value = Math.min(2.2, 0.6 + climb * 0.05);
      rain.lines.position.copy(camera.position);
      debris.lines.position.copy(camera.position);

      chunks.update(u, dt);
      tether.update(elapsed, frame.beat);
      deck.update(elapsed);

      stationOpen += (stationOpenTarget - stationOpen) * Math.min(1, dt * 1.1);
      station.update(elapsed, stationOpen, frame.beat, docked, u);
      void skyUp;
    },
  };
}

// ---- sky dome ---------------------------------------------------------------------

function createSkyDome() {
  const material = new MeshBasicNodeMaterial();
  material.side = BackSide;
  material.fog = false;
  material.depthWrite = false;

  const direction = positionLocal.normalize();
  const elevation = direction.y;
  const horizon = keyedColor(SKY.storm.horizon, SKY.sunlit.horizon, SKY.indigo.horizon, SKY.black.horizon);
  const zenith = keyedColor(SKY.storm.zenith, SKY.sunlit.zenith, SKY.indigo.zenith, SKY.black.zenith);
  let color = mix(horizon, zenith, smoothstep(float(-0.08), float(0.58), elevation));

  // Haze band on the horizon: thick and pale in the storm and the sunlit blue.
  const hazeStrength = keyedFloat(0.22, 0.42, 0.18, 0.05);
  const haze = smoothstep(float(0.22), float(0.0), elevation.abs()).mul(hazeStrength);
  color = color.add(vec3(0.28, 0.31, 0.36).mul(haze));

  // Storm texture: slow churning cloud base overhead, lit from within by lightning.
  const churn = mx_noise_float(direction.mul(4.5).add(vec3(time.mul(0.03), 0, time.mul(0.02)))).mul(0.5).add(0.5);
  const stormCloud = smoothstep(float(0.0), float(0.7), elevation).mul(churn).mul(float(1).sub(t01)).mul(0.16);
  color = color.add(vec3(0.26, 0.27, 0.3).mul(stormCloud));

  // The sun: a smeared patch in the storm, a hard disc with a halo above it.
  const sunDot = direction.dot(sunDirectionUniform);
  const disc = smoothstep(float(0.99935), float(0.99985), sunDot);
  const halo = sunDot.max(0).pow(40);
  const sunStrength = keyedFloat(0.12, 1.0, 1.15, 1.3);
  const haloStrength = keyedFloat(0.3, 0.22, 0.1, 0.03);
  color = color.add(col(SUN_WHITE).mul(disc.mul(1.5).add(halo.mul(haloStrength))).mul(sunStrength));

  // Lightning lights the whole sky, most of all overhead.
  color = color.add(vec3(0.5, 0.55, 0.65).mul(lightningUniform).mul(smoothstep(float(-0.3), float(0.6), elevation).mul(0.6).add(0.35)));
  material.colorNode = color;

  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 48, 28), material);
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

// ---- stars ------------------------------------------------------------------------

function createStars(rng: Rng) {
  const group = new Group();
  const materials: PointsMaterial[] = [];
  const make = (count: number, size: number, brightness: number) => {
    const positions: number[] = [];
    const colors: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const elevation = -0.12 + rng() * 1.12;
      const azimuth = rng() * Math.PI * 2;
      const radius = Math.sqrt(Math.max(0, 1 - elevation * elevation));
      positions.push(Math.cos(azimuth) * radius * 400, elevation * 400, Math.sin(azimuth) * radius * 400);
      const warm = rng();
      const intensity = brightness * (0.5 + rng() * 0.5);
      colors.push(intensity * (0.85 + warm * 0.15), intensity * (0.88 + warm * 0.06), intensity * (1.0 - warm * 0.1));
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const material = new PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    materials.push(material);
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -19;
    points.userData.raildIgnoreOcclusion = true;
    group.add(points);
  };
  make(720, 1.3, 0.8);
  make(110, 2.4, 1.4);
  return {
    group,
    setOpacity(opacity: number) {
      for (const material of materials) material.opacity = opacity;
    },
  };
}

// ---- backdrop: cloud tops, then the planet's limb ---------------------------------

function createBackdrop() {
  const material = new MeshBasicNodeMaterial();
  material.fog = false;
  material.depthWrite = false;
  material.transparent = true;
  material.side = DoubleSide;

  const r = uv().sub(0.5).length().mul(2);
  const limb = float(0.86);
  const noiseA = mx_noise_float(vec3(uv().mul(7), time.mul(0.012)));
  const noiseB = mx_noise_float(vec3(uv().mul(23).add(3.1), time.mul(0.02)));
  const swirl = smoothstep(float(-0.1), float(0.45), noiseA);

  const surfaceStorm = col([0.18, 0.19, 0.22]).add(noiseA.mul(0.02));
  const surfaceSunlit = col([0.3, 0.33, 0.38]).add(noiseA.mul(0.08)).add(noiseB.mul(0.04));
  const surfaceIndigo = mix(col([0.045, 0.065, 0.13]), col([0.1, 0.12, 0.16]), swirl).add(noiseB.mul(0.02));
  const cityLights = smoothstep(float(0.6), float(0.72), noiseB).mul(col([0.95, 0.65, 0.3])).mul(0.55);
  const surfaceBlack = col([0.012, 0.016, 0.034]).add(cityLights).add(swirl.mul(0.02));
  const surface = mix(mix(mix(surfaceStorm, surfaceSunlit, t01), surfaceIndigo, t12), surfaceBlack, t23);

  const inside = smoothstep(limb.add(0.025), limb, r);
  const band = smoothstep(limb.sub(0.03), limb, r).mul(smoothstep(limb.add(0.035), limb.add(0.01), r));
  const glow = smoothstep(float(1.0), limb, r).pow(1.6);
  const rimColor = keyedColor(new Color(0.2, 0.21, 0.23), new Color(0.45, 0.55, 0.68), new Color(0.4, 0.62, 0.9), new Color(0.5, 0.75, 1.0));
  const rimStrength = keyedFloat(0.0, 0.5, 1.1, 1.6);
  const glowStrength = keyedFloat(0.0, 0.35, 0.45, 0.4);

  const color = surface.mul(inside)
    .add(rimColor.mul(band).mul(rimStrength))
    .add(rimColor.mul(glow).mul(glowStrength).mul(float(1).sub(inside)))
    .mul(lightningUniform.mul(0.4).add(1));
  material.colorNode = color;
  material.opacityNode = inside.max(band).max(glow.mul(glowStrength).mul(2).clamp(0, 1));

  const mesh = new Mesh(new CircleGeometry(1, 80), material);
  mesh.renderOrder = -18;
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;

  const direction = new Vector3();
  return {
    mesh,
    place(cameraPosition: Vector3, phase: number) {
      // Angular radius of the limb shrinks as the climb goes on, so the horizon
      // visibly bows: the planet curving away below.
      const angular = (lerpPhase(phase, [50, 48, 43, 37]) * Math.PI) / 180;
      const limbTop = (-19 * Math.PI) / 180;
      const centerElevation = limbTop - angular;
      direction.set(0, Math.sin(centerElevation), -Math.cos(centerElevation));
      mesh.position.copy(cameraPosition).addScaledVector(direction, BACKDROP_DISTANCE);
      const limbRadius = BACKDROP_DISTANCE * Math.tan(angular);
      mesh.scale.setScalar(limbRadius / 0.86);
      mesh.lookAt(cameraPosition);
    },
  };
}

// ---- the cloud deck: the layer the climber punches through -----------------------

function createCloudDeck() {
  const group = new Group();
  const position = railPoint(DECK_U);
  const noiseA = mx_noise_float(vec3(positionWorld.x.mul(0.018), positionWorld.z.mul(0.018), time.mul(0.03)));
  const noiseB = mx_noise_float(vec3(positionWorld.x.mul(0.07), positionWorld.z.mul(0.07), time.mul(0.08)));

  const topMaterial = new MeshBasicNodeMaterial();
  topMaterial.colorNode = col([0.3, 0.33, 0.38]).mul(noiseA.mul(0.22).add(noiseB.mul(0.08)).add(1)).mul(lightningUniform.mul(0.4).add(1));
  const top = new Mesh(new CircleGeometry(720, 72), topMaterial);
  top.rotation.x = -Math.PI / 2;
  top.position.copy(position);
  top.userData.raildIgnoreOcclusion = true;

  const underMaterial = new MeshBasicNodeMaterial();
  underMaterial.colorNode = col([0.13, 0.135, 0.15]).mul(noiseA.mul(0.18).add(1)).add(vec3(0.3, 0.33, 0.4).mul(lightningUniform).mul(noiseB.mul(0.5).add(0.8)));
  const under = new Mesh(new CircleGeometry(720, 72), underMaterial);
  under.rotation.x = Math.PI / 2;
  under.position.copy(position).add(new Vector3(0, -0.6, 0));
  under.userData.raildIgnoreOcclusion = true;

  group.add(top, under);
  return {
    group,
    position,
    update(_elapsed: number) {},
  };
}

// ---- cloud puffs: billboarded soft quads along the rail ---------------------------

function createCloudPuffs(rng: Rng) {
  const COUNT = 120;
  const positions: number[] = [];
  const centers: number[] = [];
  const corners: number[] = [];
  const sizes: number[] = [];
  const seeds: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const aboveDeck = i >= 88;
    const u = aboveDeck ? DECK_U + 0.004 + rng() * 0.12 : rng() * (DECK_U + 0.006);
    const angle = rng() * Math.PI * 2;
    const radius = aboveDeck ? 26 + rng() * 70 : 11 + rng() * 55;
    const x = Math.cos(angle) * radius;
    const y = aboveDeck ? -18 - Math.abs(Math.sin(angle)) * radius * 0.7 : Math.sin(angle) * radius;
    const center = railPoint(u, x, y, (rng() - 0.5) * 30);
    const size = (aboveDeck ? 18 : 9) + rng() * (aboveDeck ? 22 : 16);
    const seed = rng() * 10;
    const base = i * 4;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      positions.push(center.x, center.y, center.z);
      centers.push(center.x, center.y, center.z);
      corners.push(cx, cy);
      sizes.push(size);
      seeds.push(seed);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('center', new Float32BufferAttribute(centers, 3));
  geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2));
  geometry.setAttribute('psize', new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('seed', new Float32BufferAttribute(seeds, 1));
  geometry.setIndex(indices);

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;
  const center = attribute<'vec3'>('center', 'vec3');
  const corner = attribute<'vec2'>('corner', 'vec2');
  const size = attribute<'float'>('psize', 'float');
  const seed = attribute<'float'>('seed', 'float');
  material.positionNode = center.add(cameraRightUniform.mul(corner.x.mul(size))).add(cameraUpUniform.mul(corner.y.mul(size)));
  const distance = corner.length();
  const noise = mx_noise_float(vec3(corner.mul(2.1), seed.mul(7)).add(vec3(time.mul(0.06), time.mul(0.03), 0)));
  const shape = smoothstep(float(1.0), float(0.28), distance);
  material.opacityNode = shape.mul(noise.mul(0.5).add(0.72)).mul(puffAlphaUniform).clamp(0, 1);
  const base = mix(col([0.2, 0.21, 0.235]), col([0.42, 0.44, 0.48]), t01);
  const lit = corner.y.mul(0.14).add(1).mul(noise.mul(0.14).add(0.94));
  material.colorNode = base.mul(lit).mul(lightningUniform.mul(0.7).add(1));

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

// ---- the tether ------------------------------------------------------------------

function createTether() {
  const group = new Group();
  group.quaternion.copy(RAIL_BASIS);
  group.position.copy(railPoint(0, TETHER_OFFSET.x, TETHER_OFFSET.y, 0));
  const LENGTH = RAIL_LENGTH + 550;

  const cable = new CylinderGeometry(0.42, 0.42, LENGTH, 12);
  cable.rotateX(Math.PI / 2);
  const cableMesh = new Mesh(cable, createPanelMaterial(PANEL));
  cableMesh.position.z = -(LENGTH / 2 - 150);
  group.add(cableMesh);

  // Collars every 25 units: white rings with hazard bands, whipping past.
  const SPACING = 25;
  const collarCount = Math.floor(LENGTH / SPACING);
  const collarGeometry = new CylinderGeometry(0.66, 0.66, 0.5, 10);
  collarGeometry.rotateX(Math.PI / 2);
  const collars = new InstancedMesh(collarGeometry, createLightMaterial(HAZARD_ORANGE, 0.9), collarCount);
  const matrix = new Matrix4();
  for (let i = 0; i < collarCount; i += 1) {
    matrix.makeTranslation(0, 0, 150 - i * SPACING);
    collars.setMatrixAt(i, matrix);
  }
  collars.instanceMatrix.needsUpdate = true;
  collars.frustumCulled = false;
  group.add(collars);

  // Power conduits: bright dashes climbing the cable, the tether's own pulse.
  const pulseMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const along = positionWorld.dot(vec3(RAIL_DIRECTION.x, RAIL_DIRECTION.y, RAIL_DIRECTION.z));
  const dash = along.mul(0.02).sub(time.mul(1.1)).fract().pow(9);
  const conduitGlow = keyedFloat(0.5, 0.7, 1.0, 1.35);
  pulseMaterial.colorNode = col(HAZARD_ORANGE).mul(dash.mul(1.4).add(0.08)).mul(conduitGlow);
  for (const x of [-0.47, 0.47]) {
    const geometry = new BufferGeometry().setFromPoints([new Vector3(x, 0.05, 150), new Vector3(x, 0.05, 150 - LENGTH)]);
    const line = new Line(geometry, pulseMaterial);
    line.frustumCulled = false;
    group.add(line);
  }

  const collarMaterial = collars.material as MeshBasicMaterial;
  return {
    group,
    update(_elapsed: number, beat: number) {
      collarMaterial.color.copy(HAZARD_ORANGE).multiplyScalar(0.85 + beat * 0.45);
    },
  };
}

// ---- streak fields: rain in the weather, debris up top ------------------------------

function createStreakField(
  rng: Rng,
  config: { count: number; radiusMin: number; radiusMax: number; span: number; lengthMin: number; lengthMax: number; color: Color; colorSpread: number },
): StreakField {
  const positions: number[] = [];
  const s0: number[] = [];
  const ds: number[] = [];
  const lengths: number[] = [];
  const tiers: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < config.count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = config.radiusMin + rng() * (config.radiusMax - config.radiusMin);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * config.span;
    const length = config.lengthMin + rng() * (config.lengthMax - config.lengthMin);
    const tint = config.color.clone().multiplyScalar(1 - config.colorSpread + rng() * config.colorSpread);
    const tier = rng();
    for (const delta of [0, 1]) {
      positions.push(x, y, 0);
      s0.push(start);
      ds.push(delta);
      lengths.push(length);
      tiers.push(tier);
      colors.push(tint.r, tint.g, tint.b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('s0', new Float32BufferAttribute(s0, 1));
  geometry.setAttribute('ds', new Float32BufferAttribute(ds, 1));
  geometry.setAttribute('slen', new Float32BufferAttribute(lengths, 1));
  geometry.setAttribute('tier', new Float32BufferAttribute(tiers, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const scroll = uniform(0);
  const direction = uniform(new Vector3(0, 0, 1));
  const density = uniform(1);
  const glow = uniform(1);
  const length = uniform(1);

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  material.fog = false;
  const half = config.span / 2;
  const wrapped = attribute<'float'>('s0', 'float').sub(scroll).mod(config.span).sub(half);
  const along = wrapped.add(attribute<'float'>('ds', 'float').mul(attribute<'float'>('slen', 'float')).mul(length));
  material.positionNode = positionLocal.add(direction.mul(along));
  const envelope = smoothstep(float(-half), float(-half + 6), wrapped).mul(smoothstep(float(half), float(half - 6), wrapped));
  const visible = step(attribute<'float'>('tier', 'float'), density);
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(visible).mul(glow);

  const lines = new LineSegments(geometry, material);
  lines.quaternion.copy(RAIL_BASIS);
  lines.frustumCulled = false;
  lines.userData.raildIgnoreOcclusion = true;
  return { lines, scroll, direction, density, glow, length };
}

// ---- debris chunks: real hardware falling past ----------------------------------------

// A rail-relative recycling field. The rail is a straight line, so placement is
// a single railPoint() into a preallocated position: no per-frame vector
// garbage from curve sampling, which matters with fifty chunks every frame.
function createDebrisChunks(rng: Rng) {
  const dark = createPanelMaterial(PANEL_DARK);
  const light = createPanelMaterial(PANEL.clone().multiplyScalar(0.8));
  const lamp = createLightMaterial(HAZARD_ORANGE, 1.2);
  const group = new Group();
  // Small, fast-moving scenery: a chunk crossing a target for a frame is not
  // an occlusion problem worth designing around.
  group.userData.raildIgnoreOcclusion = true;
  const BEHIND = 30 / RAIL_LENGTH;
  const AHEAD = 170 / RAIL_LENGTH;
  type Chunk = { object: Group; u: number; x: number; y: number; initialU: number; spin: Vector3; seed: number };
  const chunks: Chunk[] = [];

  const place = (chunk: Chunk, big: boolean, random: () => number) => {
    const angle = random() * Math.PI * 2;
    const radius = big ? 26 + random() * 30 : 4 + random() * 13;
    chunk.x = Math.cos(angle) * radius;
    chunk.y = Math.sin(angle) * radius;
  };

  for (let index = 0; index < 54; index += 1) {
    const big = index >= 42;
    const size = big ? 1.4 + rng() * 1.6 : 0.35 + rng() * 0.7;
    const object = new Group();
    object.add(new Mesh(new BoxGeometry(size, size * (0.3 + rng() * 0.5), size * (0.6 + rng() * 0.8)), rng() < 0.5 ? dark : light));
    if (index % 3 === 0) {
      const marker = new Mesh(new BoxGeometry(size * 0.2, size * 0.2, size * 0.2), lamp);
      marker.position.set(size * 0.4, size * 0.2, 0);
      object.add(marker);
    }
    object.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    const chunk: Chunk = { object, u: rng(), x: 0, y: 0, initialU: 0, spin: new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(2.4), seed: rng() * 1000 };
    chunk.initialU = chunk.u;
    place(chunk, big, rng);
    group.add(object);
    chunks.push(chunk);
  }

  let lastU = 0;
  const hashRandom = (chunk: Chunk) => {
    // Deterministic per-chunk stream for recycled placements.
    chunk.seed = (chunk.seed * 9301 + 49297) % 233280;
    return chunk.seed / 233280;
  };

  return {
    group,
    update(cameraU: number, dt: number) {
      if (cameraU + 0.001 < lastU) {
        for (const chunk of chunks) chunk.u = chunk.initialU;
      }
      lastU = cameraU;
      for (const [index, chunk] of chunks.entries()) {
        if (chunk.u < cameraU - BEHIND) {
          chunk.u += AHEAD + hashRandom(chunk) * AHEAD * 0.5;
          place(chunk, index >= 42, () => hashRandom(chunk));
        }
        const visible = chunk.u <= cameraU + AHEAD && chunk.u <= 1;
        chunk.object.visible = visible;
        if (!visible) continue;
        railPoint(chunk.u, chunk.x, chunk.y, 0, chunk.object.position);
        chunk.object.rotation.x += chunk.spin.x * dt;
        chunk.object.rotation.y += chunk.spin.y * dt;
        chunk.object.rotation.z += chunk.spin.z * dt;
      }
    },
  };
}

// ---- the station: ring, arrays, iris, bay --------------------------------------------

function createStation() {
  const group = new Group();
  group.quaternion.copy(RAIL_BASIS);
  const mouth = railPoint(STATION_MOUTH_U, TETHER_OFFSET.x, TETHER_OFFSET.y, 0);
  group.position.copy(mouth);
  const bayLength = (1 - STATION_MOUTH_U) * RAIL_LENGTH + 30;

  const panel = createPanelMaterial(PANEL);
  const darkPanel = createPanelMaterial(PANEL_DARK);
  const orange = createLightMaterial(HAZARD_ORANGE, 0.95);

  // Outer ring, just outside the mouth, with collar lamps.
  const ring = new Mesh(new TorusGeometry(46, 5.5, 10, 56), panel);
  ring.position.z = 6;
  group.add(ring);
  const ringLampGeometry = new BoxGeometry(2.2, 1.2, 1.2);
  const ringLamps = new InstancedMesh(ringLampGeometry, orange, 24);
  const matrix = new Matrix4();
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    matrix.makeRotationZ(angle).setPosition(Math.cos(angle) * 46, Math.sin(angle) * 46, 0);
    ringLamps.setMatrixAt(i, matrix);
  }
  ringLamps.instanceMatrix.needsUpdate = true;
  group.add(ringLamps);

  // Radial arrays: the station reads from three hundred units out. Merged
  // into one panel mesh and one array mesh.
  const arrayPieces: BufferGeometry[] = [];
  const trussPieces: BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    arrayPieces.push(placed(new BoxGeometry(66, 0.6, 26), Math.cos(angle) * 88, Math.sin(angle) * 88, 10, angle));
    trussPieces.push(placed(new BoxGeometry(44, 1.6, 1.6), Math.cos(angle) * 68, Math.sin(angle) * 68, 10, angle));
  }
  group.add(new Mesh(mergeGeometries(arrayPieces), darkPanel));
  group.add(new Mesh(mergeGeometries(trussPieces), panel));

  // The bay: a hexagonal hall around the tether, lit by guide rings.
  const bay = new CylinderGeometry(15, 15, bayLength, 6, 1, true);
  bay.rotateX(Math.PI / 2);
  const bayMaterial = createPanelMaterial(PANEL.clone().multiplyScalar(0.9), { side: BackSide });
  const bayMesh = new Mesh(bay, bayMaterial);
  bayMesh.position.z = -bayLength / 2;
  group.add(bayMesh);
  const ribCount = Math.floor(bayLength / 12);
  const ribPieces: BufferGeometry[] = [];
  for (let i = 0; i < ribCount; i += 1) ribPieces.push(placed(new TorusGeometry(15.2, 0.5, 6, 6), 0, 0, -6 - i * 12, Math.PI / 6));
  group.add(new Mesh(mergeGeometries(ribPieces), darkPanel));
  const guideGeometry = new BoxGeometry(1.4, 0.5, 0.5);
  const guideMaterials = [createLightMaterial(HAZARD_ORANGE, 1.0), createLightMaterial(HAZARD_ORANGE, 1.0)];
  const guides = guideMaterials.map((material) => new InstancedMesh(guideGeometry, material, ribCount * 3));
  for (let i = 0; i < ribCount; i += 1) {
    for (let j = 0; j < 6; j += 1) {
      const angle = (j / 6) * Math.PI * 2 + Math.PI / 6;
      matrix.makeRotationZ(angle).setPosition(Math.cos(angle) * 14.3, Math.sin(angle) * 14.3, -6 - i * 12);
      guides[(i + j) % 2].setMatrixAt(Math.floor((i * 6 + j) / 2), matrix);
    }
  }
  for (const guide of guides) {
    guide.instanceMatrix.needsUpdate = true;
    group.add(guide);
  }

  // Iris: six petals across the mouth that slide open once the tether is clear.
  const petals: Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const petal = new Mesh(new BoxGeometry(12, 13, 0.7), panel);
    const chevron = new Mesh(new BoxGeometry(0.9, 9, 0.2), orange);
    chevron.position.set(-1.5, 0, 0.45);
    petal.add(chevron);
    petal.userData.angle = angle;
    petal.rotation.z = angle;
    group.add(petal);
    petals.push(petal);
  }

  // End wall: hazard cross and the dock lamp that comes on when the car stops.
  const wall = new Mesh(new CircleGeometry(15.6, 6), darkPanel);
  wall.rotation.z = Math.PI / 6;
  wall.position.z = -bayLength + 0.5;
  group.add(wall);
  group.add(new Mesh(mergeGeometries([Math.PI / 4, -Math.PI / 4].map((rotation) => placed(new BoxGeometry(14, 1.2, 0.3), 0, 0, -bayLength + 1.0, rotation))), orange));
  const dockLamp = new Mesh(new BoxGeometry(3, 1.2, 0.5), createLightMaterial(INSTRUMENT, 0.2));
  dockLamp.position.set(0, 9, -bayLength + 1.2);
  group.add(dockLamp);

  const guideMaterialA = guideMaterials[0];
  const guideMaterialB = guideMaterials[1];
  return {
    group,
    mouth,
    setDocked(docked: boolean) {
      (dockLamp.material as MeshBasicMaterial).color.copy(INSTRUMENT).multiplyScalar(docked ? 2.2 : 0.2);
    },
    update(elapsed: number, open: number, beat: number, docked: boolean, u: number) {
      const slide = 5 + open * 19;
      for (const petal of petals) {
        const angle = petal.userData.angle as number;
        petal.position.set(Math.cos(angle) * slide, Math.sin(angle) * slide, 0);
      }
      // Guide lights chase inward on the beat; hold steady once docked.
      const chase = docked ? 0.6 : 0.55 + Math.max(0, Math.sin(elapsed * 6)) * 0.6 + beat * 0.5;
      const counter = docked ? 0.6 : 0.55 + Math.max(0, -Math.sin(elapsed * 6)) * 0.6 + beat * 0.5;
      guideMaterialA.color.copy(HAZARD_ORANGE).multiplyScalar(chase);
      guideMaterialB.color.copy(HAZARD_ORANGE).multiplyScalar(counter);
      (ringLamps.material as MeshBasicMaterial).color.copy(HAZARD_ORANGE).multiplyScalar(0.9 + beat * 0.6 + open * 0.5);
      void u;
    },
  };
}

function placed(geometry: BufferGeometry, x: number, y: number, z: number, rotationZ: number) {
  const matrix = new Matrix4().makeRotationZ(rotationZ).setPosition(x, y, z);
  return (geometry.index ? geometry.toNonIndexed() : geometry).applyMatrix4(matrix);
}

export function findObjectsOfKind(root: Object3D, predicate: (object: Object3D) => boolean) {
  const found: Object3D[] = [];
  root.traverse((object) => {
    if (predicate(object)) found.push(object);
  });
  return found;
}
