import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  float,
  mix,
  mx_noise_float,
  positionLocal,
  positionView,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  AXIS_RIGHT,
  AXIS_UP,
  axisPoint,
  CIRRUS_S,
  CLIMB_AXIS,
  CLIMB_LENGTH,
  CLOUD_DECK_S,
  createSkyhookRail,
  railSAt,
  skyhookRunProgress,
  STATION_S,
  tetherPoint,
} from '../gameplay';
import { LIGHTNING_TIMES } from '../timing';
import { HAZARD_ORANGE, hdr, mulberry32, PANEL_SHADOW, PANEL_WHITE, STORM_GREY, WARN_AMBER, type Rng } from './palette';

// The environment IS the arc: a sky dome that runs storm grey → sunlit blue →
// indigo → black with altitude, cloud decks the car physically punches
// through, rain that thins into falling debris, the tether with its collars
// and strobes whipping past, the white-and-orange climber deck at the bottom
// of frame, and the station that irises open to swallow the car at the top.

export const beatUniform = uniform(0); // beat energy 0..~1.6
export const altitudeUniform = uniform(0); // normalized climb 0..1
export const rainGlowUniform = uniform(0);
export const debrisGlowUniform = uniform(0);
const rainOffsetUniform = uniform(0);
const debrisOffsetUniform = uniform(0);
const deckFadeUniform = uniform(1); // fades the main cloud deck as the camera punches it
const strobeUniform = uniform(0); // tether strobe blink, driven on downbeats

type FloatUniform = typeof beatUniform;

// Atmosphere visuals must never block lock rays: clouds, sky, streaks, and
// bolts are see-through gameplay-wise, so their raycast hooks are no-ops.
function raycastTransparent(object: Object3D) {
  object.raycast = () => undefined;
  return object;
}

const RAIN_SPAN = 46;
const RAIN_BACK = 20;
const DEBRIS_SPAN = 90;
const DEBRIS_BACK = 30;

/** Quaternion aligning local +z with the climb axis (x → AXIS_RIGHT, y → AXIS_UP). */
const AXIS_QUATERNION = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(AXIS_RIGHT, AXIS_UP, CLIMB_AXIS),
);

type ApproachLight = { material: MeshBasicMaterial; phase: number };
type Carcass = { mesh: Group; age: number; velocity: Vector3; spin: Vector3 } | null;

export type Environment = {
  root: Group;
  update(dt: number, ctx: EnvironmentUpdateContext): void;
  dropCarcass(position: Vector3): void;
  reset(): void;
};

