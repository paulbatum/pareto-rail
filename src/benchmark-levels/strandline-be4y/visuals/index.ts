import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  BELL_TIME,
  DEADLINE_TIME,
  STRANDLINE_DURATION,
  STRANDLINE_PLAYER_HEALTH,
  createStrandlineRail,
  speedFactorAt,
  strandlineRunProgress,
} from '../gameplay';
import { APPROACH_DIR, CROWN, VISTA_DISTANCE, approachPoint } from '../world';
import {
  bareSac,
  createBroodlingMesh,
  createDarterMesh,
  createParentMesh,
  createSacMesh,
  createSpinnerMesh,
  createSporeMesh,
  createTickMesh,
  updateParentMesh,
  type TintPart,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShards,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnPuff,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  CLEAN_WHITE,
  JELLY_GOLD,
  JELLY_GREEN,
  LOCK_GRADIENT,
  PARASITE_MAGENTA,
  PARASITE_PLUM,
  PARASITE_VIOLET,
  hdr,
} from './palette';
import { damageUniform, flashUniform, lifeUniform } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type CameraEffectsContext = {
  camera: Camera;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  lockRing: Group | null;
  strandIndex: number | null;
  wasLatched: boolean;
  lastDetachSparkAt: number;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

const DENY_VIOLET = new Color(1.3, 0.25, 1.4);
const DENY_FILL = new Color(0.2, 0.03, 0.24);

let environment: Environment | null = null;
let beatEnergy = 0;
let surgePulse = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let elapsedNow = 0;
let hitsTaken = 0;
let damagePulse = 0;
let life = 0.22;
let lifeTarget = 0.22;
let totalCounted = 1;
let sweepRadius = -1;
let sereneLevel = 0;
let bellRevealed = false;
const coda = { active: false, startedAt: 0, fromDistance: 0, clean: false };

const STRANDLINE_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.6,
  frequency: 7,
  smoothing: 18,
};

const rail = createStrandlineRail();
const UP = new Vector3(0, 1, 0);

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the game emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({
    mesh,
    kind: String(mesh.userData.kind ?? ''),
    bornAt: null,
    lockRing: null,
    strandIndex: null,
    wasLatched: false,
    lastDetachSparkAt: 0,
  }),
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

const KIND_SCALE: Record<string, number> = {
  tick: 1.35,
  darter: 1.3,
  spinner: 1.3,
  sac: 1.25,
  spore: 1.2,
  broodling: 1.2,
};

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemyMesh(kind, letter);
  const scale = KIND_SCALE[kind] ?? 1;
  let mesh = built;
  if (scale !== 1) {
    built.scale.setScalar(scale);
    mesh = new Group();
    mesh.add(built);
    mesh.userData = built.userData;
  }
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'tick':
      return createTickMesh();
    case 'darter':
      return createDarterMesh();
    case 'spinner':
      return createSpinnerMesh();
    case 'sac':
      return createSacMesh();
    case 'spore':
      return createSporeMesh();
    case 'broodling':
      return createBroodlingMesh();
    case 'parent':
      return createParentMesh();
    default:
      return createTickMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_VIOLET.clone(), 2.4, 0.3);
  spawnPuff(mesh.position, hdr(PARASITE_VIOLET, 0.8), 1.6, 0.4, 0.2);
}

// Player shot: a sting dart of the animal's own light — white core, green-gold sheath.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.4, 0.4, 2.4);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(CLEAN_WHITE, 2.4) })));
  const sheathGeometry = new OctahedronGeometry(0.5, 0);
  sheathGeometry.scale(0.5, 0.5, 2.0);
  group.add(new Mesh(sheathGeometry, createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 1.0), opacity: 0.6 })));
  projectileRecords.enqueue({ mesh: group, trailColor: JELLY_GOLD.clone().multiplyScalar(0.8) });
  return group;
}

