import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera, PerspectiveCamera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { sampleRailFrame } from '../../../engine/rail';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { blowUniform, purseUniform, strobeUniform } from '../post-fx';
import { PURSE_MARKERS, PURSE_TIME } from '../timing';
import { PURSE_TUNING } from '../tuning';
import { createRiderMesh } from './bikes';
import { createBossMesh, createPlateShard, createPurseProp } from './boss-model';
import { PartBin, glowMesh, solidMesh } from './build';
import { createCockpit, type Cockpit } from './cockpit';
import {
  burstDebris,
  burstSparks,
  createEffects,
  disposeEffects,
  resetEffects,
  spawnRing,
  spawnSmear,
  updateEffects,
} from './effects';
import {
  createPurseEnvironment,
  railCurve,
  railLengthUnits,
  type PurseEnvironment,
} from './environment';
import { createSignMesh } from './letters';
import {
  AMBER,
  CHROME,
  GANG_RED,
  HEADLIGHT,
  NEON_PINK,
  PURSE_BLUE,
  RIDER_ACCENT,
  STEEL,
  TAILLIGHT,
  hdr,
} from './palette';

/**
 * The look, and every rule about when it changes.
 *
 * Palette discipline: the world is amber, red, chrome and pink. Player fire and
 * the reticle are pink-white so they never compete with hazard amber, and the
 * only blue anywhere is the purse — on the boss's shoulder, in the fireball,
 * and in the single frame-wide flash when you catch it.
 */

const DECK = -PURSE_TUNING.road.cameraHeightUnits;
const LOCK_RAMP = [NEON_PINK, AMBER, GANG_RED] as const;

/** Hardware is drawn over life size so a bike still reads at spawn distance. */
function modelScaleFor(kind: string) {
  if (kind === 'boss') return PURSE_TUNING.boss.modelScale;
  if (kind === 'letter') return 1;
  return PURSE_TUNING.enemies.modelScale;
}

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  feel: CameraFeelRig;
  elapsed: number;
  runTime: number;
  running: boolean;
  speedFactor: number;
  runProgress: number;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  accent: Color;
  bornAt: number;
  body: MeshBasicMaterial | null;
  glow: MeshBasicMaterial | null;
  lockedUntil: number;
  deniedUntil: number;
  flashUntil: number;
  lockCount: number;
};

type PurseFlight = { mesh: Group; from: Vector3; age: number; spin: number };

let environment: PurseEnvironment | null = null;
let cockpit: Cockpit | null = null;
let sightingLamp: Mesh | null = null;
let purseFlight: PurseFlight | null = null;
let purseCaught = -1;
let beatEnergy = 0;
let downbeatEnergy = 0;
let blowEnergy = 0;
let elapsedNow = 0;
let lastLaneX = 0;
let sway = 0;

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord, [string, number]>({
  createRecord: (mesh, kind, bornAt) => ({
    mesh,
    kind,
    accent: (RIDER_ACCENT[kind] ?? CHROME).clone(),
    bornAt,
    body: (mesh.userData.bodyMaterial as MeshBasicMaterial | undefined) ?? null,
    glow: (mesh.userData.glowMaterial as MeshBasicMaterial | undefined) ?? null,
    lockedUntil: -1,
    deniedUntil: -1,
    flashUntil: -1,
    lockCount: 0,
  }),
  disposeRecord: (record) => {
    record.body?.dispose();
    record.glow?.dispose();
  },
});

const projectileRecords = createPendingVisualRecords<Object3D, { mesh: Object3D }>({
  createRecord: (mesh) => ({ mesh }),
});

// --- construction ------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  disposeVisuals();
  environment = createPurseEnvironment(scene);
  createEffects(scene);
  cockpit = createCockpit();
  scene.add(cockpit.root);
  sightingLamp = createSightingLamp();
  scene.add(sightingLamp);
  return environment.root;
}

