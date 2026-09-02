import { Color, DoubleSide, Group, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Quaternion, RingGeometry, Scene, Vector3 } from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { createAdditiveBasicMaterial, createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import type { CubeFight, CubeVisualEvent } from '../cube';
import type { OrbitPose } from '../orbit';
import { createCubeVisual, type CubeVisual } from './cube-mesh';
import { burstLooseCubies, burstSparks, createEffects, dropTrail, randomUnit, resetEffects, spawnGlint, spawnRing, updateEffects } from './effects';
import {
  applySwarmColor,
  createBoltMesh,
  createCoreMesh,
  createHubMesh,
  createOctaMesh,
  createPrismMesh,
  createProjectileGroup,
  createReticleGroup,
  createStickerFrameMesh,
  createTetraMesh,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import { createLetterMesh, flashLetterDenied, setLetterLocked } from './letters';
import { DENY, GRAPHITE, HOT_WHITE, MACHINE_GREY, MACHINE_WHITE, hdr, solveColor } from './palette';
import { flashUniform, shutterUniform } from './post-fx';

// Spine: palette lives in palette.ts, choreography lives here. Every gameplay
// event gets a visual answer in the level's language — hot white for the
// player's light, loose cubies for anything that breaks, square rings for the
// sticker silhouette — and the cube's own state machine feeds the big moments.

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  running: boolean;
  pose: OrbitPose;
  onEvent?: (event: CubeVisualEvent) => void;
};

type EnemyRecord = { mesh: Group; bornAt: number | null; lockRing: Group | null; kind: string };
type ProjectileRecord = { mesh: Object3D };

let environment: Environment | null = null;
let cubeVisual: CubeVisual | null = null;
let fight: CubeFight | null = null;
let feelRef: CameraFeelRig | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let flash = 0;
let shutter = 0;
let pendingShake = 0;
let pendingFovKick = 0;
let coreHeat = 0;
let confettiUntil = -1;
const confettiOrigin = new Vector3();
const lockedStickerIds = new Set<number>();
const scratch = new Vector3();
const scratchQuaternion = new Quaternion();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, kind: String(mesh.userData.kind ?? '') }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({ createRecord: (record) => record });

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  if (kind !== 'mechanism') mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'mechanism': {
      const anchor = new Group();
      anchor.visible = false;
      return anchor;
    }
    case 'sticker':
      return createStickerFrameMesh();
    case 'hub':
      return createHubMesh();
    case 'core': {
      const unsolved = fight ? fight.fallen.map((value, face) => (value ? -1 : face)).filter((face) => face >= 0) : [];
      return createCoreMesh(unsolved);
    }
    case 'tetra':
      return createTetraMesh();
    case 'prism':
      return createPrismMesh();
    case 'bolt':
      return createBoltMesh();
    default:
      return createOctaMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  const data = mesh.userData;
  if (data.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  if (data.isSticker) {
    (data.frameMaterial as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, locked ? 2.4 : 0.9));
    (data.diamond as Mesh).visible = locked;
    return;
  }
  if (data.isHub) {
    (data.ringMaterial as MeshStandardMaterial).emissive.copy(locked ? hdr(HOT_WHITE, 0.55) : new Color(0, 0, 0));
    (data.spindleMaterial as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, locked ? 2.6 : 1.6));
    return;
  }
  if (data.isCore) {
    (data.cageMaterial as LineBasicMaterial).color.copy(hdr(MACHINE_WHITE, locked ? 2.4 : 1.2));
    return;
  }
  if (data.isSwarm) {
    const accent = data.accent as Color;
    (data.edgeMaterial as LineBasicMaterial).color.copy(locked ? hdr(HOT_WHITE, 2) : GRAPHITE);
    (data.fillMaterial as MeshStandardMaterial).emissive.copy(accent).multiplyScalar(locked ? 0.5 : 0.08);
    (data.coreMaterial as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, locked ? 3 : 1.8));
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnRing(mesh.position, hdr(DENY, 1.1), 3.2, 0.3);
  shutter = Math.max(shutter, 0.7);
}

