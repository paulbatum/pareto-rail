import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import {
  createBoltMesh,
  createCenserMesh,
  createGargoyleMesh,
  createHeartMesh,
  createMothMesh,
  createPetalMesh,
  createWispMesh,
  setEnemyJewel,
} from './enemies';
import { createVespersEnvironment, type VespersEnvironment } from './environment';
import {
  burstSparks,
  createEffects,
  puffAsh,
  resetEffects,
  spawnGlint,
  spawnRing,
  streamLight,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDeniedTint, setLetterLocked } from './letters';
import { BLOOD, CANDLE, GOLD, hdr, PALE, ROSEWHITE, THIEF_EDGE } from './palette';
import { darkPulse, goldFlash } from './post-fx';

// Spine: palette lives in palette.ts, construction in the leaf files; this
// module owns the choreography — which event produces which light, and the
// one rule everything serves: light that leaves a thief goes HOME. Kills
// stream their colour back to the window it was stolen from, and that window
// stays lit for the rest of the run.

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress?: number;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
  windowIndex: number;
};

type ProjectileRecord = {
  mesh: Object3D;
};

const LIGHT_BEARERS = new Set(['wisp', 'moth', 'gargoyle', 'censer']);

let environment: VespersEnvironment | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let petalCounter = 0;
const pendingIgnitions: Array<{ at: number; run: () => void }> = [];

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously
// right after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, windowIndex: -1 }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createVespersEnvironment(scene);
  createEffects(scene);
  petalCounter = 0;
  pendingIgnitions.length = 0;
  return environment.root;
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
      return createLetterMesh(letter ?? '?');
    case 'wisp':
      return createWispMesh();
    case 'moth':
      return createMothMesh();
    case 'gargoyle':
      return createGargoyleMesh();
    case 'censer':
      return createCenserMesh();
    case 'bolt':
      return createBoltMesh();
    case 'vigil-petal': {
      const mesh = createPetalMesh(petalCounter);
      petalCounter += 1;
      return mesh;
    }
    case 'vigil-heart':
      return createHeartMesh();
    default:
      return createWispMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, hdr(BLOOD, 0.9), 2.6, 0.32);
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.3, 0), new MeshBasicMaterial({ color: hdr(PALE, 2.6) }));
  core.scale.set(0.42, 0.42, 2.0);
  const shell = new Mesh(
    new OctahedronGeometry(0.48, 0),
    createAdditiveBasicMaterial({ color: hdr(GOLD, 0.8), opacity: 0.55 }),
  );
  shell.scale.set(0.55, 0.55, 1.9);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group });
  return group;
}

