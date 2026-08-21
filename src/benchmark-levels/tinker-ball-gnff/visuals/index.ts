import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
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
import { createTinkerRail } from '../gameplay';
import {
  ballActForProgress,
  ballCollect,
  createBall,
  resetBall,
  setBallAct,
  updateBall,
} from './ball';
import {
  burstScatter,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import {
  createBeetleMesh,
  createGlobMesh,
  createSnapperMesh,
  createSpillCoreMesh,
  createSpillNodeMesh,
  createSpillOrbitMesh,
  createWalkerMesh,
} from './enemies';
import { beatUniform, createEnvironmentInternal, type TinkerEnvironment } from './environment';
import { setLetterLocked } from './letters';
import { createLetterMesh as createLetterBlockMesh } from './letters';
import { BRASS, BUTTON_RED, CREAM, GLUE_SHEEN, hdr, LAMP, LOCK_COLORS } from './palette';
import { TINKER_RUN_DURATION } from '../timing';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress?: number;
  running: boolean;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

let environment: TinkerEnvironment | null = null;
let spotlessPatch: Mesh | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let spotlessReveal = 0;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  createBall(scene);
  environment.root.traverse((child) => {
    if (child.userData.isSpotlessPatch) spotlessPatch = child as Mesh;
  });
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  if (kind === 'letter' || letter) return createLetterBlockMesh(letter ?? 'A');
  switch (kind) {
    case 'beetle':
      return createBeetleMesh();
    case 'snapper':
      return createSnapperMesh();
    case 'walker':
      return createWalkerMesh();
    case 'glob':
      return createGlobMesh();
    case 'spill-orbit':
      return createSpillOrbitMesh(Math.floor(Math.random() * 6));
    case 'spill-node':
      return createSpillNodeMesh();
    case 'spill-core':
      return createSpillCoreMesh();
    default:
      return createBeetleMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  const core = mesh.userData.core as Group | undefined;
  const glint = core?.userData.coreGlint as Mesh | undefined;
  if (glint) {
    const material = glint.material as MeshBasicMaterial;
    material.color.copy(locked ? hdr(BUTTON_RED, 3.4) : hdr(LAMP, 2.2));
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnRing(mesh.position, hdr(BUTTON_RED, 1.0), 2.8, 0.32);
}

export function createProjectileMesh() {
  const group = new Group();
  // A brass tack: a small head with a point, stretched along flight.
  const core = new Mesh(
    new OctahedronGeometry(0.3, 0),
    new MeshBasicMaterial({ color: hdr(CREAM, 2.6) }),
  );
  core.scale.set(0.45, 0.45, 2.0);
  const shell = new Mesh(
    new OctahedronGeometry(0.46, 0),
    createAdditiveBasicMaterial({ color: hdr(BRASS, 0.9), opacity: 0.5 }),
  );
  shell.scale.set(0.55, 0.55, 1.8);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group, trailColor: BRASS.clone().multiplyScalar(0.9) });
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];

  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base, active });
  };

  // A tinker's loupe: brass ring, four corner tabs, cream dot.
  const outer = new Mesh(new RingGeometry(0.6, 0.645, 48), new MeshBasicMaterial());
  addPart(outer, hdr(BRASS, 1.15), hdr(BUTTON_RED, 1.8));

  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.33, 0.36, 3), new MeshBasicMaterial());
  addPart(inner, hdr(BRASS, 0.85), hdr(CREAM, 1.6));
  spinner.add(inner);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.18, 0.035), new MeshBasicMaterial());
    addPart(tick, hdr(CREAM, 1.3), hdr(BUTTON_RED, 2));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 20), new MeshBasicMaterial());
  addPart(dot, hdr(CREAM, 2), hdr(CREAM, 3));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) {
    part.material.color.copy(active ? part.active : part.base);
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    spawnRing(worldPosition, hdr(LAMP, 0.9), 3.2, 0.5);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_COLORS);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.4, 0.3);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(CREAM, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) {
      const accent = (record?.mesh.userData.accent as Color | undefined) ?? BRASS;
      burstSparks(worldPosition, accent.clone().multiplyScalar(0.3), 2, 7);
    } else {
      burstSparks(worldPosition, hdr(GLUE_SHEEN, 1.2), 6, 12);
      if (record?.mesh.userData.isSpillCore || record?.mesh.userData.isNode) {
        record.mesh.userData.damageFlashUntil = elapsedNow + 0.42;
        spawnRing(worldPosition, hdr(BUTTON_RED, 1.35), 4.2, 0.34);
      }
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) record.mesh.userData.damageLevel = (record.mesh.userData.damageLevel ?? 0) + 1;
    // A shell breaks: rescued pieces shower the route.
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? BRASS;
    burstScatter(worldPosition, undefined, accent);
    spawnRing(worldPosition, hdr(BRASS, 1.5), 5.8, 0.5);
    spawnGlint(worldPosition, hdr(CREAM, 2.2), 1.8, 0.22);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as Array<{ direction: Vector3; color: Color; size: number }> | undefined;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? BRASS;
    // The body breaks into its stolen pieces: they scatter, settle, and the
    // ball gathers a piece as it rolls through.
    burstScatter(worldPosition, specs, accent);
    spawnRing(worldPosition, hdr(accent, 0.9), 5.5, 0.5);
    spawnRing(worldPosition, hdr(LAMP, 0.55), 3.2, 0.34);
    spawnGlint(worldPosition, hdr(CREAM, 0.65), 0.45, 0.12);
    ballCollect(worldPosition, accent);
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, GLUE_SHEEN.clone().multiplyScalar(0.8), 4, 3);
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.shieldFlashUntil = elapsedNow + 0.65;
      spawnRing(shield.worldPosition, hdr(BUTTON_RED, 1.5), 4.8, 0.45);
      spawnGlint(shield.worldPosition, hdr(CREAM, 1.7), 1.6, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
  });

  // Taking a hit punches the FOV hard (the HUD supplies the red flash).
  bus.on('playerhit', () => {
    beatEnergy = 1.6;
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') spotlessReveal = elapsedNow + 0.8;
  });

  bus.on('runstart', () => {
    resetEffects();
    resetBall();
    spotlessReveal = 0;
    if (spotlessPatch) (spotlessPatch.material as MeshBasicMaterial).opacity = 0;
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  beatUniform.value = beatEnergy;

  ctx.feel.setFovOffset(beatEnergy * 1.0);

  const runProgress = ctx.runProgress ?? 0;
  environment?.props.update(runProgress, dt);

  // Ball scale follows the acts; the update keeps it rolling and gathering.
  setBallAct(ballActForProgress(runProgress));
  updateBall(dt, {
    curve: createTinkerRailCached(),
    runProgress,
    running: ctx.running,
    elapsed: ctx.elapsed,
    duration: TINKER_RUN_DURATION,
  });

  // The spotless patch fades in for the coast home.
  if (spotlessPatch) {
    const target = spotlessReveal > 0 && elapsedNow > spotlessReveal ? 0.85 : 0;
    const material = spotlessPatch.material as MeshBasicMaterial;
    material.opacity += (target - material.opacity) * Math.min(1, dt * 2);
  }

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    const userData = record.mesh.userData;

    // Wet glue reads best close: dim the hot glint at range so far targets
    // stay shapes, not blobs.
    const core = userData.core as Group | undefined;
    const glint = core?.userData.coreGlint as Mesh | undefined;
    if (glint && userData.locked !== true) {
      const distance = record.mesh.position.distanceTo(ctx.camera.position);
      const closeness = smootherstep(1 - clamp01((distance - 14) / (48 - 14)));
      (glint.material as MeshBasicMaterial).color.copy(hdr(LAMP, 0.7 + 1.6 * closeness));
    }

    // Snapper wings flap; glob blobs wobble; spill nodes pulse their cracks.
    const halo = userData.halo as Mesh | undefined;
    if (halo) {
      halo.rotation.z += dt * 2.2;
      halo.scale.setScalar(1 + Math.sin(elapsedNow * 10) * 0.12);
    }
    const crackRing = userData.crackRing as Mesh | undefined;
    if (crackRing) {
      const flash = (userData.shieldFlashUntil as number | undefined) ?? -1;
      const hot = flash > elapsedNow ? 1 : 0;
      (crackRing.material as MeshBasicMaterial).color.copy(hdr(BUTTON_RED, 1.2 + hot * 1.6 + Math.sin(elapsedNow * 6) * 0.3));
    }
    const cracks = userData.cracks as Mesh[] | undefined;
    if (cracks) {
      const damageLevel = (userData.damageLevel as number | undefined) ?? 0;
      const flash = (userData.damageFlashUntil as number | undefined) ?? -1;
      const hot = flash > elapsedNow ? 1 : 0;
      for (const [index, crack] of cracks.entries()) {
        const lit = index < damageLevel ? 1 : 0;
        (crack.material as MeshBasicMaterial).color.copy(
          hdr(BUTTON_RED, 0.7 + lit * 1.2 + hot * 1.4 + Math.sin(elapsedNow * 5 + index) * 0.2),
        );
      }
    }

    const deniedUntil = userData.deniedUntil as number | undefined;
    const shieldFlashUntil = userData.shieldFlashUntil as number | undefined;
    const flashUntil = Math.max(deniedUntil ?? -Infinity, shieldFlashUntil ?? -Infinity);
    if (flashUntil > elapsedNow) {
      const flash = Math.max(0, Math.min(1, (flashUntil - elapsedNow) / 0.65));
      const letterMaterials = userData.letterMaterials as
        | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
        | undefined;
      if (letterMaterials) {
        letterMaterials.edgeMaterial.color.copy(hdr(BUTTON_RED, 1.6 + flash * 1.2));
        letterMaterials.fillMaterial.color.copy(BUTTON_RED.clone().multiplyScalar(0.16 + flash * 0.16));
      }
      const coreGlint = (userData.core as Group | undefined)?.userData.coreGlint as Mesh | undefined;
      if (coreGlint) {
        (coreGlint.material as MeshBasicMaterial).color.copy(hdr(BUTTON_RED, 2.2 + flash * 2));
      }
    } else if (userData.isLetter && userData.locked !== true) {
      setLetterLocked(record.mesh, false);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.6;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 5 : 1.4);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 3.2 : 0.8);
  }

  updateEffects(dt, ctx.camera);
}

let railCurve: import('three').CatmullRomCurve3 | null = null;
function createTinkerRailCached() {
  railCurve ??= createTinkerRail();
  return railCurve;
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
    new RingGeometry(0.86, 0.92, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.68, 0.71, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(CREAM, 0.55), 1.4), side: DoubleSide }),
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
