import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { BARS, BROADSIDE_TLLU_TIME } from '../timing';
import { railSpeedAt, createBroadsideRail, SHIPS } from '../battlefield';
import { BOSS_ANCHORS } from '../gameplay';
import { createBattle } from './battle';
import type { SwarmCluster } from './battle';
import {
  createEnemyObject,
  createPlayerShot,
  disposeEnemyCaches,
  disposeEnemyObject,
  disposePlayerShot,
  enemyParts,
  SOLID_BASE,
  type EnemyKindName,
} from './enemies';
import { createFleet, type Fleet } from './fleet';
import { createFx, type Fx } from './fx';
import { createLetterObject, disposeLetterGeometries, disposeLetterObject, paintLetter } from './letters';
import {
  CRIMSON,
  CYAN,
  CYAN_HOT,
  hdr,
  LOCK_GRADIENT,
  MOLTEN,
  NEBULA_MAGENTA,
  SHIELD_AMBER,
  SHIELD_ROSE,
  WHITE_HOT,
} from './palette';
import { flareUniform, hitUniform, hushUniform, volleyUniform } from './post-fx';
import { createReticleObject, updateReticleObject } from './reticle';
import { createSky, skyBeatUniform, skyFlareUniform, skyVictoryUniform } from './sky';

export { composeBroadsideOutput } from './post-fx';

// Spine: palette use, event choreography, and the battle's dramatic dial. Model
// construction lives in the leaf files; every number that shapes the show
// (fire rates by act, explosion sizes by kind, what shakes the camera) is here.

// ---- the battle's dial: ship-to-ship fire by act -----------------------------------------------

type FireKey = readonly [bar: number, friendly: number, enemy: number, flak: number, broadside: number];
const FIRE_KEYS: readonly FireKey[] = [
  [0, 1.0, 0.8, 0.3, 0],
  [BARS.crossfire, 4.5, 4, 1.4, 0],
  [BARS.crossfirePush, 9, 8.5, 2.6, 0],
  [BARS.flank - 0.4, 7, 6, 1.8, 0],
  [BARS.flank + 1.2, 6, 7, 2.2, 7],
  [BARS.eye - 0.5, 5, 6, 1.6, 4],
  [BARS.eye + 0.6, 0.9, 0.7, 0.25, 0],
  [BARS.belly - 0.4, 0.9, 0.7, 0.25, 0],
  [BARS.belly + 0.5, 6.5, 6, 1.8, 0],
  [BARS.flagship, 10, 9, 2.8, 0],
  [BARS.escorts + 1, 13, 12, 3.4, 0],
  [BARS.victory, 5, 4, 1.0, 0],
  [BARS.victory + 0.3, 10, 0.4, 0.2, 0],
  [BARS.end, 14, 0, 0, 0],
];

/** 0 outside, 1 inside: eases in over [a, b] and back out over [c, d]. */
function smoothBand(x: number, a: number, b: number, c: number, d: number) {
  const rise = Math.min(1, Math.max(0, (x - a) / (b - a)));
  const fall = Math.min(1, Math.max(0, (x - c) / (d - c)));
  return rise * rise * (3 - 2 * rise) * (1 - fall * fall * (3 - 2 * fall));
}