export function disposeVisuals() {
  environment?.dispose();
  environment = null;
  cockpit?.dispose();
  cockpit = null;
  if (sightingLamp) {
    sightingLamp.removeFromParent();
    disposeObject3D(sightingLamp);
    sightingLamp = null;
  }
  if (purseFlight) {
    purseFlight.mesh.removeFromParent();
    disposeObject3D(purseFlight.mesh);
    purseFlight = null;
  }
  disposeEffects();
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter ? createSignMesh(letter ?? 'A') : buildRider(kind);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildRider(kind: string): Group {
  return kind === 'boss' ? createBossMesh() : createRiderMesh(kind);
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount?: number) {
  mesh.userData.locked = locked;
  mesh.userData.lockCount = locked ? lockCount ?? 1 : 0;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.4;
  spawnRing(mesh.position, hdr(GANG_RED, 2.0), 3.4, 0.34, -5);
}

/**
 * Player fire: a flat pink-white tracer. Deliberately the one hot thing in the
 * frame that is neither sodium amber nor tail-light red, so a volley in flight
 * is instantly separable from the traffic.
 */
export function createProjectileMesh() {
  const group = new Group();
  const bin = new PartBin();
  bin.add(new BoxGeometry(0.09, 0.09, 2.6), hdr(HEADLIGHT, 2.6));
  bin.add(new PlaneGeometry(0.34, 3.4), hdr(NEON_PINK, 1.5));
  bin.add(new PlaneGeometry(0.34, 3.4), hdr(NEON_PINK, 1.5), { rotate: [0, Math.PI / 2, 0] });
  const streak = glowMesh(bin.merge());
  streak.rotation.x = Math.PI / 2;
  group.add(streak);
  group.userData.raildIgnoreOcclusion = true;
  projectileRecords.enqueue(group);
  return group;
}

/**
 * The reticle is a rev counter: six blades around a chrome ring, one lighting
 * per lock and running pink → amber → red as the needle climbs to the redline.
 */
export function createReticle() {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.66, 0.71, 40),
    createAdditiveBasicMaterial({ color: hdr(CHROME, 0.9), side: DoubleSide, depthTest: false }),
  );
  const dot = new Mesh(
    new CircleGeometry(0.045, 14),
    createAdditiveBasicMaterial({ color: hdr(HEADLIGHT, 2.2), depthTest: false }),
  );
  const blades: Mesh[] = [];
  const bladeGroup = new Group();
  for (let i = 0; i < 6; i += 1) {
    const blade = new Mesh(
      new PlaneGeometry(0.075, 0.3),
      createAdditiveBasicMaterial({ color: hdr(CHROME, 0.16), side: DoubleSide, depthTest: false }),
    );
    // A 240° sweep, open at the bottom, so the fill reads like a gauge.
    const angle = Math.PI * 1.16 - (i / 5) * Math.PI * 1.32;
    blade.position.set(Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, 0);
    blade.rotation.z = angle - Math.PI / 2;
    blades.push(blade);
    bladeGroup.add(blade);
  }
  for (const part of [ring, dot, ...blades]) part.renderOrder = 1200;
  group.add(ring, dot, bladeGroup);
  group.userData.raildRole = 'reticle';
  group.userData.raildIgnoreOcclusion = true;
  group.userData.ring = ring;
  group.userData.dot = dot;
  group.userData.blades = blades;
  group.userData.bladeGroup = bladeGroup;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.07 : 0));
  const blades = reticle.userData.blades as Mesh[] | undefined;
  const colour = colorForLockCount(Math.max(1, lockCount), LOCK_RAMP);
  for (let i = 0; i < (blades?.length ?? 0); i += 1) {
    const blade = blades![i];
    const lit = i < lockCount;
    (blade.material as MeshBasicMaterial).color.copy(lit ? hdr(colour, 2.2) : hdr(CHROME, active ? 0.3 : 0.16));
    blade.scale.setScalar(lit ? 1.25 : 1);
  }
  const ring = reticle.userData.ring as Mesh | undefined;
  if (ring) (ring.material as MeshBasicMaterial).color.copy(hdr(active ? colour : CHROME, active ? 1.4 : 0.75));
}

