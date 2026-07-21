import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
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
import { createAtmosphereRamp } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  CLOUDBREAK_TIME,
  createSkyhookGgl2Rail,
  DESCENT_TIME,
  railU,
  THIN_TIME,
} from '../gameplay';
import {
  CLOUD,
  CLOUD_LIT,
  HAZARD,
  hdr,
  INDIGO,
  mulberry32,
  PANEL,
  PLANET,
  PLANET_LIMB,
  STAR,
  STEEL,
  STORM,
  SUN_GOLD,
  SUNLIT,
  VOID,
  type Rng,
} from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // 0..~1.6 beat energy
export const altitudeUniform = uniform(0); // 0 down in the weather → 1 at the station
export const streakOffsetUniform = uniform(0); // accumulated travel distance
export const streakGlowUniform = uniform(0.4); // debris-streak brightness
export const dockGlowUniform = uniform(0); // station interior light on approach

const STREAK_SPAN = 60;
const STREAK_BACK = 40;

export type Environment = {
  root: Group;
  atmosphere: (progress: number) => void;
  clouds: Group;
  streaks: Group;
  planet: Group;
  stars: Points;
  station: Group;
  stationPosition: Vector3;
  cloudbreakPosition: Vector3;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = STORM.clone();
  scene.fog = new FogExp2(STORM.clone(), 0.006);
  const root = new Group();
  const rng = mulberry32(20260721);
  const curve = createSkyhookGgl2Rail();

  // Backgrounds stay grey-to-dark and always below the bloom threshold so the
  // sky never blooms to a white wall; the only true whiteout is the brief haze
  // flash when the car punches through the deck (post-fx, ~half a second).
  const STORM_MURK = new Color(0.18, 0.20, 0.25);
  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: STORM, fog: STORM, density: 0.0028 },
    { progress: railU(CLOUDBREAK_TIME) - 0.01, background: STORM_MURK, fog: STORM_MURK, density: 0.0038 },
    { progress: railU(CLOUDBREAK_TIME) + 0.02, background: SUNLIT, fog: SUNLIT, density: 0.0015 },
    { progress: railU(THIN_TIME), background: INDIGO, fog: INDIGO, density: 0.001 },
    { progress: railU(DESCENT_TIME), background: INDIGO.clone().multiplyScalar(0.5), fog: INDIGO.clone().multiplyScalar(0.5), density: 0.0008 },
    { progress: 1, background: VOID, fog: VOID, density: 0.0005 },
  ]);

  const planet = createPlanet();
  root.add(planet);

  root.add(createStarField(rng, curve));
  const stars = root.children[root.children.length - 1] as Points;

  const clouds = createClouds(rng, curve);
  root.add(clouds);

  root.add(createTether(curve));

  const streaks = createDebrisStreaks(rng);
  root.add(streaks);

  const { station, stationPosition } = createStation(curve);
  root.add(station);

  scene.add(root);

  const cloudbreakPosition = sampleRailFrame(curve, railU(CLOUDBREAK_TIME)).position.clone();
  return { root, atmosphere, clouds, streaks, planet, stars, station, stationPosition, cloudbreakPosition };
}

// ---- the planet far below --------------------------------------------------

// A colossal sphere well beneath the rail: it is the ground the climb leaves
// behind, and by the top it curves away as a lit limb against the black.
function createPlanet() {
  const group = new Group();
  const material = new MeshBasicNodeMaterial();
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(view).clamp(0, 1);
  // Sunlit day side toward the light, dim toward the terminator; a bright limb.
  const surface = vec3(PLANET.r, PLANET.g, PLANET.b).mul(facing.mul(0.7).add(0.12));
  const limb = float(1).sub(facing).pow(2.4);
  const color = surface.add(vec3(PLANET_LIMB.r, PLANET_LIMB.g, PLANET_LIMB.b).mul(limb).mul(0.9));
  material.colorNode = color;
  const planet = new Mesh(new SphereGeometry(2600, 96, 64), material);
  planet.position.set(-400, -2860, -900);
  group.add(planet);

  // A thin atmospheric shell that catches the light on the limb.
  const shellMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  const shellView = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(shellView).abs()).pow(2.6);
  shellMaterial.colorNode = vec3(PLANET_LIMB.r, PLANET_LIMB.g, PLANET_LIMB.b).mul(rim).mul(0.7);
  const shell = new Mesh(new SphereGeometry(2665, 80, 52), shellMaterial);
  shell.position.copy(planet.position);
  group.add(shell);
  return group;
}