export function createProjectileMesh() {
  const group = createProjectileGroup();
  projectileRecords.enqueue({ mesh: group });
  return group;
}

export function createReticle() {
  return createReticleGroup();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) part.material.color.copy(active ? part.active : part.base);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cubeFight: CubeFight) {
  fight = cubeFight;
  cubeVisual = createCubeVisual(cubeFight, scene);

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    const mesh = record.mesh;
    if (mesh.userData.isSwarm) {
      applySwarmColor(mesh, Number(mesh.userData.color ?? 0));
      spawnRing(worldPosition, hdr(mesh.userData.accent as Color, 0.7), kind === 'bolt' ? 1.6 : 2.6, 0.32);
      return;
    }
    if (kind === 'sticker') spawnGlint(worldPosition, hdr(HOT_WHITE, 1.2), 1.4, 0.16);
    if (kind === 'hub') {
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.3), 6, 0.45);
      spawnGlint(worldPosition, hdr(HOT_WHITE, 2), 3, 0.22);
    }
    if (kind === 'core') {
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.0), 9, 0.6);
      flash = Math.max(flash, 0.3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      lockRings.attach(record, makeLockRing(fit), scene);
    }
    if (record?.kind === 'sticker') lockedStickerIds.add(enemyId);
    spawnRing(worldPosition, hdr(HOT_WHITE, 1.3), 2.2, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
    lockedStickerIds.delete(enemyId);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(HOT_WHITE, 1.1), 0.5, 0.1);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, hitStageIndex, hitStageCount }) => {
    projectileRecords.delete(projectileId);
    if (lethal) return;
    const record = enemyRecords.get(enemyId);
    burstSparks(worldPosition, hdr(HOT_WHITE, 0.9), 6, 10);
    if (!record) return;
    if (record.kind === 'hub') {
      record.mesh.userData.hitFlashUntil = elapsedNow + 0.35;
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.4), 4.2, 0.32);
      pendingShake += 0.12;
    }
    if (record.kind === 'core') {
      record.mesh.userData.hitFlashUntil = elapsedNow + 0.3;
      coreHeat = Math.min(1, coreHeat + 0.09);
      spawnRing(worldPosition, hdr(HOT_WHITE, 1.3), 7, 0.36);
      pendingShake += 0.18;
      pendingFovKick += 0.8;
      // Armour stage: every hit tears one unsolved face's plates off the cage.
      if (hitStageCount === 3 && hitStageIndex === 0) shedArmor(record.mesh);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const mesh = record.mesh;
    switch (record.kind) {
      case 'sticker': {
        const color = solveColor(Number(mesh.userData.wrongColor ?? 0));
        mesh.getWorldQuaternion(scratchQuaternion);
        const normal = new Vector3(0, 0, 1).applyQuaternion(scratchQuaternion);
        burstLooseCubies(worldPosition, normal, 9, { size: 1.15, speed: 7, spread: 3.5, life: 0.9, drag: 1.6, colors: [color], flat: true });
        spawnRing(worldPosition, hdr(HOT_WHITE, 1.1), 5.5, 0.32, scratchQuaternion);
        spawnGlint(worldPosition, hdr(HOT_WHITE, 1.4), 1.6, 0.16);
        break;
      }
      case 'hub': {
        burstLooseCubies(worldPosition, randomUnit(Math.random), 22, { size: 0.5, speed: 11, spread: 6, life: 1.1, drag: 1.2, colors: [MACHINE_WHITE, MACHINE_GREY, GRAPHITE] });
        spawnRing(worldPosition, hdr(HOT_WHITE, 1.5), 12, 0.5);
        spawnGlint(worldPosition, hdr(HOT_WHITE, 2.4), 4.5, 0.28);
        flash = Math.max(flash, 0.28);
        pendingShake += 0.35;
        break;
      }
      case 'core': {
        flash = Math.max(flash, 1);
        pendingShake += 1;
        pendingFovKick += 9;
        confettiUntil = elapsedNow + 1.5;
        confettiOrigin.copy(worldPosition);
        spawnRing(worldPosition, hdr(HOT_WHITE, 1.4), 22, 0.9);
        spawnGlint(worldPosition, hdr(HOT_WHITE, 3), 9, 0.4);
        burstLooseCubies(worldPosition, new Vector3(0, 1, 0), 140, { size: 0.42, speed: 12, spread: 20, life: 2.4, drag: 0.9, gravity: 1.5 });
        break;
      }
      case 'bolt': {
        const accent = (mesh.userData.accent as Color | undefined) ?? HOT_WHITE;
        burstLooseCubies(worldPosition, randomUnit(Math.random), 5, { size: 0.24, speed: 8, spread: 4, life: 0.6, colors: [accent] });
        burstSparks(worldPosition, hdr(accent, 0.7), 8, 8);
        break;
      }
      default: {
        const accent = (mesh.userData.accent as Color | undefined) ?? HOT_WHITE;
        const size = (mesh.userData.debrisSize as number | undefined) ?? 0.35;
        burstLooseCubies(worldPosition, randomUnit(Math.random), 11, { size, speed: 9, spread: 4.5, life: 0.95, drag: 1.5, colors: [accent] });
        burstSparks(worldPosition, hdr(HOT_WHITE, 0.6), 5, 7);
        spawnRing(worldPosition, hdr(accent, 0.9), 4.6, 0.36);
        spawnGlint(worldPosition, hdr(HOT_WHITE, 0.8), 0.7, 0.12);
      }
    }
    lockedStickerIds.delete(enemyId);
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      if (record.kind === 'sticker') burstSparks(worldPosition, MACHINE_GREY.clone().multiplyScalar(0.5), 4, 3);
      else if (record.mesh.userData.isSwarm) burstSparks(worldPosition, ((record.mesh.userData.accent as Color | undefined) ?? MACHINE_GREY).clone().multiplyScalar(0.45), 4, 3);
      enemyRecords.delete(enemyId, { dispose: true });
    }
    lockedStickerIds.delete(enemyId);
  });

  bus.on('reject', () => {
    shutter = Math.max(shutter, 0.8);
    pendingShake += 0.25;
  });

  bus.on('beat', ({ isDownbeat, beatNumber }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
    if (fight && !fight.running && isDownbeat && beatNumber % 8 === 0) cubeVisual?.startIdleSnap(elapsedNow);
  });

  bus.on('playerhit', () => {
    pendingShake += 0.7;
    pendingFovKick -= 3;
    shutter = Math.max(shutter, 1);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    lockedStickerIds.clear();
    flash = 0;
    shutter = 0;
    coreHeat = 0;
    confettiUntil = -1;
  });
}