function fireAt(bars: number) {
  if (bars <= FIRE_KEYS[0][0]) return FIRE_KEYS[0];
  for (let i = 1; i < FIRE_KEYS.length; i += 1) {
    if (bars <= FIRE_KEYS[i][0]) {
      const a = FIRE_KEYS[i - 1];
      const b = FIRE_KEYS[i];
      const t = (bars - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [bars, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t] as const;
    }
  }
  return FIRE_KEYS[FIRE_KEYS.length - 1];
}

/** Dogfight knots: where the swarms visibly live, by side. Radius is the loop size. */
const SWARM_CLUSTERS: readonly SwarmCluster[] = [
  { center: [-70, 40, -520], side: 'friendly', count: 9, radius: 90 },
  { center: [10, 70, -600], side: 'enemy', count: 9, radius: 80 },
  { center: [-30, 20, -780], side: 'friendly', count: 8, radius: 110 },
  { center: [90, 60, -840], side: 'enemy', count: 9, radius: 100 },
  { center: [130, 30, -1150], side: 'enemy', count: 8, radius: 100 },
  { center: [90, 60, -1350], side: 'friendly', count: 6, radius: 70 },
  { center: [160, 40, -1600], side: 'enemy', count: 8, radius: 120 },
  { center: [140, 70, -1900], side: 'friendly', count: 6, radius: 90 },
  { center: [60, 20, -2200], side: 'enemy', count: 7, radius: 130 },
  { center: [-200, 0, -2350], side: 'friendly', count: 7, radius: 150 },
  { center: [110, 40, -2650], side: 'enemy', count: 7, radius: 120 },
  { center: [140, 90, -3200], side: 'friendly', count: 7, radius: 110 },
  { center: [220, 60, -3350], side: 'enemy', count: 8, radius: 120 },
  { center: [-20, 60, -3700], side: 'enemy', count: 7, radius: 110 },
];

// ---- module state (one level mounted at a time; reset in disposeVisuals) ------------------------

type EnemyRecord = {
  mesh: Group;
  kind: EnemyKindName | 'letter';
  born: number;
  bracket: Group | null;
  bracketBorn: number;
  lockCount: number;
  flashUntil: number;
  deniedUntil: number;
  open: number;
  opened: boolean;
  stageKick: number;
  damaged: boolean;
};

let scene: Scene | null = null;
let camera: PerspectiveCamera | null = null;
let feel: CameraFeelRig | null = null;
let fx: Fx | null = null;
let fleet: Fleet | null = null;
let sky: ReturnType<typeof createSky> | null = null;
let battle: ReturnType<typeof createBattle> | null = null;
let root: Group | null = null;
let elapsedNow = 0;
let runClock = 0;
let beatEnergy = 0;
let flare = 0;
let woundFlash = 0;
let volleyFlash = 0;
let victoryAt = -1;
let finaleBlasts: Array<{ at: number; done: boolean }> = [];
let shieldBreakAt = -1;
let calloutHandler: ((text: string, hold?: number) => void) | null = null;
let warm: { group: Group; objects: Group[]; bracket: Group; shot: Group; frames: number } | null = null;

const records = createPendingVisualRecords<Group, EnemyRecord, [number]>({
  createRecord: (mesh, born) => ({
    mesh,
    kind: (mesh.userData.kind as EnemyKindName | 'letter' | undefined) ?? 'letter',
    born,
    bracket: null,
    bracketBorn: 0,
    lockCount: 0,
    flashUntil: 0,
    deniedUntil: 0,
    open: 0,
    opened: false,
    stageKick: -10,
    damaged: false,
  }),
  disposeRecord(record) {
    if (record.bracket) {
      record.bracket.removeFromParent();
      disposeBracket(record.bracket);
    }
    record.mesh.removeFromParent();
    disposeGroup(record.mesh);
  },
});
const projectiles = createPendingVisualRecords<Group, Group>({
  createRecord: (mesh) => mesh,
  disposeRecord: (mesh) => disposePlayerShot(mesh),
});

function disposeGroup(mesh: Group) {
  if (mesh.userData.isLetter) disposeLetterObject(mesh);
  else disposeEnemyObject(mesh);
}

// ---- lock bracket ----------------------------------------------------------------------------

const bracketGeometry = new BoxGeometry(1, 1, 1);

function createBracket(color: Color) {
  const group = new Group();
  const material = new MeshBasicMaterial({ color: hdr(color, 1.5), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 4; i += 1) {
    const corner = new Group();
    const arm = 0.42;
    const a = new Mesh(bracketGeometry, material);
    a.scale.set(arm, 0.075, 0.075);
    a.position.set(arm / 2 - 0.5 + 0.0375, 0.5 - 0.0375, 0);
    const b = new Mesh(bracketGeometry, material);
    b.scale.set(0.075, arm, 0.075);
    b.position.set(-0.5 + 0.0375, 0.5 - arm / 2 - 0.0375 + 0.075, 0);
    corner.add(a, b);
    corner.rotation.z = -(i * Math.PI) / 2;
    group.add(corner);
  }
  group.userData.material = material;
  group.traverse((child) => { child.userData.raildIgnoreOcclusion = true; });
  return group;
}

function disposeBracket(group: Group) {
  (group.userData.material as MeshBasicMaterial | undefined)?.dispose();
}

// ---- environment -------------------------------------------------------------------------------

export function createEnvironment(targetScene: Scene, targetCamera: PerspectiveCamera) {
  disposeVisuals();
  scene = targetScene;
  camera = targetCamera;
  targetCamera.near = 0.3;
  targetCamera.far = 6200;
  targetCamera.updateProjectionMatrix();
  scene.background = new Color(0.006, 0.003, 0.014);
  scene.fog = new FogExp2(new Color(0.09, 0.03, 0.12), 0.00021);
  root = new Group();
  scene.add(root);

  sky = createSky();
  root.add(sky.group);
  fx = createFx();
  fleet = createFleet(SHIPS);
  root.add(fleet.root);
  root.add(fx.group);
  battle = createBattle({ scene: root, fx, fleet, curve: createBroadsideRail(), clusters: SWARM_CLUSTERS });
  warmUp(root);
  return root;
}

/**
 * Draw one microscopic instance of every hostile kind, a bracket, and a shot for a few frames on the attract
 * screen, so the renderer builds their pipelines before the first wave instead of hitching when it spawns.
 */
function warmUp(parent: Group) {
  const group = new Group();
  const kinds: EnemyKindName[] = ['dart', 'raker', 'bomber', 'turret', 'pdgun', 'gen', 'core', 'heart', 'bolt'];
  const objects: Group[] = kinds.map((kind) => createEnemyObject(kind));
  const bracket = createBracket(CYAN);
  const shot = createPlayerShot();
  for (const object of [...objects, bracket, shot]) {
    object.scale.setScalar(0.0002);
    object.position.set(0, 6, -8);
    object.traverse((child) => {
      child.frustumCulled = false;
      child.userData.raildIgnoreOcclusion = true;
    });
    group.add(object);
  }
  parent.add(group);
  warm = { group, objects, bracket, shot, frames: 0 };
}

function retireWarmUp() {
  if (!warm) return;
  warm.group.removeFromParent();
  for (const object of warm.objects) disposeEnemyObject(object);
  disposeBracket(warm.bracket);
  disposePlayerShot(warm.shot);
  warm = null;
}

export function bindCallouts(handler: (text: string, hold?: number) => void) {
  calloutHandler = handler;
}

export function bindCameraFeel(rig: CameraFeelRig) {
  feel = rig;
}

// ---- factories ---------------------------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  if (kind === 'letter' || letter) {
    mesh = createLetterObject(letter ?? 'A');
    mesh.userData.kind = 'letter';
  } else {
    mesh = createEnemyObject(kind as EnemyKindName);
  }
  mesh.scale.setScalar(0.001);
  records.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) paintLetter(mesh as Group, locked ? 'locked' : 'idle');
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  if (mesh.userData.isLetter) paintLetter(mesh as Group, 'denied');
  fx?.burst(mesh.position, hdr(CRIMSON, 2.4), 8, 7, 0.4, 1.2, 0.16);
  fx?.flash(mesh.position, hdr(CRIMSON, 1.8), 1.4, 0.25, 1.4);
}

