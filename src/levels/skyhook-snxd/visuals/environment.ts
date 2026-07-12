import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineSegments,
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
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  fract,
  mix,
  mx_noise_float,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CAR_LEAD_SECONDS,
  CLIMB_DIR,
  CLOUDBREAK_TIME,
  FRAME_RIGHT,
  FRAME_UP,
  SKYHOOK_DURATION,
  createSkyhookRail,
  railU,
  skyhookRunProgress,
  tetherPoint,
} from '../gameplay';
import {
  AMBER,
  COLD_WHITE,
  DAY_HORIZON,
  DAY_ZENITH,
  GRAPHITE,
  GUNMETAL,
  HAZARD_ORANGE,
  INDIGO_HORIZON,
  INDIGO_ZENITH,
  PANEL_SHADOW,
  PANEL_WHITE,
  SPACE_HORIZON,
  SPACE_ZENITH,
  STORM_GREY,
  STORM_ZENITH,
  hdr,
  mulberry32,
  type Rng,
} from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // beat energy 0..~1.6
export const streakOffsetUniform = uniform(0); // accumulated climb distance
export const rainGlowUniform = uniform(0.4); // storm rain visibility
export const debrisGlowUniform = uniform(0); // falling-junk streak visibility
export const skyHorizonUniform = uniform(new Vector3(STORM_GREY.r, STORM_GREY.g, STORM_GREY.b));
export const skyZenithUniform = uniform(new Vector3(STORM_ZENITH.r, STORM_ZENITH.g, STORM_ZENITH.b));

const HORIZON_SCRATCH = new Color();
const ZENITH_SCRATCH = new Color();

const STATION_S = 1005;
const TETHER_FROM = -260;
const TETHER_TO = 1080;

type CarRig = {
  group: Group;
  strobeMaterials: MeshBasicMaterial[];
  warnLampMaterial: MeshBasicMaterial;
  position: Vector3;
};

export type Environment = {
  root: Group;
  car: CarRig;
  deckY: number;
  deckCenter: Vector3;
  stationPosition: Vector3;
  update(dt: number, frame: EnvironmentFrame): void;
};

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  speed: number;
  beatEnergy: number;
  hullDamage: number; // 0..1
};

// Sky keyframes: the whole color script of the level, keyed to rail progress
// computed from the musical set pieces so the palette turns exactly on the bars.
type SkyKey = {
  p: number;
  horizon: Color;
  zenith: Color;
  fog: number;
  stars: number;
  sun: number;
  planet: number;
  rim: number;
};

function buildSkyKeys(): SkyKey[] {
  const at = (barTime: number) => skyhookRunProgress(barTime);
  const bar = (n: number) => (n / 32) * SKYHOOK_DURATION;
  return [
    { p: 0, horizon: STORM_GREY, zenith: STORM_ZENITH, fog: 0.011, stars: 0, sun: 0, planet: 0.16, rim: 0 },
    { p: at(bar(6.5)), horizon: STORM_GREY.clone().multiplyScalar(1.15), zenith: STORM_ZENITH, fog: 0.014, stars: 0, sun: 0, planet: 0.14, rim: 0 },
    { p: at(bar(7.9)), horizon: new Color(0.42, 0.44, 0.47), zenith: new Color(0.3, 0.33, 0.38), fog: 0.02, stars: 0, sun: 0.05, planet: 0.1, rim: 0 },
    { p: at(bar(8.7)), horizon: DAY_HORIZON, zenith: DAY_ZENITH, fog: 0.004, stars: 0, sun: 0.65, planet: 0.75, rim: 0.15 },
    { p: at(bar(12)), horizon: DAY_HORIZON, zenith: DAY_ZENITH.clone().multiplyScalar(0.85), fog: 0.0018, stars: 0, sun: 0.8, planet: 1.0, rim: 0.3 },
    { p: at(bar(16)), horizon: DAY_HORIZON.clone().lerp(INDIGO_HORIZON, 0.45), zenith: INDIGO_ZENITH.clone().lerp(DAY_ZENITH, 0.3), fog: 0.0008, stars: 0.12, sun: 0.9, planet: 1.0, rim: 0.5 },
    { p: at(bar(20)), horizon: INDIGO_HORIZON, zenith: INDIGO_ZENITH, fog: 0.0003, stars: 0.45, sun: 1.0, planet: 0.9, rim: 0.7 },
    { p: at(bar(25)), horizon: SPACE_HORIZON, zenith: SPACE_ZENITH, fog: 0.0001, stars: 0.85, sun: 1.05, planet: 0.8, rim: 0.85 },
    { p: 1, horizon: SPACE_HORIZON.clone().multiplyScalar(0.7), zenith: SPACE_ZENITH, fog: 0.00004, stars: 1, sun: 1.1, planet: 0.75, rim: 0.9 },
  ];
}