export type EnvironmentUpdateContext = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  speed: number;
  beatEnergy: number;
  hull: number;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = new Color(0.02, 0.022, 0.03);
  const root = new Group();
  const rng = mulberry32(20260721);
  const curve = createSkyhookRail();

  const sky = createSkyDome();
  root.add(sky);

  const decks = createCloudDecks(rng);
  for (const deck of decks.meshes) root.add(deck);

  const rain = createStreakField(rng, {
    count: 210,
    span: RAIN_SPAN,
    back: RAIN_BACK,
    lengthMin: 1.4,
    lengthMax: 2.6,
    radiusMin: 2.5,
    radiusMax: 11,
    color: () => new Color(0.5, 0.58, 0.68).multiplyScalar(0.35 + rng() * 0.4),
    offset: rainOffsetUniform,
    glow: rainGlowUniform,
  });
  root.add(rain);

  const debris = createStreakField(rng, {
    count: 70,
    span: DEBRIS_SPAN,
    back: DEBRIS_BACK,
    lengthMin: 3,
    lengthMax: 7,
    radiusMin: 4,
    radiusMax: 26,
    color: () => (rng() < 0.6 ? WARN_AMBER : STORM_GREY).clone().multiplyScalar(0.25 + rng() * 0.55),
    offset: debrisOffsetUniform,
    glow: debrisGlowUniform,
  });
  root.add(debris);

  const tether = createTether();
  root.add(tether.group);

  const car = createCarDeck();
  root.add(car.group);

  const station = createStation();
  root.add(station.group);

  const bolts = createLightningBolts(rng);
  for (const bolt of bolts.meshes) root.add(bolt.lines);

  scene.add(root);

  let carcass: Carcass = null;
  let lastRunTime = -1;

  function dropCarcass(position: Vector3) {
    if (carcass) {
      carcass.mesh.removeFromParent();
    }
    // The dead Tetherjack lets go of the cable and falls past the car — the
    // biggest piece of debris in the level, sold with the same downward streak.
    const mesh = new Group();
    const hull = new Mesh(
      new OctahedronGeometry(4.6, 1),
      new MeshBasicMaterial({ color: new Color(0.05, 0.05, 0.065) }),
    );
    hull.scale.set(1.5, 1.05, 0.9);
    mesh.add(hull);
    const ember = new Mesh(
      new OctahedronGeometry(1.4, 1),
      createAdditiveBasicMaterial({ color: hdr(WARN_AMBER, 0.8), opacity: 0.7 }),
    );
    mesh.add(ember);
    mesh.position.copy(position);
    raycastTransparent(hull);
    raycastTransparent(ember);
    root.add(mesh);
    carcass = {
      mesh,
      age: 0,
      velocity: new Vector3().copy(CLIMB_AXIS).multiplyScalar(-6).addScaledVector(AXIS_RIGHT, 3),
      spin: new Vector3(0.7, 1.3, 0.9),
    };
  }

  function update(dt: number, ctx: EnvironmentUpdateContext) {
    const runTime = ctx.running ? ctx.runTime : 0;
    const camS = ctx.running ? railSAt(runTime) : 0;
    const altitude = camS / CLIMB_LENGTH;
    altitudeUniform.value += (altitude - altitudeUniform.value) * Math.min(1, dt * 3);
    beatUniform.value = ctx.beatEnergy;

    // Sky rides the camera.
    sky.position.copy(ctx.camera.position);

    // Air effects: rain dies out of the storm, debris carries the middle of
    // the climb, and by the vacuum nothing streaks at all — stillness IS the
    // altitude cue up there.
    const storm = 1 - smoothstepJs(0.16, 0.3, altitude);
    const rainTarget = (ctx.running ? 0.8 : 0.45) * storm;
    rainGlowUniform.value += (rainTarget - rainGlowUniform.value) * Math.min(1, dt * 2);
    const debrisBand = smoothstepJs(0.12, 0.3, altitude) * (1 - smoothstepJs(0.72, 0.94, altitude));
    debrisGlowUniform.value += (debrisBand * 0.85 - debrisGlowUniform.value) * Math.min(1, dt * 2);
    const climbRate = ctx.speed * 24;
    rainOffsetUniform.value = (rainOffsetUniform.value + dt * (climbRate + 26)) % 100000;
    debrisOffsetUniform.value = (debrisOffsetUniform.value + dt * (climbRate + 9)) % 100000;
    rain.position.copy(ctx.camera.position);
    debris.position.copy(ctx.camera.position);

    // Cloud decks fade out as the camera plane crosses them.
    const mainGap = Math.abs(CLOUD_DECK_S - camS);
    deckFadeUniform.value = Math.min(1, mainGap / 26) * (0.4 + storm * 0.6 + 0.35);

    // Tether collars recycle through a window around the camera.
    tether.update(camS);
    strobeUniform.value = Math.max(0, strobeUniform.value - dt * 5) ;
    if (ctx.beatEnergy > 0.9) strobeUniform.value = 1;

    // The climber car deck hugs the rail just ahead of the camera.
    const progress = ctx.running ? skyhookRunProgress(runTime) : 0;
    const frame = sampleRailFrame(curve, Math.min(1, progress + 0.0012));
    car.group.position.copy(frame.position);
    car.group.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
    car.update(ctx.elapsed, ctx.beatEnergy, ctx.hull);

    // Station: beacon grows, aperture irises open through the dock bars.
    const dockOpen = smoothstepJs(0.9, 0.99, progress);
    station.update(ctx.elapsed, dockOpen, altitude, ctx.beatEnergy);

    // Authored lightning: bolt + timing shared with the score's thunder.
    if (ctx.running && lastRunTime >= 0) {
      for (let i = 0; i < LIGHTNING_TIMES.length; i += 1) {
        if (lastRunTime < LIGHTNING_TIMES[i] && runTime >= LIGHTNING_TIMES[i]) bolts.strike(i, camS);
      }
    }
    lastRunTime = ctx.running ? runTime : -1;
    bolts.update(dt);

    if (carcass) {
      carcass.age += dt;
      carcass.velocity.addScaledVector(CLIMB_AXIS, -30 * dt);
      carcass.mesh.position.addScaledVector(carcass.velocity, dt);
      carcass.mesh.rotation.x += carcass.spin.x * dt;
      carcass.mesh.rotation.y += carcass.spin.y * dt;
      carcass.mesh.rotation.z += carcass.spin.z * dt;
      if (carcass.age > 5) {
        carcass.mesh.removeFromParent();
        carcass = null;
      }
    }
  }

  function reset() {
    if (carcass) {
      carcass.mesh.removeFromParent();
      carcass = null;
    }
    lastRunTime = -1;
    bolts.reset();
  }

  return { root, update, dropCarcass, reset };
}