export function createProjectileMesh() {
  const mesh = createPlayerShot();
  projectiles.enqueue(mesh);
  return mesh;
}

export function createReticle() {
  return createReticleObject();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  updateReticleObject(reticle, active, lockCount, elapsedNow);
}

// ---- explosions by kind --------------------------------------------------------------------------

const EXPLOSION: Record<EnemyKindName, { size: number; sparks: number; ring: number; shake: number; flare: number; color: Color }> = {
  dart: { size: 5, sparks: 12, ring: 3.6, shake: 0.06, flare: 0, color: hdr(MOLTEN, 3.0) },
  raker: { size: 7, sparks: 16, ring: 5, shake: 0.09, flare: 0, color: hdr(MOLTEN, 3.0) },
  bomber: { size: 9.5, sparks: 24, ring: 7, shake: 0.2, flare: 0.05, color: hdr(MOLTEN, 3.2) },
  turret: { size: 8, sparks: 18, ring: 6, shake: 0.14, flare: 0, color: hdr(MOLTEN, 3.0) },
  pdgun: { size: 6.5, sparks: 14, ring: 5, shake: 0.1, flare: 0, color: hdr(MOLTEN, 3.0) },
  gen: { size: 18, sparks: 36, ring: 24, shake: 0.5, flare: 0.22, color: hdr(SHIELD_AMBER, 2.4) },
  core: { size: 20, sparks: 40, ring: 26, shake: 0.6, flare: 0.28, color: hdr(WHITE_HOT, 2.4) },
  heart: { size: 34, sparks: 80, ring: 40, shake: 1.0, flare: 0.5, color: hdr(WHITE_HOT, 2.4) },
  bolt: { size: 3.6, sparks: 8, ring: 5, shake: 0.03, flare: 0, color: hdr(CYAN_HOT, 2.6) },
};