/** The boss's tail light, seen far up the road through the breakdown. */
function createSightingLamp() {
  const bin = new PartBin();
  bin.add(new PlaneGeometry(1.1, 0.32), hdr(TAILLIGHT, 3.0));
  bin.add(new PlaneGeometry(2.6, 0.9), hdr(TAILLIGHT, 0.6));
  bin.add(new PlaneGeometry(0.35, 0.35), hdr(PURSE_BLUE, 2.2), { at: [0.75, 0.34, 0] });
  const mesh = glowMesh(bin.merge());
  mesh.visible = false;
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

// --- event choreography ------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  void scene;

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId, kind, elapsedNow);
    if (!record) return;
    const accent = record.accent;
    if (kind === 'boss') {
      spawnRing(worldPosition, hdr(GANG_RED, 2.4), 16, 0.85, 1.2);
      spawnRing(worldPosition, hdr(PURSE_BLUE, 1.6), 9, 0.6, -2.4);
    } else if (kind === 'letter') {
      spawnRing(worldPosition, hdr(AMBER, 1.2), 2.4, 0.4);
    } else {
      // A headlight blink as the rider resolves out of the haze.
      spawnRing(worldPosition, hdr(accent, 1.0), 2.6, 0.32, 4);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      record.lockedUntil = elapsedNow + 0.18;
      record.lockCount = lockCount;
    }
    spawnRing(worldPosition, hdr(colorForLockCount(lockCount, LOCK_RAMP), 1.8), 1.6 + lockCount * 0.32, 0.26, 6);
  });

  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.lockCount = 0;
    spawnRing(worldPosition, hdr(CHROME, 0.5), 1.1, 0.16, -3);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectileRecords.claim(projectileId);
    spawnRing(worldPosition, hdr(NEON_PINK, 1.5), 1.0 + volleySize * 0.16, 0.16, 8);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) return;
    if (record) record.flashUntil = elapsedNow + 0.22;
    burstSparks(worldPosition, hdr(CHROME, 1.8), record?.kind === 'boss' ? 12 : 6, 7);
    if (record?.kind === 'boss') spawnRing(worldPosition, hdr(CHROME, 1.6), 4.2, 0.24, 5);
  });

  // Each chrome plate off the boss is a real event: the plate cartwheels away.
  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || record.kind !== 'boss') return;
    const plates = record.mesh.userData.plates as Group | undefined;
    const plate = plates?.children[stageIndex - 1];
    if (plate) {
      plate.visible = false;
      const shard = createPlateShard();
      shard.userData.raildIgnoreOcclusion = true;
      plate.getWorldPosition(shard.position);
      record.mesh.parent?.add(shard);
      shard.userData.shed = elapsedNow;
      shedPlates.push({ mesh: shard, age: 0, velocity: new Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 3, 6) });
    }
    spawnRing(worldPosition, hdr(AMBER, 2.4), 11, 0.5, 3);
    burstSparks(worldPosition, hdr(CHROME, 2.2), 22, 11);
    blowEnergy = Math.max(blowEnergy, 0.28);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.kind === 'boss') {
      detonateBoss(record, worldPosition);
    } else if (record.kind === 'letter') {
      burstSparks(worldPosition, hdr(AMBER, 2.0), 12, 6, 5);
      spawnRing(worldPosition, hdr(AMBER, 1.6), 3.6, 0.36);
    } else if (record.kind === 'bomb') {
      spawnRing(worldPosition, hdr(AMBER, 2.6), 8.5, 0.4, 2);
      burstSparks(worldPosition, hdr(AMBER, 2.4), 20, 13);
      blowEnergy = Math.max(blowEnergy, 0.2);
    } else {
      // A rider going down: the bike breaks up and the wreck smears the tarmac.
      burstSparks(worldPosition, hdr(record.accent, 2.0), 12, 9);
      burstSparks(worldPosition, hdr(CHROME, 1.6), 8, 12);
      burstDebris(worldPosition, record.kind === 'hauler' ? 5 : 3, 6);
      spawnRing(worldPosition, hdr(record.accent, 1.6), 4.6, 0.38);
      spawnSmear(new Vector3(worldPosition.x, worldPosition.y - 0.9, worldPosition.z), hdr(record.accent, 0.5), 2.4, 0.6);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    // They got away: a red flare receding, not an explosion.
    spawnRing(worldPosition, hdr(TAILLIGHT, 1.0), 2.6, 0.28, -4);
  });

  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    for (const id of new Set([...enemyIds, ...(missingEnemyIds ?? [])])) {
      const record = enemyRecords.get(id);
      if (!record) continue;
      record.deniedUntil = elapsedNow + 0.4;
      spawnRing(record.mesh.position, hdr(GANG_RED, 2.2), 3.0, 0.3, -6);
      burstSparks(record.mesh.position, hdr(CHROME, 2.6), 8, 5, 2);
    }
  });

  // A clean six is the level's applause line: a pink wave off the reticle.
  bus.on('volley', ({ size, kills }) => {
    if (size < 6 || kills < size) return;
    downbeatEnergy = 1.4;
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.5;
    if (isDownbeat) downbeatEnergy = Math.max(downbeatEnergy, 1);
  });

  bus.on('playerhit', () => {
    blowEnergy = Math.max(blowEnergy, 0.35);
    beatEnergy = 1.6;
  });

  bus.on('runstart', () => {
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    for (const plate of shedPlates) {
      plate.mesh.removeFromParent();
      disposeObject3D(plate.mesh);
    }
    shedPlates.length = 0;
    if (purseFlight) {
      purseFlight.mesh.removeFromParent();
      disposeObject3D(purseFlight.mesh);
      purseFlight = null;
    }
    purseCaught = -1;
    blowEnergy = 0;
    beatEnergy = 1;
    effectsResetPending = true;
  });
}