function smoothstepJs(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---- sky dome ---------------------------------------------------------------

// One sphere does all the coloring. Elevation is measured against the CLIMB
// AXIS, so "up" and "down" follow the climb; altitude drives the whole arc
// from storm murk to starfield.
function createSkyDome() {
  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;
  material.depthWrite = false;

  const dir = positionLocal.normalize();
  const axis = vec3(CLIMB_AXIS.x, CLIMB_AXIS.y, CLIMB_AXIS.z);
  const elev = dir.dot(axis);
  const alt = altitudeUniform;

  // Zenith: storm grey → deep blue → indigo → black.
  let zen = mix(vec3(0.3, 0.33, 0.38), vec3(0.16, 0.35, 0.66), smoothstep(float(0.08), float(0.3), alt));
  zen = mix(zen, vec3(0.05, 0.065, 0.19), smoothstep(float(0.32), float(0.58), alt));
  zen = mix(zen, vec3(0.004, 0.005, 0.012), smoothstep(float(0.56), float(0.85), alt));

  // Horizon band: bright murk → sunlit cream → warm limb → thin blue rim.
  let hor = mix(vec3(0.52, 0.54, 0.58), vec3(0.85, 0.87, 0.92), smoothstep(float(0.08), float(0.28), alt));
  hor = mix(hor, vec3(0.95, 0.62, 0.34), smoothstep(float(0.34), float(0.6), alt));
  hor = mix(hor, vec3(0.12, 0.3, 0.62), smoothstep(float(0.6), float(0.86), alt));

  // The band tightens with altitude — the atmosphere thinning to a rim as the
  // planet curves away below.
  const bandWidth = mix(float(1.1), float(6.5), smoothstep(float(0.15), float(0.8), alt));
  const band = smoothstep(float(0.55), float(-0.12), elev).pow(bandWidth);

  // Below the horizon: storm underdeck murk early, near-black planet later.
  const below = mix(vec3(0.38, 0.4, 0.44), vec3(0.012, 0.018, 0.032), smoothstep(float(0.12), float(0.5), alt));
  let color = mix(zen, below, smoothstep(float(-0.05), float(-0.35), elev));
  color = mix(color, hor, band);

  // Stars: sharpened noise, fading in above the weather, gone below the rim.
  const starNoise = mx_noise_float(dir.mul(90));
  const stars = smoothstep(float(0.52), float(0.86), starNoise).pow(3)
    .mul(smoothstep(float(0.34), float(0.66), alt))
    .mul(smoothstep(float(-0.05), float(0.25), elev))
    .mul(mx_noise_float(dir.mul(31).add(vec3(time.mul(0.05), 0, 0))).mul(0.4).add(0.8));
  color = color.add(vec3(0.9, 0.95, 1.05).mul(stars.mul(1.4)));

  // The sun: soft wide glare in the sunlit act, tightening to a hard point as
  // the air runs out.
  const sun = vec3(-0.52, 0.62, -0.53).normalize();
  const sunDot = dir.dot(sun).max(0.0);
  const sunTight = mix(float(160), float(1500), smoothstep(float(0.3), float(0.85), alt));
  const sunVis = smoothstep(float(0.14), float(0.3), alt);
  const sunGlow = sunDot.pow(sunTight).mul(sunVis);
  const sunHalo = sunDot.pow(12).mul(sunVis).mul(mix(float(0.3), float(0.04), smoothstep(float(0.3), float(0.8), alt)));
  color = color.add(vec3(1.35, 1.2, 0.95).mul(sunGlow)).add(vec3(0.9, 0.85, 0.7).mul(sunHalo));

  material.colorNode = color.mul(beatUniform.mul(0.03).add(1));

  const dome = new Mesh(new SphereGeometry(2400, 48, 32), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  raycastTransparent(dome);
  return dome;
}

// ---- cloud decks ------------------------------------------------------------

function createCloudDecks(rng: Rng) {
  const meshes: Mesh[] = [];

  function makeDeck(s: number, radius: number, tint: Color, density: number, fade: FloatUniform | null, drift: number) {
    const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
    const p = positionLocal.mul(0.0045);
    const churn = time.mul(drift);
    const cells = mx_noise_float(p.mul(2.6).add(vec3(churn, 0, 0)))
      .mul(0.6)
      .add(mx_noise_float(p.mul(7.4).add(vec3(0, churn.mul(1.6), 0))).mul(0.4))
      .mul(0.5)
      .add(0.5);
    const radial = positionLocal.length().div(radius);
    const edge = smoothstep(float(1), float(0.55), radial);
    const body = smoothstep(float(0.32), float(0.78), cells).mul(edge).mul(density);
    const colored = vec3(tint.r, tint.g, tint.b).mul(body);
    material.colorNode = fade ? colored.mul(fade) : colored;

    const mesh = new Mesh(new CircleGeometry(radius, 40), material);
    mesh.position.copy(axisPoint(s));
    mesh.quaternion.copy(AXIS_QUATERNION);
    mesh.frustumCulled = false;
    raycastTransparent(mesh);
    meshes.push(mesh);
    return mesh;
  }

  // The main deck the car punches through at the cloud-break drop, doubled for
  // thickness, plus a boiling storm floor below the start and a faint cirrus
  // sheet crossed mid-blue.
  makeDeck(CLOUD_DECK_S, 900, new Color(0.5, 0.52, 0.56), 0.7, deckFadeUniform, 0.012);
  makeDeck(CLOUD_DECK_S + 9, 850, new Color(0.62, 0.63, 0.66), 0.5, deckFadeUniform, 0.017);
  makeDeck(-70, 1100, new Color(0.3, 0.32, 0.36), 0.85, null, 0.01);
  makeDeck(CIRRUS_S, 1000, new Color(0.55, 0.6, 0.68), 0.2, null, 0.03);

  // A handful of loose cumulus billboards scattered through the storm layer so
  // the lower climb has parallax, not just distant sheets.
  const puffMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  const puffCells = mx_noise_float(positionLocal.mul(0.06)).mul(0.5).add(0.5);
  const puffRadial = positionLocal.length().div(30);
  puffMaterial.colorNode = vec3(0.42, 0.44, 0.5)
    .mul(smoothstep(float(0.3), float(0.75), puffCells))
    .mul(smoothstep(float(1), float(0.4), puffRadial))
    .mul(float(1).sub(smoothstep(float(0.25), float(0.45), altitudeUniform)).mul(0.5));
  const puffGeometry = new CircleGeometry(30, 20);
  for (let i = 0; i < 14; i += 1) {
    const s = 20 + rng() * (CLOUD_DECK_S - 60);
    const angle = rng() * Math.PI * 2;
    const radius = 60 + rng() * 220;
    const puff = new Mesh(puffGeometry, puffMaterial);
    puff.position
      .copy(axisPoint(s))
      .addScaledVector(AXIS_RIGHT, Math.cos(angle) * radius)
      .addScaledVector(AXIS_UP, Math.sin(angle) * radius * 0.5);
    puff.quaternion.copy(AXIS_QUATERNION);
    puff.rotateX(Math.PI / 2 + (rng() - 0.5) * 0.6);
    puff.frustumCulled = false;
    raycastTransparent(puff);
    meshes.push(puff);
  }

  return { meshes };
}

// ---- rain / debris streak fields --------------------------------------------

type StreakOptions = {
  count: number;
  span: number;
  back: number;
  lengthMin: number;
  lengthMax: number;
  radiusMin: number;
  radiusMax: number;
  color: () => Color;
  offset: FloatUniform;
  glow: FloatUniform;
};

// Wrap-around line streaks in the climb frame; everything scrolls DOWN the
// axis relative to the rising camera. Rain is thin and pale, debris is long
// and warm — both reuse this builder.
function createStreakField(rng: Rng, options: StreakOptions) {
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = options.radiusMin + rng() * (options.radiusMax - options.radiusMin);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * options.span;
    const length = options.lengthMin + rng() * (options.lengthMax - options.lengthMin);
    const color = options.color();
    for (const delta of [0, length]) {
      positions.push(x, y, 0);
      z0.push(start);
      dz.push(delta);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('z0', new Float32BufferAttribute(z0, 1));
  geometry.setAttribute('dz', new Float32BufferAttribute(dz, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  // Streaks travel toward -z (down the climb) as the offset accumulates.
  const wrapped = float(options.span)
    .sub(attribute<'float'>('z0', 'float').add(options.offset).mod(options.span))
    .sub(options.back);
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    wrapped.add(attribute<'float'>('dz', 'float')),
  );
  const envelope = smoothstep(float(-options.back), float(-options.back + 6), wrapped).mul(
    smoothstep(float(options.span - options.back), float(options.span - options.back - 6), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(options.glow);

  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  raycastTransparent(lines);
  const group = new Group();
  group.quaternion.copy(AXIS_QUATERNION);
  const holder = new Group();
  holder.add(group);
  group.add(lines);
  return holder;
}

// ---- the tether -------------------------------------------------------------

const COLLAR_COUNT = 34;
const COLLAR_SPACING = 14;
const collarMatrix = new Matrix4();
const collarPosition = new Vector3();

function createTether() {
  const group = new Group();

  // Twin cables, straight as truth, from below the weather to past the station.
  const cableMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  cableMaterial.colorNode = vec3(0.5, 0.53, 0.58)
    .mul(positionView.z.negate().mul(-0.006).exp())
    .mul(0.85);
  for (const side of [-0.55, 0.55]) {
    const points: Vector3[] = [];
    for (let i = 0; i <= 80; i += 1) {
      const s = -160 + ((STATION_S + 120 + 160) * i) / 80;
      points.push(tetherPoint(s).addScaledVector(AXIS_RIGHT, side));
    }
    const cable = new LineSegments(
      new BufferGeometry().setFromPoints(points.flatMap((p, i) => (i === 0 ? [] : [points[i - 1], p]))),
      cableMaterial,
    );
    cable.frustumCulled = false;
    group.add(cable);
  }

  // Collars: white service rings every 14 units, recycled through a window
  // around the camera. Their passage is the meterstick of the climb.
  const collarMesh = new InstancedCollarMesh();
  group.add(collarMesh.mesh);
  group.add(collarMesh.strobes);

  function update(camS: number) {
    collarMesh.update(camS);
  }

  return { group, update };
}

class InstancedCollarMesh {
  mesh: InstancedMesh;
  strobes: InstancedMesh;

  constructor() {
    this.mesh = new InstancedMesh(
      new TorusGeometry(0.95, 0.11, 6, 12),
      new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.5) }),
      COLLAR_COUNT,
    );
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => undefined;
    const strobeMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
    strobeMaterial.colorNode = vec3(HAZARD_ORANGE.r, HAZARD_ORANGE.g, HAZARD_ORANGE.b)
      .mul(strobeUniform.mul(1.6).add(0.25));
    this.strobes = new InstancedMesh(new BoxGeometry(0.34, 0.34, 0.34), strobeMaterial, Math.ceil(COLLAR_COUNT / 3));
    this.strobes.frustumCulled = false;
    this.strobes.raycast = () => undefined;
  }

  update(camS: number) {
    const firstIndex = Math.floor((camS - 46) / COLLAR_SPACING);
    let strobeCount = 0;
    for (let i = 0; i < COLLAR_COUNT; i += 1) {
      const index = firstIndex + i;
      const s = index * COLLAR_SPACING;
      tetherPoint(s, collarPosition);
      collarMatrix.makeBasis(AXIS_RIGHT, AXIS_UP, CLIMB_AXIS).setPosition(collarPosition);
      this.mesh.setMatrixAt(i, collarMatrix);
      if (index % 3 === 0 && strobeCount < this.strobes.count) {
        collarMatrix.setPosition(collarPosition.clone().addScaledVector(AXIS_RIGHT, 1.15));
        this.strobes.setMatrixAt(strobeCount, collarMatrix);
        strobeCount += 1;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.strobes.instanceMatrix.needsUpdate = true;
  }
}

// ---- the climber car --------------------------------------------------------

// The car rides at the bottom-right of frame: white deck plate, hazard
// chevrons, two latch pylons (the grapplers' targets), a clamp arm around the
// tether, and an amber status beacon that blinks with the music.
function createCarDeck() {
  const group = new Group();
  const cosmetic = raycastTransparent;

  const deckGeometry = new BoxGeometry(4.6, 2.3, 0.3);
  const deck = new Mesh(deckGeometry, new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.42) }));
  deck.position.set(1.5, -2.2, 3.8);
  cosmetic(deck);
  group.add(deck);
  const rim = new LineSegments(
    new EdgesGeometry(deckGeometry),
    new LineBasicMaterial(additiveMaterialParameters({ color: hdr(PANEL_WHITE, 0.7) })),
  );
  deck.add(rim);

  // Hazard chevrons across the leading edge.
  for (let i = 0; i < 3; i += 1) {
    const chevron = new Mesh(
      new BoxGeometry(0.85, 0.3, 0.05),
      new MeshBasicMaterial({ color: HAZARD_ORANGE.clone().multiplyScalar(0.6) }),
    );
    chevron.position.set(0.3 + i * 1.25, -1.15, 3.98);
    chevron.rotation.z = -0.5;
    cosmetic(chevron);
    group.add(chevron);
  }

  // Latch pylons — the hardware grapplers actually grab.
  for (const [x, y] of [[1.3, -1.5], [2.7, -1.35]] as const) {
    const pylon = new Mesh(
      new BoxGeometry(0.4, 0.4, 0.5),
      new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(1.8) }),
    );
    pylon.position.set(x, y, 3.82);
    cosmetic(pylon);
    group.add(pylon);
  }

  // Clamp arm out to the tether and a collar around it.
  const arm = new Mesh(
    new BoxGeometry(1.6, 0.35, 0.35),
    new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(2) }),
  );
  arm.position.set(3.1, -1.75, 3.8);
  arm.rotation.z = 0.32;
  cosmetic(arm);
  group.add(arm);
  const clamp = new Mesh(
    new TorusGeometry(1.15, 0.16, 6, 12),
    new MeshBasicMaterial({ color: HAZARD_ORANGE.clone().multiplyScalar(0.5) }),
  );
  clamp.position.set(3.6, -1.4, 3.8);
  cosmetic(clamp);
  group.add(clamp);

  // Status beacon + a warning lamp that reddens as the hull goes.
  const beaconMaterial = createAdditiveBasicMaterial({ color: hdr(WARN_AMBER, 1.2) });
  const beacon = new Mesh(new OctahedronGeometry(0.16, 1), beaconMaterial);
  beacon.position.set(-0.5, -1.95, 3.75);
  group.add(beacon);
  const hullLampMaterial = createAdditiveBasicMaterial({ color: hdr(PANEL_WHITE, 0.5) });
  const hullLamp = new Mesh(new BoxGeometry(0.5, 0.2, 0.1), hullLampMaterial);
  hullLamp.position.set(3.3, -2.3, 3.95);
  group.add(hullLamp);

  function update(elapsed: number, beatEnergy: number, hull: number) {
    beaconMaterial.color.copy(WARN_AMBER).multiplyScalar(0.4 + beatEnergy * 1.1);
    if (hull <= 1) {
      const flicker = 0.6 + Math.sin(elapsed * 21) * 0.4;
      hullLampMaterial.color.set(1.4 * flicker, 0.12 * flicker, 0.06 * flicker);
    } else if (hull === 2) {
      hullLampMaterial.color.set(1.1, 0.5, 0.1);
    } else {
      hullLampMaterial.color.copy(PANEL_WHITE).multiplyScalar(0.5);
    }
  }

  return { group, update };
}