const SUN_DIRECTION = new Vector3(-0.52, 0.72, -0.46).normalize();

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = STORM_ZENITH.clone();
  scene.fog = new FogExp2(STORM_GREY.clone(), 0.011);

  const root = new Group();
  const rng = mulberry32(20260712);
  const curve = createSkyhookRail();
  const skyKeys = buildSkyKeys();

  const skydome = createSkydome();
  root.add(skydome);

  const { stars, starsMaterial } = createStars(rng);
  root.add(stars);

  const { sun, sunCore, sunHalo } = createSun();
  root.add(sun);

  const { planet, planetLight, rimShell, rimMaterial } = createPlanet();
  root.add(planet);
  root.add(rimShell);

  const deckPoint = curve.getPointAt(railU(CLOUDBREAK_TIME + 0.28));
  const deckY = deckPoint.y;
  const deckCenter = deckPoint.clone();
  root.add(createCloudDeck(rng, deckCenter));

  const wisps = createWisps(rng, curve, deckY);
  root.add(wisps.group);

  const junk = createFallingJunk(rng, curve);
  root.add(junk.group);

  root.add(createTetherAndStation());
  const stationPosition = tetherPoint(STATION_S);

  const doors = createDockDoors();
  root.add(doors.group);

  const { rain, debris } = createStreaks(rng);
  root.add(rain);
  root.add(debris);

  const car = createCar();
  root.add(car.group);

  scene.add(root);

  let smoothedCarPosition: Vector3 | null = null;

  function applySky(progress: number) {
    let a = skyKeys[0];
    let b = skyKeys[skyKeys.length - 1];
    for (let i = 1; i < skyKeys.length; i += 1) {
      if (progress <= skyKeys[i].p) {
        a = skyKeys[i - 1];
        b = skyKeys[i];
        break;
      }
      a = skyKeys[i];
      b = skyKeys[i];
    }
    const span = Math.max(0.0001, b.p - a.p);
    const t = Math.min(1, Math.max(0, (progress - a.p) / span));
    HORIZON_SCRATCH.copy(a.horizon).lerp(b.horizon, t);
    ZENITH_SCRATCH.copy(a.zenith).lerp(b.zenith, t);
    (skyHorizonUniform.value as Vector3).set(HORIZON_SCRATCH.r, HORIZON_SCRATCH.g, HORIZON_SCRATCH.b);
    (skyZenithUniform.value as Vector3).set(ZENITH_SCRATCH.r, ZENITH_SCRATCH.g, ZENITH_SCRATCH.b);
    (scene.background as Color).copy(ZENITH_SCRATCH);
    const fog = scene.fog as FogExp2;
    fog.color.copy(HORIZON_SCRATCH);
    fog.density = a.fog + (b.fog - a.fog) * t;
    starsMaterial.opacity = a.stars + (b.stars - a.stars) * t;
    const sunLevel = a.sun + (b.sun - a.sun) * t;
    sunCore.color.copy(COLD_WHITE).multiplyScalar(1.1 + sunLevel * 1.6);
    sunHalo.color.copy(new Color(1, 0.93, 0.8)).multiplyScalar(sunLevel * 0.22);
    sun.visible = sunLevel > 0.02;
    planetLight.value = a.planet + (b.planet - a.planet) * t;
    rimMaterial.value = a.rim + (b.rim - a.rim) * t;
  }

  return {
    root,
    car,
    deckY,
    deckCenter,
    stationPosition,
    update(dt, frame) {
      const cameraPos = frame.camera.position;
      const progress = frame.running ? skyhookRunProgress(frame.runTime) : 0;

      applySky(progress);

      skydome.position.copy(cameraPos);
      stars.position.copy(cameraPos);
      stars.rotation.y = frame.elapsed * 0.004;
      sun.position.copy(cameraPos).addScaledVector(SUN_DIRECTION, 386);
      sun.lookAt(cameraPos);

      // The planet drops away as the climb proceeds; its curvature is the
      // whole "world falling away" read.
      const drop = 315 + progress * 265;
      planet.position.set(cameraPos.x, cameraPos.y - drop, cameraPos.z - 85);
      rimShell.position.copy(planet.position);

      // Rain thick in the storm, gone above the deck; junk streaks appear in
      // the upper half of the climb.
      const belowDeck = Math.min(1, Math.max(0, (deckY - 12 - cameraPos.y) / 40));
      rainGlowUniform.value = frame.running ? belowDeck * 0.55 : 0.4;
      debrisGlowUniform.value = smoothstepNumber(0.42, 0.62, progress) * 0.6;
      rain.position.copy(cameraPos);
      debris.position.copy(cameraPos);
      streakOffsetUniform.value = (streakOffsetUniform.value + dt * (frame.speed * 24 + 26)) % 10000;

      wisps.update(progress, dt);
      junk.update(progress, dt);
      for (const item of junk.items) {
        item.offset.y -= dt * 20;
      }

      // Car: rides the tether ahead of the camera, and for the last stretch
      // pulls away into the station's open bay.
      const baseU = skyhookRunProgress(Math.min(SKYHOOK_DURATION, (frame.running ? frame.runTime : 0) + CAR_LEAD_SECONDS));
      let carS = curve.getPointAt(Math.min(1, baseU)).dot(CLIMB_DIR);
      const dockPull = smoothstepNumber(0.965, 1.0, progress);
      carS = Math.max(carS, carS + (STATION_S + 7 - carS) * dockPull);
      tetherPoint(carS, car.position);
      if (!smoothedCarPosition) {
        smoothedCarPosition = car.position.clone();
      } else if (frame.running) {
        smoothedCarPosition.lerp(car.position, Math.min(1, dt * 9));
      } else {
        smoothedCarPosition.copy(car.position);
      }
      car.group.position.copy(smoothedCarPosition);

      // Strobes blink on the beat; the warn lamp flickers with hull damage.
      const strobe = 0.4 + frame.beatEnergy * 1.6;
      for (const [index, material] of car.strobeMaterials.entries()) {
        material.color.copy(COLD_WHITE).multiplyScalar(strobe * (index === 0 ? 1 : 0.75));
      }
      const warn = frame.hullDamage <= 0
        ? 0.12
        : 0.5 + frame.hullDamage * (0.9 + Math.sin(frame.elapsed * 11) * 0.7);
      car.warnLampMaterial.color.copy(HAZARD_ORANGE).multiplyScalar(warn);

      // Station doors iris open for the arrival.
      const open = smoothstepNumber(0.9, 0.985, progress);
      doors.left.position.x = -7 - open * 15;
      doors.right.position.x = 7 + open * 15;
    },
  };
}

