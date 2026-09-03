import {
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera, CatmullRomCurve3 } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  configureAdditiveMaterial,
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { actAt, createTinkerRail, speedFactorAt, TABLE_Y } from '../gameplay';
import { emitSignal } from '../signals';
import { spillState } from '../spill';
import { createBall, type Ball } from './ball';
import {
  animateCreature,
  breakShell,
  createBeetleMesh,
  createCoreMesh,
  createGlobMesh,
  createSnapperMesh,
  createStriderMesh,
  disposeCreature,
  tintCreature,
  wornParts,
  type CreaturePart,
  type CreatureUserData,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import { burstDroplets, burstSparkles, createEffects, dropTrail, puff, resetEffects, spawnGlint, spawnRing, updateEffects } from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { CHALK, DENY, GOLD, LAMP_WARM, LOCK_GRADIENT, MINT, SILVER, hdr } from './palette';
import { createPieceSystem, type PieceSpawn, type PieceSystem } from './pieces';
import { flashUniform, gooUniform } from './post-fx';

// Visual spine: palette use and event choreography. Construction lives in the
// leaf files (supplies, enemies, letters, environment, pieces, ball, effects).

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  runProgress: number;
  feel: CameraFeelRig;
};

export type CameraEffectsContext = {
  camera: Camera;
  runTime: number;
  runProgress: number;
  running: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
  kind: string;
};

type ProjectileRecord = { mesh: Object3D };

const CAMERA_PITCH = 0.2; // radians down toward the table
const TINKER_SHAKE: CameraFeelShakeOptions = {
  decay: 2.8,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.6,
  frequency: 9,
  smoothing: 20,
};

let environment: Environment | null = null;
let pieces: PieceSystem | null = null;
let ball: Ball | null = null;
let curve: CatmullRomCurve3 | null = null;
let beatEnergy = 0;
let surge = 0;
let elapsedNow = 0;
let runTimeNow = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let gooTarget = 0;
let debugDebris = false;

/** Dev-only: 'debris' scatters a copy of every creature's parts on spawn so the piece system can be inspected without kills. */
export function setVisualDebug(value?: string) {
  debugDebris = value === 'debris';
}

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, kind: String(mesh.userData.kind ?? '') }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    if (record.mesh.userData.isAnchor) return;
    if (record.mesh.userData.isLetter) {
      record.mesh.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as { dispose(): void }).dispose();
        }
      });
    } else {
      disposeCreature(record.mesh);
    }
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  curve = createTinkerRail();
  const rail = curve;
  pieces = createPieceSystem(scene, rail, {
    onStick(type, position, count) {
      emitSignal('stick', { type, count });
      burstSparkles(position, hdr(MINT, 0.9), 3, 3, 2);
    },
    onLand(position, scale) {
      puff(position, 0.7 + scale * 0.5);
    },
  });
  environment = createEnvironmentInternal(scene, {
    onSuck(type, tint, from, center, scale) {
      pieces?.suck(type, tint, from, center, scale);
    },
  });
  createEffects(scene);
  ball = createBall(scene, rail);
  return environment.root;
}

export function disposeVisuals() {
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
  pieces?.dispose();
  pieces = null;
  ball?.dispose();
  ball = null;
  environment?.dispose();
  environment = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'beetle':
      return createBeetleMesh();
    case 'strider': {
      const act = actAt(runTimeNow);
      return createStriderMesh(act === 'melon' || act === 'spill' || act === 'clean');
    }
    case 'snapper':
      return createSnapperMesh();
    case 'glob':
      return createGlobMesh();
    case 'spill-core':
      return createCoreMesh(Number(mesh_core_index_from_spill()));
    case 'spill': {
      const anchor = new Group();
      anchor.userData = { kind: 'spill', isAnchor: true };
      return anchor;
    }
    default:
      return createBeetleMesh();
  }
}

// Cores spawn in index order 0, 1, 2 at the start of the fight; count them.
let coreBuilds = 0;
function mesh_core_index_from_spill() {
  const index = coreBuilds % 3;
  coreBuilds += 1;
  return index;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  (mesh.userData as CreatureUserData).locked = locked;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  if (mesh.userData.isLetter) {
    setLetterDenied(mesh as Group, true);
    spawnRing(mesh.position, hdr(DENY, 1.1), 2.4, 0.3);
    return;
  }
  spawnRing(mesh.position, hdr(DENY, 1.1), 2.2 * Math.max(1, mesh.scale.x), 0.3);
}

