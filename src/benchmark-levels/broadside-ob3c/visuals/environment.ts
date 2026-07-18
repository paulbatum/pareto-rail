import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  DoubleSide,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CRUISER_STATIONS,
  FLAGSHIP_STATIONS,
  WARSHIP_STATIONS,
  bar,
  broadsideRunProgress,
  createBroadsideRail,
  type HullStation,
} from '../gameplay';
import { muzzleFlash } from './effects';
import {
  CRIMSON,
  EMBER,
  FRIEND_CYAN,
  FRIEND_DEEP,
  ICE_SHADOW,
  ICE_WHITE,
  MOLTEN,
  NEBULA_DEEP,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  NEBULA_ROSE,
  OBSIDIAN,
  STARLIGHT,
  VOID,
  hdr,
} from './palette';
import { buildHullRibbon, createDistantWarship, type HullSkin } from './warships';

// The whole engagement, built in four layers:
//
//   1. the nebula — one enormous backlit dome plus soft cloud banks, so every
//      hull in the level is a silhouette rimmed in magenta and gold;
//   2. the three ships you actually fly against — a friendly cruiser's flank,
//      an enemy warship's belly, and the enemy flagship, all lofted along the
//      rail so they are exactly as close as they were authored to be;
//   3. the rest of both fleets, slugging it out at distance in no formation;
//   4. the crossfire — thousands of rounds a minute crossing the gaps, which
//      is what actually sells "you are flying through a battle".
//
// Nothing here is a texture. The nebula is vertex colour on an icosphere.

const FRIENDLY_SKIN: HullSkin = {
  plate: ICE_SHADOW.clone().multiplyScalar(0.42),
  rim: ICE_WHITE,
  light: FRIEND_CYAN,
  glow: FRIEND_DEEP,
};

const ENEMY_SKIN: HullSkin = {
  plate: OBSIDIAN.clone(),
  rim: MOLTEN,
  light: CRIMSON,
  glow: EMBER,
};

const railUAtBar = (barIndex: number) => broadsideRunProgress(bar(barIndex));

// The shared camera runs a 500-unit far plane, so everything in this file is
// sized to live inside it: the nebula dome sits just short of the clip, the
// star shell and cloud banks sit inside the dome, and the rest of both fleets
// are placed near enough to be seen whole. Fog carries the far end so hulls
// dissolve into the nebula instead of popping at the clip plane.
const SKY_RADIUS = 468;
const STAR_RADIUS = 440;
const FOG_NEAR = 210;
const FOG_FAR = 500;

export type EnvironmentUpdate = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  beatEnergy: number;
};

export type Environment = {
  root: Group;
  update(dt: number, context: EnvironmentUpdate): void;
  /** 1 = shield at full, 0 = collapsed. Driven by the generators still standing. */
  setShieldStrength(value: number): void;
  /** The flagship is coming apart: her rim lights die and her seams run white. */
  breakFlagship(): void;
  reset(): void;
};

// ---- nebula ---------------------------------------------------------------------------

/**
 * The backlight. A vertex-coloured icosphere with two great lobes — magenta
 * off the port quarter, gold ahead and low, where the run is heading — plus
 * banded structure so it does not read as a plain gradient.
 */