function explode(kind: EnemyKindName, position: Vector3) {
  if (!fx) return;
  const spec = EXPLOSION[kind];
  fx.flash(position, hdr(WHITE_HOT, 2.4), spec.size * 0.55, 0.22, 1.8, 2);
  fx.flash(position, spec.color, spec.size, 0.55 + spec.size * 0.012, 2.4);
  if (kind !== 'bolt') fx.flash(position, hdr(CRIMSON, 1.9), spec.size * 1.7, 0.85 + spec.size * 0.01, 2, 2);
  fx.ring(position, kind === 'bolt' ? hdr(CYAN, 2.2) : spec.color, spec.ring * 0.42, 0.5 + spec.size * 0.008, 3.4);
  fx.burst(position, spec.color, spec.sparks, 12 + spec.size * 1.8, 0.7 + spec.size * 0.02, 1.4 + spec.size * 0.1, 0.16 + spec.size * 0.008);
  feel?.shake(spec.shake);
  flare = Math.max(flare, spec.flare);
}

// ---- events ------------------------------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, cameraFeel: CameraFeelRig, onFinale: () => void) {
  feel = cameraFeel;
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = records.claim(enemyId, elapsedNow);
    if (!record) return;
    if (kind === 'letter') {
      fx?.flash(worldPosition, hdr(CYAN, 1.5), 1.6, 0.3, 1.6);
      return;
    }
    const k = kind as EnemyKindName;
    if (k === 'bolt') {
      fx?.flash(worldPosition, hdr(CRIMSON, 2.4), 3.5, 0.35, 2.2);
      fx?.ring(worldPosition, hdr(CRIMSON, 2), 1.4, 0.45, 5);
    } else if (k === 'gen' || k === 'core' || k === 'heart') {
      fx?.ring(worldPosition, hdr(k === 'gen' ? SHIELD_ROSE : CRIMSON, 2.2), 4, 0.8, 6);
      fx?.flash(worldPosition, hdr(k === 'gen' ? SHIELD_AMBER : WHITE_HOT, 2), 6, 0.6, 2);
    } else if (k === 'turret' || k === 'pdgun') {
      fx?.flash(worldPosition, hdr(MOLTEN, 2.2), 4, 0.4, 1.8);
      fx?.burst(worldPosition, hdr(MOLTEN, 2.4), 6, 8, 0.4, 1.1, 0.14);
    } else {
      fx?.flash(worldPosition, hdr(MOLTEN, 2.4), 3, 0.3, 1.8);
      // Swarm craft visibly launch from the nearest enemy bay: a streak from the hangar mouth to where they appear.
      const bay = fleet?.nearestBay(worldPosition);
      if (bay && fx) {
        const distance = bay.distanceTo(worldPosition);
        fx.flash(bay, hdr(MOLTEN, 2.2), 14, 0.5, 1.8, 1.6, 0.07);
        fx.bolt(bay, worldPosition, hdr(MOLTEN, 2.0), Math.min(1.1, Math.max(0.45, distance / 480)), 34, 1.0);
      }
    }
  });

  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = records.get(enemyId);
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    if (record) {
      if (record.bracket) {
        record.bracket.removeFromParent();
        disposeBracket(record.bracket);
      }
      record.bracket = createBracket(color);
      record.bracketBorn = elapsedNow;
      record.lockCount = lockCount;
      scene?.add(record.bracket);
    }
    fx?.flash(worldPosition, hdr(color, 2.4), 2.6, 0.22, 1.8);
    fx?.ring(worldPosition, hdr(color, 2.2), 1.6, 0.3, 3);
    feel?.kickFov(0.35 + lockCount * 0.05, { decay: 8 });
    if (lockCount >= 6) {
      volleyFlash = 0.7;
      fx?.ring(worldPosition, hdr(WHITE_HOT, 2.6), 3, 0.5, 8);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = records.get(enemyId);
    if (record?.bracket) {
      record.bracket.removeFromParent();
      disposeBracket(record.bracket);
      record.bracket = null;
    }
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize, indexInVolley }) => {
    projectiles.claim(projectileId);
    fx?.flash(worldPosition, hdr(CYAN_HOT, 2.6), 1.1, 0.16, 1.6);
    fx?.ring(worldPosition, hdr(CYAN, 2), 0.7, 0.24, 4);
    feel?.kickFov(indexInVolley === 0 ? 0.5 + volleySize * 0.18 : 0.15, { decay: 7 });
    if (indexInVolley === 0) {
      feel?.shake(0.05 + volleySize * 0.025, { decay: 4 });
      if (volleySize >= 6) volleyFlash = 1;
    }
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId, { dispose: true });
    const record = records.get(enemyId);
    if (record) {
      record.flashUntil = elapsedNow + 0.14;
      if (!lethal) record.damaged = true;
    }
    fx?.flash(worldPosition, hdr(WHITE_HOT, 3), lethal ? 3 : 4.2, 0.2, 1.6);
    fx?.burst(worldPosition, hdr(CYAN_HOT, 2.6), lethal ? 5 : 9, 14, 0.4, 1.4, 0.13);
    if (!lethal && record) {
      if (record.kind === 'gen' || record.kind === 'heart' || record.kind === 'core') {
        fx?.ring(worldPosition, hdr(record.kind === 'gen' ? SHIELD_ROSE : CRIMSON, 2.4), 3, 0.5, 6);
        fleet?.hitShield(worldPosition);
        feel?.shake(0.16);
      } else {
        fx?.burst(worldPosition, hdr(MOLTEN, 2.6), 10, 12, 0.5, 1.2, 0.14);
      }
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    if (record) record.stageKick = elapsedNow;
    fx?.flash(worldPosition, hdr(WHITE_HOT, 3.6), 20, 0.7, 2.4);
    fx?.ring(worldPosition, hdr(CRIMSON, 2.6), 10, 0.9, 8);
    fx?.burst(worldPosition, hdr(MOLTEN, 3), 40, 34, 1.0, 3, 0.3);
    feel?.shake(0.7);
    flare = Math.max(flare, 0.3);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    const kind = record && record.kind !== 'letter' ? record.kind : null;
    if (kind) explode(kind, worldPosition);
    else fx?.burst(worldPosition, hdr(CYAN_HOT, 2.4), 18, 10, 0.6, 1.2, 0.14);
    records.delete(enemyId, { dispose: true });
    if (kind === 'gen') fleet?.hitShield(worldPosition);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    if (record && record.kind !== 'letter' && record.kind !== 'bolt') fx?.flash(worldPosition, hdr(MOLTEN, 1.2), 2, 0.25, 1.2);
    records.delete(enemyId, { dispose: true });
  });

  bus.on('reject', () => {
    beatEnergy = -0.6;
    feel?.shake(0.14, { decay: 5 });
  });

  bus.on('playerhit', () => {
    woundFlash = 1;
    feel?.shake(0.95, { decay: 2.2 });
    feel?.kickFov(-2.4, { decay: 3.5 });
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.5;
    if (!scene || !camera || !battle) return;
    const barPosition = runClock / BROADSIDE_TLLU_TIME.barSeconds;
    if (barPosition > BARS.flank && barPosition < BARS.eye - 0.4) battle.broadsideBurst('resolute', isDownbeat ? 9 : 4, camera.position, camera);
    if (barPosition >= BARS.eye - 0.4 && barPosition < BARS.eye + 0.2) battle.broadsideBurst('resolute', 5, camera.position, camera);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      fleet?.collapseShield();
      shieldBreakAt = elapsedNow;
      feel?.shake(0.9);
      flare = Math.max(flare, 0.35);
      calloutHandler?.('SHIELD DOWN — ESCORTS INBOUND', 2.4);
      const center = FLAGSHIP_CENTER;
      fx?.ring(center, hdr(SHIELD_ROSE, 2.4), 60, 1.2, 8);
    } else if (phase === 'exposed') {
      calloutHandler?.('THE TRENCH — DESTROY THE REACTOR', 2.4);
    } else if (phase === 'destroyed') {
      victoryAt = runClock;
      finaleBlasts = Array.from({ length: 22 }, (_, i) => ({ at: 0.08 + i * 0.17 + (i % 3) * 0.04, done: false }));
      fleet?.destroy(runClock);
      flare = 0.4;
      calloutHandler?.('FLAGSHIP DESTROYED', 3.6);
      onFinale();
    }
  });

  bus.on('runstart', () => {
    // The runner cleared its targets and shots without events; drop their stale visual records.
    records.clear({ dispose: true });
    projectiles.clear({ dispose: true });
    runClock = 0;
    victoryAt = -1;
    finaleBlasts = [];
    shieldBreakAt = -1;
    flare = 0;
    woundFlash = 0;
    volleyFlash = 0;
    skyVictoryUniform.value = 0;
    skyFlareUniform.value = 0;
    fleet?.reset();
    fx?.clear();
  });
}

