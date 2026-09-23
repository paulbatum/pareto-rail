import {
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { frameAtTime, speedAt } from '../flight';
import { FLAGSHIP, FLAGSHIP_CENTER, SHIELD_RADII, VALIANT_BATTERIES } from '../setpieces';
import { BARS, BEAT_SECONDS, BROADSIDE_DURATION, bar } from '../timing';
import { createFlashSystem, createGlowDiscGeometry, createParticleSystem } from './battle';
import {
  createBoltMesh,
  createBomberMesh,
  createCoreMesh,
  createDartMesh,
  createGeneratorMesh,
  createGunsight,
  createLancerMesh,
  createLockBracket,
  createRingwingMesh,
  createShotMesh,
  createTurretMesh,
  type CraftColors,
  type TintPart,
} from './craft';
import { createBattleEnvironment, randomHullPoint, type Environment, type ShipRecord } from './environment';
import { createLetterMesh, setLetterState, type LetterColors } from './letters';
import {
  battleLightUniform,
  enemyBurnUniform,
  launchChaseUniform,
  launchIntensityUniform,
  nebulaGainUniform,
  shieldCollapseUniform,
  shieldHitUniform,
  shieldInsideUniform,
  shieldUniform,
} from './materials';
import {
  CRIMSON,
  CYAN,
  DENY,
  ICE_WHITE,
  LOCK_GRADIENT,
  MOLTEN,
  MOLTEN_HOT,
  OBSIDIAN,
  WHITE_HOT,
  hdr,
} from './palette';
import { damageUniform, flashUniform, salvoUniform } from './post-fx';

// VISUALS SPINE. Palette assignments, event choreography, and the ambient
// battle's direction live here; construction lives in the leaves.
//
// Color grammar: cyan is always ours (the reticle, our shots, lock brackets,
// VALIANT's salvos); crimson is always theirs (bolts, flak, return fire);
// molten orange is the enemy's substance (engines, veins, explosions).

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  bracket: Group | null;
  bracketAt: number;
  damageUntil: number;
  deniedUntil: number;
};

type ProjectileRecord = { mesh: Object3D };

// ---- palette assignments ------------------------------------------------------------

const SWARM_COLORS: CraftColors = {
  body: OBSIDIAN.clone().multiplyScalar(1.3),
  edge: hdr(MOLTEN, 1.05),
  glow: hdr(MOLTEN, 2.4),
  eye: hdr(CRIMSON, 2.2),
};
const HEAVY_COLORS: CraftColors = {
  body: OBSIDIAN.clone().multiplyScalar(1.5),
  edge: hdr(MOLTEN_HOT, 1.1),
  glow: hdr(MOLTEN, 2.6),
  eye: hdr(CRIMSON, 2.6),
};
const BOSS_COLORS: CraftColors = {
  body: new Color(0.05, 0.035, 0.04),
  edge: hdr(MOLTEN_HOT, 1.25),
  glow: hdr(new Color(1.0, 0.22, 0.08), 0.8),
  eye: hdr(MOLTEN, 1.7),
};
const LETTER_COLORS: LetterColors = {
  plate: new Color(0.16, 0.2, 0.26),
  edge: hdr(CYAN, 1.9),
  lockedPlate: hdr(new Color(0.55, 0.95, 1.0), 1.25),
  lockedEdge: hdr(ICE_WHITE, 2.0),
  deniedPlate: new Color(0.45, 0.03, 0.05),
  deniedEdge: hdr(DENY, 1.8),
};
const ALLY_FIRE = hdr(CYAN, 2.6);
const ENEMY_FIRE = hdr(CRIMSON, 2.4);
const ALLY_IMPACT = hdr(new Color(0.7, 0.95, 1.0), 1.6);
const ENEMY_IMPACT = hdr(MOLTEN, 2.0);

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.6,
  pitchDegrees: 0.4,
  yawDegrees: 0.32,
  rollDegrees: 0.9,
  frequency: 9,
  smoothing: 20,
};

// ---- module state ---------------------------------------------------------------------

let environment: Environment | null = null;
let sceneRef: Scene | null = null;
let elapsedNow = 0;
let lastRunTime = -1;
let beatEnergy = 0;
let generatorsDown = 0;
let shieldCollapseAt = -1;
let flagshipDestroyedAt = -1;
let runningNow = false;
let runTimeNow = 0;
const pendingSalvos: Array<{ at: number; battery: number }> = [];
const pendingBlasts: Array<{ at: number; point: Vector3; size: number }> = [];

let sparks: ReturnType<typeof createParticleSystem> | null = null;
let debris: ReturnType<typeof createParticleSystem> | null = null;
let rings: ReturnType<typeof createFlashSystem> | null = null;
let trails: ReturnType<typeof createFlashSystem> | null = null;

const brackets = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.bracket,
  set: (record, bracket) => {
    record.bracket = bracket;
  },
});