function smoothstepNumber(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---- sky dome -------------------------------------------------------------------

function createSkydome() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  const h = positionLocal.y.div(430);
  const up = smoothstep(float(0), float(0.8), h);
  let color = mix(skyHorizonUniform, skyZenithUniform, up.pow(0.72));
  const down = h.negate().mul(2.4).clamp(0, 1);
  color = mix(color, skyHorizonUniform.mul(0.62), down);
  material.colorNode = color;
  const dome = new Mesh(new SphereGeometry(430, 36, 24), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

// ---- stars ----------------------------------------------------------------------

function createStars(rng: Rng) {
  const COUNT = 900;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i += 1) {
    const v = new Vector3(rng() * 2 - 1, rng() * 1.6 - 0.25, rng() * 2 - 1).normalize().multiplyScalar(405);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
    const warm = rng();
    const intensity = 0.35 + rng() * 0.65;
    colors[i * 3] = intensity * (warm > 0.8 ? 1 : 0.85);
    colors[i * 3 + 1] = intensity * 0.9;
    colors[i * 3 + 2] = intensity * (warm > 0.8 ? 0.8 : 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const starsMaterial = new PointsMaterial(additiveMaterialParameters({
    size: 2.1,
    vertexColors: true,
    sizeAttenuation: false,
    opacity: 0,
    fog: false,
  }));
  starsMaterial.transparent = true;
  const stars = new Points(geometry, starsMaterial);
  stars.frustumCulled = false;
  stars.userData.raildIgnoreOcclusion = true;
  return { stars, starsMaterial };
}

// ---- sun ------------------------------------------------------------------------

function createSun() {
  const sun = new Group();
  const sunCore = createAdditiveBasicMaterial({ color: hdr(COLD_WHITE, 1.4), side: DoubleSide });
  sunCore.fog = false;
  const sunHalo = createAdditiveBasicMaterial({ color: hdr(new Color(1, 0.93, 0.8), 0.3), side: DoubleSide });
  sunHalo.fog = false;
  const core = new Mesh(new CircleGeometry(7, 28), sunCore);
  const halo = new Mesh(new CircleGeometry(24, 28), sunHalo);
  halo.position.z = -1;
  sun.add(core, halo);
  sun.visible = false;
  sun.userData.raildIgnoreOcclusion = true;
  return { sun, sunCore, sunHalo };
}

// ---- planet ---------------------------------------------------------------------

function createPlanet() {
  const planetLight = uniform(0.2);
  const material = new MeshBasicNodeMaterial({ fog: false });
  const p = positionLocal.mul(0.011);
  const drift = time.mul(0.008);
  const weather = mx_noise_float(p.mul(2.4).add(vec3(drift, 0, drift.mul(0.6))))
    .mul(0.55)
    .add(mx_noise_float(p.mul(6.8)).mul(0.3))
    .add(mx_noise_float(p.mul(17)).mul(0.15))
    .mul(0.5)
    .add(0.5);
  const ocean = vec3(0.05, 0.1, 0.17);
  const land = vec3(0.1, 0.13, 0.12);
  const cloud = vec3(0.75, 0.79, 0.83);
  let surface = mix(ocean, land, smoothstep(float(0.42), float(0.6), weather));
  surface = mix(surface, cloud, smoothstep(float(0.62), float(0.85), weather));
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(viewDirection).abs()).pow(2.2);
  const rimLight = vec3(0.5, 0.7, 1.0).mul(rim).mul(0.7);
  material.colorNode = surface.mul(planetLight).add(rimLight.mul(planetLight));
  const planet = new Mesh(new SphereGeometry(300, 56, 36), material);
  planet.frustumCulled = false;
  planet.userData.raildIgnoreOcclusion = true;

  // Thin-atmosphere shell: the blue line that gets sharper the higher you climb.
  const rimMaterial = uniform(0.2);
  const shellMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  const shellView = cameraPosition.sub(positionWorld).normalize();
  const shellRim = float(1).sub(normalWorld.dot(shellView).abs()).pow(3.4);
  shellMaterial.colorNode = vec3(0.35, 0.6, 1.0).mul(shellRim).mul(rimMaterial);
  const rimShell = new Mesh(new SphereGeometry(307, 48, 30), shellMaterial);
  rimShell.frustumCulled = false;
  rimShell.userData.raildIgnoreOcclusion = true;

  return { planet, planetLight, rimShell, rimMaterial };
}

// ---- cloud deck -------------------------------------------------------------------

// The storm ceiling: an annular field of flat puffs with a corridor hole the
// tether climbs through. Additive and depthWrite-free, so it never occludes
// targets; the punch-through moment is sold by fog, flash, and the streaks.
// Soft round vapour material: normal blending, fogged (fog is what hides the
// deck inside the storm), with a radial alpha falloff so puffs read as cloud
// masses instead of hard-edged plates. A few shared opacity tiers keep the
// shader count small.
function makePuffMaterial(color: Color, opacity: number) {
  const material = new MeshBasicNodeMaterial({
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  material.colorNode = vec3(color.r, color.g, color.b);
  material.opacityNode = smoothstep(float(0.5), float(0.12), uv().sub(0.5).length()).mul(opacity);
  material.opacity = Math.min(0.3, opacity);
  return material;
}

function createCloudDeck(rng: Rng, center: Vector3) {
  const group = new Group();
  const geometry = new PlaneGeometry(1, 1);
  const deckColor = new Color(0.56, 0.58, 0.61);
  const tiers = [
    makePuffMaterial(deckColor, 0.5),
    makePuffMaterial(deckColor, 0.34),
    makePuffMaterial(deckColor, 0.09),
  ];
  const addPuff = (radiusMin: number, radiusMax: number, size: [number, number], tier: number, yJitter: number, lift: number) => {
    const angle = rng() * Math.PI * 2;
    const radius = radiusMin + rng() * (radiusMax - radiusMin);
    const puff = new Mesh(geometry, tiers[Math.min(tiers.length - 1, tier + (rng() < 0.4 ? 1 : 0))]);
    puff.position.set(
      center.x + Math.cos(angle) * radius,
      center.y + (rng() - 0.5) * yJitter + lift,
      center.z + Math.sin(angle) * radius,
    );
    puff.rotation.x = -Math.PI / 2;
    puff.rotation.z = rng() * Math.PI * 2;
    const scale = size[0] + rng() * (size[1] - size[0]);
    puff.scale.set(scale, scale * (0.7 + rng() * 0.5), 1);
    group.add(puff);
  };
  for (let i = 0; i < 108; i += 1) addPuff(46, 250, [30, 80], 0, 12, 0);
  for (let i = 0; i < 22; i += 1) addPuff(30, 48, [12, 26], 1, 8, -3);
  group.userData.raildIgnoreOcclusion = true;
  return group;
}

// ---- under-deck wisps ---------------------------------------------------------------

function createWisps(rng: Rng, curve: ReturnType<typeof createSkyhookRail>, deckY: number) {
  const geometry = new PlaneGeometry(1, 1);
  const material = makePuffMaterial(new Color(0.42, 0.45, 0.5), 0.3);
  const deckU = railU(CLOUDBREAK_TIME) * 0.95;
  const field = scatterAlongRail(curve, {
    count: 26,
    seed: 20260712,
    rng,
    window: { behind: 40, ahead: 150 },
    alignToRail: false,
    make() {
      const wisp = new Mesh(geometry, material);
      wisp.rotation.x = -Math.PI / 2 + (rng() - 0.5) * 0.5;
      wisp.rotation.z = rng() * Math.PI * 2;
      const scale = 9 + rng() * 16;
      wisp.scale.set(scale, scale * 0.6, 1);
      wisp.userData.raildIgnoreOcclusion = true;
      return wisp;
    },
    place(_index, placeRng) {
      const angle = placeRng() * Math.PI * 2;
      const radius = 16 + placeRng() * 60;
      return {
        u: placeRng() * deckU,
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.5, 0),
      };
    },
    onUpdate(item) {
      // No wisps above the storm ceiling.
      if (item.object.position.y > deckY - 8) item.object.visible = false;
    },
  });
  return field;
}

// ---- falling junk (upper climb) -----------------------------------------------------

function createFallingJunk(rng: Rng, curve: ReturnType<typeof createSkyhookRail>): ScatterField {
  const dark = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.7) });
  const field = scatterAlongRail(curve, {
    count: 18,
    seed: 20260713,
    rng,
    window: { behind: 50, ahead: 220 },
    alignToRail: false,
    make(_index, makeRng) {
      const chunk = new Group();
      const body = new Mesh(new BoxGeometry(0.6 + makeRng() * 1.8, 0.3 + makeRng() * 0.9, 0.5 + makeRng() * 1.4), dark);
      chunk.add(body);
      const glint = new Mesh(
        new BoxGeometry(0.1, 0.1, 1.6 + makeRng() * 1.6),
        createAdditiveBasicMaterial({ color: hdr(COLD_WHITE, 0.5) }),
      );
      glint.position.y = 0.2;
      chunk.add(glint);
      chunk.rotation.set(makeRng() * 3, makeRng() * 3, makeRng() * 3);
      chunk.userData.raildIgnoreOcclusion = true;
      return chunk;
    },
    place(_index, placeRng) {
      const angle = placeRng() * Math.PI * 2;
      const radius = 30 + placeRng() * 70;
      return {
        u: 0.5 + placeRng() * 0.5,
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7 + 20, 0),
      };
    },
    onUpdate(item, dt) {
      item.object.visible = item.object.visible && debrisGlowUniform.value > 0.03;
      item.object.rotation.x += dt * 0.8;
      item.object.rotation.z += dt * 0.5;
    },
  });
  return field;
}