type ShedPlate = { mesh: Mesh; age: number; velocity: Vector3 };
const shedPlates: ShedPlate[] = [];

/**
 * The payoff. The bike goes up, and the purse comes out of the top of the
 * fireball on a long slow arc toward the window — this is the one moment in the
 * level that is allowed to be blue, and the one that is allowed to be slow.
 */
function detonateBoss(record: EnemyRecord, worldPosition: Vector3) {
  blowEnergy = 1.5;
  spawnRing(worldPosition, hdr(AMBER, 3.2), 34, 1.0, 1);
  spawnRing(worldPosition, hdr(HEADLIGHT, 2.4), 20, 0.7, -2);
  spawnRing(worldPosition, hdr(GANG_RED, 2.2), 46, 1.35, 0.6);
  burstSparks(worldPosition, hdr(AMBER, 2.8), 46, 20);
  burstSparks(worldPosition, hdr(CHROME, 2.2), 26, 26);
  burstDebris(worldPosition, 12, 12);
  spawnSmear(new Vector3(worldPosition.x, worldPosition.y - 1.2, worldPosition.z), hdr(AMBER, 0.9), 7, 1.2);

  const mesh = createPurseProp();
  mesh.userData.raildIgnoreOcclusion = true;
  mesh.position.copy(worldPosition);
  mesh.scale.setScalar(1.6);
  record.mesh.parent?.add(mesh);
  purseFlight = { mesh, from: worldPosition.clone(), age: 0, spin: 2.4 };
}

// --- per-frame ---------------------------------------------------------------