// createEnemyMesh has no id; the runner emits `spawn` synchronously right after.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, kind: mesh.userData.kind as string, bornAt: null, bracket: null, bracketAt: 0, damageUntil: -1, deniedUntil: -1 }),
  disposeRecord: (record) => {
    brackets.detach(record);
    // Geometry is shared across craft; only the per-target tint materials go.
    record.mesh.traverse((child) => {
      const material = (child as Mesh).material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({ createRecord: (record) => record });

// ---- construction ------------------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  sceneRef = scene;
  environment = createBattleEnvironment(scene);
  sparks = createParticleSystem(360, new OctahedronGeometry(0.22, 0), { additive: true });
  debris = createParticleSystem(160, new TetrahedronGeometry(0.5, 0), { additive: false });
  rings = createFlashSystem(64, new RingGeometry(0.44, 0.5, 48));
  trails = createFlashSystem(220, createGlowDiscGeometry(12, 0.3));
  environment.root.add(sparks.mesh, debris.mesh, rings.mesh, trails.mesh);
  return environment;
}

export function disposeEnvironment(scene: Scene) {
  if (environment) scene.remove(environment.root);
  scene.backgroundNode = null;
  environment = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'S', LETTER_COLORS);
    case 'dart':
      return createDartMesh(SWARM_COLORS);
    case 'ringwing':
      return createRingwingMesh(SWARM_COLORS);
    case 'lancer':
      return createLancerMesh(HEAVY_COLORS);
    case 'bomber':
      return createBomberMesh(HEAVY_COLORS, hdr(CRIMSON, 2));
    case 'turret':
      return createTurretMesh(HEAVY_COLORS);
    case 'bolt':
      return createBoltMesh(hdr(new Color(1.0, 0.55, 0.5), 2.4), hdr(CRIMSON, 1.8));
    case 'generator':
      return createGeneratorMesh(BOSS_COLORS);
    case 'core':
      return createCoreMesh(BOSS_COLORS);
    default:
      return createDartMesh(SWARM_COLORS);
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  rings?.spawn(mesh.getWorldPosition(new Vector3()), hdr(DENY, 1.8), 3.2, 0.3, { grow: 2.2 });
}

export function createProjectileMesh() {
  const mesh = createShotMesh(hdr(ICE_WHITE, 2.6), hdr(CYAN, 1.3));
  projectileRecords.enqueue({ mesh });
  return mesh;
}

export function createReticle() {
  const reticle = createGunsight(hdr(CYAN, 1.6), hdr(CYAN, 0.35));
  reticle.userData.isGunsight = true;
  return reticle;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const arcs = reticle.userData.arcs as MeshBasicMaterial[];
  const charge = lockCount > 0 ? colorForLockCount(lockCount, LOCK_GRADIENT) : null;
  const rejected = (reticle.userData.rejectUntil as number | undefined ?? -1) > elapsedNow;
  arcs.forEach((material, index) => {
    if (rejected) material.color.copy(hdr(DENY, 1.6));
    else if (charge && index < lockCount) material.color.copy(hdr(charge, 2.0));
    else material.color.copy(hdr(CYAN, active ? 0.55 : 0.32));
  });
  const tick = reticle.userData.tickMaterial as MeshBasicMaterial;
  tick.color.copy(rejected ? hdr(DENY, 1.8) : hdr(charge ?? CYAN, active ? 1.8 : 1.2));
  const pulse = 1 + beatEnergy * 0.05;
  reticle.scale.setScalar((1 + lockCount * 0.045 + (active ? 0.06 : 0)) * pulse);
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
}

// ---- effects vocabulary --------------------------------------------------------------------

function explosion(position: Vector3, requestedScale: number, options: { hot?: Color; debrisColor?: Color; ring?: Color } = {}) {
  if (!environment) return;
  // Never let a blast swallow the frame: cap its size by its distance.
  const distance = cachedCamera ? position.distanceTo(cachedCamera.position) : 100;
  const scale = Math.min(requestedScale, Math.max(0.15, distance * 0.07));
  const hot = options.hot ?? hdr(MOLTEN_HOT, 2.2);
  environment.glows.spawn(position, hot, 3.2 * scale, 0.42, { grow: 2.1, minAngular: 0.01 });
  environment.glows.spawn(position, hdr(WHITE_HOT, 2.2), 1.4 * scale, 0.14, { grow: 1.3 });
  sparks?.burst(position, Math.round(10 * Math.sqrt(scale)), 16 * scale, hdr(MOLTEN, 1.8), 0.9 * Math.sqrt(scale), 0.7);
  debris?.burst(position, Math.round(5 * Math.sqrt(scale)), 11 * scale, options.debrisColor ?? hdr(MOLTEN, 0.9), 0.9 * Math.sqrt(scale), 1.4, { drag: 0.6 });
  rings?.spawn(position, options.ring ?? hdr(CYAN, 1.1), 2.2 * scale, 0.4, { grow: 3.4 });
}

function spawnBlast(point: Vector3, size: number, delay: number) {
  pendingBlasts.push({ at: elapsedNow + delay, point: point.clone(), size });
}

// ---- event wiring ----------------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || !environment) return;
    if (kind === 'bolt') {
      environment.glows.spawn(worldPosition, hdr(CRIMSON, 2.0), 2.6, 0.22, { grow: 1.8 });
    } else if (kind === 'generator' || kind === 'core') {
      rings?.spawn(worldPosition, hdr(MOLTEN_HOT, 1.4), 9, 0.7, { grow: 2.6 });
      environment.glows.spawn(worldPosition, hdr(MOLTEN, 1.6), 10, 0.6, { grow: 1.6 });
    } else if (kind === 'turret') {
      rings?.spawn(worldPosition, hdr(CRIMSON, 1.2), 4, 0.4, { grow: 2.4 });
    } else if (kind !== 'letter') {
      environment.glows.spawn(worldPosition, hdr(MOLTEN, 1.3), 2.2, 0.28, { grow: 1.6 });
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && sceneRef) {
      if (!record.bracket) brackets.attach(record, createLockBracket(hdr(color, 2.0)), sceneRef);
      else (record.bracket.userData.material as MeshBasicMaterial).color.copy(hdr(color, 2.2));
      record.bracketAt = elapsedNow;
      record.bracket!.userData.locks = ((record.bracket!.userData.locks as number | undefined) ?? 0) + 1;
    }
    rings?.spawn(worldPosition, hdr(color, 1.5), 2.4, 0.22, { grow: 0.45 });
  });

  bus.on('unlock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.bracket) {
      brackets.detach(record);
      rings?.spawn(worldPosition, hdr(CYAN, 0.7), 2.8, 0.18, { grow: 1.8 });
    }
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize, indexInVolley }) => {
    projectileRecords.claim(projectileId);
    environment?.glows.spawn(worldPosition, hdr(CYAN, 1.8), 1.6, 0.14, { grow: 1.5 });
    feel.kickFov(volleySize >= 6 && indexInVolley === 0 ? 2.4 : 0.35);
    salvoUniform.value = Math.max(salvoUniform.value, volleySize >= 6 ? 0.22 : 0.05);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    sparks?.burst(worldPosition, 6, 12, hdr(ICE_WHITE, 1.4), 0.7, 0.35);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.damageUntil = elapsedNow + 0.16;
      environment?.glows.spawn(worldPosition, hdr(CYAN, 1.6), 3, 0.16, { grow: 1.4 });
      if (record.kind === 'core' || record.kind === 'generator') feel.shake(0.12, SHAKE);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    record.mesh.userData.stage = 1;
    const rings2 = record.mesh.userData.rings as Object3D[] | undefined;
    if (rings2?.[1]) rings2[1].visible = false;
    const cage = record.mesh.userData.cage as Group | undefined;
    if (cage) cage.children.forEach((child, index) => (child.visible = index === 1));
    explosion(worldPosition, 2.2, { ring: hdr(MOLTEN_HOT, 1.4) });
    feel.shake(0.4, SHAKE);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.kind;
    if (kind === 'letter') {
      explosion(worldPosition, 0.8, { hot: hdr(CYAN, 1.8), debrisColor: new Color(0.6, 0.66, 0.74), ring: hdr(ICE_WHITE, 1.4) });
    } else if (kind === 'bolt') {
      // Interceptions happen close in: size the pop by distance so it never blinds.
      const near = cachedCamera ? Math.min(1, worldPosition.distanceTo(cachedCamera.position) / 30) : 1;
      environment?.glows.spawn(worldPosition, hdr(CRIMSON, 2.2), 3.4 * near, 0.25, { grow: 2 });
      rings?.spawn(worldPosition, hdr(CYAN, 1.2), 2 * near, 0.24, { grow: 2.6 });
    } else if (kind === 'generator') {
      generatorsDown += 1;
      explosion(worldPosition, 5, { ring: hdr(MOLTEN_HOT, 1.6) });
      spawnBlast(worldPosition.clone().add(new Vector3(0, 6, 0)), 3, 0.18);
      spawnBlast(worldPosition.clone().add(new Vector3(0, -5, 4)), 2.4, 0.33);
      shieldHitUniform.value = 1;
      feel.shake(0.7, SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.18);
    } else if (kind === 'core') {
      explosion(worldPosition, 6.5, { hot: hdr(WHITE_HOT, 2.4), ring: hdr(MOLTEN_HOT, 1.8) });
      spawnBlast(worldPosition.clone().add(new Vector3(0, 8, 0)), 4, 0.2);
      spawnBlast(worldPosition.clone().add(new Vector3(6, 3, -10)), 3, 0.4);
      feel.shake(1.0, SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.4);
    } else if (kind) {
      const scale = kind === 'bomber' ? 2.4 : kind === 'lancer' || kind === 'turret' ? 1.7 : 1.1;
      explosion(worldPosition, scale);
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.kind === 'bomber') {
      // Torpedo strike on VALIANT's flank.
      explosion(worldPosition, 4.5, { hot: hdr(MOLTEN_HOT, 2.4), debrisColor: new Color(0.55, 0.6, 0.66), ring: hdr(CRIMSON, 1.4) });
      spawnBlast(worldPosition.clone().add(new Vector3(0, 5, -8)), 3, 0.25);
      feel.shake(0.45, SHAKE);
    } else if (record && record.kind !== 'bolt' && record.kind !== 'letter') {
      environment?.glows.spawn(worldPosition, hdr(MOLTEN, 0.5), 2, 0.3, { grow: 1.2 });
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('reject', () => {
    const reticle = findReticle();
    if (reticle) reticle.userData.rejectUntil = elapsedNow + 0.35;
    damageUniform.value = Math.max(damageUniform.value, 0.18);
    feel.shake(0.2, SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === 6) {
      // A full broadside: the fleet answers with one of its own.
      flashUniform.value = Math.max(flashUniform.value, 0.12);
      salvoUniform.value = Math.max(salvoUniform.value, 0.4);
      battleLightUniform.value = Math.max(battleLightUniform.value, 0.6);
      feel.shake(0.3, SHAKE);
      fleetSalvo(10);
    }
  });

  bus.on('beat', ({ beatNumber, isDownbeat }) => {
    lastBeatEventAt = elapsedNow;
    onBeat(beatNumber, isDownbeat);
  });

  bus.on('playerhit', () => {
    damageUniform.value = 0.8;
    feel.shake(1.2, SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!environment) return;
    if (phase === 'summoned') {
      // Punching through the flagship's shield.
      shieldHitUniform.value = 1.4;
      flashUniform.value = Math.max(flashUniform.value, 0.22);
      feel.shake(0.5, SHAKE);
    } else if (phase === 'exposed') {
      shieldCollapseAt = elapsedNow;
      flashUniform.value = Math.max(flashUniform.value, 0.6);
      battleLightUniform.value = 1;
      feel.shake(1.1, SHAKE);
      feel.kickFov(6);
      rings?.spawn(FLAGSHIP_CENTER, hdr(MOLTEN_HOT, 1.6), 400, 1.4, { grow: 2.4 });
      rings?.spawn(FLAGSHIP_CENTER, hdr(CYAN, 1.3), 260, 1.1, { grow: 2.8 });
      fleetSalvo(24);
    } else if (phase === 'destroyed') {
      flagshipDestroyedAt = elapsedNow;
      flashUniform.value = Math.max(flashUniform.value, 0.55);
      feel.shake(1.3, SHAKE);
      // A chain of secondaries walking the length of the hull.
      for (let i = 0; i < 26; i += 1) {
        const z = MathUtils.lerp(FLAGSHIP.sternZ, FLAGSHIP.bowZ, Math.random());
        const local = new Vector3((Math.random() - 0.5) * FLAGSHIP.beam * 0.8, -Math.random() * 110, z);
        const world = local.applyQuaternion(FLAGSHIP.place.quaternion).add(FLAGSHIP.place.position);
        spawnBlast(world, 8 + Math.random() * 16, 0.2 + i * 0.26 + Math.random() * 0.2);
      }
    }
  });

  bus.on('runstart', () => {
    resetRun(feel);
  });
  bus.on('runend', () => {
    feel.restore();
    runningNow = false;
  });
}

let lastBeatEventAt = -Infinity;
let lastFallbackBeat = -1;

function onBeat(beatNumber: number, isDownbeat: boolean) {
  beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
  if (!runningNow) return;
  const barPosition = beatNumber / 4;
  // VALIANT's broadside: batteries ripple fire overhead on every beat of the run.
  if (barPosition >= BARS.broadside - 0.01 && barPosition < BARS.eye - 0.2) queueValiantSalvo(isDownbeat);
}

/** If the audio clock is silent (no context yet), keep the set pieces on the run clock's beat. */
function fallbackBeats(runTime: number) {
  if (!runningNow || elapsedNow - lastBeatEventAt < 1.5) return;
  const beat = Math.floor(runTime / BEAT_SECONDS);
  if (beat === lastFallbackBeat) return;
  lastFallbackBeat = beat;
  onBeat(beat, beat % 4 === 0);
}

function resetRun(feel: CameraFeelRig) {
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
  sparks?.clear();
  debris?.clear();
  rings?.clear();
  trails?.clear();
  environment?.tracers.clear();
  environment?.flashes.clear();
  environment?.glows.clear();
  environment?.dust.reset();
  pendingSalvos.length = 0;
  pendingBlasts.length = 0;
  generatorsDown = 0;
  shieldCollapseAt = -1;
  flagshipDestroyedAt = -1;
  lastRunTime = -1;
  lastFallbackBeat = -1;
  shieldUniform.value = 1;
  shieldCollapseUniform.value = 0;
  shieldHitUniform.value = 0;
  enemyBurnUniform.value = 0;
  flashUniform.value = 0;
  damageUniform.value = 0;
  salvoUniform.value = 0;
  battleLightUniform.value = 0;
  feel.restore();
  if (environment) {
    for (const ship of environment.ships) {
      ship.mesh.position.copy(ship.basePosition);
      ship.mesh.quaternion.copy(ship.baseQuaternion);
    }
    for (const section of environment.flagship.sections) {
      section.mesh.position.copy(section.basePosition);
      section.mesh.rotation.set(0, 0, 0);
    }
    environment.flagship.shield.visible = true;
  }
}

// ---- the fleets' guns ---------------------------------------------------------------------------

function queueValiantSalvo(downbeat: boolean) {
  if (!environment) return;
  const camera = environment.root.parent ? findCamera() : null;
  if (!camera) return;
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  // Batteries between 20 and 260 units ahead fire in a stern-to-bow ripple across the beat.
  const candidates = VALIANT_BATTERIES
    .map((battery, index) => ({ index, along: battery.muzzle.clone().sub(camera.position).dot(forward) }))
    .filter((entry) => entry.along > 12 && entry.along < 260)
    .sort((a, b) => a.along - b.along)
    .slice(0, downbeat ? 4 : 2);
  candidates.forEach((entry, order) => {
    pendingSalvos.push({ at: elapsedNow + order * (BEAT_SECONDS / 4), battery: entry.index });
  });
}

let cachedCamera: PerspectiveCamera | null = null;
function findCamera() {
  return cachedCamera;
}

function fireValiantBattery(index: number, feel: CameraFeelRig) {
  if (!environment) return;
  const battery = VALIANT_BATTERIES[index];
  environment.glows.spawn(battery.muzzle, hdr(ICE_WHITE, 2.4), 16, 0.24, { grow: 2.2 });
  environment.glows.spawn(battery.muzzle, hdr(CYAN, 1.8), 30, 0.5, { grow: 1.6 });
  const targets = environment.enemies.filter((ship) => ship.name === 'MAW' || ship.name === 'SCOURGE' || ship.name === 'THORN');
  for (let k = 0; k < 3; k += 1) {
    const target = targets[Math.floor(Math.random() * targets.length)];
    const from = battery.muzzle.clone().addScaledVector(environment.valiant.place.forward, (k - 1) * 3.4);
    const to = randomHullPoint(target, Math.random);
    environment.tracers.fire(from, to, hdr(CYAN, 3.2), {
      speed: 1500,
      length: 140,
      width: 1.5,
      onImpact: (point) => {
        environment?.flashes.spawn(point, ENEMY_IMPACT, 26, 0.5, { grow: 2, minAngular: 0.012 });
      },
    });
  }
  sparks?.burst(battery.muzzle, 6, 22, hdr(CYAN, 1.2), 1.2, 0.5, { inherit: battery.direction.clone().multiplyScalar(30) });
  const distance = cachedCamera ? battery.muzzle.distanceTo(cachedCamera.position) : 100;
  const near = MathUtils.clamp(1 - distance / 160, 0, 1);
  battleLightUniform.value = Math.max(battleLightUniform.value, 0.45 * near);
  salvoUniform.value = Math.max(salvoUniform.value, 0.16 * near);
  feel.shake(0.22 * near, SHAKE);
}

/** Capital-ship crossfire: our line's cyan against theirs in crimson. */
function crossfireRates(runTime: number, running: boolean) {
  if (!running) return { ally: 3, enemy: 3 };
  const b = runTime / bar(1);
  if (b < BARS.gaps) return { ally: 5, enemy: 4 };
  if (b < BARS.broadside) return { ally: 11, enemy: 10 };
  if (b < BARS.eye) return { ally: 8, enemy: 12 };
  if (b < BARS.belly) return { ally: 1.2, enemy: 1 };
  if (b < BARS.flagship) return { ally: 8, enemy: 8 };
  if (b < BARS.trench) return { ally: 12, enemy: 10 };
  if (b < BARS.victory) return { ally: 10, enemy: 7 };
  return flagshipDestroyedAt >= 0 ? { ally: 22, enemy: 1.5 } : { ally: 8, enemy: 12 };
}

const crossfireAccumulator = { ally: 0, enemy: 0 };

function fireCrossfire(side: 'ally' | 'enemy', camera: Camera) {
  if (!environment) return;
  const shooters = side === 'ally' ? environment.allies : environment.enemies;
  const targets = side === 'ally' ? environment.enemies : environment.allies;
  const source = pickNear(shooters, camera, 4200);
  const target = pickNear(targets, camera, 5200);
  if (!source || !target) return;
  const from = randomHullPoint(source, Math.random);
  // Some of our fire breaks on the flagship's shield while it stands.
  if (side === 'ally' && environment.flagship.shield.visible && Math.random() < 0.22) {
    const d = new Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiply(SHIELD_RADII);
    const point = d.applyQuaternion(FLAGSHIP.place.quaternion).add(FLAGSHIP_CENTER);
    environment.tracers.fire(from, point, ALLY_FIRE, {
      speed: 1300,
      length: 80,
      width: 1.1,
      onImpact: (hit) => {
        environment?.flashes.spawn(hit, hdr(new Color(1, 0.4, 0.15), 1.6), 40, 0.5, { grow: 2.2, minAngular: 0.012 });
        shieldHitUniform.value = Math.max(shieldHitUniform.value, 0.3);
      },
    });
    return;
  }
  const miss = Math.random() < 0.35;
  const to = randomHullPoint(target, Math.random);
  if (miss) to.add(new Vector3((Math.random() - 0.5) * 260, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 260));
  const color = side === 'ally' ? ALLY_FIRE : ENEMY_FIRE;
  environment.tracers.fire(from, to, color, {
    speed: 1100 + Math.random() * 500,
    length: 50 + Math.random() * 70,
    width: 1.1,
    onImpact: miss ? undefined : (point) => {
      environment?.flashes.spawn(point, side === 'ally' ? ENEMY_IMPACT : ALLY_IMPACT, 14 + Math.random() * 16, 0.4, { grow: 1.8, minAngular: 0.008 });
    },
  });
}

function pickNear(ships: ShipRecord[], camera: Camera, radius: number) {
  const near = ships.filter((ship) => ship.mesh.position.distanceTo(camera.position) < radius);
  const pool = near.length > 0 ? near : ships;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** An allied salvo from every nearby hull at once — the fleet answering a full broadside or the shield falling. */
function fleetSalvo(count: number) {
  if (!environment || !cachedCamera) return;
  for (let i = 0; i < count; i += 1) fireCrossfire('ally', cachedCamera);
  // The gap pair and VALIANT join when in range.
  if (environment.valiant.mesh.position.distanceTo(cachedCamera.position) < 1600) {
    for (let k = 0; k < 4; k += 1) pendingSalvos.push({ at: elapsedNow + k * BEAT_SECONDS / 4, battery: Math.floor(Math.random() * VALIANT_BATTERIES.length) });
  }
}

// ---- per-frame --------------------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  if (!environment) return;
  elapsedNow = ctx.elapsed;
  runningNow = ctx.running;
  runTimeNow = ctx.running ? ctx.runTime : 0;
  if (ctx.camera instanceof PerspectiveCamera) cachedCamera = ctx.camera;
  const camera = ctx.camera;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.6);

  const runTime = runTimeNow;
  const b = runTime / bar(1);
  fallbackBeats(runTime);

  // Salvos and delayed blasts.
  for (let i = pendingSalvos.length - 1; i >= 0; i -= 1) {
    if (pendingSalvos[i].at <= elapsedNow) {
      fireValiantBattery(pendingSalvos[i].battery, ctx.feel);
      pendingSalvos.splice(i, 1);
    }
  }
  for (let i = pendingBlasts.length - 1; i >= 0; i -= 1) {
    const blast = pendingBlasts[i];
    if (blast.at > elapsedNow) continue;
    explosion(blast.point, blast.size, { ring: hdr(MOLTEN_HOT, 1.2) });
    battleLightUniform.value = Math.max(battleLightUniform.value, Math.min(0.5, blast.size * 0.03));
    pendingBlasts.splice(i, 1);
  }

  // Crossfire.
  const rates = crossfireRates(runTime, ctx.running);
  crossfireAccumulator.ally += rates.ally * dt;
  crossfireAccumulator.enemy += rates.enemy * dt;
  while (crossfireAccumulator.ally >= 1) {
    crossfireAccumulator.ally -= 1;
    fireCrossfire('ally', camera);
  }
  while (crossfireAccumulator.enemy >= 1) {
    crossfireAccumulator.enemy -= 1;
    fireCrossfire('enemy', camera);
  }
  updateSetPieces(dt, ctx, b);

  environment.tracers.update(dt, camera);
  environment.flashes.update(dt, camera);
  environment.glows.update(dt, camera);
  environment.swarm.update(elapsedNow, camera);
  const dustBrightness = ctx.running ? MathUtils.clamp(speedAt(runTime) / 110, 0.25, 1.1) : 0.25;
  environment.dust.update(dt, camera, dustBrightness);
  sparks?.update(dt, camera);
  debris?.update(dt, camera);
  rings?.update(dt, camera);
  trails?.update(dt, camera);

  updateEnemyRecords(dt, ctx);

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    trails?.spawn(record.mesh.position, hdr(CYAN, 1.2), 0.9, 0.2, { grow: 0.4 });
  }

  const reticle = findReticle();
  if (reticle) {
    const ticks = reticle.userData.ticks as Group;
    ticks.rotation.z += dt * (reticle.userData.active ? 2.8 : 0.5);
  }

  // Post uniforms decay.
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.5 ? 1.1 : 2.2));
  damageUniform.value = Math.max(0, damageUniform.value - dt * 2.2);
  salvoUniform.value = Math.max(0, salvoUniform.value - dt * 3);
  battleLightUniform.value = Math.max(0, battleLightUniform.value - dt * 2.4);
  shieldHitUniform.value = Math.max(0, shieldHitUniform.value - dt * 1.6);
  lastRunTime = runTime;
}