// ---- tether and station -------------------------------------------------------------

function climbFrameGroup() {
  const group = new Group();
  // (right, frameUp, climb) is left-handed; negate X to get a proper rotation.
  // The tether, station, and car are built left-right symmetric, so the
  // mirrored local X axis costs nothing.
  const basisX = FRAME_RIGHT.clone().negate();
  group.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(basisX, FRAME_UP, CLIMB_DIR));
  group.position.copy(tetherPoint(0));
  return group;
}

function createTetherAndStation() {
  const group = climbFrameGroup();
  const length = TETHER_TO - TETHER_FROM;
  const mid = (TETHER_TO + TETHER_FROM) / 2;

  // Twin chords of the ribbon.
  // The ladder members are pencil-thin: a centre-point occlusion ray through
  // them reads as a full block, so they opt out of the occlusion audit while
  // the genuinely solid pieces (station panels, doors, the car) stay honest.
  const chordMaterial = new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(0.85) });
  for (const x of [-1.05, 1.05]) {
    const chord = new Mesh(new BoxGeometry(0.32, 0.32, length), chordMaterial);
    chord.position.set(x, 0, mid);
    chord.frustumCulled = false;
    chord.userData.raildIgnoreOcclusion = true;
    group.add(chord);
  }

  // Rungs.
  const rungGeometries: BufferGeometry[] = [];
  for (let z = TETHER_FROM; z < TETHER_TO; z += 7) {
    rungGeometries.push(new BoxGeometry(2.34, 0.12, 0.12).applyMatrix4(new Matrix4().makeTranslation(0, 0, z)));
  }
  const rungs = new Mesh(mergeGeometries(rungGeometries), new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(0.75) }));
  rungs.frustumCulled = false;
  rungs.userData.raildIgnoreOcclusion = true;
  group.add(rungs);
  for (const geometry of rungGeometries) geometry.dispose();

  // Collars every 47 m with hazard marker lamps: the odometer of the climb.
  const collarGeometries: BufferGeometry[] = [];
  const lampGeometries: BufferGeometry[] = [];
  for (let z = TETHER_FROM + 20; z < TETHER_TO - 40; z += 47) {
    for (const [w, h, x, y] of [
      [3.0, 0.22, 0, 1.5],
      [3.0, 0.22, 0, -1.5],
      [0.22, 3.0, 1.5, 0],
      [0.22, 3.0, -1.5, 0],
    ] as const) {
      collarGeometries.push(new BoxGeometry(w, h, 0.6).applyMatrix4(new Matrix4().makeTranslation(x, y, z)));
    }
    lampGeometries.push(new BoxGeometry(0.6, 0.3, 0.12).applyMatrix4(new Matrix4().makeTranslation(z % 94 < 47 ? 1.9 : -1.9, 0, z)));
  }
  const collars = new Mesh(mergeGeometries(collarGeometries), new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.58) }));
  collars.frustumCulled = false;
  collars.userData.raildIgnoreOcclusion = true;
  group.add(collars);
  for (const geometry of collarGeometries) geometry.dispose();

  const lampMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  const chase = fract(positionLocal.z.mul(0.008).sub(time.mul(0.35))).pow(6);
  lampMaterial.colorNode = vec3(HAZARD_ORANGE.r, HAZARD_ORANGE.g, HAZARD_ORANGE.b)
    .mul(chase.mul(2.0).add(0.7))
    .mul(beatUniform.mul(0.7).add(0.8));
  const lamps = new Mesh(mergeGeometries(lampGeometries), lampMaterial);
  lamps.frustumCulled = false;
  group.add(lamps);
  for (const geometry of lampGeometries) geometry.dispose();

  // Power pulses racing up the chords: the tether is alive and feeding the climb.
  const pulsePositions: number[] = [];
  for (const x of [-0.85, 0.85]) {
    pulsePositions.push(x, 0.14, TETHER_FROM, x, 0.14, TETHER_TO);
  }
  const pulseGeometry = new BufferGeometry();
  pulseGeometry.setAttribute('position', new Float32BufferAttribute(pulsePositions, 3));
  const pulseMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  pulseMaterial.colorNode = vec3(COLD_WHITE.r, COLD_WHITE.g, COLD_WHITE.b)
    .mul(fract(positionLocal.z.mul(0.03).sub(time.mul(1.1))).pow(14).mul(2.2).add(0.4));
  const pulses = new LineSegments(pulseGeometry, pulseMaterial);
  pulses.frustumCulled = false;
  group.add(pulses);

  // The station: an octagonal docking collar at the top of the world.
  const collarFill = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.68) });
  const collarShadow = new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(1.15) });
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const panel = new Mesh(new BoxGeometry(19, 5.4, 7), i % 2 === 0 ? collarFill : collarShadow);
    panel.position.set(Math.cos(angle) * 23, Math.sin(angle) * 23, STATION_S);
    panel.rotation.z = angle + Math.PI / 2;
    group.add(panel);
  }
  // Inner guide ring, hazard orange, facing the climb.
  const ringGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const matrix = new Matrix4()
      .makeTranslation(Math.cos(angle) * 16.4, Math.sin(angle) * 16.4, STATION_S - 3.4)
      .multiply(new Matrix4().makeRotationZ(angle + Math.PI / 2));
    ringGeometries.push(new BoxGeometry(12.6, 0.7, 0.4).applyMatrix4(matrix));
  }
  const ringMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  ringMaterial.colorNode = vec3(HAZARD_ORANGE.r, HAZARD_ORANGE.g, HAZARD_ORANGE.b)
    .mul(beatUniform.mul(0.6).add(1.25));
  const guideRing = new Mesh(mergeGeometries(ringGeometries), ringMaterial);
  group.add(guideRing);
  for (const geometry of ringGeometries) geometry.dispose();

  // Bay interior glow, revealed as the doors open.
  const interior = new Mesh(
    new CircleGeometry(15.5, 24),
    createAdditiveBasicMaterial({ color: hdr(new Color(1, 0.9, 0.72), 0.85), side: DoubleSide }),
  );
  interior.position.set(0, 0, STATION_S + 9);
  group.add(interior);

  // Approach lane lights: paired lamps rushing toward the bay.
  const lanePositions: BufferGeometry[] = [];
  for (let z = 790; z < STATION_S - 8; z += 12) {
    for (const x of [-3.4, 3.4]) {
      lanePositions.push(new BoxGeometry(0.5, 0.24, 0.12).applyMatrix4(new Matrix4().makeTranslation(x, 0, z)));
    }
  }
  const laneMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  const laneChase = fract(positionLocal.z.mul(0.02).sub(time.mul(1.3))).pow(10);
  laneMaterial.colorNode = vec3(COLD_WHITE.r, COLD_WHITE.g, COLD_WHITE.b)
    .mul(laneChase.mul(2.4).add(0.3));
  const lane = new Mesh(mergeGeometries(lanePositions), laneMaterial);
  lane.frustumCulled = false;
  group.add(lane);
  for (const geometry of lanePositions) geometry.dispose();

  return group;
}