// ---- reticle -------------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  // A soft ring with six cilia around it: one lights per lock, so the sight
  // itself counts the volley.
  const outer = new Mesh(new RingGeometry(0.6, 0.64, 48), new MeshBasicMaterial());
  addPart(outer, hdr(JELLY_GREEN, 1.0));
  const inner = new Mesh(new RingGeometry(0.3, 0.325, 32), new MeshBasicMaterial());
  addPart(inner, hdr(CLEAN_WHITE, 0.7));
  const spinner = new Group();
  spinner.add(inner);

  const cilia = new Group();
  const ciliaMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.06, 0.26), new MeshBasicMaterial());
    const material = configureAdditiveMaterial(tick.material as MeshBasicMaterial, { color: hdr(JELLY_GREEN, 0.35), side: DoubleSide });
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 2;
    tick.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    tick.rotation.z = angle - Math.PI / 2;
    cilia.add(tick);
    ciliaMaterials.push(material);
  }

  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(CLEAN_WHITE, 1.8));

  group.add(outer, spinner, cilia, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.cilia = cilia;
  group.userData.ciliaMaterials = ciliaMaterials;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.5 : 1.2));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
  const cilia = reticle.userData.ciliaMaterials as MeshBasicMaterial[];
  for (const [index, material] of cilia.entries()) {
    const lit = index < lockCount;
    material.color.copy(lit ? hdr(colorForLockCount(index + 1, LOCK_GRADIENT), 1.8) : hdr(JELLY_GREEN, active ? 0.5 : 0.3));
  }
}