// ---- the station ------------------------------------------------------------

function createStation() {
  const group = new Group();
  const center = axisPoint(STATION_S);
  group.position.copy(center);
  group.quaternion.copy(AXIS_QUATERNION);

  // Main ring.
  const ring = new Mesh(
    new TorusGeometry(30, 6, 8, 28),
    new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(1.6) }),
  );
  group.add(ring);
  const seam = new Mesh(
    new TorusGeometry(30, 6.3, 8, 28),
    createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 0.35), opacity: 0.3 }),
  );
  group.add(seam);

  // Window lights around the ring — the first thing visible from far below.
  // Merged to one mesh: they are a single draw call for the whole run.
  const windowMaterial = createAdditiveBasicMaterial({ color: hdr(new Color(1, 0.9, 0.7), 0.9) });
  const windowParts: BufferGeometry[] = [];
  for (let i = 0; i < 20; i += 1) {
    const angle = (i / 20) * Math.PI * 2;
    const box = new BoxGeometry(1.6, 1.6, 0.6);
    box.applyMatrix4(new Matrix4().setPosition(Math.cos(angle) * 30, Math.sin(angle) * 30, -3.5));
    windowParts.push(box);
  }
  group.add(new Mesh(mergeGeometries(windowParts), windowMaterial));

  // Iris petals: closed until the dock bars, then they slide open radially.
  const petals: Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const petal = new Mesh(
      new BoxGeometry(19, 11, 1.4),
      new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.28) }),
    );
    petal.userData.angle = angle;
    petal.rotation.z = angle;
    petals.push(petal);
    group.add(petal);
  }

  // The lit interior behind the petals — what the car is climbing toward.
  const mawMaterial = createAdditiveBasicMaterial({ color: hdr(new Color(1, 0.93, 0.8), 0.0), side: DoubleSide });
  const maw = new Mesh(new CircleGeometry(17, 32), mawMaterial);
  maw.position.z = 4;
  group.add(maw);

  // The beacon: the bright point the whole climb aims at.
  const beaconMaterial = createAdditiveBasicMaterial({ color: hdr(new Color(1, 0.95, 0.85), 1.6) });
  const beacon = new Mesh(new OctahedronGeometry(2.4, 1), beaconMaterial);
  beacon.position.z = -2;
  group.add(beacon);

  // Approach lights racing up the tether into the dock.
  const approach: ApproachLight[] = [];
  for (let i = 0; i < 10; i += 1) {
    const material = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 0.4) });
    const light = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), material);
    const s = STATION_S - 210 + i * 20;
    light.position.copy(tetherPoint(s).sub(center));
    light.position.applyQuaternion(AXIS_QUATERNION.clone().invert());
    light.position.x += 1.6;
    approach.push({ material, phase: i / 10 });
    group.add(light);
  }

  function update(elapsed: number, dockOpen: number, altitude: number, beatEnergy: number) {
    for (const petal of petals) {
      const angle = petal.userData.angle as number;
      const radius = 5.5 + dockOpen * 16;
      petal.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    }
    mawMaterial.color.set(1, 0.93, 0.8).multiplyScalar(dockOpen * 1.1);
    const pulse = 0.9 + beatEnergy * 0.5 + Math.sin(elapsed * 2.2) * 0.2;
    beaconMaterial.color.set(1, 0.95, 0.85).multiplyScalar((0.4 + altitude * 1.4) * pulse);
    // Strobe chase toward the aperture.
    for (const light of approach) {
      const chase = (elapsed * 0.9 + light.phase * 2) % 1;
      const on = chase < 0.18 ? 1 : 0.12;
      light.material.color.copy(HAZARD_ORANGE).multiplyScalar(on * (0.25 + altitude * 1.1));
    }
  }

  return { group, update };
}