// A candle-sight: a gold ring with four flame ticks and an ember at the
// centre, drawn to the size of the engine lock radius.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];
  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base, active });
  };

  const outer = new Mesh(new RingGeometry(0.6, 0.643, 48), new MeshBasicMaterial());
  addPart(outer, hdr(CANDLE, 1.0), hdr(GOLD, 1.7));

  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.32, 0.35, 4), new MeshBasicMaterial());
  addPart(inner, hdr(CANDLE, 0.75), hdr(ROSEWHITE, 1.5));
  spinner.add(inner);

  const ticks = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.05, 0.2), new MeshBasicMaterial());
    addPart(tick, hdr(CANDLE, 1.2), hdr(GOLD, 2));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tick.position.set(Math.cos(angle) * 0.77, Math.sin(angle) * 0.77, 0);
    tick.rotation.z = angle + Math.PI / 2;
    ticks.add(tick);
  }

  const ember = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(ember, hdr(PALE, 1.9), hdr(PALE, 3));

  group.add(outer, spinner, ticks, ember);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.ticks = ticks;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) part.material.color.copy(active ? part.active : part.base);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  void scene;

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || !environment) return;
    // A thief arrives already carrying a window's light: claim the nearest
    // dark window and burn with exactly its colour.
    if (LIGHT_BEARERS.has(kind)) {
      record.windowIndex = environment.assignWindowNear(worldPosition);
      if (record.windowIndex >= 0) setEnemyJewel(record.mesh, environment.windowJewel(record.windowIndex));
    }
    spawnRing(worldPosition, THIEF_EDGE.clone().multiplyScalar(1.6), 2.6, 0.4);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [CANDLE, GOLD, ROSEWHITE]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing && environment) {
      lockRings.attach(record, makeLockRing(lockColor), environment.root);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.2, 0.28);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(PALE, 1.1), 0.45, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) {
      burstSparks(worldPosition, hdr(PALE, 0.5), 3, 6);
      return;
    }
    // Cracked, not killed: the vessel shows its light.
    if (record) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.4;
      record.mesh.userData.cracked = true;
    }
    burstSparks(worldPosition, hdr(PALE, 0.9), 5, 9);
    spawnRing(worldPosition, hdr(ROSEWHITE, 1.1), 3.4, 0.3);
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.mesh.userData.kind === 'vigil-heart') {
      record.mesh.userData.shellCracking = true;
      goldFlash.value = Math.min(1, (goldFlash.value as number) + 0.35);
      spawnRing(worldPosition, hdr(ROSEWHITE, 1.6), 7, 0.5);
      spawnGlint(worldPosition, hdr(ROSEWHITE, 2.2), 2, 0.24);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || !environment) return;
    const kind = record.mesh.userData.kind as string;
    const jewel = (record.mesh.userData.jewel as Color | undefined) ?? GOLD;

    if (kind === 'vigil-heart') {
      // The biggest single event in the level: the rose ignites, every rank
      // opens, and the light sweeps back down the nave.
      environment.igniteRose(elapsedNow);
      goldFlash.value = 1.25;
      spawnRing(worldPosition, hdr(ROSEWHITE, 2.2), 16, 0.8);
      spawnRing(worldPosition, hdr(GOLD, 1.6), 10, 0.6);
      spawnGlint(worldPosition, hdr(ROSEWHITE, 2.6), 4, 0.4);
      burstSparks(worldPosition, hdr(GOLD, 1.1), 26, 14);
    } else if (kind === 'vigil-petal') {
      const petalIndex = (record.mesh.userData.petalIndex as number) % 6;
      const target = environment.roseSectorTarget(petalIndex);
      const travel = streamLight(worldPosition, target, jewel, 14);
      const env = environment;
      pendingIgnitions.push({ at: elapsedNow + travel, run: () => env.ignitePetalSector(petalIndex) });
      spawnRing(worldPosition, hdr(jewel, 1.2), 4.6, 0.45);
      burstSparks(worldPosition, hdr(jewel, 0.8), 8, 9);
    } else if (record.windowIndex >= 0) {
      // The signature moment: the stolen colour goes home.
      const windowIndex = record.windowIndex;
      const target = environment.windowTarget(windowIndex);
      const travel = streamLight(worldPosition, target, jewel, 12);
      const env = environment;
      pendingIgnitions.push({
        at: elapsedNow + travel,
        run: () => {
          env.igniteWindow(windowIndex);
          spawnGlint(target, hdr(jewel, 1.6), 1.6, 0.22);
          goldFlash.value = Math.min(0.5, (goldFlash.value as number) + 0.08);
        },
      });
      spawnRing(worldPosition, hdr(jewel, 1.1), 4.2, 0.42);
      burstSparks(worldPosition, hdr(jewel, 0.7), 8, 8);
    } else {
      burstSparks(worldPosition, hdr(CANDLE, 0.8), 6, 8);
      spawnRing(worldPosition, hdr(CANDLE, 0.8), 2.6, 0.3);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    // The thief escapes INTO the dark — its window stays dead all run.
    puffAsh(worldPosition, 7);
    spawnRing(worldPosition, THIEF_EDGE.clone().multiplyScalar(1.2), 3, 0.4);
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.shieldFlashUntil = elapsedNow + 0.6;
      spawnRing(shield.worldPosition, hdr(GOLD, 1.3), 4.2, 0.4);
    }
  });

  bus.on('reject', () => {
    darkPulse.value = Math.max(darkPulse.value as number, 0.5);
  });

  bus.on('playerhit', () => {
    darkPulse.value = 0.85;
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.35);
  });

  bus.on('runstart', () => {
    resetEffects();
    environment?.reset();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    pendingIgnitions.length = 0;
    petalCounter = 0;
    goldFlash.value = 0;
    darkPulse.value = 0;
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 2.2);
  // The organ breathes rather than thumps: a slow half-degree FOV swell.
  ctx.feel.setFovOffset(beatEnergy * 0.55);

  goldFlash.value = Math.max(0, (goldFlash.value as number) - dt * 1.5);
  darkPulse.value = Math.max(0, (darkPulse.value as number) - dt * 2.4);

  for (let i = pendingIgnitions.length - 1; i >= 0; i -= 1) {
    if (pendingIgnitions[i].at <= elapsedNow) {
      pendingIgnitions[i].run();
      pendingIgnitions.splice(i, 1);
    }
  }

  environment?.update(dt, elapsedNow);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    const userData = record.mesh.userData;

    // Distance falloff for the hot cores: full colour only as they close in,
    // so far thieves are faint embers rather than bloomed blobs.
    const coreMaterial = userData.coreMaterial as MeshBasicMaterial | undefined;
    const glowMaterial = userData.glowMaterial as MeshBasicMaterial | undefined;
    if (coreMaterial && glowMaterial && userData.coreBase && userData.glowBase) {
      const distance = record.mesh.position.distanceTo(ctx.camera.position);
      const closeness = smootherstep(1 - clamp01((distance - 12) / (52 - 12)));
      const hot = 0.3 + 0.7 * closeness;
      const danger = userData.isBolt === true ? smootherstep(1 - clamp01((distance - 3) / (26 - 3))) : 0;
      const coreColor = (userData.coreBase as Color).clone().lerp(hdr(BLOOD, 2.6), danger);
      const glowColor = (userData.glowBase as Color).clone().lerp(hdr(BLOOD, 0.9), danger);
      coreMaterial.color.copy(coreColor).multiplyScalar(hot);
      glowMaterial.color.copy(glowColor).multiplyScalar(hot);

      const flashUntil = Math.max((userData.damageFlashUntil as number | undefined) ?? -Infinity, (userData.shieldFlashUntil as number | undefined) ?? -Infinity);
      if (flashUntil > elapsedNow) {
        const flash = clamp01((flashUntil - elapsedNow) / 0.5);
        coreMaterial.color.lerp(hdr(ROSEWHITE, 2.4), flash * 0.7);
        glowMaterial.color.lerp(hdr(ROSEWHITE, 1.2), flash * 0.5);
      }
      const deniedUntil = userData.deniedUntil as number | undefined;
      if (!userData.isLetter && deniedUntil !== undefined && deniedUntil > elapsedNow) {
        const flicker = Math.sin(elapsedNow * 40) > 0 ? 1 : 0.25;
        coreMaterial.color.copy(hdr(BLOOD, 1.6 * flicker));
      }
    }

    // Letter deny flicker keeps the stained-glass language.
    if (userData.isLetter) {
      const deniedUntil = userData.deniedUntil as number | undefined;
      if (deniedUntil !== undefined && deniedUntil > elapsedNow) {
        setLetterDeniedTint(record.mesh, clamp01((deniedUntil - elapsedNow) / 0.5));
      } else if (userData.locked !== true) {
        setLetterLocked(record.mesh, false);
      }
    }

    // Kind-specific idle motion, all visual-only.
    const wings = userData.wings as Group[] | undefined;
    if (wings) {
      const flap = 0.42 + Math.sin(elapsedNow * 9 + enemyId * 1.7) * 0.5;
      wings[0].rotation.y = flap;
      wings[1].rotation.y = -flap;
    }
    const tatters = userData.tatters as Group | undefined;
    if (tatters) tatters.rotation.z = Math.sin(elapsedNow * 3.2 + enemyId) * 0.25;
    if (userData.cracked === true && glowMaterial) {
      glowMaterial.color.multiplyScalar(1.25 + Math.sin(elapsedNow * 14) * 0.25);
    }

    // The heart's shell cracks away once its first stage breaks.
    const shell = userData.shell as Group | undefined;
    if (shell && shell.visible) {
      shell.rotation.z += dt * (userData.exposed === true ? 0.7 : 0.25);
      if (userData.shellCracking === true) {
        const next = shell.scale.x - dt * 1.9;
        if (next <= 0.02) shell.visible = false;
        else shell.scale.setScalar(next);
      }
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = (userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.8 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    burstSparks(record.mesh.position, hdr(GOLD, 0.5), 1, 0.9);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.2 : 1.1);
    const ticks = reticleSpinner.parent?.userData.ticks as Group | undefined;
    if (ticks) ticks.rotation.z -= dt * (active ? 2.6 : 0.6);
  }

  updateEffects(dt, ctx.camera);
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.84, 0.9, 5),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.66, 0.69, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ROSEWHITE, 0.5), 1.3), side: DoubleSide }),
  );
  group.add(ring, innerRing);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(t: number): number {
  return t * t * (3 - 2 * t);
}