// ---- event wiring ------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('runstart', ({ totalEnemies }) => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    resetCameraFeel(cameraFeel);
    environment?.resetStrands();
    flashUniform.value = 0;
    damageUniform.value = 0;
    surgePulse = 0;
    hitsTaken = 0;
    damagePulse = 0;
    life = 0.22;
    lifeTarget = 0.22;
    totalCounted = Math.max(1, totalEnemies);
    sweepRadius = -1;
    sereneLevel = 0;
    bellRevealed = false;
    coda.active = false;
    coda.clean = false;
  });

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'parent') {
      // The crown reveal: the water shudders, violet floods the frame edge.
      cameraFeel.shake(1.1, STRANDLINE_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.6);
      damagePulse = Math.max(damagePulse, 0.9);
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 1.3), 26, 0.9);
      spawnRing(worldPosition, hdr(PARASITE_MAGENTA, 1.0), 14, 0.6);
      burstSparks(worldPosition, hdr(PARASITE_VIOLET, 1.0), 30, 9, 0.8);
    } else if (kind === 'broodling') {
      spawnPuff(worldPosition, hdr(PARASITE_VIOLET, 1.0), 2.2, 0.5, 0.4);
      burstSparks(worldPosition, hdr(PARASITE_MAGENTA, 0.9), 4, 5, 0.6);
    } else if (kind === 'tick' || kind === 'sac' || kind === 'spinner') {
      record.strandIndex = environment?.strandAt(worldPosition) ?? null;
      record.wasLatched = kind !== 'spinner';
      if (kind !== 'tick') spawnRing(worldPosition, hdr(PARASITE_VIOLET, 0.5), 2.0, 0.35);
    } else if (kind === 'darter') {
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 0.45), 1.8, 0.3);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.2), 1.9, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(JELLY_GREEN, 1.1), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(JELLY_GOLD, 0.9), 5, 7);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(CLEAN_WHITE, 1.6), 0.9, 0.15);
      spawnPuff(worldPosition, hdr(PARASITE_VIOLET, 0.7), 1.2, 0.35, 0.3);
      if (record.mesh.userData.isParent) cameraFeel.shake(0.35, STRANDLINE_CAMERA_SHAKE);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.kind === 'sac') {
      // The membrane bursts: skin shards, a violet cloud, the core bared.
      bareSac(innerGroup(record.mesh));
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 5));
      spawnPuff(worldPosition, hdr(PARASITE_VIOLET, 1.0), 2.6, 0.6, 0.5);
      spawnRing(worldPosition, hdr(PARASITE_MAGENTA, 1.2), 4.5, 0.4);
    } else if (record.mesh.userData.isParent) {
      // The grip tears: half its legs come away, and it flinches back into the crown.
      cameraFeel.shake(0.9, STRANDLINE_CAMERA_SHAKE);
      surgePulse = Math.max(surgePulse, 0.45);
      flashUniform.value = Math.max(flashUniform.value, 0.25);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 8));
      spawnRing(worldPosition, hdr(PARASITE_MAGENTA, 1.3), 18, 0.7);
      burstSparks(worldPosition, hdr(PARASITE_VIOLET, 1.0), 22, 12, 0.8);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstShards(worldPosition, specs);
    const accent = (record.mesh.userData.accent as Color | undefined) ?? PARASITE_VIOLET;
    // The parasite dissolves violet; the animal answers with a clean green-gold ring.
    spawnPuff(worldPosition, hdr(accent, 0.9), record.kind === 'sac' ? 3.2 : 2.2, 0.7, 0.5);
    burstSparks(worldPosition, hdr(accent, 0.9), 7, 8, 0.7);
    spawnRing(worldPosition, hdr(JELLY_GREEN, 1.0), 4.4, 0.45);
    spawnGlint(worldPosition, hdr(JELLY_GOLD, 1.5), 1.1, 0.16);
    if (record.strandIndex !== null) {
      environment?.cleanseStrand(record.strandIndex);
      spawnRing(worldPosition, hdr(JELLY_GOLD, 0.8), 7, 0.6);
    }
    if (record.kind !== 'spore') lifeTarget = Math.min(0.92, lifeTarget + 0.55 / totalCounted);

    if (record.mesh.userData.isParent) {
      // Torn loose: the kill the whole level is built around.
      cameraFeel.shake(1.6, STRANDLINE_CAMERA_SHAKE);
      surgePulse = 1.0;
      flashUniform.value = Math.max(flashUniform.value, 1.0);
      spawnRing(worldPosition, hdr(CLEAN_WHITE, 1.5), 70, 1.6);
      spawnRing(worldPosition, hdr(JELLY_GOLD, 1.2), 40, 1.1);
      spawnRing(worldPosition, hdr(JELLY_GREEN, 1.0), 22, 0.8);
      spawnGlint(worldPosition, hdr(CLEAN_WHITE, 2.2), 6, 0.5);
      burstSparks(worldPosition, hdr(PARASITE_VIOLET, 1.1), 60, 16, 1.0);
      burstSparks(worldPosition, hdr(JELLY_GOLD, 1.2), 30, 10, 1.4);
      spawnPuff(worldPosition, hdr(PARASITE_VIOLET, 1.2), 8, 1.4, 0.8);
    } else if (record.kind === 'broodling') {
      spawnRing(worldPosition, hdr(JELLY_GREEN, 0.9), 6, 0.5);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      if (record.mesh.userData.isParent) {
        // The deadline: it burrows back into the crown.
        spawnPuff(worldPosition, hdr(PARASITE_VIOLET, 1.2), 7, 1.2, -0.3);
        burstSparks(worldPosition, hdr(PARASITE_VIOLET, 0.8), 24, 6, -0.6);
        cameraFeel.shake(0.6, STRANDLINE_CAMERA_SHAKE);
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstSparks(worldPosition, PARASITE_PLUM.clone().multiplyScalar(0.6), 3, 2, 0.3);
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.webFlareUntil = elapsedNow + 0.45;
      spawnRing(shield.worldPosition, hdr(PARASITE_VIOLET, 1.2), 9, 0.4);
      burstSparks(shield.worldPosition, hdr(PARASITE_MAGENTA, 0.9), 10, 6, 0.4);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      flashUniform.value = Math.max(flashUniform.value, 0.18);
      lifeTarget = Math.min(0.92, lifeTarget + 0.03);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    beatEnergy = 1.3;
    cameraFeel.shake(1.2, STRANDLINE_CAMERA_SHAKE);
    lifeTarget = Math.max(0.1, lifeTarget - 0.04);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      flashUniform.value = Math.max(flashUniform.value, 0.3);
      surgePulse = Math.max(surgePulse, 0.4);
      lifeTarget = Math.min(0.92, lifeTarget + 0.1);
    } else if (phase === 'destroyed') {
      lifeTarget = 1;
      coda.clean = true;
    }
  });

  bus.on('runend', () => {
    resetCameraFeel(cameraFeel);
  });
}

// ---- per-frame update -------------------------------------------------------------------

function resetCameraFeel(cameraFeel: CameraFeelRig) {
  cameraRoll = 0;
  cameraFovOffset = 0;
  cameraFeel.restore();
}