function updateSetPieces(dt: number, ctx: VisualContext, b: number) {
  if (!environment) return;
  const runTime = runTimeNow;

  // Flight-deck launch lights: idle chase in attract, a blaze at the catapult.
  const catapult = ctx.running ? MathUtils.clamp(1 - Math.abs(b - 1.1) / 0.6, 0, 1) : 0;
  launchChaseUniform.value -= dt * (ctx.running ? 1.4 + catapult * 9 : 0.9);
  launchIntensityUniform.value = !ctx.running ? 0.55 + beatEnergy * 0.35 : b < 2.6 ? 0.6 + catapult * 1.8 + beatEnergy * 0.3 : Math.max(0, 0.6 - (b - 2.6) * 0.3);

  // Gap pair: RIPPER and PARAGON trade broadsides straight across the rail.
  if (ctx.running && b > 3.3 && b < 6.6) {
    const [ally, enemy] = environment.gapPair;
    if (Math.random() < dt * 7) fireAcross(ally, enemy, ALLY_FIRE, ENEMY_IMPACT);
    if (Math.random() < dt * 7) fireAcross(enemy, ally, ENEMY_FIRE, ALLY_IMPACT);
  }

  // Return fire on VALIANT's flank during the run, landing near the camera.
  if (ctx.running && b > BARS.broadside && b < BARS.eye - 0.3 && Math.random() < dt * 3.5) {
    const source = environment.enemies.find((ship) => ship.name === 'MAW');
    if (source) {
      const frame = frameAtTime(runTime + 0.8 + Math.random() * 1.5);
      const hit = frame.position.clone().addScaledVector(frame.right, -24 - Math.random() * 6).addScaledVector(frame.up, (Math.random() - 0.3) * 30);
      environment.tracers.fire(randomHullPoint(source, Math.random), hit, ENEMY_FIRE, {
        speed: 1300,
        length: 70,
        width: 1,
        onImpact: (point) => {
          environment?.flashes.spawn(point, ALLY_IMPACT, 10, 0.35, { grow: 2 });
          sparks?.burst(point, 4, 14, hdr(ICE_WHITE, 1.2), 0.9, 0.5);
        },
      });
    }
  }

  // Point-defense flak blooming around the flagship pass.
  if (ctx.running && b > BARS.flagship - 0.4 && b < BARS.shieldsDown && Math.random() < dt * 7) {
    const frame = frameAtTime(runTime);
    const point = frame.position.clone()
      .addScaledVector(frame.forward, 40 + Math.random() * 110)
      .addScaledVector(frame.right, -40 + Math.random() * 110)
      .addScaledVector(frame.up, -30 + Math.random() * 65);
    environment.glows.spawn(point, hdr(CRIMSON, 1.3), 5 + Math.random() * 5, 0.5, { grow: 1.8 });
    environment.glows.spawn(point, hdr(MOLTEN_HOT, 1.4), 2, 0.18, { grow: 1.2 });
    sparks?.burst(point, 4, 8, hdr(MOLTEN, 1.3), 0.8, 0.6);
  }

  // Inside the shield ellipsoid the lattice dims to a web.
  const local = ctx.camera.position.clone().sub(FLAGSHIP_CENTER).applyQuaternion(FLAGSHIP.place.quaternion.clone().invert()).divide(SHIELD_RADII);
  shieldInsideUniform.value = MathUtils.lerp(shieldInsideUniform.value, local.length() < 1 ? 1 : 0, Math.min(1, dt * 4));

  // Shield: failing flicker once all generators are down, collapse on the downbeat.
  if (shieldCollapseAt >= 0) {
    const t = (elapsedNow - shieldCollapseAt) / 1.6;
    shieldCollapseUniform.value = MathUtils.clamp(t, 0, 1);
    if (t >= 1) {
      shieldUniform.value = 0;
      environment.flagship.shield.visible = false;
    }
  } else if (generatorsDown >= 4) {
    shieldUniform.value = 0.35 + 0.65 * Math.abs(Math.sin(elapsedNow * 23) * Math.sin(elapsedNow * 7.3));
  } else {
    shieldUniform.value = 1 - generatorsDown * 0.12;
  }

  // Background fleet drift; after the flagship falls, the enemy line burns and scatters.
  const victory = ctx.running && b >= BARS.victory && flagshipDestroyedAt >= 0;
  enemyBurnUniform.value = MathUtils.lerp(enemyBurnUniform.value, victory ? 1 : flagshipDestroyedAt >= 0 ? 0.35 : 0, Math.min(1, dt * 0.8));
  for (const ship of environment.ships) {
    if (ship.drift.lengthSq() === 0) continue;
    ship.mesh.position.copy(ship.basePosition).addScaledVector(ship.drift, runTime);
    if (victory && ship.side === 'enemy') {
      const t = runTime - bar(BARS.victory);
      const turn = Math.min(0.5, t * 0.06) * (ship.basePosition.x > 800 ? 1 : -1);
      ship.mesh.quaternion.copy(ship.baseQuaternion);
      ship.mesh.rotateY(turn);
      ship.mesh.rotateZ(turn * 0.4);
      ship.mesh.position.addScaledVector(ship.place.forward, -t * t * 3);
      if (Math.random() < dt * 0.9) spawnBlast(randomHullPoint(ship, Math.random), 10 + Math.random() * 14, 0);
    }
  }

  // The flagship breaking: sections drift and roll apart once the pull-out begins.
  if (flagshipDestroyedAt >= 0) {
    const t = Math.max(0, runTime - bar(BARS.victory - 0.2));
    for (const section of environment.flagship.sections) {
      section.mesh.position.copy(section.basePosition).addScaledVector(section.drift, t * t * 0.5);
      section.mesh.rotation.set(section.spin.x * t * t * 0.4, section.spin.y * t * t * 0.4, section.spin.z * t * t * 0.4);
    }
    if (ctx.running && Math.random() < dt * 4) {
      const z = MathUtils.lerp(FLAGSHIP.sternZ, FLAGSHIP.bowZ, Math.random());
      const world = new Vector3((Math.random() - 0.5) * FLAGSHIP.beam, -Math.random() * 120, z)
        .applyQuaternion(FLAGSHIP.place.quaternion).add(FLAGSHIP.place.position);
      spawnBlast(world, 12 + Math.random() * 20, 0);
    }
  }

  // Wreckage tumbling through the eye.
  for (const wreck of environment.wreckage) {
    wreck.mesh.position.copy(wreck.base).addScaledVector(wreck.drift, elapsedNow % 600);
    wreck.mesh.quaternion.copy(wreck.baseQuaternion);
    wreck.mesh.rotateX(wreck.spin.x * elapsedNow);
    wreck.mesh.rotateY(wreck.spin.y * elapsedNow);
  }

  // The eye: the sky itself holds its breath.
  const eye = ctx.running ? MathUtils.clamp(1 - Math.abs(b - 15) / 1.2, 0, 1) : 0;
  const finale = ctx.running ? MathUtils.clamp((b - BARS.victory) / 3, 0, 1) : 0;
  nebulaGainUniform.value = 1 - eye * 0.25 + finale * (flagshipDestroyedAt >= 0 ? 0.25 : 0);
}

