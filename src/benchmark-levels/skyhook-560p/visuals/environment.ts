import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Object3D,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { createAtmosphereRamp } from '../../../engine/environment-kit';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CLIMB_HEIGHT,
  TETHER_OFFSET_X,
  TETHER_OFFSET_Y,
  climbOffset,
  createSkyhookRail,
  skyhookRunProgress,
} from '../gameplay';
import { DECK_TIME, THIN_TIME, DESCENDER_TIME, DOCK_TIME, SKYHOOK_TIME } from '../timing';
import {
  CLOUD_GREY,
  CLOUD_LIT,
  HAZARD,
  HAZARD_DEEP,
  PANEL_DARK,
  PANEL_GREY,
  PANEL_WHITE,
  SKY_INDIGO,
  SKY_STORM,
  SKY_SUNLIT,
  SKY_VOID,
  STARLIGHT,
  STEEL,
  SUNLIGHT,
  hdr,
  mulberry32,
} from './palette';

// The whole world is one vertical line and the air around it. Everything else
// in the frame — cloud, rain, stars, the station, the planet — exists to say
// how high the car has got, and every one of those layers is switched by
// altitude rather than by clock time.

const rail = createSkyhookRail();
const RAIL_LENGTH = rail.getLength();

export const DECK_U = skyhookRunProgress(DECK_TIME);
export const THIN_U = skyhookRunProgress(THIN_TIME);
export const DESCENDER_U = skyhookRunProgress(DESCENDER_TIME);
export const DOCK_U = skyhookRunProgress(DOCK_TIME);
const STATION_U = skyhookRunProgress(SKYHOOK_TIME.bar(37.7));

const DECK_Y = rail.getPointAt(DECK_U).y;

const TICK_SPACING = 4.2;
const TICK_COUNT = 46;
const COLLAR_SPACING = 24;
const COLLAR_COUNT = 13;
const CLOUD_COUNT = 15;
const RAIN_SEGMENTS = 90;
const STAR_COUNT = 780;

export type Environment = {
  root: Group;
  tether: Group;
  ticks: Mesh[];
  collars: Group[];
  clouds: Group[];
  cloudState: Array<{ y: number; radius: number; angle: number; scale: number; spin: number }>;
  rain: LineSegments;
  rainPositions: Float32Array;
  stars: Points;
  starMaterial: PointsMaterial;
  sun: Group;
  sunMaterials: MeshBasicMaterial[];
  sky: Group;
  planet: Group;
  planetMaterials: MeshBasicMaterial[];
  cloudFloor: Mesh;
  station: Group;
  stationLights: MeshBasicMaterial[];
  cowl: Group;
  cowlAlarms: MeshBasicMaterial[];
  cowlSparkAnchors: Vector3[];
  applyAtmosphere: (progress: number) => void;
};

/**
 * Atmosphere and matte-painting layers — cloud, rain, stars, the sun, the
 * planet — are translucent or effectively at infinity. They must never count as
 * solid geometry in front of a target, so they opt out of raycasting entirely.
 * Only the tether, the station and the car's own cowl can really block a shot.
 */
function makeNonOccluding(object: Object3D) {
  object.traverse((child) => {
    child.raycast = () => {};
  });
  return object;
}

// ---- tether ------------------------------------------------------------------

/** Two crossed ribbons: the tether reads as a solid strap from any angle. */
function createTetherRibbon() {
  const group = new Group();
  const segments = 150;
  const halfWidth = 0.62;

  for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const point = climbOffset(rail, i / segments, TETHER_OFFSET_X, TETHER_OFFSET_Y);
      for (const [side, sign] of [[0, -1], [1, 1]] as const) {
        const index = (i * 2 + side) * 3;
        positions[index] = point.x + axis.x * halfWidth * sign;
        positions[index + 1] = point.y;
        positions[index + 2] = point.z + axis.z * halfWidth * sign;
      }
      if (i < segments) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    group.add(new Mesh(geometry, new MeshBasicMaterial({ color: PANEL_GREY.clone().multiplyScalar(0.8), side: DoubleSide })));
  }
  return group;
}

// ---- clouds ------------------------------------------------------------------