function shedArmor(coreMesh: Group) {
  const armor = coreMesh.userData.armor as Group | undefined;
  const group = armor?.children[armor.children.length - 1] as Group | undefined;
  if (!group) return;
  const face = Number(group.userData.face ?? 0);
  group.updateWorldMatrix(true, false);
  for (const plate of [...group.children]) {
    plate.getWorldPosition(scratch);
    burstLooseCubies(scratch, scratch.clone().sub(coreMesh.position).normalize(), 1, { size: 1.3, speed: 9, spread: 3, life: 1.1, colors: [solveColor(face)], flat: true });
  }
  group.removeFromParent();
  spawnRing(coreMesh.position, hdr(solveColor(face), 0.8), 7, 0.4);
}

function handleFightEvent(event: CubeVisualEvent, ctx: VisualContext) {
  if (!cubeVisual || !fight) return;
  switch (event.type) {
    case 'snap':
      cubeVisual.onSnapLand(event.move, event.face, event.kind);
      if (event.kind === 'solve') pendingShake += 0.06;
      break;
    case 'lit':
      fight.stickerWorldPose(event.cubie, event.face, 0.7, scratch);
      spawnGlint(scratch, hdr(HOT_WHITE, 1.6), 2.2, 0.18);
      break;
    case 'fall':
      cubeVisual.onFaceFall(event.face);
      flash = Math.max(flash, 0.32);
      pendingFovKick -= 2.5;
      pendingShake += 0.45;
      break;
    case 'hub':
      if (event.phase === 'kill') cubeVisual.onHubGone(event.face);
      break;
    case 'shell':
      cubeVisual.onShellBlow();
      flash = Math.max(flash, 0.7);
      pendingFovKick += 6;
      pendingShake += 0.9;
      break;
    case 'swing':
      shutter = Math.max(shutter, 0.9);
      pendingFovKick += 2.5;
      break;
    case 'core':
      if (event.phase === 'cage') {
        const record = [...enemyRecords.values()].find((candidate) => candidate.kind === 'core');
        if (record) breakCage(record.mesh);
      }
      break;
    default:
      break;
  }
  ctx.onEvent?.(event);
}