// ---- stars -----------------------------------------------------------------

function createStarField(rng: Rng, curve: ReturnType<typeof createSkyhookGgl2Rail>) {
  const count = 900;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 300 + rng() * 900;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius + 200)
      .addScaledVector(frame.tangent, (rng() - 0.3) * 600);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    const intensity = rng() < 0.08 ? 1.6 : 0.4 + rng() * 0.5;
    colors[i * 3] = STAR.r * intensity;
    colors[i * 3 + 1] = STAR.g * intensity;
    colors[i * 3 + 2] = STAR.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({ size: 1.4, vertexColors: true, sizeAttenuation: true }));
  material.opacity = 0;
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// ---- cloud deck ------------------------------------------------------------

// A static bank of soft puffs from the ground up to the deck the car punches
// through, thinning to nothing above it. Non-additive and low-opacity so they
// read as haze instead of stacking into a white wall, and never occlude a
// target. The car passes them once and leaves them below — clouds only live in
// the weather.
function createClouds(rng: Rng, curve: ReturnType<typeof createSkyhookGgl2Rail>) {
  const group = new Group();
  const deckU = railU(CLOUDBREAK_TIME);
  const geometry = new SphereGeometry(1, 10, 8);
  const COUNT = 44;
  for (let i = 0; i < COUNT; i += 1) {
    // Bias toward the deck so the break reads as passing through a layer.
    const t = rng();
    const u = MathUtils.clamp((t * t * 0.6 + rng() * 0.5) * (deckU + 0.05), 0, deckU + 0.05);
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 10 + rng() * 46;
    const lit = rng() < 0.28;
    const material = new MeshBasicMaterial({
      color: hdr(lit ? CLOUD_LIT : CLOUD, 0.5),
      transparent: true,
      opacity: 0.1 + rng() * 0.07,
      depthWrite: false,
    });
    const puff = new Mesh(geometry, material);
    puff.position.copy(frame.position)
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius * 0.5 - 5)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 44);
    puff.scale.setScalar(6 + rng() * 13);
    group.add(puff);
  }
  group.frustumCulled = false;
  return group;
}

// ---- the tether ------------------------------------------------------------