const FLAGSHIP_CENTER = new Vector3(-250, 60, -3560);
const scratchVector = new Vector3();

// ---- per-frame update -------------------------------------------------------------------------------------

export type VisualFrame = {
  dt: number;
  elapsed: number;
  runTime: number;
  running: boolean;
  camera: PerspectiveCamera;
};

export function updateVisuals(frame: VisualFrame) {
  const { dt, elapsed, camera: cam } = frame;
  elapsedNow = elapsed;
  if (frame.running) runClock = frame.runTime;
  const barPosition = runClock / BROADSIDE_TLLU_TIME.barSeconds;

  beatEnergy += (0 - beatEnergy) * Math.min(1, dt * 7);
  skyBeatUniform.value = Math.max(0, beatEnergy);
  flare *= Math.exp(-dt * 3.8);
  woundFlash *= Math.exp(-dt * 3.2);
  volleyFlash *= Math.exp(-dt * 4.4);
  flareUniform.value = flare;
  hitUniform.value = woundFlash;
  volleyUniform.value = volleyFlash;
  hushUniform.value = victoryAt >= 0 ? 0 : smoothBand(barPosition, BARS.eye - 0.2, BARS.eye + 0.4, BARS.belly - 0.3, BARS.belly + 0.2);

  if (victoryAt >= 0) {
    const since = runClock - victoryAt;
    skyVictoryUniform.value = Math.min(1, since / 3.2);
    skyFlareUniform.value = flare * 0.8;
    // The flagship comes apart in a string of blasts along its length.
    for (const blast of finaleBlasts) {
      if (blast.done || since < blast.at) continue;
      blast.done = true;
      const ship = fleet?.flagship;
      if (!ship || !fx) continue;
      const local = ship.model.surface[Math.floor(Math.random() * ship.model.surface.length)];
      if (!local) continue;
      const world = ship.group.localToWorld(local.clone());
      const big = Math.random() < 0.4;
      fx.flash(world, hdr(WHITE_HOT, 1.8), big ? 26 : 14, 0.9, 2.6, 1.8, 0.045);
      fx.flash(world, hdr(MOLTEN, 1.5), big ? 50 : 26, 1.4, 2.2, 1.8, 0.05);
      fx.ring(world, hdr(MOLTEN, 2.6), big ? 40 : 18, 1.4, 9);
      fx.burst(world, hdr(MOLTEN, 3), big ? 30 : 16, 60, 1.6, 6, 0.6);
    }
  } else {
    skyVictoryUniform.value = 0;
    skyFlareUniform.value = 0;
  }

  if (warm && (warm.frames += 1) > 8) retireWarmUp();
  sky?.update(cam.position);
  fleet?.update(dt, elapsed, cam, Math.max(0, beatEnergy));
  const bars = fireAt(barPosition);
  const speed = frame.running ? Math.max(8, railSpeedAt(frame.runTime)) : 10;
  const burning = victoryAt >= 0 ? Math.min(1, (runClock - victoryAt) / 1.2) : 0;
  const fastCut = victoryAt >= 0;
  battle?.update({
    dt,
    elapsed,
    runTime: frame.runTime,
    running: frame.running,
    camera: cam,
    railSpeed: fastCut ? speed * 0.25 : speed,
    fireRate: victoryAt >= 0
      ? { friendly: 14 * Math.min(1, (runClock - victoryAt) / 1.5), enemy: 0.2 }
      : { friendly: bars[1], enemy: bars[2] },
    flakRate: victoryAt >= 0 ? 0 : bars[3],
    broadside: bars[4] > 0 && victoryAt < 0 ? { shipId: 'resolute', rate: bars[4] } : null,
    burning,
  });
  fx?.update(dt, cam);

  // Shield-break shrapnel after the collapse begins.
  if (shieldBreakAt >= 0 && elapsed - shieldBreakAt < 1.2 && fx && Math.random() < dt * 30) {
    const ship = fleet?.flagship;
    if (ship) {
      const local = ship.model.surface[Math.floor(Math.random() * ship.model.surface.length)];
      if (local) fx.burst(ship.group.localToWorld(local.clone()).add(scratchVector.set(-60, 0, 0)), hdr(SHIELD_ROSE, 2.6), 4, 30, 0.7, 3, 0.3);
    }
  }

  // Shots the runner dropped without a hit event (their target vanished) are retired here.
  for (const [id, shot] of [...projectiles.entries()]) if (!shot.parent) projectiles.delete(id, { dispose: true });

  // Player shots shrink as they pass the camera so a passing bolt never washes out the frame.
  for (const shot of projectiles.values()) {
    const distance = shot.position.distanceTo(cam.position);
    shot.scale.setScalar(Math.min(1.4, Math.max(0.22, distance * 0.075)));
  }

  // Records: intro scale, brackets, animated parts.
  for (const record of records.values()) {
    const mesh = record.mesh;
    const age = elapsed - record.born;
    const isMount = record.kind === 'turret' || record.kind === 'gen' || record.kind === 'core' || record.kind === 'heart';
    const introTime = isMount ? 0.55 : record.kind === 'letter' ? 0.001 : 0.24;
    const introRaw = Math.min(1, Math.max(0.001, age / introTime));
    const intro = isMount ? 1 - (1 - introRaw) ** 3 * (1 + Math.sin(introRaw * 9) * 0.06) : introRaw;
    const denied = mesh.userData.deniedUntil > elapsed;
    const deniedShake = denied ? 0.86 + Math.sin(elapsed * 40) * 0.1 : 1;
    if (record.kind === 'letter') {
      mesh.scale.setScalar(1.05 * Math.max(0.001, Math.min(1, 0.4 + age * 3)) * deniedShake);
      if (!denied && mesh.userData.locked !== true) paintLetter(mesh, 'idle');
      continue;
    }
    // Plasma shrinks as it reaches the cockpit so the impact reads as a flash and a jolt, not a white screen.
    const closeness = record.kind === 'bolt' ? Math.min(1, Math.max(0.09, mesh.position.distanceTo(cam.position) / 24)) : 1;
    mesh.scale.setScalar(Math.max(0.001, intro) * deniedShake * closeness);
    const parts = enemyParts(mesh);
    if (parts.trail) parts.trail.opacity = 0.5 * Math.min(1, mesh.position.distanceTo(cam.position) / 18);
    const locked = mesh.userData.locked === true;
    const flash = record.flashUntil > elapsed;
    const brighten = 1 + (locked ? 0.7 : 0) + (flash ? 1.6 : 0);
    parts.hullMaterial.color.setScalar(brighten);
    parts.solidMaterial.color.copy(SOLID_BASE).multiplyScalar(brighten);
    parts.glowMaterial.color.setScalar(1 + (locked ? 0.5 : 0) + (flash ? 1.0 : 0));
    for (const spinner of parts.spinners) {
      if (spinner.rate !== 0) spinner.object.rotateOnAxis(spinner.axis, spinner.rate * dt);
    }

    if (record.kind === 'gen') {
      const sealed = mesh.userData.sealed === true;
      const target = sealed ? 0 : 1;
      record.open += (target - record.open) * Math.min(1, dt * 5);
      if (!sealed && !record.opened) {
        record.opened = true;
        if (age > 0.7) {
          fx?.ring(mesh.position, hdr(SHIELD_ROSE, 2.6), 5, 0.6, 6);
          fx?.flash(mesh.position, hdr(SHIELD_AMBER, 2.8), 8, 0.4, 2);
        }
      }
      parts.petals?.forEach((petal, index) => { petal.rotation.x = 1.35 * record.open + Math.sin(elapsed * 3 + index) * 0.03 * record.open; });
      const pulse = 0.85 + 0.15 * Math.sin(elapsed * 7 + record.born);
      (parts.core!.material as MeshBasicMaterial).color.copy(hdr(SHIELD_AMBER, (0.25 + 1.6 * record.open) * pulse));
      (parts.halo!.material as MeshBasicMaterial).opacity = 0.15 + 0.4 * record.open;
      parts.core!.scale.setScalar(0.8 + 0.25 * record.open * pulse);
    } else if (record.kind === 'core') {
      const pulse = 0.8 + 0.25 * Math.sin(elapsed * 8 + record.born);
      (parts.core!.material as MeshBasicMaterial).color.copy(hdr(WHITE_HOT, (record.damaged ? 2.0 : 1.5) * pulse));
      (parts.halo!.material as MeshBasicMaterial).opacity = 0.25 + 0.2 * pulse + (record.damaged ? 0.12 : 0);
      parts.core!.scale.setScalar(1 + 0.08 * pulse);
    } else if (record.kind === 'heart') {
      const sealed = mesh.userData.sealed === true;
      const stageOpen = elapsed - record.stageKick;
      const pulse = 0.8 + 0.25 * Math.sin(elapsed * (sealed ? 3 : 9) + record.born);
      (parts.core!.material as MeshBasicMaterial).color.copy(hdr(WHITE_HOT, (sealed ? 0.8 : 1.7) * pulse));
      (parts.halo!.material as MeshBasicMaterial).opacity = sealed ? 0.14 : 0.36 + 0.16 * pulse;
      if (parts.plates) {
        // First stage: the armor plates blow off.
        const blown = record.stageKick > 0 && stageOpen >= 0;
        const spread = blown ? Math.min(1, stageOpen * 2.2) : 0;
        parts.plates.children.forEach((plate, index) => {
          const angle = (index / 8) * Math.PI * 2;
          const distance = 11.5 + spread * 30;
          plate.position.set(Math.cos(angle) * distance, spread * (index % 2 ? 8 : -8), Math.sin(angle) * distance);
          plate.scale.setScalar(Math.max(0.001, 1 - spread * 0.9));
        });
        parts.plates.visible = !(blown && spread >= 1);
      }
    } else if (record.kind === 'bomber' && parts.plates) {
      parts.plates.visible = !record.damaged;
    } else if (record.kind === 'bolt' && parts.halo) {
      (parts.halo.material as MeshBasicMaterial).opacity = 0.42 + 0.2 * Math.sin(elapsed * 22 + record.born);
    }

    if (record.bracket) {
      const bracket = record.bracket;
      const distance = mesh.position.distanceTo(cam.position);
      const since = elapsed - record.bracketBorn;
      const converge = 1 + Math.max(0, 1 - since / 0.22) * 1.2;
      const size = Math.min(15, Math.max(parts.baseRadius * 1.5, distance * 0.055), Math.max(2, distance * 0.5)) * converge;
      bracket.position.copy(mesh.position);
      bracket.quaternion.copy(cam.quaternion);
      bracket.rotateZ(elapsed * 1.6);
      bracket.scale.setScalar(size);
      (bracket.userData.material as MeshBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(elapsed * 18);
    }
  }
}

export function disposeVisuals() {
  retireWarmUp();
  records.clear({ dispose: true, pending: true });
  projectiles.clear({ dispose: true, pending: true });
  fx?.dispose();
  fleet?.dispose();
  sky?.dispose();
  battle?.dispose();
  root?.removeFromParent();
  if (scene) scene.fog = null;
  fx = null;
  fleet = null;
  sky = null;
  battle = null;
  root = null;
  scene = null;
  camera = null;
  feel = null;
  calloutHandler = null;
  victoryAt = -1;
  finaleBlasts = [];
  shieldBreakAt = -1;
  disposeEnemyCaches();
  disposeLetterGeometries();
}

export { BOSS_ANCHORS, CYAN, NEBULA_MAGENTA };