function createCloud(rng: () => number) {
  const group = new Group();
  const lobes = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < lobes; i += 1) {
    const geometry = new SphereGeometry(1, 7, 5);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({
      color: CLOUD_GREY.clone(),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }));
    mesh.position.set((rng() - 0.5) * 34, (rng() - 0.5) * 9, (rng() - 0.5) * 34);
    mesh.scale.set(10 + rng() * 16, 3.4 + rng() * 3, 10 + rng() * 16);
    group.add(mesh);
  }
  return group;
}

// ---- station -----------------------------------------------------------------

// The dock: a ring truss around the ribbon with a lit throat the car runs into.
function createStation(lights: MeshBasicMaterial[]) {
  const group = new Group();

  const throatGeometry = new CylinderGeometry(30, 30, 150, 20, 1, true);
  throatGeometry.rotateX(Math.PI / 2);
  const throat = new Mesh(throatGeometry, new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.5), side: BackSide }));
  throat.position.z = 78;
  group.add(throat);

  for (let i = 0; i < 9; i += 1) {
    const rib = new Mesh(new TorusGeometry(29.6, 1.5, 5, 22), new MeshBasicMaterial({ color: PANEL_GREY }));
    rib.position.z = 14 + i * 16;
    group.add(rib);
    const strip = new Mesh(new TorusGeometry(28, 0.5, 4, 22), new MeshBasicMaterial({ color: hdr(SUNLIGHT, 0.6) }));
    strip.position.z = 22 + i * 16;
    lights.push(strip.material as MeshBasicMaterial);
    group.add(strip);
  }

  const mouth = new Mesh(new TorusGeometry(31, 3.4, 6, 28), new MeshBasicMaterial({ color: PANEL_WHITE }));
  group.add(mouth);
  const hazardMouth = new Mesh(new TorusGeometry(34.5, 1.6, 5, 28), new MeshBasicMaterial({ color: hdr(HAZARD, 0.8) }));
  lights.push(hazardMouth.material as MeshBasicMaterial);
  group.add(hazardMouth);

  // Outer truss: spokes and a counterweight hoop, so the dock has mass on
  // approach. It sweeps past outside the aperture and is never cover.
  const truss = new Group();
  truss.userData.raildIgnoreOcclusion = true;
  group.add(truss);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const spoke = new Mesh(new BoxGeometry(2.2, 46, 2.2), new MeshBasicMaterial({ color: STEEL.clone().multiplyScalar(0.6) }));
    spoke.position.set(Math.cos(angle) * 54, Math.sin(angle) * 54, 6);
    spoke.rotation.z = angle + Math.PI / 2;
    truss.add(spoke);
    const pod = new Mesh(new BoxGeometry(9, 9, 14), new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.75) }));
    pod.position.set(Math.cos(angle) * 78, Math.sin(angle) * 78, 4);
    truss.add(pod);
    const beacon = new Mesh(new CircleGeometry(1.6, 8), new MeshBasicMaterial({ color: hdr(HAZARD, 1.4), side: DoubleSide }));
    beacon.position.set(Math.cos(angle) * 78, Math.sin(angle) * 78, -3.5);
    lights.push(beacon.material as MeshBasicMaterial);
    truss.add(beacon);
  }
  const hoop = new Mesh(new TorusGeometry(78, 2.2, 6, 40), new MeshBasicMaterial({ color: PANEL_GREY }));
  truss.add(hoop);

  return group;
}

// ---- climber car -------------------------------------------------------------