function fireAcross(from: ShipRecord, to: ShipRecord, color: Color, impact: Color) {
  if (!environment) return;
  const start = randomHullPoint(from, Math.random);
  const end = randomHullPoint(to, Math.random);
  environment.tracers.fire(start, end, color, {
    speed: 900,
    length: 36,
    width: 0.9,
    onImpact: (point) => environment?.flashes.spawn(point, impact, 9, 0.35, { grow: 1.8 }),
  });
}

function updateEnemyRecords(dt: number, ctx: VisualContext) {
  const camera = ctx.camera as PerspectiveCamera;
  for (const [enemyId, record] of enemyRecords.entries()) {
    const mesh = record.mesh;
    if (!mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const grow = record.kind === 'turret' ? Math.min(1, age / 0.5) : Math.min(1, age / 0.3);
    mesh.scale.setScalar(record.kind === 'letter' ? 1 : easeOutBack(grow));

    const userData = mesh.userData;
    if (userData.isLetter) {
      const denied = (userData.deniedUntil as number | undefined ?? -1) > elapsedNow;
      setLetterState(mesh, denied ? 'denied' : userData.locked ? 'locked' : 'idle', beatEnergy);
    } else {
      tintCraft(record, camera);
    }

    switch (record.kind) {
      case 'turret': {
        const head = userData.head as Group | undefined;
        if (head) {
          const headWorld = head.getWorldPosition(new Vector3());
          head.lookAt(headWorld.clone().multiplyScalar(2).sub(camera.position));
        }
        break;
      }
      case 'generator': {
        const rings2 = userData.rings as Object3D[];
        rings2.forEach((ring, index) => {
          ring.rotation.x += dt * (index === 0 ? 1.2 : -1.7);
        });
        const dome = userData.dome as Mesh;
        dome.scale.setScalar(1 + Math.sin(elapsedNow * 8) * 0.06 + beatEnergy * 0.08 + (userData.stage ? 0.25 : 0));
        break;
      }
      case 'core': {
        const crystal = userData.crystal as Mesh;
        crystal.rotation.y += dt * (userData.stage ? 3.4 : 1.2);
        crystal.scale.set(0.9, 2.2, 0.9).multiplyScalar(1 + beatEnergy * 0.12 + (userData.stage ? 0.2 : 0));
        (userData.cage as Group).rotation.y -= dt * 0.8;
        break;
      }
      case 'bolt': {
        // Braking in front of the lens: keep the bolt a threat, not a wall.
        const distance = mesh.position.distanceTo(camera.position);
        mesh.scale.multiplyScalar(MathUtils.clamp(distance / 7, 0.18, 1));
        const spin = userData.spin as Mesh | undefined;
        if (spin) {
          spin.rotation.z += dt * 9;
        }
        trails?.spawn(mesh.position, hdr(CRIMSON, 1.1), 1.2, 0.22, { grow: 0.5 });
        break;
      }
      case 'lancer': {
        const eye = userData.eye as Mesh;
        eye.scale.setScalar(1 + (userData.charge as number ?? 0) * 1.8);
        break;
      }
      default:
        break;
    }

    if (record.bracket) {
      const bracket = record.bracket;
      mesh.getWorldPosition(bracket.position);
      bracket.quaternion.copy(camera.quaternion);
      const snap = Math.min(1, (elapsedNow - record.bracketAt) / 0.12);
      const lockScale = (userData.lockScale as number | undefined) ?? 1.3;
      const locks = (bracket.userData.locks as number | undefined) ?? 1;
      bracket.rotateZ((1 - snap) * 0.8 + (locks - 1) * 0.25 + Math.sin(elapsedNow * 6) * 0.03);
      bracket.scale.setScalar(lockScale * (2.3 - 1.1 * snap) * (1 + beatEnergy * 0.06));
    }
  }
}

function tintCraft(record: EnemyRecord, camera: PerspectiveCamera) {
  const parts = record.mesh.userData.parts as TintPart[] | undefined;
  if (!parts) return;
  const denied = (record.mesh.userData.deniedUntil as number | undefined ?? -1) > elapsedNow;
  const locked = record.mesh.userData.locked === true;
  const damaged = record.damageUntil > elapsedNow;
  const charge = (record.mesh.userData.charge as number | undefined) ?? 0;
  const stage = record.mesh.userData.stage ? 1 : 0;
  const distance = record.mesh.position.distanceTo(camera.position);
  const near = MathUtils.clamp(1 - (distance - 20) / 90, 0.55, 1);
  for (const part of parts) {
    const color = part.material.color;
    if (denied) {
      color.copy(part.role === 'body' ? new Color(0.35, 0.02, 0.03) : hdr(DENY, 1.8));
    } else if (damaged) {
      color.copy(part.role === 'body' ? new Color(0.55, 0.62, 0.7) : hdr(WHITE_HOT, 2.2));
    } else if (locked && part.role === 'edge') {
      color.copy(hdr(CYAN, 1.7));
    } else if (part.role === 'eye') {
      color.copy(part.base).multiplyScalar(1 + charge * 1.2 + stage * 0.4 + beatEnergy * 0.15);
    } else if (part.role === 'edge') {
      color.copy(part.base).multiplyScalar(near);
    } else {
      color.copy(part.base);
    }
  }
}

function findReticle(): Object3D | null {
  if (!sceneRef) return null;
  for (const child of sceneRef.children) if (child.userData.isGunsight) return child;
  return null;
}

// ---- camera feel -------------------------------------------------------------------------

let fovOffset = 0;
let catapultKicked = false;

/** Applied after the flown camera: FOV breathes with airspeed, kicks at the catapult, widens for the pull-out. */
export function updateCameraFeel(dt: number, feel: CameraFeelRig, runTime: number) {
  const b = runTime / bar(1);
  if (runTime < 0.2) catapultKicked = false;
  if (!catapultKicked && b >= BARS.catapult) {
    catapultKicked = true;
    feel.kickFov(11, { decay: 1.6 });
    feel.shake(0.7, SHAKE);
    flashUniform.value = Math.max(flashUniform.value, 0.15);
  }
  const speed = speedAt(runTime);
  const pullout = MathUtils.clamp((b - BARS.victory) / 1.5, 0, 1) * MathUtils.clamp((BROADSIDE_DURATION - runTime) / 2.5, 0, 1);
  const target = MathUtils.clamp((speed - 70) * 0.05, -2, 4) + pullout * 5;
  fovOffset = MathUtils.lerp(fovOffset, target, Math.min(1, dt * 3));
  feel.setFovOffset(fovOffset);
  feel.update(dt, { shake: SHAKE });
}

export function resetCameraFeelState() {
  fovOffset = 0;
  catapultKicked = false;
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