let effectsResetPending = false;

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  if (effectsResetPending) {
    effectsResetPending = false;
    resetEffects(ctx.camera);
  }
  beatEnergy = Math.max(0, beatEnergy - dt * 3.6);
  downbeatEnergy = Math.max(0, downbeatEnergy - dt * 2.4);
  blowEnergy = Math.max(0, blowEnergy - dt * 1.5);

  updateWorldLighting(dt, ctx);
  environment?.update(ctx.runProgress, dt, ctx.camera);
  updateSighting(ctx);
  updateEnemies(dt, ctx);
  updateShedPlates(dt);
  updatePurseFlight(dt, ctx);
  updateProjectiles(dt);
  updateReticleSpin(dt, ctx);
  updateCameraFeel(dt, ctx);
  updateEffects(dt, ctx.camera);
}

/**
 * Sodium lamps sweep overhead at a rate set by real speed, not by a timer: the
 * strobe phase is the camera's distance along the rail divided by the lamp
 * spacing, so flooring it visibly speeds the flicker up.
 */
function updateWorldLighting(dt: number, ctx: VisualContext) {
  const metres = ctx.runProgress * railLengthUnits;
  const lampPhase = (metres / PURSE_TUNING.world.streetlight.spacingUnits) % 1;
  const passing = Math.max(0, 1 - Math.abs(lampPhase - 0.5) * 2.6) ** 2;
  const overpassPhase = (metres / PURSE_TUNING.world.overpass.spacingUnits) % 1;
  const underpass = Math.max(0, 1 - Math.abs(overpassPhase - 0.5) * 12);

  const lights = environment?.lights;
  if (lights) {
    lights.streetlight.color.copy(hdr(AMBER, 0.7 + passing * 1.5 + beatEnergy * 0.35));
    lights.pool.color.copy(hdr(AMBER, 0.07 + passing * 0.16));
    lights.overpass.color.copy(hdr(AMBER, 0.16 + underpass * 0.8));
    lights.laneDash.color.copy(hdr(HEADLIGHT, 0.34 + downbeatEnergy * 0.42));
  }

  strobeUniform.value = ctx.running ? passing * 0.34 + underpass * 0.16 : 0.06;
  blowUniform.value = blowEnergy * 0.55;
  purseUniform.value = purseCaught < 0 ? 0 : Math.max(0, 1 - (ctx.elapsed - purseCaught) * 1.6) ** 2 * 0.85;

  // Lane-change sway: the car body leans a beat behind the rail's lateral move.
  const frame = sampleRailFrame(railCurve, Math.min(0.999, ctx.runProgress));
  const laneX = frame.tangent.x;
  const lateral = (laneX - lastLaneX) / Math.max(dt, 1 / 240);
  lastLaneX = laneX;
  sway += (Math.max(-1, Math.min(1, lateral * 6)) - sway) * Math.min(1, dt * 2.6);
  cockpit?.update(ctx.camera, dt, sway, passing * 0.9 + downbeatEnergy * 0.2, blowEnergy * 0.6);
}

/** Between the breakdown and the boss's arrival, that tail light up ahead. */
function updateSighting(ctx: VisualContext) {
  if (!sightingLamp) return;
  const from = PURSE_MARKERS.breakdown;
  const to = PURSE_MARKERS.bossEntrance;
  const visible = ctx.running && ctx.runTime >= from && ctx.runTime < to;
  sightingLamp.visible = visible;
  if (!visible) return;
  const t = (ctx.runTime - from) / Math.max(0.001, to - from);
  const distance = 210 - t * 120;
  const anchorU = Math.min(0.999, ctx.runProgress + distance / railLengthUnits);
  const frame = sampleRailFrame(railCurve, anchorU);
  sightingLamp.position.copy(frame.position)
    .addScaledVector(frame.right, Math.sin(ctx.runTime * 1.4) * 5)
    .addScaledVector(frame.up, DECK + 1.3);
  sightingLamp.quaternion.copy(ctx.camera.quaternion);
  const flicker = 0.55 + 0.45 * Math.sin(ctx.runTime * 11);
  sightingLamp.scale.setScalar((0.55 + t * 1.1) * (0.9 + flicker * 0.2));
}

