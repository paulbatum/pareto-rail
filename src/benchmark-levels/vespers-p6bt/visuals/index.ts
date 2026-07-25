import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  Object3D,
  Quaternion,
  RingGeometry,
  Scene,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdditiveBasicMaterial, createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createCathedral, type Cathedral } from './cathedral';
import {
  chips,
  createEffects,
  cross,
  ember,
  halo,
  resetEffects,
  returnLight,
  shatter,
  updateEffects,
  type Splinter,
} from './effects';
import {
  applyEnemyGlow,
  createVespersEnemy,
  setEnemyAccent,
  setVespersEnemyDenied,
  setVespersEnemyLocked,
} from './enemies';
import { createLetterMesh, setLetterState } from './letters';
import { BLOOD, BONE, GLASS, GOLD, LOCK_GRADIENT, hdr } from './palette';
import { ignitionUniform, warmthUniform } from './post-fx';
import { createRoseWindow, type RoseWindow } from './rose-window';
import { createVespersProjectile, createVespersReticle, setVespersReticleActive } from './sight';

// Event choreography for the whole level. Every decision about what a moment
// looks like lives here; the leaf files only know how to build meshes.
//
// The through-line is the glass. A target spawning pulls a thread of light out
// of the nearest window and that window goes dark; killing it sends the thread
// home, and that window — with its twin across the nave — burns for the rest
// of the run. Letting one past costs the player that pane permanently.

export type VespersVisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
  /** Which pane of the nave this one stripped, or -1 if it belongs to the rose. */
  windowIndex: number;
  /** Which light of the rose it is holding, or -1 for anything in the nave. */
  rosePetal: number;
  accent: Color;
};

let cathedral: Cathedral | null = null;
let rose: RoseWindow | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let ignition = 0;
let ignitionTarget = 0;
let petalsSeen = 0;

const faceCamera = new Quaternion();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but `spawn` fires synchronously right after it,
// so pairing a queue with the spawn event is what links mesh to enemy id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, windowIndex: -1, rosePetal: -1, accent: BONE.clone() }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    disposeMaterialsOnly(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<Object3D, Object3D>({ createRecord: (mesh) => mesh });

export function createEnvironment(scene: Scene) {
  cathedral = createCathedral(scene);
  rose = createRoseWindow();
  scene.add(rose.root);
  createEffects(scene);
  return cathedral.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  if (kind === 'letter' || letter !== undefined) return createLetterMesh(letter ?? 'A');
  const mesh = createVespersEnemy(kind);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  if (mesh.userData.isLetter === true) {
    mesh.userData.locked = locked;
    setLetterState(mesh as Group, locked ? 'locked' : 'idle');
    return;
  }
  setVespersEnemyLocked(mesh, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  if (mesh.userData.isLetter === true) setLetterState(mesh as Group, 'denied');
  else setVespersEnemyDenied(mesh, elapsedNow + 0.5);
  halo(mesh.position, hdr(BLOOD, 1.5), 3.4, 0.34);
}

export function createProjectileMesh() {
  const mesh = createVespersProjectile();
  projectileRecords.enqueue(mesh);
  return mesh;
}

export const createReticle = createVespersReticle;
export const setReticleActive = setVespersReticleActive;

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    if (kind === 'letter') return;
    const record = enemyRecords.claim(enemyId);
    if (!record || !cathedral || !rose) return;
    if (kind === 'rose-heart') {
      record.accent.copy(GOLD);
      setEnemyAccent(record.mesh, record.accent);
      halo(worldPosition, hdr(GOLD, 1.2), 9, 0.8);
      return;
    }
    if (kind === 'rose-petal') {
      // The rose's own lights, pulled forward into the nave on a thread.
      record.rosePetal = petalsSeen % 6;
      petalsSeen += 1;
      record.accent.copy(GLASS[record.rosePetal % GLASS.length]);
      setEnemyAccent(record.mesh, record.accent);
      returnLight(rose.lightPosition(record.rosePetal * 2), worldPosition, hdr(record.accent, 0.8), 0.6);
      halo(worldPosition, hdr(record.accent, 1.1), 4.4, 0.5);
      return;
    }
    // Whatever it is, it came off the nearest window, and that window is now
    // dark. The thread running out to it is the theft made visible.
    record.windowIndex = cathedral.nearestWindow(worldPosition);
    record.accent.copy(cathedral.colourAt(record.windowIndex));
    cathedral.strip(record.windowIndex);
    setEnemyAccent(record.mesh, record.accent);
    returnLight(cathedral.positionAt(record.windowIndex), worldPosition, hdr(record.accent, 0.6), 0.5);
    halo(worldPosition, hdr(record.accent, 0.9), 3.2, 0.42);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const colour = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(colour), scene);
    halo(worldPosition, hdr(colour, 1.5), 2.6, 0.26);
    if (lockCount >= 6) cross(worldPosition, hdr(GOLD, 2.2), 2.6, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    cross(worldPosition, hdr(BONE, 1.4), 1.1, 0.16);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    if (lethal) return;
    chips(worldPosition, hdr(BONE, 1.1), 8, 11);
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
    halo(worldPosition, hdr(BONE, 1.2), 3.6, 0.3);
  });

  bus.on('stage', ({ worldPosition }) => {
    halo(worldPosition, hdr(GOLD, 1.8), 7.5, 0.55);
    cross(worldPosition, hdr(GOLD, 2.4), 3.4, 0.3);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    shatter(worldPosition, record.mesh.userData.splinters as Splinter[] | undefined, hdr(record.accent, 1.1));
    halo(worldPosition, hdr(record.accent, 1.4), 5.6, 0.45);
    cross(worldPosition, hdr(BONE, 1.7), 2.2, 0.22);
    if (rose && record.rosePetal >= 0) {
      // A light the rose was holding, going back into the window itself.
      rose.litPetal(record.rosePetal);
      returnLight(worldPosition, rose.lightPosition(record.rosePetal * 2), hdr(record.accent, 1.8), 0.6);
    } else if (cathedral && record.windowIndex >= 0) {
      const mirror = cathedral.mirrorOf(record.windowIndex);
      returnLight(worldPosition, cathedral.positionAt(record.windowIndex), hdr(record.accent, 1.6), 0.55);
      returnLight(worldPosition, cathedral.positionAt(mirror), hdr(record.accent, 1.1), 0.7);
      cathedral.light(record.windowIndex);
      cathedral.light(mirror);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    // The pane it took goes with it: a miss is a window the player never gets.
    if (record && cathedral && record.windowIndex >= 0) cathedral.strip(record.windowIndex);
    chips(worldPosition, hdr(BLOOD, 0.5), 6, 4);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.deniedUntil = elapsedNow + 0.5;
      halo(shield.worldPosition, hdr(GOLD, 1.6), 5.2, 0.42);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') igniteRose();
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.4);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.8;
  });

  bus.on('runstart', () => {
    resetEffects();
    cathedral?.reset();
    rose?.reset();
    ignition = 0;
    ignitionTarget = 0;
    petalsSeen = 0;
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
  });
}

