import { DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, RingGeometry, Scene, Vector3 } from 'three';
import type { Camera } from 'three';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnFallingHusk,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import {
  createBoltMesh,
  createBroodMesh,
  createDarterMesh,
  createLetterMesh,
  createLimpetMesh,
  createParentMesh,
  createPlayerBoltMesh,
  createSkimmerMesh,
  createStrandlineReticle,
  createWebMesh,
  setEnemyLockedMesh,
  setLetterDenied,
  setLetterLocked,
} from './enemies';
import { createEnvironmentInternal, type StrandlineEnvironment } from './environment';
import {
  BLOOM_GOLD,
  BONE_WHITE,
  CORE_WHITE,
  JELLY_GREEN,
  LOCK_GRADIENT,
  PARASITE_VIOLET,
  SICKLY_MAGENTA,
  SUNLIT_AQUA,
  hdr,
} from './palette';
import { damageUniform, flashUniform, resolveUniform } from './post-fx';

// Strandline's event choreography: parasites arrive in violet rings and die
// in violet shatter; everything the player owns — locks, bolts, letters,
// the resolve — speaks green-gold. The parent's death floods the frame
// white, cleanses the forest, and starts the long pullback.

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
};

export type StrandlineCameraEffects = {
  camera: Camera;
  runProgress: number;
  runTime: number;
  dt: number;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: typeof JELLY_GREEN;
};

let environment: StrandlineEnvironment | null = null;
let beatEnergy = 0;
let damagePulse = 0;
let flashPulse = 0;
let resolveT = 0;
let resolved = false;
let elapsedNow = 0;
let reticleRef: Object3D | null = null;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

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
    case 'limpet':
      return createLimpetMesh();
    case 'skimmer':
      return createSkimmerMesh();
    case 'darter':
      return createDarterMesh();
    case 'bolt':
      return createBoltMesh();
    case 'brood':
      return createBroodMesh();
    case 'web':
      return createWebMesh();
    case 'parent':
      return createParentMesh();
    default:
      return createLimpetMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  setEnemyLockedMesh(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group, true);
  spawnRing(mesh.position, hdr(PARASITE_VIOLET, 1.0), 2.8, 0.32);
}

export function createProjectileMesh() {
  const mesh = createPlayerBoltMesh();
  projectileRecords.enqueue({ mesh, trailColor: JELLY_GREEN });
  return mesh;
}