function updateEnemies(dt: number, ctx: VisualContext) {
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    const age = ctx.elapsed - record.bornAt;
    const intro = Math.min(1, age / 0.22);
    const locked = record.mesh.userData.locked === true;
    const lockCount = Number(record.mesh.userData.lockCount ?? 0);
    const denied = Math.max(
      record.deniedUntil,
      Number(record.mesh.userData.deniedUntil ?? -1),
    ) > ctx.elapsed;
    const scale = modelScaleFor(record.kind) * (intro * intro * (3 - 2 * intro));
    record.mesh.scale.setScalar(scale * (locked ? 1 + Math.sin(ctx.elapsed * 26) * 0.035 : 1));

    // Additive light rigs bloom into blobs at range, so the whole rider dims
    // with distance and only lights up properly once it is worth shooting.
    const distance = record.mesh.position.distanceTo(ctx.camera.position);
    const closeness = smoothstep(1 - clamp01((distance - 10) / 58));
    tint.setScalar(0.42 + 0.58 * closeness);
    glowColour.setScalar(0.3 + 0.85 * closeness);

    if (locked) {
      const lockColour = colorForLockCount(Math.max(1, lockCount), LOCK_RAMP);
      tint.lerp(hdr(lockColour, 1.5), 0.55);
      glowColour.lerp(hdr(lockColour, 2.0), 0.6);
    }
    if (record.flashUntil > ctx.elapsed) {
      const flash = (record.flashUntil - ctx.elapsed) / 0.22;
      tint.lerp(hdr(HEADLIGHT, 2.2), flash);
      glowColour.lerp(hdr(HEADLIGHT, 2.6), flash);
    }
    if (denied) {
      const shimmer = 0.6 + 0.4 * Math.sin(ctx.elapsed * 52);
      tint.copy(hdr(GANG_RED, 1.4 * shimmer));
      glowColour.copy(hdr(GANG_RED, 2.2 * shimmer));
    }
    record.body?.color.copy(tint);
    record.glow?.color.copy(glowColour);

    if (record.kind === 'boss') updateBossDressing(dt, ctx, record, closeness);
  }
}

const tint = new Color();
const glowColour = new Color();

/** The purse swings on the strap, and the flank flares while it is exposed. */
function updateBossDressing(dt: number, ctx: VisualContext, record: EnemyRecord, closeness: number) {
  const purse = record.mesh.userData.purse as Group | undefined;
  if (!purse) return;
  const lean = Number(record.mesh.userData.bossLean ?? 0);
  const phase = ctx.elapsed * 3.1;
  purse.position.set(0.62 + lean * 0.34, 1.0 - Math.abs(Math.sin(phase)) * 0.12, 0.3 + Math.sin(phase) * 0.26);
  purse.rotation.z = -lean * 0.5 + Math.sin(phase) * 0.32;
  purse.rotation.y += dt * 0.6;
  const halo = purse.userData.purseHalo as Mesh | undefined;
  if (halo) {
    const pulse = 1.4 + 0.6 * Math.sin(ctx.elapsed * 5.5);
    (halo.material as MeshBasicMaterial).color.copy(hdr(PURSE_BLUE, pulse * (0.4 + 0.9 * closeness)));
  }
  // Exposed flanks glint; during a barrage the bike goes matte and dangerous.
  const exposed = record.mesh.userData.bossPhase === 'window';
  record.body?.color.multiplyScalar(exposed ? 1.15 : 0.78);
  if (!exposed) record.glow?.color.lerp(hdr(GANG_RED, 2.2), 0.5);
}