// The cable the climber rides: two thin lit rails with rung ticks running up
// the middle of the rail into the sky. Additive so it stays a glowing line and
// never occludes a target.
function createTether(curve: ReturnType<typeof createSkyhookGgl2Rail>) {
  const group = new Group();
  const segments = 200;
  const railMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  railMaterial.colorNode = vec3(PANEL.r, PANEL.g, PANEL.b)
    .mul(float(0.5).add(beatUniform.mul(0.3)))
    .add(vec3(HAZARD.r, HAZARD.g, HAZARD.b).mul(0.2));

  for (const side of [-1.4, 1.4]) {
    const positions: number[] = [];
    let previous: Vector3 | null = null;
    for (let i = 0; i <= segments; i += 1) {
      const frame = sampleRailFrame(curve, i / segments);
      const p = frame.position.clone().addScaledVector(frame.right, side).addScaledVector(frame.up, -0.4).addScaledVector(frame.tangent, 6);
      if (previous) positions.push(previous.x, previous.y, previous.z, p.x, p.y, p.z);
      previous = p;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const line = new LineSegments(geometry, railMaterial);
    line.frustumCulled = false;
    group.add(line);
  }

  // Hazard rung ticks climbing the cable.
  const rungPositions: number[] = [];
  const RUNGS = 90;
  for (let i = 0; i < RUNGS; i += 1) {
    const u = (i + 0.5) / RUNGS;
    const frame = sampleRailFrame(curve, u);
    const a = frame.position.clone().addScaledVector(frame.right, -1.4).addScaledVector(frame.up, -0.4).addScaledVector(frame.tangent, 6);
    const bpt = frame.position.clone().addScaledVector(frame.right, 1.4).addScaledVector(frame.up, -0.4).addScaledVector(frame.tangent, 6);
    rungPositions.push(a.x, a.y, a.z, bpt.x, bpt.y, bpt.z);
  }
  const rungGeometry = new BufferGeometry();
  rungGeometry.setAttribute('position', new Float32BufferAttribute(rungPositions, 3));
  const rungMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  rungMaterial.colorNode = vec3(HAZARD.r, HAZARD.g, HAZARD.b).mul(float(0.5).add(beatUniform.mul(0.5)));
  const rungs = new LineSegments(rungGeometry, rungMaterial);
  rungs.frustumCulled = false;
  group.add(rungs);
  return group;
}

// ---- debris streaks --------------------------------------------------------

// A cylinder of debris streaks around the camera, streaming *downward* past the
// car as the world falls away. Brightness rides `streakGlowUniform`.
function createDebrisStreaks(rng: Rng) {
  const COUNT = 200;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 4 + rng() * 11;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = 2 + rng() * 5;
    const base = rng() < 0.7 ? STEEL.clone().multiplyScalar(3) : HAZARD.clone().multiplyScalar(0.7);
    for (const delta of [0, length]) {
      positions.push(x, y, 0);
      z0.push(start);
      dz.push(delta);
      colors.push(base.r, base.g, base.b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('z0', new Float32BufferAttribute(z0, 1));
  geometry.setAttribute('dz', new Float32BufferAttribute(dz, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const wrapped = attribute<'float'>('z0', 'float').add(streakOffsetUniform).mod(STREAK_SPAN).sub(STREAK_BACK);
  material.positionNode = vec3(positionLocal.x, positionLocal.y, wrapped.add(attribute<'float'>('dz', 'float')));
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 10), wrapped)
    .mul(smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 6), wrapped));
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(streakGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}

// ---- the station -----------------------------------------------------------

// Caps the top of the tether: a heavy docking ring the car flies up into. It is
// far away for most of the climb and only opens up on the final approach.
function createStation(curve: ReturnType<typeof createSkyhookGgl2Rail>) {
  const group = new Group();
  const frame = sampleRailFrame(curve, 1);
  const position = frame.position.clone().addScaledVector(frame.tangent, 120).addScaledVector(frame.up, 6);
  group.position.copy(position);
  group.lookAt(position.clone().add(frame.tangent));

  const dark = new MeshBasicMaterial({ color: STEEL.clone().multiplyScalar(1.1) });
  const panel = new MeshBasicMaterial({ color: PANEL.clone().multiplyScalar(0.7) });

  // Docking maw: an open cylinder the car climbs into.
  const maw = new Mesh(new CylinderGeometry(26, 30, 60, 24, 1, true), panel);
  maw.rotation.x = Math.PI / 2;
  group.add(maw);

  // Structural rings and hazard collars.
  for (const z of [-24, 0, 24]) {
    const ring = new Mesh(new TorusGeometry(28, 2.2, 8, 32), dark);
    ring.position.z = z;
    group.add(ring);
  }
  const collar = new Mesh(new TorusGeometry(30, 1.2, 8, 32), new MeshBasicMaterial({ color: hdr(HAZARD, 0.9) }));
  collar.position.z = 28;
  group.add(collar);

  // Radial gantry struts around the mouth.
  const strutGeometry = new BoxGeometry(2, 2, 22);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const strut = new Mesh(strutGeometry, dark);
    strut.position.set(Math.cos(angle) * 40, Math.sin(angle) * 40, 20);
    strut.lookAt(position);
    group.add(strut);
  }

  // Interior light — the glow that swallows the car, brightening on approach.
  const lightMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: BackSide }));
  lightMaterial.colorNode = vec3(SUN_GOLD.r, SUN_GOLD.g, SUN_GOLD.b).mul(dockGlowUniform.mul(1.1));
  const light = new Mesh(new SphereGeometry(20, 24, 16), lightMaterial);
  light.position.z = -34;
  group.add(light);

  // A ring backdrop so the maw reads as lit — kept modest so structure shows.
  const backing = new Mesh(new RingGeometry(0, 24, 32), new MeshBasicNodeMaterial(additiveMaterialParameters({})));
  (backing.material as MeshBasicNodeMaterial).colorNode = vec3(SUN_GOLD.r, SUN_GOLD.g, SUN_GOLD.b).mul(dockGlowUniform.mul(0.7));
  backing.position.z = -34;
  group.add(backing);

  return { station: group, stationPosition: position };
}