function igniteRose() {
  rose?.ignite();
  cathedral?.lightAll();
  ignitionTarget = 1;
}

export function updateVisuals(dt: number, ctx: VespersVisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.4);
  ctx.feel.setFovOffset(beatEnergy * 0.9);

  // Ignition blooms hard, then settles back into a cathedral that stays lit.
  ignition += (ignitionTarget - ignition) * Math.min(1, dt * (ignitionTarget > ignition ? 6 : 0.8));
  if (ignitionTarget > 0.5 && ignition > 0.9) ignitionTarget = 0.02;
  ignitionUniform.value = ignition * 0.3;
  warmthUniform.value = cathedral?.litFraction() ?? 0;

  cathedral?.update(dt, ctx.elapsed, ctx.camera.position);
  rose?.update(dt, ctx.elapsed);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const distance = record.mesh.position.distanceTo(ctx.camera.position);

    // Bloom haloes are screen-space, so distance shapes a target at both ends:
    // far off, a chest fits inside its own glow and reads as a blob; right on
    // top of the camera it fills the frame with one flat colour. A target being
    // overtaken shrinks out of the way instead of smearing across the shot.
    const closeness = smoothstep(clamp01(1 - (distance - 16) / 46));
    const near = smoothstep(clamp01((distance - 1.2) / 9));
    const passing = smoothstep(clamp01((distance - 1.5) / 4.5));
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, (elapsedNow - record.bornAt) / 0.42)) * passing);
    const userData = record.mesh.userData;
    const denied = (userData.deniedUntil as number | undefined) ?? -Infinity;
    const damaged = (userData.damageFlashUntil as number | undefined) ?? -Infinity;
    if (denied > elapsedNow) applyEnemyGlow(record.mesh, (1.2 + (denied - elapsedNow) * 2) * near, false, BLOOD);
    else if (damaged > elapsedNow) applyEnemyGlow(record.mesh, (1.4 + (damaged - elapsedNow) * 3) * near, false, BONE);
    else applyEnemyGlow(record.mesh, (0.32 + 0.68 * closeness) * near, userData.locked === true);

    const billboards = userData.billboard as Object3D[] | undefined;
    if (billboards) {
      record.mesh.getWorldQuaternion(faceCamera).invert().multiply(ctx.camera.quaternion);
      for (const billboard of billboards) billboard.quaternion.copy(faceCamera);
    }
    for (const rank of (userData.ranks as Group[] | undefined) ?? []) {
      rank.rotation.z += dt * (rank.userData.spinRate as number);
    }
    const spokes = userData.spokes as Object3D | undefined;
    if (spokes) spokes.rotation.z += dt * 0.55;

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 1.6;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      record.lockRing.scale.setScalar(pulse * 1.75 * ((userData.lockRingScale as number | undefined) ?? 1));
    }
  }

  for (const [projectileId, mesh] of projectileRecords.entries()) {
    if (!mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    ember(mesh.position, hdr(GOLD, 0.7));
  }

  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const active = reticle.userData.active === true;
    const lobes = reticle.userData.lobes as Group | undefined;
    const cusps = reticle.userData.cusps as Group | undefined;
    if (lobes) lobes.rotation.z += dt * (active ? 1.9 : 0.5);
    if (cusps) cusps.rotation.z -= dt * (active ? 3.1 : 0.7);
  }

  updateEffects(dt, ctx.camera);
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle') return child;
  }
  return null;
}

/** A lock mark: a halo with a cusped inner ring, in the same language as the sight. */
function makeLockRing(colour: Color): Group {
  const group = new Group();
  group.add(new Mesh(
    new RingGeometry(0.92, 0.98, 40),
    createAdditiveBasicMaterial({ color: hdr(colour, 1.9), side: DoubleSide }),
  ));
  group.add(new Mesh(
    new RingGeometry(0.66, 0.71, 4),
    createAdditiveBasicMaterial({ color: hdr(colour.clone().lerp(BONE, 0.5), 1.5), side: DoubleSide }),
  ));
  group.userData.raildIgnoreOcclusion = true;
  return group;
}

/** Enemy geometry is shared and cached; only the per-instance materials go. */
function disposeMaterialsOnly(root: Object3D) {
  root.traverse((child) => {
    const material = (child as { material?: { dispose(): void } | Array<{ dispose(): void }> }).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
  });
}

function easeOutBack(t: number) {
  const c1 = 1.62;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