function breakCage(coreMesh: Group) {
  const cage = coreMesh.userData.cage as Group | undefined;
  if (!cage || !cage.visible) return;
  cage.visible = false;
  burstLooseCubies(coreMesh.position, randomUnit(Math.random), 40, { size: 0.42, speed: 12, spread: 9, life: 1.2, drag: 1, colors: [MACHINE_WHITE, MACHINE_GREY] });
  spawnRing(coreMesh.position, hdr(HOT_WHITE, 1.3), 10, 0.5);
  spawnGlint(coreMesh.position, hdr(HOT_WHITE, 2.6), 5, 0.3);
  flash = Math.max(flash, 0.45);
  pendingShake += 0.6;
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  feelRef = ctx.feel;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  flash *= Math.exp(-dt * 7.5);
  shutter = Math.max(0, shutter - dt * 3.6);
  flashUniform.value = flash;
  shutterUniform.value = shutter;

  ctx.feel.setFovOffset(beatEnergy * 0.55 + ctx.pose.swing * 3.4);
  if (pendingFovKick !== 0) {
    ctx.feel.kickFov(pendingFovKick);
    pendingFovKick = 0;
  }
  if (pendingShake > 0) {
    ctx.feel.shake(pendingShake);
    pendingShake = 0;
  }

  environment?.update(dt, ctx.elapsed, ctx.camera.position);

  if (fight) for (const event of fight.drainEvents()) handleFightEvent(event, ctx);

  const lockedCubies = new Set<number>();
  if (fight) {
    for (const id of lockedStickerIds) {
      const cubie = fight.stickerCubieOf(id);
      if (cubie !== undefined) lockedCubies.add(cubie);
    }
  }
  cubeVisual?.update(dt, ctx.elapsed, ctx.running, lockedCubies);

  for (const [enemyId, record] of enemyRecords.entries()) {
    const mesh = record.mesh;
    if (!mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.kind === 'mechanism') continue;
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.38)));
    const data = mesh.userData;

    if (data.isSticker) {
      const lit = data.lit === true;
      const locked = data.locked === true;
      const pulse = 0.5 + 0.5 * Math.sin(elapsedNow * 8 + enemyId);
      (data.frameMaterial as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, locked ? 2.4 : lit ? 0.85 + pulse * 0.5 : 0.16));
      (data.bracketMaterial as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, lit ? 1.3 + pulse * 0.6 : 0.2));
      const brackets = data.brackets as Group;
      brackets.rotation.z = lit ? Math.sin(elapsedNow * 2.4) * 0.08 : 0;
      const diamond = data.diamond as Mesh;
      if (diamond.visible) diamond.rotation.z += dt * 3.5;
    } else if (data.isHub) {
      (data.gear as Group).rotation.z += dt * 2.3;
      const hitFlash = Math.max(0, ((data.hitFlashUntil as number | undefined) ?? -Infinity) - elapsedNow) / 0.35;
      if (hitFlash > 0) (data.ringMaterial as MeshStandardMaterial).emissive.copy(hdr(HOT_WHITE, 0.3 + hitFlash * 0.9));
      else if (data.locked !== true) (data.ringMaterial as MeshStandardMaterial).emissive.set(0, 0, 0);
      mesh.rotateZ(dt * 0.4);
    } else if (data.isCore) {
      const exposed = data.exposed === true;
      const hitFlash = Math.max(0, ((data.hitFlashUntil as number | undefined) ?? -Infinity) - elapsedNow) / 0.3;
      const heart = data.heartMaterial as MeshStandardMaterial;
      const pulse = 0.5 + 0.5 * Math.sin(elapsedNow * (exposed ? 14 : 5));
      heart.emissive.copy(hdr(HOT_WHITE, 0.45 + coreHeat * 0.9 + pulse * (exposed ? 0.5 : 0.12) + hitFlash * 1.2));
      heart.color.copy(MACHINE_WHITE).lerp(HOT_WHITE, coreHeat);
      mesh.rotation.y += dt * (exposed ? 3.4 : 0.9) * (1 + coreHeat);
      mesh.rotation.x = Math.sin(elapsedNow * 0.7) * 0.3;
      const cage = data.cage as Group;
      cage.rotation.z -= dt * 0.7;
      cage.rotation.x += dt * 0.35;
      const armor = data.armor as Group;
      armor.rotation.y += dt * 0.5;
    } else if (data.isSwarm) {
      const accent = data.accent as Color;
      if (data.isBolt) {
        const distance = mesh.position.distanceTo(ctx.camera.position);
        const danger = 1 - Math.min(1, Math.max(0, (distance - 3) / 26));
        (data.coreMaterial as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, 1.4 + danger * 2));
        const halo = data.halo as Mesh;
        halo.quaternion.copy(ctx.camera.quaternion);
        mesh.getWorldQuaternion(scratchQuaternion).invert();
        halo.quaternion.premultiply(scratchQuaternion);
        (halo.material as MeshBasicMaterial).color.copy(hdr(accent, 0.6 + danger * 1.2));
        halo.scale.setScalar(1 + danger * 0.5 + Math.sin(elapsedNow * 12) * 0.08);
      }
      const telegraph = (data.telegraph as number | undefined) ?? 0;
      if (data.muzzleMaterial) (data.muzzleMaterial as MeshBasicMaterial).color.copy(hdr(HOT_WHITE, 0.4 + telegraph * 2.6));
      if (data.belt) (data.belt as Mesh).rotation.z += dt * 2.6;
    }

    const deniedUntil = (data.deniedUntil as number | undefined) ?? -Infinity;
    if (deniedUntil > elapsedNow) {
      const amount = Math.min(1, (deniedUntil - elapsedNow) / 0.45);
      if (data.isLetter) flashLetterDenied(mesh, DENY, amount);
      else if (data.edgeMaterial) (data.edgeMaterial as LineBasicMaterial).color.copy(hdr(DENY, 1 + amount));
      else if (data.frameMaterial) (data.frameMaterial as MeshBasicMaterial).color.copy(hdr(DENY, 1 + amount));
      mesh.position.x += Math.sin(elapsedNow * 60) * 0.06 * amount;
    } else if (data.isLetter && data.locked !== true) {
      setLetterLocked(mesh, false);
    }

    if (record.lockRing) {
      mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      record.lockRing.scale.setScalar(pulse * (record.lockRing.userData.fit as number));
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, hdr(HOT_WHITE, 0.9));
  }

  if (confettiUntil > elapsedNow) {
    const density = Math.max(0.15, (confettiUntil - elapsedNow) / 1.5);
    burstLooseCubies(confettiOrigin, randomUnit(Math.random), Math.round(14 * density), { size: 0.34, speed: 13, spread: 15, life: 1.9, drag: 1.1, gravity: 2.2 });
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 4.5 : 1.2);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 2.8 : 0.6);
  }

  updateEffects(dt, ctx.camera);
  void feelRef;
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle' && child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(fit: number): Group {
  const group = new Group();
  const outer = new Mesh(new RingGeometry(0.9, 0.96, 4), createAdditiveBasicMaterial({ color: hdr(HOT_WHITE, 1.8), side: DoubleSide }));
  outer.rotation.z = Math.PI / 4;
  const inner = new Mesh(new RingGeometry(0.66, 0.69, 32), createAdditiveBasicMaterial({ color: hdr(MACHINE_WHITE, 1.3), side: DoubleSide }));
  group.add(outer, inner);
  group.userData.fit = 1.9 * fit;
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