function createNebulaDome() {
  const geometry = new IcosahedronGeometry(1, 5);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const direction = new Vector3();
  const magentaAxis = new Vector3(-0.62, 0.34, -0.71).normalize();
  const goldAxis = new Vector3(0.30, -0.34, -0.89).normalize();
  const laneAxis = new Vector3(0.42, 0.86, -0.29).normalize();
  const color = new Color();
  const mixScratch = new Color();

  for (let i = 0; i < position.count; i += 1) {
    direction.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
    const magenta = Math.max(0, direction.dot(magentaAxis)) ** 1.7;
    // Gold sits ahead and low, so the enemy line you are flying toward is
    // backlit by it and every hull over there is a hard silhouette.
    const gold = Math.max(0, direction.dot(goldAxis)) ** 2.0;
    // Filament banding: cheap layered sines read as structure at this scale.
    const bands = 0.5
      + 0.5 * Math.sin(direction.y * 7.3 + direction.x * 3.1)
      * Math.sin(direction.z * 5.7 - direction.y * 2.4);
    const fine = 0.5 + 0.5 * Math.sin(direction.x * 17.3 - direction.z * 13.1);
    const filament = (0.22 + 0.78 * bands) * (0.75 + 0.25 * fine);
    // One broad dust lane cutting the field: the dark band that makes the
    // bright regions read as cloud rather than as a gradient.
    const lane = 1 - 0.72 * Math.exp(-((direction.dot(laneAxis) / 0.17) ** 2));

    color.copy(VOID);
    for (const [tone, weight] of [
      [NEBULA_DEEP, 0.3 + filament * 0.4],
      [NEBULA_MAGENTA, magenta * (0.24 + filament * 0.56) * lane],
      [NEBULA_ROSE, magenta * magenta * 0.3 * lane],
      [NEBULA_GOLD, gold * (0.3 + filament * 0.58) * lane],
    ] as const) {
      color.add(mixScratch.copy(tone).multiplyScalar(weight));
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const dome = new Mesh(geometry, new MeshBasicMaterial({
    vertexColors: true,
    side: BackSide,
    fog: false,
    depthWrite: false,
  }));
  dome.scale.setScalar(SKY_RADIUS);
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  return dome;
}

/** A soft additive blob: bright at the centre, black (invisible) at the rim. */
function softBlobGeometry(segments = 22) {
  const geometry = new CircleGeometry(1, segments);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const radius = Math.hypot(position.getX(i), position.getY(i));
    const weight = (1 - Math.min(1, radius)) ** 1.7;
    colors[i * 3] = weight;
    colors[i * 3 + 1] = weight;
    colors[i * 3 + 2] = weight;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

function createNebulaClouds() {
  const group = new Group();
  const geometry = softBlobGeometry();
  const rng = mulberry32(0xb20a5);
  for (let i = 0; i < 26; i += 1) {
    const gold = rng() < 0.45;
    const material = new MeshBasicMaterial({
      color: hdr(gold ? NEBULA_GOLD : NEBULA_MAGENTA, gold ? 0.055 : 0.075),
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });
    const blob = new Mesh(geometry, material);
    // Bias the field toward the run axis and the port quarter so the two lobes
    // of the dome get physical depth rather than sitting flat behind everything.
    const theta = rng() * Math.PI * 2;
    const height = (rng() * 2 - 1) * 0.75;
    const radius = 330 + rng() * 110;
    const flat = Math.sqrt(Math.max(0, 1 - height * height));
    blob.position.set(Math.cos(theta) * flat * radius, height * radius * 0.6, Math.sin(theta) * flat * radius);
    blob.scale.setScalar(70 + rng() * 130);
    blob.frustumCulled = false;
    blob.renderOrder = -1;
    group.add(blob);
  }
  group.renderOrder = -1;
  return group;
}

function createStarfield() {
  const rng = mulberry32(0x51a25);
  const count = 900;
  const mesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    createAdditiveBasicMaterial({ color: hdr(STARLIGHT, 1.3) }),
    count,
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  const dummy = new Object3D();
  for (let i = 0; i < count; i += 1) {
    const height = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const flat = Math.sqrt(Math.max(0, 1 - height * height));
    dummy.position.set(Math.cos(theta) * flat, height, Math.sin(theta) * flat).multiplyScalar(STAR_RADIUS);
    dummy.scale.setScalar(0.3 + rng() * 0.9);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ---- the crossfire ---------------------------------------------------------------------

type TracerPool = {
  mesh: InstancedMesh;
  origin: Vector3[];
  velocity: Vector3[];
  life: number[];
  maxLife: number[];
};

const TRACER_COUNT = 150;
const TRACER_RANGE = 620;

function createTracerPool(color: Color, intensity: number, thickness: number) {
  const mesh = new InstancedMesh(
    new BoxGeometry(thickness, thickness, 1),
    createAdditiveBasicMaterial({ color: hdr(color, intensity) }),
    TRACER_COUNT,
  );
  mesh.frustumCulled = false;
  const pool: TracerPool = {
    mesh,
    origin: Array.from({ length: TRACER_COUNT }, () => new Vector3()),
    velocity: Array.from({ length: TRACER_COUNT }, () => new Vector3()),
    life: new Array(TRACER_COUNT).fill(0),
    maxLife: new Array(TRACER_COUNT).fill(1),
  };
  return pool;
}

// ---- environment ------------------------------------------------------------------------

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  scene.add(root);

  // Space, but not empty space: a dark magenta haze so the far fleet dissolves
  // into the nebula instead of hanging in front of it as a hard cut-out.
  scene.fog = new Fog(NEBULA_DEEP.clone().multiplyScalar(0.75).getHex(), FOG_NEAR, FOG_FAR);
  scene.background = new Color(VOID.getHex());

  const curve = createBroadsideRail();
  const rng = mulberry32(0x0b3c);

  // --- sky (rides with the camera) ---
  const sky = new Group();
  const dome = createNebulaDome();
  const clouds = createNebulaClouds();
  const stars = createStarfield();
  sky.add(dome, clouds, stars);
  root.add(sky);

  // --- the three ships you fly against ---
  const cruiser = buildHullRibbon({
    curve,
    stations: CRUISER_STATIONS,
    railUAtBar,
    skin: FRIENDLY_SKIN,
    seed: 0x1111,
    greebleDensity: 3.6,
  });
  const warship = buildHullRibbon({
    curve,
    stations: WARSHIP_STATIONS,
    railUAtBar,
    skin: ENEMY_SKIN,
    seed: 0x2222,
    greebleDensity: 3.4,
    // Seen from directly beneath, the interesting silhouette lines are the
    // ventral corners, not the dorsal ones.
    rimVertices: [6, 7],
  });
  const flagship = buildHullRibbon({
    curve,
    stations: FLAGSHIP_STATIONS,
    railUAtBar,
    skin: ENEMY_SKIN,
    seed: 0x3333,
    segments: 150,
    greebleDensity: 3.0,
  });
  root.add(cruiser.group, warship.group, flagship.group);

  // --- her shield: the same hull, inflated, additive, and pulled down as her
  // generators die. It is a wall between you and her trenchwork until then. ---
  // Her shield only wraps the flank she presents to you. By the time she rolls
  // under the flight path it is gone either way, and a translucent wall across
  // the corridor would hide the fighters coming at you.
  const shieldStations: HullStation[] = FLAGSHIP_STATIONS
    .filter((entry) => entry.bar <= 22.0)
    .map((entry) => ({
      ...entry,
      halfWidth: entry.halfWidth + 15,
      halfHeight: entry.halfHeight + 15,
      trenchHalfWidth: 0,
      trenchDepth: 0,
    }));
  const shield = buildHullRibbon({
    curve,
    stations: shieldStations,
    railUAtBar,
    skin: { plate: CRIMSON, rim: NEBULA_MAGENTA, light: CRIMSON, glow: CRIMSON },
    seed: 0x4444,
    segments: 70,
    greebleDensity: 0,
    runningLights: false,
  });
  // Strip the skin down to a single translucent field; a shield has no plating.
  const shieldMaterials: MeshBasicMaterial[] = [];
  shield.group.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as MeshBasicMaterial;
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.opacity = 0.16;
    material.color.copy(hdr(CRIMSON, 0.5));
    shieldMaterials.push(material);
  });
  shield.group.name = 'shield';
  shield.group.traverse((child) => { child.name = 'shield-field'; });
  shield.group.renderOrder = 2;
  root.add(shield.group);

  // --- the rest of both fleets ---
  // Placed rail-relative once at build time, then left alone: they are
  // kilometres off and hold their own line through the whole engagement.
  const fleet = new Group();
  const FLEET: Array<{ bar: number; right: number; up: number; length: number; friendly: boolean; yaw: number; roll: number }> = [
    { bar: 1.2, right: -210, up: 40, length: 300, friendly: true, yaw: 0.28, roll: 0.1 },
    { bar: 2.6, right: 190, up: -95, length: 250, friendly: false, yaw: -0.5, roll: -0.24 },
    { bar: 4.0, right: -150, up: 120, length: 200, friendly: true, yaw: -0.35, roll: 0.3 },
    { bar: 5.4, right: 165, up: 78, length: 330, friendly: false, yaw: 0.42, roll: 0.16 },
    { bar: 6.8, right: -260, up: -110, length: 290, friendly: true, yaw: 0.12, roll: -0.18 },
    { bar: 9.0, right: 155, up: 135, length: 230, friendly: false, yaw: -0.62, roll: 0.22 },
    { bar: 10.8, right: -195, up: -130, length: 310, friendly: true, yaw: 0.5, roll: 0.08 },
    { bar: 13.2, right: 215, up: -55, length: 270, friendly: false, yaw: 0.2, roll: -0.3 },
    { bar: 15.0, right: -170, up: 150, length: 240, friendly: true, yaw: -0.28, roll: 0.26 },
    { bar: 17.6, right: -225, up: 62, length: 350, friendly: true, yaw: 0.16, roll: -0.12 },
    { bar: 19.8, right: 175, up: 165, length: 220, friendly: false, yaw: -0.44, roll: 0.34 },
    { bar: 22.2, right: -245, up: -90, length: 300, friendly: true, yaw: 0.34, roll: 0.2 },
    { bar: 24.6, right: 200, up: 130, length: 260, friendly: false, yaw: -0.22, roll: -0.26 },
    { bar: 26.4, right: -180, up: 175, length: 330, friendly: true, yaw: 0.46, roll: 0.14 },
  ];
  for (const spec of FLEET) {
    const ship = createDistantWarship(spec.length, spec.friendly ? FRIENDLY_SKIN : ENEMY_SKIN, rng);
    const frame = sampleRailFrame(curve, railUAtBar(spec.bar));
    ship.position.copy(frame.position)
      .addScaledVector(frame.right, spec.right)
      .addScaledVector(frame.up, spec.up);
    ship.lookAt(ship.position.clone().addScaledVector(frame.tangent, 100).addScaledVector(frame.right, spec.yaw * 100));
    ship.rotateZ(spec.roll);
    fleet.add(ship);
  }
  root.add(fleet);

  // --- close debris: the speed cue that a kilometre-long hull cannot give you ---
  const debrisGeometries = [
    new BoxGeometry(1.2, 0.5, 2.8),
    new BoxGeometry(0.6, 0.6, 1.0),
    new BoxGeometry(2.2, 0.25, 0.8),
  ];
  const debrisMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(1.3) });
  const emberMaterial = createAdditiveBasicMaterial({ color: hdr(EMBER, 1.0) });
  const debris: ScatterField = scatterAlongRail(curve, {
    count: 120,
    seed: 0x7ac3,
    window: { behind: 90, ahead: 620 },
    alignToRail: false,
    // Hollowed around the flight path: close enough to streak past, never
    // close enough to sit between the player and a target.
    place: (_index, random) => {
      // Hollowed around the flight path: near enough to streak past the canopy,
      // never near enough to sit between the player and a target. Half the
      // field is thrown wide, half is thrown high or low.
      const wide = random() < 0.5;
      const lateralSign = random() < 0.5 ? -1 : 1;
      const verticalSign = random() < 0.5 ? -1 : 1;
      return {
        u: random(),
        offset: new Vector3(
          lateralSign * (wide ? 72 + random() * 110 : random() * 150),
          verticalSign * (wide ? random() * 130 : 54 + random() * 90),
          (random() * 2 - 1) * 30,
        ),
      };
    },
    make: (index, random) => {
      const chunk = new Mesh(debrisGeometries[index % debrisGeometries.length], random() < 0.16 ? emberMaterial : debrisMaterial);
      chunk.name = 'debris';
      chunk.scale.setScalar(0.4 + random() * 1.3);
      chunk.rotation.set(random() * 6.28, random() * 6.28, random() * 6.28);
      chunk.userData.spin = (random() * 2 - 1) * 0.5;
      return chunk;
    },
    onUpdate: (item, dt) => {
      item.object.rotation.z += (item.object.userData.spin as number) * dt;
    },
  });
  root.add(debris.group);

  // --- the crossfire ---
  const friendlyFire = createTracerPool(FRIEND_CYAN, 1.7, 0.5);
  const enemyFire = createTracerPool(CRIMSON, 1.7, 0.5);
  const salvo = createTracerPool(FRIEND_CYAN, 2.4, 1.5);
  friendlyFire.mesh.name = 'tracer';
  enemyFire.mesh.name = 'tracer';
  salvo.mesh.name = 'salvo';
  root.add(friendlyFire.mesh, enemyFire.mesh, salvo.mesh);
  for (const pool of [friendlyFire, enemyFire]) for (let i = 0; i < TRACER_COUNT; i += 1) pool.life[i] = -1;
  for (let i = 0; i < TRACER_COUNT; i += 1) salvo.life[i] = -1;

  const dummy = new Object3D();
  const scratch = new Vector3();
  const forward = new Vector3();

  /** Seed one round somewhere in the volume the player is about to fly through. */
  function respawnTracer(pool: TracerPool, index: number, camera: PerspectiveCamera, fromPort: boolean) {
    camera.getWorldDirection(forward);
    const right = scratch.set(0, 1, 0).cross(forward).normalize().multiplyScalar(-1);
    const up = new Vector3().crossVectors(right, forward).normalize();
    const side = fromPort ? -1 : 1;
    const depth = 40 + Math.random() * 480;
    const lateral = side * (110 + Math.random() * 260);
    const vertical = (Math.random() * 2 - 1) * 210;
    pool.origin[index]
      .copy(camera.position)
      .addScaledVector(forward, depth)
      .addScaledVector(right, lateral)
      .addScaledVector(up, vertical);
    // Mostly a lateral crossing shot, with enough spread that no two rounds
    // look parallel and the volume reads as three-dimensional.
    pool.velocity[index]
      .copy(right).multiplyScalar(-side * (230 + Math.random() * 300))
      .addScaledVector(up, (Math.random() * 2 - 1) * 130)
      .addScaledVector(forward, (Math.random() * 2 - 1) * 190);
    pool.maxLife[index] = 1.0 + Math.random() * 1.4;
    pool.life[index] = 0;
  }

  function updateTracerPool(pool: TracerPool, dt: number, camera: PerspectiveCamera, fromPort: boolean | null, energy: number) {
    let count = 0;
    for (let i = 0; i < TRACER_COUNT; i += 1) {
      if (pool.life[i] < 0) {
        if (fromPort === null) continue; // salvo rounds are only spawned on command
        if (Math.random() > energy) continue;
        respawnTracer(pool, i, camera, fromPort);
      }
      pool.life[i] += dt;
      if (pool.life[i] >= pool.maxLife[i]) {
        pool.life[i] = -1;
        continue;
      }
      pool.origin[i].addScaledVector(pool.velocity[i], dt);
      if (pool.origin[i].distanceToSquared(camera.position) > TRACER_RANGE * TRACER_RANGE) {
        pool.life[i] = -1;
        continue;
      }
      const speed = pool.velocity[i].length();
      dummy.position.copy(pool.origin[i]);
      dummy.lookAt(scratch.copy(pool.origin[i]).add(pool.velocity[i]));
      // A round is drawn as its own motion streak: length is speed × shutter.
      dummy.scale.set(1, 1, Math.max(6, speed * 0.055));
      dummy.updateMatrix();
      pool.mesh.setMatrixAt(count, dummy.matrix);
      count += 1;
    }
    pool.mesh.count = count;
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  /** The friendly cruiser's broadside: a whole gun deck firing across your canopy. */
  function fireBroadside(camera: PerspectiveCamera, atBar: number) {
    const shells = 14;
    let placed = 0;
    for (let i = 0; i < TRACER_COUNT && placed < shells; i += 1) {
      if (salvo.life[i] >= 0) continue;
      const along = atBar + 0.9 + (placed / shells) * 1.9;
      const muzzle = cruiser.pointAt(along, 34, -4 + ((placed % 4) - 1.5) * 7);
      const frame = sampleRailFrame(curve, railUAtBar(along));
      salvo.origin[i].copy(muzzle);
      salvo.velocity[i]
        .copy(frame.right).multiplyScalar(300 + Math.random() * 130)
        .addScaledVector(frame.up, 30 + Math.random() * 70)
        .addScaledVector(frame.tangent, 60 + Math.random() * 120);
      salvo.maxLife[i] = 1.9;
      salvo.life[i] = 0;
      if (placed % 3 === 0) muzzleFlash(muzzle, FRIEND_CYAN, 5 + Math.random() * 3);
      placed += 1;
    }
    void camera;
  }

  // Her guns speak on the downbeat of every bar of the flank run — the run is
  // literally scored by the ship you are flying alongside.
  const BROADSIDE_BARS = [8, 9, 10, 11];
  let nextBroadside = 0;

  let shieldStrength = 1;
  let shieldTarget = 1;
  let flagshipBreaking = 0;
  const flagshipRimMaterials: MeshBasicMaterial[] = [];
  flagship.group.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as MeshBasicMaterial;
    if (material.blending === AdditiveBlending) flagshipRimMaterials.push(material);
  });
  const flagshipRimBase = flagshipRimMaterials.map((material) => material.color.clone());

  return {
    root,

    update(dt, context) {
      const { camera, elapsed, runTime, running, beatEnergy } = context;
      sky.position.copy(camera.position);
      clouds.rotation.z = elapsed * 0.004;

      debris.update(running ? broadsideRunProgress(runTime) : 0, dt);

      // Crossfire density follows the battle: thin on the catapult, saturated
      // through the gauntlet and the flank, thin again inside the trench.
      const phase = running ? runTime : 0;
      const density = running
        ? intensityAt(phase)
        : 0.25;
      updateTracerPool(friendlyFire, dt, camera, true, density * 0.09);
      updateTracerPool(enemyFire, dt, camera, false, density * 0.09);
      updateTracerPool(salvo, dt, camera, null, 0);

      if (running) {
        while (nextBroadside < BROADSIDE_BARS.length && runTime >= bar(BROADSIDE_BARS[nextBroadside])) {
          fireBroadside(camera, BROADSIDE_BARS[nextBroadside]);
          nextBroadside += 1;
        }
      }

      // The shield breathes with the music while it holds, then falls away.
      shieldStrength += (shieldTarget - shieldStrength) * Math.min(1, dt * 3.2);
      const shimmer = 0.13 + beatEnergy * 0.07 + Math.sin(elapsed * 2.4) * 0.035;
      for (const material of shieldMaterials) {
        material.opacity = Math.max(0, shieldStrength * shimmer);
        material.color.copy(hdr(CRIMSON, 0.35 + shieldStrength * 0.45)).lerp(hdr(NEBULA_MAGENTA, 0.7), 0.35);
      }
      shield.group.visible = shieldStrength > 0.01;

      if (flagshipBreaking > 0) {
        flagshipBreaking = Math.min(1, flagshipBreaking + dt * 0.5);
        // Her rim light dies and her seams run white-hot as she opens up.
        const flare = 1 + Math.sin(elapsed * 17) * 0.5 * flagshipBreaking;
        flagshipRimMaterials.forEach((material, index) => {
          material.color.copy(flagshipRimBase[index]).lerp(hdr(NEBULA_GOLD, 2.4), flagshipBreaking * 0.7).multiplyScalar(flare);
        });
      }
    },

    setShieldStrength(value) {
      shieldTarget = Math.max(0, Math.min(1, value));
    },

    breakFlagship() {
      flagshipBreaking = Math.max(flagshipBreaking, 0.001);
    },

    reset() {
      nextBroadside = 0;
      shieldStrength = 1;
      shieldTarget = 1;
      flagshipBreaking = 0;
      for (let i = 0; i < TRACER_COUNT; i += 1) {
        friendlyFire.life[i] = -1;
        enemyFire.life[i] = -1;
        salvo.life[i] = -1;
      }
      flagshipRimMaterials.forEach((material, index) => material.color.copy(flagshipRimBase[index]));
    },
  };
}

/** How thick the crossfire is at a given run time — the battle's own dynamics curve. */
function intensityAt(runTime: number) {
  const keys: Array<[number, number]> = [
    [bar(0), 0.25],
    [bar(2), 0.55],
    [bar(3), 1.0],
    [bar(8), 1.25],
    [bar(11.8), 1.1],
    [bar(12.6), 0.28], // in her shadow, the battle is somewhere else
    [bar(15.6), 0.4],
    [bar(16.4), 0.9],
    [bar(21), 1.15],
    [bar(24), 0.55],
    [bar(26.6), 0.4],
    [bar(27.2), 1.0], // out of the trench: the whole engagement at once
    [bar(28), 1.1],
  ];
  for (let i = 1; i < keys.length; i += 1) {
    if (runTime > keys[i][0]) continue;
    const [t0, v0] = keys[i - 1];
    const [t1, v1] = keys[i];
    const t = (runTime - t0) / Math.max(1e-4, t1 - t0);
    return v0 + (v1 - v0) * t;
  }
  return keys[keys.length - 1][1];
}