// The player's shot: a bright pin with a mint head, flying point-first.
export function createProjectileMesh() {
  const group = new Group();
  const needle = new Mesh(new CylinderGeometry(0.045, 0.02, 1.7, 6), new MeshBasicMaterial({ color: hdr(SILVER, 1.5) }));
  needle.rotation.x = Math.PI / 2;
  needle.position.z = 0.2;
  const head = new Mesh(new SphereGeometry(0.17, 12, 8), new MeshBasicMaterial({ color: hdr(MINT, 2.6) }));
  head.position.z = -0.7;
  const glow = new Mesh(new SphereGeometry(0.34, 10, 8), createAdditiveBasicMaterial({ color: hdr(MINT, 0.9), opacity: 0.5 }));
  glow.position.z = -0.7;
  group.add(needle, head, glow);
  projectileRecords.enqueue({ mesh: group });
  return group;
}

// ---- reticle: a stitched mint ring, beaded with each lock ---------------------

export function createReticle() {
  const group = new Group();
  const parts: MeshBasicMaterial[] = [];
  const spinner = new Group();
  const dashGeometry = new PlaneGeometry(0.19, 0.045);
  for (let i = 0; i < 12; i += 1) {
    const dash = new Mesh(dashGeometry, new MeshBasicMaterial());
    const material = configureAdditiveMaterial(dash.material as MeshBasicMaterial, { color: hdr(MINT, 1.1), side: DoubleSide });
    const angle = (i / 12) * Math.PI * 2;
    dash.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    dash.rotation.z = angle + Math.PI / 2;
    spinner.add(dash);
    parts.push(material);
  }
  const needle = new Mesh(new PlaneGeometry(0.42, 0.04), new MeshBasicMaterial());
  parts.push(configureAdditiveMaterial(needle.material as MeshBasicMaterial, { color: hdr(CHALK, 1.4), side: DoubleSide }));
  needle.position.set(0, 0.98, 0);
  needle.rotation.z = Math.PI / 2;
  const dot = new Mesh(new CircleGeometry(0.05, 16), new MeshBasicMaterial());
  parts.push(configureAdditiveMaterial(dot.material as MeshBasicMaterial, { color: hdr(CHALK, 1.8), side: DoubleSide }));

  const beads: Mesh[] = [];
  const beadGeometry = new CircleGeometry(0.075, 12);
  for (let i = 0; i < 6; i += 1) {
    const bead = new Mesh(beadGeometry, createAdditiveBasicMaterial({ color: hdr(MINT, 2), side: DoubleSide }));
    const angle = Math.PI / 2 - (i / 6) * Math.PI * 2;
    bead.position.set(Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, 0);
    bead.visible = false;
    group.add(bead);
    beads.push(bead);
  }

  group.add(spinner, needle, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.beads = beads;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as MeshBasicMaterial[];
  for (const material of parts) material.color.copy(hdr(MINT, active ? 1.7 : 1.1));
  const beads = reticle.userData.beads as Mesh[];
  beads.forEach((bead, index) => {
    const on = index < lockCount;
    bead.visible = on;
    if (on) (bead.material as MeshBasicMaterial).color.copy(hdr(colorForLockCount(index + 1, LOCK_GRADIENT), 2));
  });
}

// ---- event wiring ----------------------------------------------------------------

function partSpawns(parts: CreaturePart[]): PieceSpawn[] {
  const world = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  return parts.map((part) => {
    part.chunk.mesh.updateWorldMatrix(true, false);
    world.multiplyMatrices(part.chunk.mesh.matrixWorld, part.local);
    world.decompose(position, quaternion, scale);
    return { type: part.type, tint: part.tint, position: position.clone(), quaternion: quaternion.clone(), scale: Math.max(0.2, scale.x) };
  });
}

function scatterParts(parts: CreaturePart[], burst: number) {
  if (!pieces || !ball) return 0;
  const spawns = partSpawns(parts);
  pieces.scatter(spawns, ball.state, burst);
  return spawns.length;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || kind === 'letter' || kind === 'spill') return;
    const scale = Math.max(0.6, record.mesh.scale.x);
    if (kind === 'glob') {
      spawnRing(worldPosition, hdr(GOLD, 1.0), 1.6 * scale, 0.3);
    } else if (kind === 'spill-core') {
      spawnRing(worldPosition, hdr(GOLD, 1.2), 12, 0.7);
      burstDroplets(worldPosition, 18, 9, 0.5);
    } else {
      puff(worldPosition, 1.4 * scale, 0.5);
      if (debugDebris) scatterParts(wornParts(record.mesh), 3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    const scale = record ? Math.max(1, record.mesh.scale.x) : 1;
    spawnRing(worldPosition, hdr(lockColor, 1.3), 1.8 * scale, 0.28);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(MINT, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    if (lethal) return;
    const record = enemyRecords.get(enemyId);
    const scale = record ? Math.max(1, record.mesh.scale.x) : 1;
    burstDroplets(worldPosition, 6, 5 * Math.sqrt(scale), 0.16 * scale);
    burstSparkles(worldPosition, hdr(CHALK, 0.9), 5, 7, 3);
    if (record) {
      (record.mesh.userData as CreatureUserData).damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(CHALK, 1.8), 1.2 * scale, 0.16);
    }
  });

  // A core's outer shell breaks: it showers the road with rescued supplies.
  bus.on('stage', ({ enemyId, worldPosition, previousStageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || record.kind !== 'spill-core') return;
    const count = scatterParts(breakShell(record.mesh, previousStageIndex), 9);
    emitSignal('shower', { pieces: count });
    spawnRing(worldPosition, hdr(GOLD, 1.4), 16, 0.6);
    spawnGlint(worldPosition, hdr(CHALK, 2.2), 3, 0.24);
    burstDroplets(worldPosition, 26, 12, 0.5);
    feel.shake(0.7, TINKER_SHAKE);
    surge = Math.max(surge, 0.5);
    flashUniform.value = Math.max(flashUniform.value, 0.22);
    ball?.grow(0.8);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.kind === 'spill') {
      enemyRecords.delete(enemyId);
      return;
    }
    const data = record.mesh.userData as CreatureUserData;
    const scale = Math.max(0.6, record.mesh.scale.x);
    if (record.mesh.userData.isLetter !== true && data.chunks) {
      let count = 0;
      if (data.isCore) {
        for (let layer = 0; layer < data.shells.length; layer += 1) count += scatterParts(breakShell(record.mesh, layer), 10);
      } else {
        count = scatterParts(wornParts(record.mesh), 4 + scale);
      }
      // The core splats: dark droplets, a warm ring, and a clean glint.
      burstDroplets(worldPosition, data.isCore ? 40 : 10 + Math.round(scale * 3), (data.isCore ? 14 : 6) * Math.sqrt(scale), (data.isCore ? 0.6 : 0.14) * scale);
      spawnRing(worldPosition, hdr(data.accent, 1.0), (data.isCore ? 6 : 2.6) * scale, 0.42);
      spawnGlint(worldPosition, hdr(CHALK, 1.5), (data.isCore ? 3 : 1.1) * Math.sqrt(scale), 0.18);
      burstSparkles(worldPosition, hdr(MINT, 0.8), data.isCore ? 30 : 6, data.isCore ? 12 : 5);
      if (data.isCore) {
        emitSignal('shower', { pieces: count });
        const lastCore = spillState.coreAlive.filter((alive) => alive).length <= 1;
        feel.shake(lastCore ? 1.5 : 0.9, TINKER_SHAKE);
        surge = Math.max(surge, lastCore ? 1.1 : 0.7);
        flashUniform.value = Math.max(flashUniform.value, lastCore ? 0.9 : 0.35);
        ball?.grow(lastCore ? 1.4 : 1);
        if (lastCore) {
          spawnRing(spillState.center.clone().setY(TABLE_Y + 1), hdr(CHALK, 1.4), 70, 1.3);
          spawnRing(spillState.center.clone().setY(TABLE_Y + 1), hdr(GOLD, 1.1), 40, 1.0);
          burstSparkles(spillState.center.clone().setY(TABLE_Y + 2), hdr(CHALK, 1.2), 90, 26, 6);
          gooTarget = 0;
        }
      }
    } else {
      burstSparkles(worldPosition, hdr(MINT, 0.9), 8, 6);
      spawnRing(worldPosition, hdr(MINT, 0.9), 2.4, 0.35);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.kind === 'spill') {
      enemyRecords.delete(enemyId);
      return;
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    puff(worldPosition, 1.2, 0.35);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.4);
      flashUniform.value = Math.max(flashUniform.value, 0.16);
      if (ball) burstSparkles(ball.state.center.clone().setY(ball.state.center.y + ball.state.radius), hdr(CHALK, 1.1), 26, 6 + ball.state.radius * 2, 3);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.4;
    feel.shake(1.1, TINKER_SHAKE);
    gooTarget = Math.min(1, gooTarget + 0.34);
    if (ball) {
      ball.gum();
      const top = ball.state.center.clone().setY(ball.state.center.y + ball.state.radius);
      burstDroplets(top, 14, 5 + ball.state.radius, 0.2 + ball.state.radius * 0.12);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      surge = Math.max(surge, 0.8);
      feel.shake(0.9, TINKER_SHAKE);
      flashUniform.value = Math.max(flashUniform.value, 0.28);
    } else if (phase === 'exposed') {
      surge = Math.max(surge, 0.5);
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    pieces?.reset();
    ball?.reset();
    coreBuilds = 0;
    beatEnergy = 0;
    surge = 0;
    cameraRoll = 0;
    cameraFovOffset = 0;
    gooTarget = 0;
    gooUniform.value = 0;
    flashUniform.value = 0;
    feel.restore();
  });

  bus.on('runend', () => {
    feel.restore();
    gooTarget = 0;
  });
}