function startCoda(runTime: number, camera: PerspectiveCamera) {
  coda.active = true;
  coda.startedAt = runTime;
  coda.fromDistance = Math.max(4, camera.position.clone().sub(CROWN).dot(APPROACH_DIR.clone().negate()));
  if (coda.clean) sweepRadius = 0;
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);
  surgePulse = Math.max(0, surgePulse - dt * 0.85);
  damagePulse = Math.max(0, damagePulse - dt * 1.4);
  life += (lifeTarget - life) * Math.min(1, dt * 1.2);

  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;
  const camera = ctx.camera as PerspectiveCamera;

  // The bell reveal: one flash and a widening as the swing turns to face it.
  if (ctx.running && !bellRevealed && runTime >= BELL_TIME + 4.2) {
    bellRevealed = true;
    flashUniform.value = Math.max(flashUniform.value, 0.5);
    surgePulse = Math.max(surgePulse, 0.9);
    beatEnergy = Math.max(beatEnergy, 1.4);
  }

  // The coda starts on the Parent's death, or at the deadline regardless.
  if (ctx.running && !coda.active && (coda.clean || runTime >= DEADLINE_TIME)) startCoda(runTime, camera);
  if (ctx.running && coda.active) {
    const t = runTime - coda.startedAt;
    if (coda.clean) sweepRadius = Math.min(420, t * 62);
    sereneLevel = Math.min(1, t / 3);
  } else if (!ctx.running) {
    sereneLevel = coda.active ? 1 : 0;
  }

  environment?.update(dt, {
    camera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    speed,
    beatEnergy,
    life: ctx.running || coda.active ? life : 0.3,
    sweepRadius,
    serene: sereneLevel,
  });

  lifeUniform.value = life;
  damageUniform.value = Math.min(1, damagePulse * 0.55 + Math.min(1, hitsTaken / STRANDLINE_PLAYER_HEALTH) * 0.05);
  flashUniform.value = Math.max(0, flashUniform.value - dt * (flashUniform.value > 0.7 ? 1.4 : 2.4));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);
    const inner = innerGroup(record.mesh);

    if (record.kind === 'tick') {
      // Letting go: the legs fold, and a violet spark marks the moment.
      const latched = record.mesh.userData.latched === true;
      const legs = inner.userData.legs as Mesh[] | undefined;
      if (legs) {
        const swim = (record.mesh.userData.swim as number | undefined) ?? 0;
        for (const [index, leg] of legs.entries()) {
          const side = index < 3 ? -1 : 1;
          leg.rotation.z = side * (0.75 - swim * 0.55) + Math.sin(elapsedNow * 9 + index) * swim * 0.25;
        }
      }
      if (record.wasLatched && !latched) {
        record.wasLatched = false;
        record.lastDetachSparkAt = elapsedNow;
        burstSparks(record.mesh.position, hdr(PARASITE_VIOLET, 1.0), 6, 4, 0.5);
        spawnRing(record.mesh.position, hdr(PARASITE_VIOLET, 0.9), 2.4, 0.35);
      }
    } else if (record.kind === 'darter') {
      const vanes = inner.userData.vanes as Mesh[] | undefined;
      const wave = (record.mesh.userData.wave as number | undefined) ?? 0;
      if (vanes) {
        for (const [index, vane] of vanes.entries()) {
          vane.rotation.x = Math.sin(wave + index * 1.2) * 0.45;
        }
      }
    } else if (record.kind === 'spinner') {
      const lamp = inner.userData.chargeLamp as MeshBasicMaterial | undefined;
      const charge = (record.mesh.userData.charge as number | undefined) ?? 0;
      if (lamp && record.mesh.userData.locked !== true) {
        lamp.color.copy(PARASITE_MAGENTA.clone().lerp(CLEAN_WHITE, charge * 0.6)).multiplyScalar(0.8 + charge * 2.4);
      }
    } else if (record.kind === 'sac') {
      const swell = 1 + Math.max(0, Math.sin(elapsedNow * 2.6 + enemyId)) * 0.08 + beatEnergy * 0.05;
      inner.scale.setScalar((KIND_SCALE.sac ?? 1) * swell);
    } else if (record.kind === 'broodling') {
      const swim = (record.mesh.userData.swim as number | undefined) ?? 0;
      inner.scale.setScalar((KIND_SCALE.broodling ?? 1) * (1 + swim * 0.12));
    }

    if (record.mesh.userData.isParent) updateParentMesh(inner, elapsedNow, dt);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color, 0.35);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 1.6;
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
    dropTrail(record.mesh.position, record.trailColor, 0.45);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 3.6 : 0.7);
    const cilia = reticleSpinner.parent?.userData.cilia as Group | undefined;
    if (cilia) cilia.rotation.z -= dt * (active ? 1.8 : 0.4);
  }

  updateEffects(dt, ctx.camera);
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  // The coda: dolly straight back down the approach line, and keep going,
  // until the whole animal is in frame at the vista the level started on.
  let codaWiden = 0;
  if (ctx.running && coda.active) {
    const t = runTime - coda.startedAt;
    const span = Math.max(0.5, STRANDLINE_DURATION - coda.startedAt);
    const k = Math.min(1, t / span) ** 1.45;
    const distance = MathUtils.lerp(coda.fromDistance, VISTA_DISTANCE, k);
    camera.position.copy(approachPoint(distance));
    camera.updateMatrixWorld();
    codaWiden = k * 9;
  }

  // FOV breathes with the rail speed, kicks on the beat and the set pieces.
  const targetFovOffset = (speed - 0.9) * 6 + beatEnergy * 0.8 + surgePulse * 6.5 + codaWiden;
  cameraFovOffset = MathUtils.lerp(cameraFovOffset, targetFovOffset, Math.min(1, dt * 6));

  if (ctx.running && !coda.active) {
    // Bank into the rail's turns: threading between the strands.
    const u = strandlineRunProgress(ctx.runTime, STRANDLINE_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.005, 0, 1));
    const right = new Vector3().crossVectors(tangent, UP).normalize();
    const turnRight = ahead.dot(right);
    const targetRoll = MathUtils.clamp(turnRight * 34, -0.17, 0.17);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
  } else {
    cameraRoll += (0 - cameraRoll) * Math.min(1, dt * 2);
  }
  if (Math.abs(cameraRoll) > 0.0001) camera.rotateZ(cameraRoll);

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: STRANDLINE_CAMERA_SHAKE });
}