export function createReticle() {
  const reticle = createStrandlineReticle();
  reticleRef = reticle;
  return reticle;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: typeof SUNLIT_AQUA; active: typeof SUNLIT_AQUA }>;
  for (const part of parts) {
    part.material.color.copy(active ? part.active : part.base);
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    const violet = kind === 'limpet' || kind === 'skimmer' || kind === 'darter' || kind === 'bolt' || kind === 'brood';
    spawnRing(worldPosition, hdr(violet ? PARASITE_VIOLET : JELLY_GREEN, 0.9), kind === 'parent' ? 8 : 3.2, 0.5);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [SUNLIT_AQUA, JELLY_GREEN, BLOOM_GOLD]);
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
    spawnGlint(worldPosition, hdr(BLOOM_GOLD, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) {
      const accent = (record?.mesh.userData.accent as typeof PARASITE_VIOLET | undefined) ?? PARASITE_VIOLET;
      burstSparks(worldPosition, accent.clone().multiplyScalar(0.6), 8, 7);
    } else {
      burstSparks(worldPosition, hdr(CORE_WHITE, 0.9), 6, 10);
    }
    if (record?.mesh.userData.kind === 'parent' && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.42;
      spawnRing(worldPosition, hdr(BLOOM_GOLD, 1.35), 7, 0.34);
      spawnGlint(worldPosition, hdr(CORE_WHITE, 2.0), 1.6, 0.18);
    }
    if ((record?.mesh.userData.kind === 'darter' || record?.mesh.userData.kind === 'brood') && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnRing(worldPosition, hdr(SICKLY_MAGENTA, 1.2), 3.4, 0.3);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.mesh.userData.kind !== 'parent') return;
    spawnRing(worldPosition, hdr(BLOOM_GOLD, 1.5), 9, 0.5);
    spawnGlint(worldPosition, hdr(CORE_WHITE, 2.2), 2.2, 0.22);
    record.mesh.userData.damageFlashUntil = elapsedNow + 0.5;
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.mesh.userData.kind as string | undefined;
    if (record) {
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      const accent = (record.mesh.userData.accent as typeof PARASITE_VIOLET | undefined) ?? PARASITE_VIOLET;
      burstShards(worldPosition, specs, accent);
      spawnRing(worldPosition, hdr(accent, 0.9), kind === 'parent' ? 12 : 5.5, 0.5);
      spawnRing(worldPosition, hdr(JELLY_GREEN, 0.55), 3.2, 0.34);
      spawnGlint(worldPosition, hdr(CORE_WHITE, 0.65), 0.45, 0.12);
      enemyRecords.delete(enemyId, { dispose: true });
    }
    if (kind === 'parent') {
      // The severance: white flood, husks, the forest cleansed.
      flashPulse = 1.4;
      resolved = true;
      environment?.setCleansed(true);
      for (let i = 0; i < 5; i += 1) {
        spawnFallingHusk(
          worldPosition.clone().add(new Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, 0)),
          hdr(PARASITE_VIOLET, 0.9),
          0.8 + Math.random() * 0.8,
        );
      }
      spawnRing(worldPosition, hdr(BONE_WHITE, 1.6), 16, 1.1);
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.mesh.userData.kind as string | undefined;
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    if (kind === 'web') {
      // A starved plate crumbles — not a failure, a small exhale.
      spawnFallingHusk(worldPosition, hdr(PARASITE_VIOLET, 0.7), 1.2);
      spawnRing(worldPosition, hdr(JELLY_GREEN, 0.7), 5, 0.6);
    } else {
      burstSparks(worldPosition, PARASITE_VIOLET.clone().multiplyScalar(0.5), 4, 3);
    }
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.shieldFlashUntil = elapsedNow + 0.65;
      spawnRing(shield.worldPosition, hdr(PARASITE_VIOLET, 1.5), 4.8, 0.45);
      spawnGlint(shield.worldPosition, hdr(CORE_WHITE, 1.4), 1.2, 0.2);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') flashPulse = Math.max(flashPulse, 0.7);
    if (phase === 'summoned') flashPulse = Math.max(flashPulse, 0.4);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.6;
    damagePulse = 1;
  });

  bus.on('runstart', () => {
    resetEffects();
    resolved = false;
    resolveT = 0;
    damagePulse = 0;
    flashPulse = 0;
    environment?.setCleansed(false);
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  damagePulse = Math.max(0, damagePulse - dt * 1.8);
  flashPulse = Math.max(0, flashPulse - dt * 1.6);
  damageUniform.value = damagePulse;
  flashUniform.value = Math.min(1.2, flashPulse + beatEnergy * 0.06);
  if (resolved) resolveT = Math.min(1, resolveT + dt * 0.25);
  else if (!ctx.running) resolveT = Math.max(0, resolveT - dt * 0.5);
  resolveUniform.value = resolveT;

  environment?.update(dt, {
    elapsed: ctx.elapsed,
    runProgress: ctx.runTime / 60,
    runTime: ctx.runTime,
    beat: beatEnergy,
    camera: ctx.camera,
  });

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const userData = record.mesh.userData;
    const kind = userData.kind as string | undefined;

    // Webs and the parent grow large and stay large; everything else eases in.
    if (kind === 'web' || kind === 'parent') {
      record.mesh.scale.setScalar(age < 0.6 ? 0.3 + 0.7 * (age / 0.6) : 1);
    } else {
      record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));
    }

    // Limpet sucking pulse.
    const pulseMesh = userData.pulseMesh as Mesh | undefined;
    if (pulseMesh) {
      const pulse = (userData.pulse as number | undefined) ?? 0.5;
      (pulseMesh.material as MeshBasicMaterial).opacity = 0.35 + pulse * 0.4;
      pulseMesh.scale.setScalar(1 + pulse * 0.12);
    }

    // Darter charge read: the sac swells white before it spits.
    const chargeMesh = userData.chargeMesh as Mesh | undefined;
    if (chargeMesh) {
      const charge = (userData.charge as number | undefined) ?? 0;
      chargeMesh.scale.setScalar(0.15 + charge * 0.85);
      (chargeMesh.material as MeshBasicMaterial).color.copy(
        charge > 0.02 ? hdr(CORE_WHITE, 1.2 + charge) : hdr(CORE_WHITE, 0.25),
      );
    }

    // Brood orbiters whirl; darter fins and parent spikes turn.
    const spinParts = userData.spinParts as Group[] | undefined;
    if (spinParts) {
      for (const part of spinParts) part.rotation.z += dt * (kind === 'brood' ? 3.2 : 1.4);
    }

    // The parent's wound opens as its webbing starves.
    if (kind === 'parent') {
      const coreMesh = userData.coreMesh as Mesh | undefined;
      const withered = (userData.witheredCount as number | undefined) ?? 0;
      const exposed = userData.exposed === true;
      if (coreMesh) coreMesh.visible = withered > 0 || exposed;
      const craterMat = userData.craterMat as MeshBasicMaterial | undefined;
      if (craterMat) craterMat.color.copy(hdr(BLOOM_GOLD, 0.6 + withered * 0.35 + (exposed ? 0.6 : 0)));
    }

    // Starved webbing collapses inward and greys out.
    if (kind === 'web') {
      const witherT = (userData.witherT as number | undefined) ?? 0;
      if (witherT > 0) {
        record.mesh.scale.setScalar(Math.max(0.02, 1 - witherT * 0.9));
        const latticeMat = userData.latticeMat as MeshBasicMaterial | undefined;
        if (latticeMat) latticeMat.color.copy(PARASITE_VIOLET.clone().multiplyScalar(0.8 * (1 - witherT * 0.7)));
        const membraneMat = userData.membraneMat as MeshBasicMaterial | undefined;
        if (membraneMat) membraneMat.opacity = 0.5 * (1 - witherT);
      }
    }

    // Deny / shield / damage flashes: violet for blocked, white for wounded.
    const deniedUntil = userData.deniedUntil as number | undefined;
    const shieldFlashUntil = userData.shieldFlashUntil as number | undefined;
    const blockUntil = Math.max(deniedUntil ?? -Infinity, shieldFlashUntil ?? -Infinity);
    if (blockUntil > elapsedNow) {
      const flash = Math.max(0, Math.min(1, (blockUntil - elapsedNow) / 0.65));
      if (!userData.isLetter) setEnemyLockedMesh(record.mesh, false);
      spawnDenyTint(record.mesh, flash);
      if (userData.isLetter) setLetterDenied(record.mesh, true);
    } else if (userData.isLetter && userData.locked !== true) {
      setLetterDenied(record.mesh, false);
    }

    const damageFlashUntil = userData.damageFlashUntil as number | undefined;
    if ((damageFlashUntil ?? -Infinity) > elapsedNow) {
      const flash = Math.max(0, Math.min(1, ((damageFlashUntil ?? 0) - elapsedNow) / 0.5));
      spawnWoundTint(record.mesh, flash);
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

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, JELLY_GREEN.clone().multiplyScalar(0.7));
  }

  if (reticleRef?.userData.spinner) {
    const spinner = reticleRef.userData.spinner as Group;
    const active = reticleRef.userData.active === true;
    spinner.rotation.z += dt * (active ? 5 : 1.4);
    const brackets = reticleRef.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 3.2 : 0.8);
  }

  updateEffects(dt, ctx.camera);
}