// The cowl the player is riding in: a lip of white panel across the bottom of
// the frame, corner struts, and two clamp arms reaching out to the ribbon. It
// is the thing the latchers bite and the thing the Descender wants to tear off.
function createCowl(alarms: MeshBasicMaterial[], sparkAnchors: Vector3[]) {
  const group = new Group();

  // Everything here is deliberately pinned to the bottom lip and the lower-left
  // corner of the frame. The car has to be visible — it is what the latchers
  // bite and what the Descender is trying to tear apart — but it must never be
  // somewhere a target can hide behind it.
  const lip = new Mesh(new BoxGeometry(13, 0.8, 3.0), new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.26) }));
  lip.position.set(0, -4.55, -6.1);
  lip.rotation.x = -0.34;
  group.add(lip);

  const chevrons = new Mesh(new BoxGeometry(11.4, 0.34, 0.3), new MeshBasicMaterial({ color: hdr(HAZARD, 0.5) }));
  chevrons.position.set(0, -4.24, -5.6);
  chevrons.rotation.x = -0.34;
  group.add(chevrons);

  for (const side of [-1, 1]) {
    const strut = new Mesh(new BoxGeometry(0.4, 1.7, 0.4), new MeshBasicMaterial({ color: PANEL_GREY.clone().multiplyScalar(0.7) }));
    strut.position.set(side * 6.5, -3.85, -6.4);
    strut.rotation.z = side * 0.24;
    group.add(strut);

    const lamp = new Mesh(new CircleGeometry(0.18, 8), new MeshBasicMaterial({ color: hdr(HAZARD, 1.2), side: DoubleSide }));
    lamp.position.set(side * 6.7, -3.25, -6.2);
    alarms.push(lamp.material as MeshBasicMaterial);
    group.add(lamp);
    sparkAnchors.push(new Vector3(side * 3.2, -3.4, -6.3));
  }

  // Clamp arms: the car is holding the ribbon, and you can see it holding on.
  // They run out of the bottom-left corner, below the play area.
  for (const reach of [-0.9, 1.1]) {
    const arm = new Mesh(new BoxGeometry(0.42, 0.42, 6.2), new MeshBasicMaterial({ color: STEEL.clone().multiplyScalar(0.42) }));
    arm.position.set(TETHER_OFFSET_X / 2 - 0.4, -4.4 + reach * 0.25, -7.0 + reach);
    arm.rotation.y = Math.PI / 2 - 0.34;
    arm.rotation.z = 0.16;
    group.add(arm);

    const jaw = new Mesh(new TorusGeometry(1.1, 0.22, 5, 12, Math.PI * 1.4), new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.34) }));
    jaw.position.set(TETHER_OFFSET_X, TETHER_OFFSET_Y + 1.4 + reach * 0.4, -7.0 + reach);
    jaw.rotation.y = Math.PI / 2;
    group.add(jaw);
    sparkAnchors.push(new Vector3(TETHER_OFFSET_X, TETHER_OFFSET_Y + 1.4 + reach * 0.4, -7.0 + reach));
  }

  return group;
}

// ---- planet ------------------------------------------------------------------

// Matte-painting scale: the planet rides with the camera so it never leaves the
// far plane. It is only in frame during the docking sweep, which is the point.
function createPlanet(materials: MeshBasicMaterial[]) {
  const group = new Group();

  const surface = new Mesh(new SphereGeometry(255, 40, 24), new MeshBasicMaterial({ color: new Color(0.030, 0.062, 0.115) }));
  materials.push(surface.material as MeshBasicMaterial);
  group.add(surface);

  // Continental haze and weather systems, suggested with a few pale caps.
  const rng = mulberry32(0x5c1e);
  for (let i = 0; i < 9; i += 1) {
    const patch = new Mesh(new SphereGeometry(255.4, 12, 8, 0, rng() * 0.8 + 0.4, rng() * 0.5 + 0.2, rng() * 0.4 + 0.2), new MeshBasicMaterial({
      color: new Color(0.09, 0.13, 0.17),
      transparent: true,
      opacity: 0.8,
      side: DoubleSide,
    }));
    patch.rotation.set(rng() * 6.3, rng() * 6.3, rng() * 6.3);
    materials.push(patch.material as MeshBasicMaterial);
    group.add(patch);
  }

  const limb = new Mesh(new SphereGeometry(268, 40, 24), new MeshBasicMaterial({
    color: new Color(0.18, 0.42, 0.85),
    transparent: true,
    opacity: 0.34,
    side: BackSide,
    blending: AdditiveBlending,
    depthWrite: false,
  }));
  materials.push(limb.material as MeshBasicMaterial);
  group.add(limb);

  group.position.set(0, -300, 0);
  return group;
}

