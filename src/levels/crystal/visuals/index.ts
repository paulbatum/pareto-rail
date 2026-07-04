import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
} from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../../events';
import { createCrystal, setCrystalLocked, type CrystalKind, type ShardSpec } from './crystal';
import { beatUniform, createEnvironmentInternal, type Environment } from './environment';
import {
  burstShatter,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import { colorForLockCount } from '../../../engine/locks';
import { createLetterMesh, setLetterLocked } from './letters';
import { AMBER, CORE_WHITE, CYAN, hdr, MAGENTA } from './palette';
import { createBoltMesh, createLancerHalo, createWardenCoreMesh, createWardenShieldMesh } from './warden';


export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
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

let environment: Environment | null = null;
let sceneRef: Scene | null = null;
let baseFov: number | null = null;
let beatEnergy = 0;
let elapsedNow = 0;

const BOLT_RED = new Color(1, 0.035, 0.015);

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const pendingEnemyMeshes: Group[] = [];
const pendingProjectileMeshes: ProjectileRecord[] = [];
const enemyRecords = new Map<number, EnemyRecord>();
const projectileRecords = new Map<number, ProjectileRecord>();

export function createEnvironment(scene: Scene) {
  sceneRef = scene;
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  pendingEnemyMeshes.push(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'bolt':
      return createBoltMesh();
    case 'lancer': {
      // A lancer is an orbiter-class crystal wearing an amber targeting halo:
      // the halo is the "shoots back" read.
      const mesh = createCrystal('orbiter');
      const halo = createLancerHalo();
      mesh.add(halo);
      mesh.userData.lancerHalo = halo;
      return mesh;
    }
    case 'warden-shield':
      return createWardenShieldMesh();
    case 'warden-core':
      return createWardenCoreMesh();
    default:
      return createCrystal(kind as CrystalKind);
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  setCrystalLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnRing(mesh.position, hdr(AMBER, 1.0), 2.8, 0.32);
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(
    new OctahedronGeometry(0.34, 0),
    new MeshBasicMaterial({ color: hdr(CORE_WHITE, 2.8) }),
  );
  core.scale.set(0.4, 0.4, 2.1);
  const shell = new Mesh(
    new OctahedronGeometry(0.52, 0),
    new MeshBasicMaterial({
      color: hdr(MAGENTA, 0.9),
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  shell.scale.set(0.5, 0.5, 1.9);
  group.add(core, shell);
  pendingProjectileMeshes.push({ mesh: group, trailColor: MAGENTA.clone().multiplyScalar(0.95) });
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];

  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.color.copy(base);
    parts.push({ material, base, active });
  };

  const outer = new Mesh(new RingGeometry(0.6, 0.645, 48), new MeshBasicMaterial());
  addPart(outer, hdr(CYAN, 1.1), hdr(MAGENTA, 1.7));

  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.33, 0.36, 3), new MeshBasicMaterial());
  addPart(inner, hdr(CYAN, 0.8), hdr(CORE_WHITE, 1.6));
  spinner.add(inner);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.18, 0.035), new MeshBasicMaterial());
    addPart(tick, hdr(CYAN, 1.3), hdr(MAGENTA, 2));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 20), new MeshBasicMaterial());
  addPart(dot, hdr(CORE_WHITE, 2), hdr(CORE_WHITE, 3));

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
    const mesh = pendingEnemyMeshes.shift();
    if (!mesh) return;
    enemyRecords.set(enemyId, { mesh, bornAt: null, lockRing: null });
    spawnRing(worldPosition, hdr(CYAN, 0.9), 3.2, 0.5);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [CYAN, MAGENTA, AMBER]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      record.lockRing = makeLockRing(lockColor);
      scene.add(record.lockRing);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.4, 0.3);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) removeLockRing(record, scene);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    const record = pendingProjectileMeshes.shift();
    if (record) projectileRecords.set(projectileId, record);
    spawnGlint(worldPosition, hdr(CORE_WHITE, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, hitPointsRemaining }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(CORE_WHITE, 0.9), 6, 12);
    const record = enemyRecords.get(enemyId);
    if (record?.mesh.userData.kind === 'warden-shield' && !lethal) {
      record.mesh.userData.damageLevel = Math.max(record.mesh.userData.damageLevel ?? 0, 2 - hitPointsRemaining);
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.42;
      spawnRing(worldPosition, hdr(CYAN, 1.35), 4.2, 0.34);
      spawnGlint(worldPosition, hdr(CORE_WHITE, 2.0), 1.3, 0.18);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShatter(worldPosition, specs);
      const accent = (record.mesh.userData.accent as Color | undefined) ?? CYAN;
      spawnRing(worldPosition, hdr(accent, 0.9), 5.5, 0.5);
      spawnRing(worldPosition, hdr(CYAN, 0.55), 3.2, 0.34);
      spawnGlint(worldPosition, hdr(CORE_WHITE, 1.8), 1.4, 0.2);
      removeLockRing(record, scene);
      enemyRecords.delete(enemyId);
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      removeLockRing(record, scene);
      enemyRecords.delete(enemyId);
    }
    burstSparks(worldPosition, AMBER.clone().multiplyScalar(0.5), 4, 3);
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.shieldFlashUntil = elapsedNow + 0.65;
      spawnRing(shield.worldPosition, hdr(AMBER, 1.5), 4.8, 0.45);
      spawnRing(shield.worldPosition, hdr(MAGENTA, 0.8), 2.6, 0.28);
      spawnGlint(shield.worldPosition, hdr(CORE_WHITE, 1.7), 1.6, 0.2);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
  });

  // Taking a hit punches the FOV hard (the HUD supplies the red flash).
  bus.on('playerhit', () => {
    beatEnergy = 1.6;
  });

  bus.on('runstart', () => {
    resetEffects();
    for (const record of enemyRecords.values()) removeLockRing(record, scene);
    enemyRecords.clear();
    projectileRecords.clear();
    pendingEnemyMeshes.length = 0;
    pendingProjectileMeshes.length = 0;
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  beatUniform.value = beatEnergy;

  if (ctx.camera instanceof PerspectiveCamera) {
    if (baseFov === null) baseFov = ctx.camera.fov;
    ctx.camera.fov = baseFov + beatEnergy * 1.1;
    ctx.camera.updateProjectionMatrix();
  }

  if (environment) {
    for (const item of environment.debris) {
      item.lines.rotation.x += item.spin.x * dt;
      item.lines.rotation.y += item.spin.y * dt;
      item.lines.rotation.z += item.spin.z * dt;
    }
  }

  for (const [enemyId, record] of enemyRecords) {
    if (!record.mesh.parent) {
      if (sceneRef) removeLockRing(record, sceneRef);
      enemyRecords.delete(enemyId);
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    // Distance falloff: bloom halos are screen-space, so a far crystal fits
    // inside its own halo and reads as a blob. Dim the hot elements with
    // distance; full energy only arrives as the enemy closes in.
    const distance = record.mesh.position.distanceTo(ctx.camera.position);
    const closeness = smootherstep(1 - clamp01((distance - 14) / (48 - 14)));
    const userData = record.mesh.userData;
    if (userData.edgeMaterial && userData.fillMaterial && userData.coreMaterial && userData.coreGlow) {
      // Edges are thin lines with small bloom halos — keep them readable at
      // range. The additive fill is what stacks into a white blob when the
      // whole crystal fits in a few pixels, so it dims much harder.
      (userData.edgeMaterial as LineBasicMaterial).color.setScalar(0.5 + 0.5 * closeness);
      (userData.fillMaterial as MeshBasicMaterial).color.setScalar(0.22 + 0.78 * closeness);
      const hotScale = 0.3 + 0.7 * closeness;
      const danger = userData.isBolt === true ? smootherstep(1 - clamp01((distance - 3) / (30 - 3))) : 0;
      const coreColor = (userData.coreBase as Color).clone().lerp(hdr(BOLT_RED, 2.9), danger);
      const glowColor = (userData.glowBase as Color).clone().lerp(hdr(BOLT_RED, 2.1), danger);
      (userData.coreMaterial as MeshBasicMaterial).color.copy(coreColor).multiplyScalar(hotScale);
      const coreGlow = userData.coreGlow as Mesh;
      (coreGlow.material as MeshBasicMaterial).color.copy(glowColor).multiplyScalar(hotScale);
    }

    const damageLevel = userData.damageLevel as number | undefined;
    if ((damageLevel ?? 0) > 0) {
      if (userData.edgeMaterial) (userData.edgeMaterial as LineBasicMaterial).color.copy(hdr(AMBER, 1.05));
      if (userData.fillMaterial) (userData.fillMaterial as MeshBasicMaterial).color.copy(hdr(AMBER, 0.26));
      if (userData.coreMaterial) (userData.coreMaterial as MeshBasicMaterial).color.copy(hdr(CORE_WHITE, 1.15));
      const coreGlow = userData.coreGlow as Mesh | undefined;
      if (coreGlow) (coreGlow.material as MeshBasicMaterial).color.copy(hdr(AMBER, 0.55));
    }

    const deniedUntil = userData.deniedUntil as number | undefined;
    const shieldFlashUntil = userData.shieldFlashUntil as number | undefined;
    const shieldFlashUntilMax = Math.max(deniedUntil ?? -Infinity, shieldFlashUntil ?? -Infinity);
    if (shieldFlashUntilMax > elapsedNow) {
      const flash = Math.max(0, Math.min(1, (shieldFlashUntilMax - elapsedNow) / 0.65));
      if (userData.edgeMaterial) (userData.edgeMaterial as LineBasicMaterial).color.copy(hdr(AMBER, 1.2 + flash * 1.4));
      if (userData.fillMaterial) (userData.fillMaterial as MeshBasicMaterial).color.copy(hdr(MAGENTA, 0.25 + flash * 0.45));
      if (userData.coreMaterial) (userData.coreMaterial as MeshBasicMaterial).color.copy(hdr(CORE_WHITE, 1.2 + flash * 1.8));
      const coreGlow = userData.coreGlow as Mesh | undefined;
      if (coreGlow) (coreGlow.material as MeshBasicMaterial).color.copy(hdr(AMBER, 0.8 + flash * 1.2));
      const letterMaterials = userData.letterMaterials as
        | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
        | undefined;
      if (letterMaterials) {
        letterMaterials.edgeMaterial.color.copy(hdr(AMBER, 1.6 + flash * 1.2));
        letterMaterials.fillMaterial.color.copy(AMBER.clone().multiplyScalar(0.16 + flash * 0.16));
      }
    } else if (userData.isLetter && userData.locked !== true) {
      setLetterLocked(record.mesh, false);
    }

    const damageFlashUntil = userData.damageFlashUntil as number | undefined;
    if ((damageFlashUntil ?? -Infinity) > elapsedNow) {
      const flash = Math.max(0, Math.min(1, ((damageFlashUntil ?? 0) - elapsedNow) / 0.42));
      if (userData.edgeMaterial) (userData.edgeMaterial as LineBasicMaterial).color.copy(hdr(CORE_WHITE, 1.1 + flash * 1.8));
      if (userData.fillMaterial) (userData.fillMaterial as MeshBasicMaterial).color.copy(hdr(CYAN, 0.28 + flash * 0.4));
      if (userData.coreMaterial) (userData.coreMaterial as MeshBasicMaterial).color.copy(hdr(CORE_WHITE, 1.5 + flash * 1.6));
      const coreGlow = userData.coreGlow as Mesh | undefined;
      if (coreGlow) (coreGlow.material as MeshBasicMaterial).color.copy(hdr(CYAN, 0.8 + flash * 1.4));
    }

    const halo = record.mesh.userData.lancerHalo as Group | undefined;
    if (halo) {
      const spinParts = halo.userData.spinParts as Mesh[];
      spinParts[0].rotation.z += dt * 1.7;
      spinParts[1].rotation.z -= dt * 1.1;
    }

    // Warden shell: spins while up; once gameplay flags the core exposed it
    // bursts and collapses inward.
    const shell = record.mesh.userData.shell as Group | undefined;
    if (shell && shell.visible && record.mesh.userData.exposed === true) {
      if (record.mesh.userData.shellBurst !== true) {
        record.mesh.userData.shellBurst = true;
        spawnRing(record.mesh.position, hdr(AMBER, 1.2), 9, 0.6);
        spawnGlint(record.mesh.position, hdr(CORE_WHITE, 1.6), 2.4, 0.25);
      }
      const next = shell.scale.x - dt * 2.4;
      if (next <= 0.02) shell.visible = false;
      else shell.scale.setScalar(next);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.6;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
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
    new MeshBasicMaterial({
      color: hdr(color, 1.8),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.68, 0.71, 32),
    new MeshBasicMaterial({
      color: hdr(color.clone().lerp(CORE_WHITE, 0.55), 1.4),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  group.add(ring, innerRing);
  return group;
}

function removeLockRing(record: EnemyRecord, scene: Scene) {
  if (record.lockRing) {
    scene.remove(record.lockRing);
    record.lockRing = null;
  }
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
