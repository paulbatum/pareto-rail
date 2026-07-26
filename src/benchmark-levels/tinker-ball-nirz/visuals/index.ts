import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  TorusGeometry,
} from 'three';
import type { CatmullRomCurve3, Camera, Object3D, Scene } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdornmentSlot, createPendingVisualRecords, configureAdditiveMaterial } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { PIECES_PER_KILL, type TinkerEnemyKind } from '../gameplay';
import { createEnemyGroup, piecesForMesh } from './enemies';
import {
  burstFlecks,
  burstGlue,
  createEffects,
  resetEffects,
  spawnFaceRing,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import { createTinkerEnvironment, TABLE_Y, type TinkerEnvironment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { createPieceField, type PieceField } from './pieces';
import {
  BEAD,
  BUTTON,
  ERASER,
  GLUE_SHEEN,
  LAMP,
  LAMP_HOT,
  PAPER,
  PENCIL,
  STEEL,
  SUPPLY_COLORS,
  glow,
  hdr,
  matte,
} from './palette';

// Spine: the palette lives in `palette.ts`, but every decision about what a
// gameplay event looks like is made here. The through-line is the same in all
// of them — glue is thrown off black and dead, supplies come off bright and
// bounce, and anything the ball can still collect stays on the table.

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress: number;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  isLetter: boolean;
  lockRing: Group | null;
  lockedUntil: number;
  deniedUntil: number;
  damageUntil: number;
};

const LOCK_COLORS = [BEAD, PENCIL, BUTTON] as const;

let environment: TinkerEnvironment | null = null;
let pieces: PieceField | null = null;
let beatEnergy = 0;
let downbeatEnergy = 0;
let elapsedNow = 0;
let activeCamera: Camera | null = null;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` immediately after
// calling it, so a queue pairs the mesh with the id the events use.
const enemyRecords = createPendingVisualRecords<{ mesh: Group; kind: string; isLetter: boolean }, EnemyRecord>({
  createRecord: (pending) => ({
    mesh: pending.mesh,
    kind: pending.kind,
    isLetter: pending.isLetter,
    bornAt: null,
    lockRing: null,
    lockedUntil: -1,
    deniedUntil: -1,
    damageUntil: -1,
  }),
  disposeRecord: (record) => lockRings.detach(record),
});

const projectileRecords = createPendingVisualRecords<Object3D, Object3D>({ createRecord: (mesh) => mesh });

export function createEnvironment(scene: Scene, curve: CatmullRomCurve3) {
  environment = createTinkerEnvironment(scene, curve);
  createEffects(scene);
  pieces = createPieceField(scene, TABLE_Y);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const isLetter = kind === 'letter' || letter !== undefined;
  const mesh = isLetter ? createLetterMesh(letter ?? 'A') : createEnemyGroup(kind);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue({ mesh, kind, isLetter });
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

/** The glue holds: a pink flash, a sticky ring, and a spray of adhesive off the target. */
export function setEnemyDenied(mesh: Object3D) {
  const record = recordForMesh(mesh);
  if (record) record.deniedUntil = elapsedNow + 0.6;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group, true);
  if (!activeCamera) return;
  spawnFaceRing(mesh.position, hdr(ERASER, 1.2), 3.4, 0.4, activeCamera);
  burstGlue(mesh.position, 5, 3.4);
}

function recordForMesh(mesh: Object3D) {
  for (const record of enemyRecords.values()) if (record.mesh === mesh) return record;
  return undefined;
}

/** The shot is a straight pin with a hot bead head; it reads as "pinning the glue down". */
export function createProjectileMesh() {
  const group = new Group();
  const shaft = new Mesh(new PlaneGeometry(0.09, 1.5), matte(STEEL, 0.7));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.6;
  group.add(shaft);
  const head = new Mesh(new CircleGeometry(0.22, 12), glow(LAMP_HOT, 0.9));
  head.position.z = 0.2;
  group.add(head);
  const spark = new Mesh(new CircleGeometry(0.45, 12), glow(PENCIL, 0.4));
  spark.position.z = 0.16;
  group.add(spark);
  projectileRecords.enqueue(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];
  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base, active });
    return mesh;
  };

  // Two bent wire loops, exactly the paperclip the ball is shooting.
  const outer = addPart(new Mesh(new TorusGeometry(0.95, 0.045, 6, 40), new MeshBasicMaterial()), hdr(STEEL, 1.0), hdr(BUTTON, 1.8));
  const inner = addPart(new Mesh(new TorusGeometry(0.66, 0.035, 6, 32), new MeshBasicMaterial()), hdr(BEAD, 0.9), hdr(PENCIL, 1.7));
  inner.scale.set(1, 0.78, 1);

  const spinner = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const tick = addPart(new Mesh(new PlaneGeometry(0.26, 0.05), new MeshBasicMaterial()), hdr(PENCIL, 1.2), hdr(LAMP_HOT, 2));
    tick.position.set(Math.cos(angle) * 1.16, Math.sin(angle) * 1.16, 0);
    tick.rotation.z = angle;
    spinner.add(tick);
  }

  const dot = addPart(new Mesh(new CircleGeometry(0.075, 14), new MeshBasicMaterial()), hdr(PAPER, 1.4), hdr(LAMP_HOT, 2.6));

  group.add(outer, inner, spinner, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.07 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) part.material.color.copy(active ? part.active : part.base);
}

function makeLockRing(color: Color) {
  const group = new Group();
  const loop = new Mesh(new TorusGeometry(0.86, 0.05, 6, 5), configureAdditiveMaterial(new MeshBasicMaterial({ color: hdr(color, 1.8) }), { side: DoubleSide }));
  const thread = new Mesh(new RingGeometry(0.64, 0.68, 26), configureAdditiveMaterial(new MeshBasicMaterial({ color: hdr(color.clone().lerp(LAMP_HOT, 0.5), 1.3) }), { side: DoubleSide }));
  group.add(loop, thread);
  return group;
}

function supplyColors(mesh: Object3D) {
  const specs = piecesForMesh(mesh);
  return specs.length ? specs.map((spec) => spec.color) : SUPPLY_COLORS;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || !activeCamera) return;
    // A ring of glue lifting off the table as the thing assembles itself.
    spawnRing(worldPosition, hdr(GLUE_SHEEN, 1.1), 3.4 * record.mesh.scale.x + 1.4, 0.5);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const color = colorForLockCount(lockCount, LOCK_COLORS);
    const record = enemyRecords.get(enemyId);
    if (record) {
      record.lockedUntil = elapsedNow + 0.2;
      if (!record.lockRing) lockRings.attach(record, makeLockRing(color), scene);
    }
    if (activeCamera) spawnFaceRing(worldPosition, hdr(color, 1.5), 2.2, 0.26, activeCamera);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    if (activeCamera) spawnGlint(worldPosition, hdr(LAMP_HOT, 1.3), 0.9, 0.14, activeCamera);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) return;
    if (record) record.damageUntil = elapsedNow + 0.32;
    burstGlue(worldPosition, 7, 4.5);
    if (activeCamera) spawnGlint(worldPosition, hdr(GLUE_SHEEN, 1.4), 1.2, 0.16, activeCamera);
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.damageUntil = elapsedNow + 0.6;
    burstGlue(worldPosition, 14, 6.5);
    if (activeCamera) spawnFaceRing(worldPosition, hdr(GLUE_SHEEN, 1.4), 6, 0.5, activeCamera);
  });

  // The whole level in one event: the glue dies, the supplies it stole come
  // apart, and they land on the table for the ball to sweep up.
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const scale = Math.max(0.4, record.mesh.scale.x);
    const colors = supplyColors(record.mesh);
    burstGlue(worldPosition, 9, 5 * scale);
    burstFlecks(worldPosition, colors, 6, 5.5 * scale, { size: scale, life: 0.6 });
    if (activeCamera) {
      spawnFaceRing(worldPosition, hdr(LAMP, 1.2), 4 * scale, 0.42, activeCamera);
      spawnGlint(worldPosition, hdr(LAMP_HOT, 1.1), 1.4 * scale, 0.16, activeCamera);
      pieces?.scatter(
        worldPosition,
        piecesForMesh(record.mesh),
        activeCamera,
        PIECES_PER_KILL[record.kind as TinkerEnemyKind] ?? 4,
        6 * scale,
      );
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstGlue(worldPosition, 3, 2.2);
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.deniedUntil = elapsedNow + 0.6;
      if (!activeCamera) continue;
      spawnFaceRing(shield.worldPosition, hdr(ERASER, 1.4), 7, 0.5, activeCamera);
      spawnFaceRing(shield.worldPosition, hdr(GLUE_SHEEN, 1.0), 4, 0.34, activeCamera);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.42;
    if (isDownbeat) downbeatEnergy = 1;
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.7;
  });

  bus.on('runstart', () => {
    resetEffects();
    pieces?.reset();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  activeCamera = ctx.camera;
  beatEnergy = Math.max(0, beatEnergy - dt * 4);
  downbeatEnergy = Math.max(0, downbeatEnergy - dt * 2.6);

  ctx.feel.setFovOffset(beatEnergy * 0.9);

  environment?.applyAtmosphere(ctx.runProgress);
  environment?.update(ctx.runProgress, dt, ctx.camera.position, beatEnergy);
  pieces?.update(dt, ctx.camera, downbeatEnergy);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Gameplay owns the mesh scale; the spawn pop multiplies into it so the
    // creature assembles out of nothing without fighting the wave's sizing.
    const pop = easeOutBack(Math.min(1, age / 0.36));
    if (record.isLetter) record.mesh.scale.setScalar(pop);
    else record.mesh.scale.multiplyScalar(pop);

    const denialLeft = record.deniedUntil - elapsedNow;
    if (record.isLetter) {
      setLetterDenied(record.mesh, denialLeft > 0);
    }

    const halo = record.mesh.userData.haloMaterial as MeshBasicMaterial | undefined;
    if (halo) {
      const locked = record.mesh.userData.locked === true;
      const denied = Math.max(0, (record.deniedUntil - elapsedNow) / 0.6);
      const damaged = Math.max(0, (record.damageUntil - elapsedNow) / 0.32);
      const lockGlow = locked ? 0.34 + Math.sin(elapsedNow * 13) * 0.09 : 0;
      halo.opacity = Math.min(0.9, lockGlow + denied * 0.55 + damaged * 0.5);
      halo.color.copy(denied > 0 ? ERASER : damaged > 0 ? GLUE_SHEEN : LAMP);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 1.9;
      const fit = ((record.mesh.userData.lockFit as number | undefined) ?? 1.2) * Math.max(0.4, record.mesh.scale.x);
      record.lockRing.scale.setScalar(fit * (1.35 + Math.sin(elapsedNow * 10) * 0.06));
    }
  }

  for (const [projectileId, mesh] of projectileRecords.entries()) {
    if (!mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    mesh.rotateZ(dt * 9);
  }

  const spinner = findReticleSpinner(ctx.scene);
  if (spinner) {
    const active = spinner.parent?.userData.active === true;
    spinner.rotation.z += dt * (active ? 3.4 : 0.9);
  }

  updateEffects(dt, ctx.camera);
}

/** Pieces the ball has picked up, for the end-of-run card. */
export function stuckPieceCount() {
  return pieces?.stuckCount() ?? 0;
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