// ---- per-frame update ---------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  runTimeNow = ctx.running ? ctx.runTime : 0;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surge = Math.max(0, surge - dt * 0.9);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.6 ? 1.6 : 2.6));
  gooUniform.value += (gooTarget - gooUniform.value) * Math.min(1, dt * 2.2);

  if (environment) {
    environment.bulbMaterial.color.copy(hdr(LAMP_WARM, 1.2 + beatEnergy * 0.3));
    environment.update(dt, { camera: ctx.camera, elapsed: ctx.elapsed, running: ctx.running, runTime: ctx.runTime });
  }

  if (ball && pieces && curve) {
    const swerveTarget = ctx.running
      ? pieces.nearestLooseAhead(ball.state, 4 + ball.state.speed * 1.1, ball.state.radius * 2.6 + 1.8)
      : null;
    ball.update(dt, { curve, runProgress: ctx.running ? ctx.runProgress : 0, running: ctx.running, elapsed: ctx.elapsed, swerveTarget });
    const forward = new Vector3();
    ctx.camera.getWorldDirection(forward);
    pieces.update(dt, ball.state, ctx.camera.position, forward);
  }

  const cameraPosition = ctx.camera.position;
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const userData = record.mesh.userData;

    if (userData.isAnchor) continue;
    if (userData.isLetter) {
      const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;
      setLetterDenied(record.mesh, denied);
    } else {
      animateCreature(record.mesh, dt, elapsedNow, age);
      const distance = record.mesh.position.distanceTo(cameraPosition);
      const closeness = (userData as CreatureUserData).isGlob ? 1 - clamp01((distance - 4) / 36) : 1 - clamp01((distance - 10) / 60);
      tintCreature(record.mesh, elapsedNow, closeness);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as PerspectiveCamera).quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = ((userData.lockRingScale as number | undefined) ?? 1) * (userData.isLetter ? 1 : Math.max(0.6, record.mesh.scale.x));
      record.lockRing.scale.setScalar(pulse * 1.7 * fit);
    }
  }

  const projectileScale = ball ? 0.75 + ball.state.radius * 0.32 : 1;
  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    record.mesh.scale.setScalar(projectileScale);
    dropTrail(record.mesh.position, hdr(MINT, 0.8));
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 3.2 : 0.7);
  }

  updateEffects(dt, ctx.camera);
}