/** The attract camera: the vista, the whole animal drifting, a slow sway. */
export function updateAttractCamera(camera: PerspectiveCamera, modeTime: number) {
  const drift = new Vector3(
    Math.sin(modeTime * 0.31) * 1.6,
    Math.cos(modeTime * 0.23) * 1.1,
    Math.sin(modeTime * 0.19 + 1.2) * 1.4,
  );
  camera.position.copy(approachPoint(VISTA_DISTANCE)).add(drift);
  const look = approachPoint(VISTA_DISTANCE - 40).add(new Vector3(Math.sin(modeTime * 0.17) * 0.8, Math.cos(modeTime * 0.21) * 0.6, 0));
  camera.lookAt(look);
}

function innerGroup(mesh: Group): Group {
  const first = mesh.children[0];
  return first instanceof Group && mesh.userData === first.userData ? first : mesh;
}

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
  const userData = record.mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  const distance = record.mesh.position.distanceTo((ctx.camera as PerspectiveCamera).position);
  const closeness = smootherstep(1 - clamp01((distance - 14) / (60 - 14)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'fill' ? DENY_FILL : DENY_VIOLET);
      continue;
    }
    if (locked) {
      // Locked: the animal's light closes over the parasite.
      if (part.kind === 'edge') part.material.color.copy(hdr(JELLY_GOLD, 1.5));
      else if (part.kind === 'fill') part.material.color.copy(JELLY_GOLD.clone().multiplyScalar(0.22));
      else part.material.color.copy(hdr(CLEAN_WHITE, 1.9));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(CLEAN_WHITE, part.kind === 'fill' ? 0.5 : 1.8));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.55 + 0.45 * closeness : 0.45 + 0.55 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // A soft ring of the animal's light with three cilia arcs: a sting cell closing.
  const ring = new Mesh(
    new RingGeometry(0.78, 0.84, 40),
    createAdditiveBasicMaterial({ color: hdr(color, 1.6), side: DoubleSide }),
  );
  group.add(ring);
  for (let i = 0; i < 3; i += 1) {
    const arc = new Mesh(
      new RingGeometry(0.98, 1.06, 24, 1, (i / 3) * Math.PI * 2, Math.PI * 0.4),
      createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(CLEAN_WHITE, 0.4), 1.2), side: DoubleSide }),
    );
    group.add(arc);
  }
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