function updateShedPlates(dt: number) {
  for (let i = shedPlates.length - 1; i >= 0; i -= 1) {
    const plate = shedPlates[i];
    plate.age += dt;
    plate.velocity.y -= 18 * dt;
    plate.mesh.position.addScaledVector(plate.velocity, dt);
    plate.mesh.rotation.x += dt * 7;
    plate.mesh.rotation.z += dt * 5;
    if (plate.age > 1.4) {
      plate.mesh.removeFromParent();
      disposeObject3D(plate.mesh);
      shedPlates.splice(i, 1);
    }
  }
}

/**
 * The catch. The purse leaves the fireball fast, slows almost to a stop as it
 * crosses the frame, and is snatched out of the air just short of the window.
 */
function updatePurseFlight(dt: number, ctx: VisualContext) {
  if (!purseFlight) return;
  purseFlight.age += dt;
  const flightTime = 1.35;
  const t = clamp01(purseFlight.age / flightTime);
  // Ease-out hard: nearly all the travel happens in the first third.
  const eased = 1 - (1 - t) ** 3;
  const target = ctx.camera.position.clone()
    .add(new Vector3(0, 0, -2.2).applyQuaternion(ctx.camera.quaternion))
    .add(new Vector3(-0.5, -0.3, 0).applyQuaternion(ctx.camera.quaternion));
  purseFlight.mesh.position.lerpVectors(purseFlight.from, target, eased);
  purseFlight.mesh.position.y += Math.sin(t * Math.PI) * 5.5;
  purseFlight.mesh.rotation.y += dt * purseFlight.spin;
  purseFlight.mesh.rotation.z = Math.sin(purseFlight.age * 3) * 0.5;
  purseFlight.mesh.scale.setScalar(1.6 + t * 1.1);

  const halo = purseFlight.mesh.userData.purseHalo as Mesh | undefined;
  if (halo) (halo.material as MeshBasicMaterial).color.copy(hdr(PURSE_BLUE, 2.2 + t * 2.4));

  if (t >= 1) {
    purseCaught = ctx.elapsed;
    spawnRing(purseFlight.mesh.position, hdr(PURSE_BLUE, 3.0), 12, 0.7, 3);
    burstSparks(purseFlight.mesh.position, hdr(PURSE_BLUE, 2.6), 30, 9, 3);
    ctx.feel.kickFov(-5.5, { decay: 2.2 });
    purseFlight.mesh.removeFromParent();
    disposeObject3D(purseFlight.mesh);
    purseFlight = null;
  }
}

function updateProjectiles(dt: number) {
  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    record.mesh.rotateZ(dt * 22);
  }
}

function updateReticleSpin(dt: number, ctx: VisualContext) {
  const reticle = ctx.scene.children.find((child) => child.userData.raildRole === 'reticle');
  const blades = reticle?.userData.bladeGroup as Group | undefined;
  if (!blades) return;
  const active = reticle?.userData.active === true;
  blades.rotation.z += dt * (active ? 1.4 : 0.35);
}

/**
 * Camera feel: FOV opens with speed, the frame rumbles with the road surface,
 * and the fireball punches it. The lane-change roll lives in the level's
 * `updateCameraEffects`, not here, because it has to run before edge-look.
 */
function updateCameraFeel(dt: number, ctx: VisualContext) {
  const excess = Math.max(0, ctx.speedFactor - 0.9);
  ctx.feel.setFovOffset(
    Math.min(PURSE_TUNING.camera.maxFovOffsetDegrees, excess * PURSE_TUNING.camera.fovPerSpeedExcess)
      + downbeatEnergy * 0.8,
    { response: PURSE_TUNING.camera.fovResponse },
  );
  ctx.feel.shake(
    (PURSE_TUNING.camera.roadRumbleTrauma * ctx.speedFactor + blowEnergy * 0.5) * dt,
    { maxTrauma: 0.85, decay: 2.4, rollDegrees: 0.5, pitchDegrees: 0.3, yawDegrees: 0.22, frequency: 13 },
  );
  if (blowEnergy > 1.2) ctx.feel.kickFov(6, { decay: 3.0 });
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