/** The camera looks down at the table and banks into the road's turns. */
export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  if (ctx.running) {
    camera.rotateX(-CAMERA_PITCH);
  } else {
    // Attract: float a little higher and look almost level so the START word
    // hangs over the road instead of under the table.
    camera.position.y += 1.6;
    camera.rotateX(-0.06);
  }

  if (ctx.running && curve) {
    const u = MathUtils.clamp(ctx.runProgress, 0, 1);
    const tangent = curve.getTangentAt(u);
    const ahead = curve.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.13, 0.13);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    camera.rotateZ(cameraRoll);
  }

  const speed = ctx.running ? speedFactorAt(ctx.runTime) : 0.6;
  const targetFov = (speed - 1) * 3.5 + beatEnergy * 0.9 + surge * 6.5;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFov, Math.min(1, dt * 6));
  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: TINKER_SHAKE });
  camera.updateMatrixWorld();
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

// Lock ring: a stitched mint hoop, like a thread loop pulled tight on the core.
function makeLockRing(color: Color): Group {
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.88, 0.94, 40), createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }));
  group.add(ring);
  const dashGeometry = new PlaneGeometry(0.16, 0.05);
  for (let i = 0; i < 8; i += 1) {
    const dash = new Mesh(dashGeometry, createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(CHALK, 0.5), 1.5), side: DoubleSide }));
    const angle = (i / 8) * Math.PI * 2;
    dash.position.set(Math.cos(angle) * 0.72, Math.sin(angle) * 0.72, 0);
    dash.rotation.z = angle;
    group.add(dash);
  }
  group.userData.raildIgnoreOcclusion = true;
  return group;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