function createDockDoors() {
  const group = climbFrameGroup();
  const material = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.46) });
  const stripe = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 1.0) });
  const makeDoor = (side: number) => {
    const door = new Group();
    const slab = new Mesh(new BoxGeometry(14.5, 29, 1.4), material);
    door.add(slab);
    const strip = new Mesh(new BoxGeometry(0.6, 29, 0.3), stripe);
    strip.position.set(side * -7, 0, 0.8);
    door.add(strip);
    door.position.set(side * 7, 0, STATION_S - 1.5);
    group.add(door);
    return door;
  };
  return { group, left: makeDoor(-1), right: makeDoor(1) };
}

// ---- streak fields (rain, falling junk slivers) ----------------------------------------

const STREAK_SPAN = 64;
const STREAK_BACK = 34;

function makeStreakLines(
  rng: Rng,
  count: number,
  color: () => Color,
  lengthRange: [number, number],
  glow: typeof rainGlowUniform,
) {
  const positions: number[] = [];
  const y0: number[] = [];
  const dy: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 3.5 + rng() * 11;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = lengthRange[0] + rng() * (lengthRange[1] - lengthRange[0]);
    const c = color();
    for (const delta of [0, length]) {
      positions.push(x, 0, z);
      y0.push(start);
      dy.push(delta);
      colors.push(c.r, c.g, c.b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('y0', new Float32BufferAttribute(y0, 1));
  geometry.setAttribute('dy', new Float32BufferAttribute(dy, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({ fog: false }));
  const wrapped = attribute<'float'>('y0', 'float')
    .sub(streakOffsetUniform)
    .mod(STREAK_SPAN)
    .sub(STREAK_BACK);
  material.positionNode = vec3(
    positionLocal.x,
    wrapped.add(attribute<'float'>('dy', 'float')),
    positionLocal.z,
  );
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 8), wrapped).mul(
    smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 6), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(glow);

  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

function createStreaks(rng: Rng) {
  // Rain: dense pale streaks. Junk slivers: sparse, brighter, warm-tinged.
  const rain = makeStreakLines(
    rng,
    210,
    () => new Color(0.55, 0.6, 0.68).multiplyScalar(0.25 + rng() * 0.5),
    [2.2, 5],
    rainGlowUniform,
  );
  const debris = makeStreakLines(
    rng,
    34,
    () => (rng() < 0.75 ? COLD_WHITE.clone() : AMBER.clone()).multiplyScalar(0.3 + rng() * 0.6),
    [1.2, 2.6],
    debrisGlowUniform,
  );
  return { rain, debris };
}

// ---- the climber car -------------------------------------------------------------------

function createCar(): CarRig {
  const group = climbFrameGroup();
  group.position.set(0, 0, 0);

  const white = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.56) });
  const lighter = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.68) });
  const shadow = new MeshBasicMaterial({ color: PANEL_SHADOW.clone() });

  // Body hangs below the ribbon; grip shoes clamp the chords above it.
  const body = new Mesh(new BoxGeometry(2.5, 2.1, 3.1), white);
  body.position.set(0, -1.75, 0);
  group.add(body);
  const roof = new Mesh(new BoxGeometry(2.1, 0.35, 2.6), lighter);
  roof.position.set(0, -0.6, 0);
  group.add(roof);
  const skirt = new Mesh(new BoxGeometry(2.2, 0.5, 2.7), shadow);
  skirt.position.set(0, -2.95, 0);
  group.add(skirt);

  for (const side of [-0.85, 0.85]) {
    const shoe = new Mesh(new BoxGeometry(0.55, 0.6, 1.7), shadow);
    shoe.position.set(side, 0, 0);
    group.add(shoe);
    const arm = new Mesh(new BoxGeometry(0.3, 1.2, 0.4), white);
    arm.position.set(side, -0.62, 0);
    group.add(arm);
  }

  // Hazard chevron band around the hull.
  const chevron = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 0.95) });
  for (const [w, h, d, x, y, z] of [
    [2.54, 0.34, 0.1, 0, -1.5, 1.58],
    [2.54, 0.34, 0.1, 0, -1.5, -1.58],
    [0.1, 0.34, 3.14, 1.28, -1.5, 0],
    [0.1, 0.34, 3.14, -1.28, -1.5, 0],
  ] as const) {
    const band = new Mesh(new BoxGeometry(w, h, d), chevron);
    band.position.set(x, y, z);
    group.add(band);
  }

  // Nav strobes and the hull warning lamp.
  const strobeMaterials: MeshBasicMaterial[] = [];
  for (const [x, z] of [[1.1, 1.4], [-1.1, -1.4]] as const) {
    const strobeMaterial = createAdditiveBasicMaterial({ color: hdr(COLD_WHITE, 0.6) });
    const strobe = new Mesh(new SphereGeometry(0.14, 8, 6), strobeMaterial);
    strobe.position.set(x, -0.48, z);
    group.add(strobe);
    strobeMaterials.push(strobeMaterial);
  }
  const warnLampMaterial = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 0.12) });
  const warnLamp = new Mesh(new SphereGeometry(0.2, 8, 6), warnLampMaterial);
  warnLamp.position.set(0, -1.05, 1.62);
  group.add(warnLamp);

  return { group, strobeMaterials, warnLampMaterial, position: new Vector3() };
}