function spawnDenyTint(mesh: Group, flash: number) {
  const core = mesh.userData.lockCore as MeshBasicMaterial | undefined;
  if (core) core.color.copy(hdr(PARASITE_VIOLET, 1.1 + flash * 1.4));
}

function spawnWoundTint(mesh: Group, flash: number) {
  const core = mesh.userData.lockCore as MeshBasicMaterial | undefined;
  if (core) core.color.copy(hdr(CORE_WHITE, 1.3 + flash * 1.4));
}

export function updateCameraEffects({ camera, runTime }: StrandlineCameraEffects) {
  // The resolve pullback: after the parent dies (or the coda arrives), the
  // camera drifts back and back — the whole animal in frame for the first
  // time. Absolute offsets recomputed each frame, so the runner's base
  // transform stays authoritative.
  const codaStart = 56;
  const pullT = Math.max(0, runTime - (resolved ? codaStart - 2 : codaStart));
  const perspective = camera as PerspectiveCamera;
  if (pullT <= 0) {
    if (Math.abs(perspective.fov - 62) > 0.01) {
      perspective.fov = 62;
      perspective.updateProjectionMatrix();
    }
    return;
  }
  const pull = Math.min(24, pullT * pullT * 1.1);
  const backward = new Vector3();
  perspective.getWorldDirection(backward).multiplyScalar(-pull);
  backward.y += pull * 0.35;
  perspective.position.add(backward);
  const targetFov = 62 + Math.min(14, pullT * 3.2);
  if (Math.abs(perspective.fov - targetFov) > 0.01) {
    perspective.fov = targetFov;
    perspective.updateProjectionMatrix();
  }
}

function makeLockRing(color: typeof SUNLIT_AQUA): Group {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.68, 0.71, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(CORE_WHITE, 0.55), 1.4), side: DoubleSide }),
  );
  group.add(ring, innerRing);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