// ---- assembly ----------------------------------------------------------------

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  root.name = 'skyhook-environment';
  scene.add(root);

  scene.background = SKY_STORM.clone();
  scene.fog = new FogExp2(SKY_STORM.clone().getHex(), 0.012);

  const applyAtmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: SKY_STORM, fog: SKY_STORM, density: 0.0145 },
    { progress: DECK_U * 0.72, background: SKY_STORM.clone().lerp(SKY_SUNLIT, 0.25), fog: CLOUD_GREY, density: 0.021 },
    { progress: DECK_U, background: SKY_SUNLIT, fog: CLOUD_LIT, density: 0.019 },
    { progress: DECK_U + 0.035, background: SKY_SUNLIT, fog: SKY_SUNLIT, density: 0.0038 },
    { progress: THIN_U, background: SKY_SUNLIT.clone().lerp(SKY_INDIGO, 0.55), fog: SKY_INDIGO, density: 0.0016 },
    { progress: DESCENDER_U, background: SKY_INDIGO.clone().lerp(SKY_VOID, 0.7), fog: SKY_VOID, density: 0.0004 },
    { progress: 1, background: SKY_VOID, fog: SKY_VOID, density: 0.0002 },
  ]);

  // The ribbon and its furniture run from just off the camera's shoulder all the
  // way to the vanishing point, so in screen space they sweep the whole left half
  // of the frame — but only ever as a hairline: 0.9 units wide at 40 m is under
  // 1% of the frame. A centre-ray occlusion test reads that as a wall, so the
  // tether opts out of occlusion accounting the same way Helios's serpent does.
  // It still writes depth and still visually passes in front of things.
  const tetherFurniture = new Group();
  tetherFurniture.name = 'tether';
  tetherFurniture.userData.raildIgnoreOcclusion = true;
  root.add(tetherFurniture);

  const tether = createTetherRibbon();
  tether.name = 'tether-ribbon';
  tetherFurniture.add(tether);

  // Scale marks and collar bands: the tether's own speedometer.
  const ticks: Mesh[] = [];
  const tickGeometry = new BoxGeometry(1.5, 0.09, 0.3);
  const tickMaterial = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.85) });
  for (let i = 0; i < TICK_COUNT; i += 1) {
    const tick = new Mesh(tickGeometry, tickMaterial);
    tick.name = "tether-mark";
    ticks.push(tick);
    tetherFurniture.add(tick);
  }

  const collars: Group[] = [];
  for (let i = 0; i < COLLAR_COUNT; i += 1) {
    const collar = new Group();
    const band = new Mesh(new BoxGeometry(2.1, 1.2, 2.1), new MeshBasicMaterial({ color: PANEL_GREY.clone().multiplyScalar(1.3) }));
    const stripe = new Mesh(new BoxGeometry(2.2, 0.36, 2.2), new MeshBasicMaterial({ color: hdr(HAZARD, 0.35) }));
    stripe.position.y = 0.42;
    const arm = new Mesh(new BoxGeometry(0.3, 0.3, 3.2), new MeshBasicMaterial({ color: STEEL.clone().multiplyScalar(0.6) }));
    arm.position.z = 2.4;
    collar.add(band, stripe, arm);
    collar.name = "tether-collar";
    collars.push(collar);
    tetherFurniture.add(collar);
  }

  const cloudRng = mulberry32(0x51c0);
  const clouds: Group[] = [];
  const cloudState: Environment['cloudState'] = [];
  for (let i = 0; i < CLOUD_COUNT; i += 1) {
    const cloud = createCloud(cloudRng);
    makeNonOccluding(cloud);
    clouds.push(cloud);
    cloudState.push({
      y: (i / CLOUD_COUNT) * 260 - 40,
      radius: 34 + cloudRng() * 88,
      angle: cloudRng() * Math.PI * 2,
      scale: 0.7 + cloudRng() * 0.8,
      spin: (cloudRng() - 0.5) * 0.2,
    });
    root.add(cloud);
  }

  const rainPositions = new Float32Array(RAIN_SEGMENTS * 2 * 3);
  for (let i = 0; i < RAIN_SEGMENTS; i += 1) {
    const base = i * 6;
    const angle = (i * 2.399963) % (Math.PI * 2);
    const radius = 3 + ((i * 7.13) % 22);
    const y = -10 + ((i * 3.7) % 44);
    rainPositions[base] = Math.cos(angle) * radius;
    rainPositions[base + 1] = y;
    rainPositions[base + 2] = Math.sin(angle) * radius;
    rainPositions[base + 3] = rainPositions[base];
    rainPositions[base + 4] = y + 3;
    rainPositions[base + 5] = rainPositions[base + 2];
  }
  const rainGeometry = new BufferGeometry();
  rainGeometry.setAttribute('position', new BufferAttribute(rainPositions, 3));
  const rain = new LineSegments(rainGeometry, new LineBasicMaterial({
    color: hdr(CLOUD_LIT, 0.2),
    transparent: true,
    opacity: 0.5,
  }));
  rain.frustumCulled = false;
  makeNonOccluding(rain);
  root.add(rain);

  const starRng = mulberry32(0x57a2);
  const starPositions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const theta = starRng() * Math.PI * 2;
    const phi = Math.acos(2 * starRng() - 1);
    const radius = 340;
    starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    starPositions[i * 3 + 1] = Math.cos(phi) * radius;
    starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new BufferAttribute(starPositions, 3));
  const starMaterial = new PointsMaterial({
    color: STARLIGHT.clone(),
    size: 1.7,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const stars = new Points(starGeometry, starMaterial);
  stars.frustumCulled = false;

  // Sun: the light that arrives the moment the car clears the deck.
  const sun = new Group();
  const sunMaterials: MeshBasicMaterial[] = [];
  const disc = new Mesh(new CircleGeometry(4.6, 26), createAdditiveBasicMaterial({ color: hdr(SUNLIGHT, 1.25), side: DoubleSide, opacity: 0 }));
  const halo = new Mesh(new CircleGeometry(19, 26), createAdditiveBasicMaterial({ color: hdr(SUNLIGHT, 0.35), side: DoubleSide, opacity: 0 }));
  halo.position.z = -1;
  sunMaterials.push(disc.material as MeshBasicMaterial, halo.material as MeshBasicMaterial);
  sun.add(halo, disc);
  sun.frustumCulled = false;

  makeNonOccluding(stars);
  makeNonOccluding(sun);
  const sky = new Group();
  sky.add(stars, sun);
  root.add(sky);

  const planetMaterials: MeshBasicMaterial[] = [];
  const planet = createPlanet(planetMaterials);
  makeNonOccluding(planet);
  root.add(planet);

  const cloudFloor = new Mesh(new CircleGeometry(230, 40), new MeshBasicMaterial({
    color: CLOUD_LIT.clone().multiplyScalar(0.5),
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
  }));
  cloudFloor.rotation.x = Math.PI / 2;
  makeNonOccluding(cloudFloor);
  root.add(cloudFloor);

  const stationLights: MeshBasicMaterial[] = [];
  const station = createStation(stationLights);
  station.position.copy(climbOffset(rail, STATION_U, TETHER_OFFSET_X, TETHER_OFFSET_Y));
  station.rotation.x = -Math.PI / 2; // the throat opens upward, so the car runs into its mouth
  station.name = "station";
  root.add(station);

  const cowlAlarms: MeshBasicMaterial[] = [];
  const cowlSparkAnchors: Vector3[] = [];
  const cowl = createCowl(cowlAlarms, cowlSparkAnchors);
  cowl.name = "climber-cowl";
  // The cowl is pinned below NDC -0.78 and into the extreme corners: anything a
  // ray finds behind it is already leaving the frame, so it is furniture rather
  // than cover and does not take part in occlusion accounting.
  cowl.userData.raildIgnoreOcclusion = true;
  root.add(cowl);

  return {
    root,
    tether,
    ticks,
    collars,
    clouds,
    cloudState,
    rain,
    rainPositions,
    stars,
    starMaterial,
    sun,
    sunMaterials,
    sky,
    planet,
    planetMaterials,
    cloudFloor,
    station,
    stationLights,
    cowl,
    cowlAlarms,
    cowlSparkAnchors,
    applyAtmosphere,
  };
}

// ---- per-frame ----------------------------------------------------------------

const scratch = new Vector3();

/** Slide the tether furniture so it streams past at the camera's real speed. */
export function updateTetherFurniture(environment: Environment, cameraU: number, cameraY: number) {
  const phase = ((cameraY % TICK_SPACING) + TICK_SPACING) % TICK_SPACING;
  for (const [index, tick] of environment.ticks.entries()) {
    const ahead = index * TICK_SPACING - phase + 9;
    tick.position.copy(climbOffset(rail, cameraU + ahead / RAIL_LENGTH, TETHER_OFFSET_X, TETHER_OFFSET_Y));
  }

  const collarPhase = ((cameraY % COLLAR_SPACING) + COLLAR_SPACING) % COLLAR_SPACING;
  for (const [index, collar] of environment.collars.entries()) {
    const ahead = index * COLLAR_SPACING - collarPhase + 9;
    collar.position.copy(climbOffset(rail, cameraU + ahead / RAIL_LENGTH, TETHER_OFFSET_X, TETHER_OFFSET_Y));
  }
}

/** Clouds only exist near the deck; above it they are switched off entirely. */
export function updateClouds(environment: Environment, cameraPosition: Vector3, dt: number, speed: number) {
  const active = cameraPosition.y < DECK_Y + 90;
  for (const [index, cloud] of environment.clouds.entries()) {
    if (!active) {
      cloud.visible = false;
      continue;
    }
    const state = environment.cloudState[index];
    state.y -= dt * speed * 1.05;
    if (state.y < -70) {
      state.y += 300;
      state.radius = 30 + Math.abs(Math.sin(index * 12.9898 + state.y) * 96);
      state.angle += 1.7;
    }
    state.angle += state.spin * dt;
    const worldY = cameraPosition.y + state.y;
    cloud.visible = worldY < DECK_Y + 40;
    if (!cloud.visible) continue;
    cloud.position.set(
      cameraPosition.x + Math.cos(state.angle) * state.radius,
      worldY,
      cameraPosition.z + Math.sin(state.angle) * state.radius,
    );
    cloud.scale.setScalar(state.scale);
    // Lit from above once the sun is close: the deck's top surface glows.
    const lit = MathUtils.clamp((worldY - (DECK_Y - 90)) / 130, 0, 1);
    for (const lobe of cloud.children) {
      const material = (lobe as Mesh).material as MeshBasicMaterial;
      material.color.copy(CLOUD_GREY).lerp(CLOUD_LIT, lit);
      material.opacity = 0.28 + lit * 0.34;
    }
  }
}

/** Rain only falls below the deck; it is the first layer the climb loses. */
export function updateRain(environment: Environment, cameraPosition: Vector3, dt: number, speed: number, wet: number) {
  const material = environment.rain.material as LineBasicMaterial;
  material.opacity = wet * 0.55;
  environment.rain.visible = wet > 0.02;
  if (!environment.rain.visible) return;

  const positions = environment.rainPositions;
  // Relative fall speed: the drops are dropping and the car is climbing.
  const fall = (speed + 26) * dt;
  const streak = 2.8 + speed * 0.18;
  for (let i = 0; i < RAIN_SEGMENTS; i += 1) {
    const base = i * 6;
    let y = positions[base + 1] - fall;
    if (y < cameraPosition.y - 26) {
      const angle = (i * 2.399963) % (Math.PI * 2);
      const radius = 3 + ((i * 7.13) % 22);
      positions[base] = cameraPosition.x + Math.cos(angle) * radius;
      positions[base + 2] = cameraPosition.z + Math.sin(angle) * radius;
      positions[base + 3] = positions[base];
      positions[base + 5] = positions[base + 2];
      y = cameraPosition.y + 18 + ((i * 3.7) % 30);
    }
    positions[base + 1] = y;
    positions[base + 4] = y + streak;
  }
  (environment.rain.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
}

/** Sky layers: stars fade in as the air runs out, the sun arrives above the deck. */
export function updateSky(environment: Environment, cameraPosition: Vector3, air: number, elapsed: number) {
  environment.stars.position.copy(cameraPosition);
  environment.starMaterial.opacity = MathUtils.clamp((0.55 - air) / 0.5, 0, 1) * 0.95;

  environment.sun.position.copy(cameraPosition)
    .addScaledVector(scratch.set(0.38, 0.80, 0.46).normalize(), 300);
  environment.sun.lookAt(cameraPosition);
  const sunlit = MathUtils.clamp((cameraPosition.y - (DECK_Y - 20)) / 70, 0, 1);
  environment.sunMaterials[0].opacity = sunlit;
  // The halo is atmospheric scatter: it dies with the air, so the sun hardens
  // from a bloom-soft flare above the deck into a bare point in vacuum.
  environment.sunMaterials[1].opacity = sunlit * air * (0.5 + Math.sin(elapsed * 0.6) * 0.06);

  environment.planet.position.copy(cameraPosition).add(scratch.set(0, -300, 0));
  environment.cloudFloor.position.copy(cameraPosition).add(scratch.set(0, -150, 0));
  const floorFade = MathUtils.clamp((cameraPosition.y - DECK_Y) / 220, 0, 1);
  (environment.cloudFloor.material as MeshBasicMaterial).opacity = floorFade * 0.8;
}

export function tetherRail() {
  return rail;
}

export { CLIMB_HEIGHT, DECK_Y, RAIL_LENGTH };