// ---- lightning --------------------------------------------------------------

function createLightningBolts(rng: Rng) {
  type Bolt = { lines: LineSegments; material: LineBasicMaterial; life: number; side: number };
  const meshes: Bolt[] = [];
  for (let i = 0; i < LIGHTNING_TIMES.length; i += 1) {
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: new Color(0, 0, 0) }));
    const points: Vector3[] = [];
    // A jagged descent through the local cloud, with one fork.
    let cursor = new Vector3((rng() - 0.5) * 30, 40 + rng() * 20, 0);
    for (let seg = 0; seg < 9; seg += 1) {
      const next = cursor.clone().add(new Vector3((rng() - 0.5) * 14, -(8 + rng() * 7), (rng() - 0.5) * 8));
      points.push(cursor, next);
      if (seg === 4) {
        const forkEnd = next.clone().add(new Vector3((rng() - 0.5) * 22, -(12 + rng() * 8), 0));
        points.push(next.clone(), forkEnd);
      }
      cursor = next;
    }
    const lines = new LineSegments(new BufferGeometry().setFromPoints(points), material);
    lines.visible = false;
    lines.frustumCulled = false;
    raycastTransparent(lines);
    meshes.push({ lines, material, life: -1, side: i % 2 === 0 ? 1 : -1 });
  }

  function strike(index: number, camS: number) {
    const bolt = meshes[index];
    if (!bolt) return;
    const lateral = 40 + index * 14;
    bolt.lines.position
      .copy(axisPoint(camS + 60 + index * 25))
      .addScaledVector(AXIS_RIGHT, bolt.side * lateral)
      .addScaledVector(AXIS_UP, 10);
    bolt.lines.quaternion.copy(AXIS_QUATERNION);
    bolt.lines.visible = true;
    bolt.life = 0.22;
  }

  function update(dt: number) {
    for (const bolt of meshes) {
      if (bolt.life < 0) continue;
      bolt.life -= dt;
      if (bolt.life <= 0) {
        bolt.life = -1;
        bolt.lines.visible = false;
        continue;
      }
      const flicker = bolt.life > 0.14 ? 1 : Math.random() > 0.4 ? 0.9 : 0.2;
      bolt.material.color.set(1.6 * flicker, 1.7 * flicker, 2.0 * flicker);
    }
  }

  function reset() {
    for (const bolt of meshes) {
      bolt.life = -1;
      bolt.lines.visible = false;
    }
  }

  return { meshes, strike, update, reset };
}
