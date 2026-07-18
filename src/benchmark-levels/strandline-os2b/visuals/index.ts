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
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { STRANDLINE_PLAYER_HEALTH, STRANDLINE_TIMELINE, strandlineRunProgress, strandlineSpeedAt } from '../gameplay';
import { DEEP_TIME, OPEN_WATER_TIME, SERENE_TIME, STRANDLINE_TIME } from '../timing';
import { BELL_CENTER } from '../world';
import {
  burstMotes,
  burstShards,
  createEffects,
  disposeEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createEnvironmentInternal, type Environment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  animateParasite,
  breakParentMantle,
  createBorerMesh,
  createBroodMesh,
  createClingMesh,
  createParentMesh,
  createSporeMesh,
  createSwarmerMesh,
  type TintPart,
} from './parasites';
import {
  BELL_RIM,
  BIO_GOLD,
  BIO_GREEN,
  LOCK_GRADIENT,
  LUMEN,
  PARASITE_HOT,
  PARASITE_SHELL,
  PARASITE_VIOLET,
  WEBBING,
  hdr,
} from './palette';
import { bloomFlashUniform, causticTimeUniform, causticUniform, infestUniform, revivalUniform } from './post-fx';

// The visual spine. It owns three decisions and delegates the rest: what
// colour a thing is at a given moment, what happens on screen when the player
// does something, and where the camera looks during the level's two authored
// moments — the wide arc where the animal comes into view, and the pull-back
// after the parent dies.

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export type CameraEffectsContext = {
  camera: PerspectiveCamera;
  runTime: number;
  feel: CameraFeelRig;
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = { mesh: Object3D };

const DENY_VIOLET = new Color(1.5, 0.18, 1.6);
const DENY_SHELL = new Color(0.24, 0.03, 0.3);

// Water absorbs impact: the frame moves like something heavy displacing it.
const STRANDLINE_SHAKE: CameraFeelShakeOptions = {
  decay: 2.1,
  maxTrauma: 1.6,
  pitchDegrees: 0.36,
  yawDegrees: 0.3,
  rollDegrees: 0.86,
  frequency: 6.4,
  smoothing: 15,
};

const COUNTED_TOTAL = Math.max(1, STRANDLINE_TIMELINE.filter((entry) => entry.countsTowardTotal !== false).length);
/** Full light arrives a little before a perfect clear, so good play is rewarded. */
const REVIVAL_TARGET = COUNTED_TOTAL * 0.82;

let environment: Environment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let hitsTaken = 0;
let killCount = 0;
let damagePulse = 0;
let revival = 0;
let parentDown = false;
let finale = 0;
let fovOffset = 0;
let cameraRoll = 0;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<{ mesh: Group; kind: string }, EnemyRecord>({
  createRecord: ({ mesh, kind }) => ({ mesh, kind, bornAt: null, lockRing: null }),
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

export function disposeEnvironment() {
  environment?.dispose();
  environment = null;
  disposeEffects();
}

const KIND_SCALE: Record<string, number> = {
  cling: 1.5,
  swarmer: 1.45,
  borer: 1.25,
  spore: 1.2,
  brood: 1.35,
};

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemyMesh(kind, letter);
  // Wrap so the spawn bloat animates the outer group while the inner group
  // keeps each silhouette's authored readability scale.
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
  enemyRecords.enqueue({ mesh, kind });
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A');
    case 'cling':
      return createClingMesh();
    case 'swarmer':
      return createSwarmerMesh();
    case 'borer':
      return createBorerMesh();
    case 'spore':
      return createSporeMesh();
    case 'brood':
      return createBroodMesh();
    case 'parent':
      return createParentMesh();
    default:
      return createClingMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, DENY_VIOLET.clone(), 3.2, 0.34);
}

// The player's shot is the one cold, hard thing in the level: a lance of pale
// light with no violet in it at all.
export function createProjectileMesh() {
  const group = new Group();
  const core = new OctahedronGeometry(0.26, 0);
  core.scale(0.5, 0.5, 2.6);
  group.add(new Mesh(core, new MeshBasicMaterial({ color: hdr(LUMEN, 2.8) })));
  const sheath = new OctahedronGeometry(0.46, 0);
  sheath.scale(0.6, 0.6, 2.1);
  group.add(new Mesh(sheath, createAdditiveBasicMaterial({ color: hdr(BIO_GREEN, 0.9), opacity: 0.5 })));
  projectileRecords.enqueue({ mesh: group });
  return group;
}

// ---- reticle ---------------------------------------------------------------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
  };

  // A medusa iris: an outer margin ring, six radial canals that light one per
  // lock, and a bright manubrium at the centre.
  const outer = new Mesh(new RingGeometry(0.66, 0.7, 44), new MeshBasicMaterial());
  addPart(outer, hdr(BIO_GREEN, 1.0));

  const canals = new Group();
  for (let i = 0; i < 6; i += 1) {
    const canal = new Mesh(new PlaneGeometry(0.035, 0.3), new MeshBasicMaterial());
    addPart(canal, hdr(BIO_GOLD, 0.9));
    const angle = (i / 6) * Math.PI * 2;
    canal.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0);
    canal.rotation.z = angle - Math.PI / 2;
    canals.add(canal);
  }

  const iris = new Mesh(new RingGeometry(0.24, 0.27, 3), new MeshBasicMaterial());
  addPart(iris, hdr(BELL_RIM, 1.1));

  const centre = new Mesh(new CircleGeometry(0.05, 14), new MeshBasicMaterial());
  addPart(centre, hdr(LUMEN, 2.0));

  group.add(outer, canals, iris, centre);
  group.userData.parts = parts;
  group.userData.spinner = iris;
  group.userData.canals = canals;
  group.userData.active = false;
  group.userData.isReticle = true;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
  const canals = reticle.userData.canals as Group | undefined;
  if (canals) {
    canals.children.forEach((canal, index) => {
      canal.scale.set(1, index < lockCount ? 1.6 : 0.65, 1);
    });
  }
}

// ---- event wiring ----------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'parent') {
      // The crown shows what has been living in it. The water shoves.
      feel.shake(1.15, STRANDLINE_SHAKE);
      bloomFlashUniform.value = Math.max(bloomFlashUniform.value, 0.3);
      spawnRing(worldPosition, hdr(PARASITE_VIOLET, 1.4), 26, 0.95);
      spawnRing(worldPosition, hdr(WEBBING, 1.0), 15, 0.7);
      burstMotes(worldPosition, hdr(PARASITE_VIOLET, 0.9), 13, 11, { life: 1.6, size: 0.64 });
    } else if (kind === 'brood') {
      spawnRing(worldPosition, hdr(PARASITE_HOT, 1.2), 5.5, 0.55);
    } else if (kind === 'spore') {
      spawnRing(worldPosition, hdr(PARASITE_HOT, 1.1), 2.2, 0.28);
    } else if (kind !== 'letter') {
      // Everything else arrives as a small displacement of the water.
      spawnRing(worldPosition, hdr(BIO_GREEN, 0.42), 2.6, 0.42);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.4), 2.1, 0.24);
    if (lockCount >= 6) {
      spawnGlint(worldPosition, hdr(LUMEN, 1.8), 2.4, 0.24);
      feel.kickFov(-1.7, { decay: 5.5 });
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(LUMEN, 1.2), 0.7, 0.13);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    // Impacts in water disperse rather than spark.
    burstMotes(worldPosition, hdr(LUMEN, 0.9), 3, 7, { life: 0.5, size: 0.26, buoyancy: 0.4 });
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.damageFlashUntil = elapsedNow + 0.26;
      spawnGlint(worldPosition, hdr(LUMEN, 1.6), 1.1, 0.14);
      burstMotes(worldPosition, hdr(PARASITE_VIOLET, 0.8), 4, 9, { life: 0.8, size: 0.3 });
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.isParent) {
      // The mantle comes off; the hold underneath is what is actually gripping.
      breakParentMantle(record.mesh);
      const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
      if (specs) burstShards(worldPosition, specs.slice(0, 10), 13);
      feel.shake(1.1, STRANDLINE_SHAKE);
      bloomFlashUniform.value = Math.max(bloomFlashUniform.value, 0.34);
      spawnRing(worldPosition, hdr(PARASITE_HOT, 1.5), 22, 0.8);
      burstMotes(worldPosition, hdr(PARASITE_VIOLET, 1.0), 14, 15, { life: 1.4, size: 0.56 });
    } else {
      spawnRing(worldPosition, hdr(PARASITE_HOT, 1.1), 4.4, 0.4);
      burstMotes(worldPosition, hdr(PARASITE_VIOLET, 0.8), 5, 10, { life: 0.9, size: 0.34 });
    }
  });

  bus.on('shielded', ({ shields }) => {
    // The webbing takes the shot. It is the one thing in the level that
    // refuses the player, so it answers loudly and in its own colour.
    for (const shield of shields) {
      spawnRing(shield.worldPosition, hdr(WEBBING, 1.6), 11, 0.42);
      spawnRing(shield.worldPosition, hdr(PARASITE_VIOLET, 1.2), 6.5, 0.3);
      burstMotes(shield.worldPosition, hdr(WEBBING, 1.1), 7, 9, { life: 0.7, size: 0.38, buoyancy: 0.2 });
    }
    feel.shake(0.32, STRANDLINE_SHAKE);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? PARASITE_VIOLET;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;

    if (record.mesh.userData.isParent) {
      // Torn loose. The animal's own light takes over the frame.
      parentDown = true;
      revival = 1;
      if (specs) burstShards(worldPosition, specs, 17);
      burstMotes(worldPosition, hdr(PARASITE_VIOLET, 1.1), 26, 22, { life: 2.4, size: 0.8 });
      burstMotes(worldPosition, hdr(BIO_GOLD, 1.3), 22, 17, { life: 3.0, size: 0.66, buoyancy: 2.4 });
      spawnRing(worldPosition, hdr(LUMEN, 1.6), 70, 1.5);
      spawnRing(worldPosition, hdr(BIO_GREEN, 1.3), 44, 1.1);
      spawnRing(worldPosition, hdr(BIO_GOLD, 1.1), 26, 0.85);
      spawnGlint(worldPosition, hdr(LUMEN, 2.4), 8, 0.6);
      bloomFlashUniform.value = 1;
      feel.shake(1.6, STRANDLINE_SHAKE);
    } else if (record.kind === 'letter') {
      if (specs) burstShards(worldPosition, specs, 7);
      burstMotes(worldPosition, hdr(BIO_GOLD, 1.0), 5, 7, { life: 0.9, size: 0.3 });
      spawnRing(worldPosition, hdr(BIO_GREEN, 0.9), 3.2, 0.36);
    } else {
      killCount += 1;
      if (specs) burstShards(worldPosition, specs, record.kind === 'brood' ? 12 : 9);
      // Parasite matter disperses violet; the strand it held lights back up.
      burstMotes(worldPosition, hdr(accent, 0.95), record.kind === 'brood' ? 12 : 6, 11, { life: 1.2, size: 0.38 });
      burstMotes(worldPosition, hdr(BIO_GOLD, 1.0), 4, 6, { life: 1.5, size: 0.28, buoyancy: 2.0 });
      spawnRing(worldPosition, hdr(BIO_GREEN, 0.9), record.kind === 'brood' ? 8 : 4.6, 0.45);
      spawnGlint(worldPosition, hdr(LUMEN, 1.3), 1.3, 0.16);
      environment?.flareNear(worldPosition, record.kind === 'brood' ? 1.2 : 0.55);
      if (record.kind === 'brood') feel.shake(0.4, STRANDLINE_SHAKE);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    // A parasite that got away leaves only a dark smudge in the water.
    burstMotes(worldPosition, hdr(PARASITE_SHELL, 1.4), 3, 3, { life: 0.8, size: 0.26, buoyancy: 0.2 });
  });

  bus.on('reject', () => {
    infestUniform.value = Math.max(infestUniform.value, 0.4);
    feel.shake(0.28, STRANDLINE_SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.6);
      bloomFlashUniform.value = Math.max(bloomFlashUniform.value, 0.16);
      feel.kickFov(2.4, { decay: 3.4 });
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
    damagePulse = 1;
    infestUniform.value = 0.85;
    feel.shake(1.25, STRANDLINE_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    hitsTaken = 0;
    killCount = 0;
    revival = 0;
    damagePulse = 0;
    parentDown = false;
    finale = 0;
    fovOffset = 0;
    cameraRoll = 0;
    bloomFlashUniform.value = 0;
    infestUniform.value = 0;
    revivalUniform.value = 0;
    feel.restore();
  });

  bus.on('runend', () => {
    feel.restore();
  });

  void scene;
}

// ---- per-frame update ------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.4);
  damagePulse = Math.max(0, damagePulse - dt * 1.4);

  const runTime = ctx.running ? ctx.runTime : 0;
  const progress = ctx.running ? strandlineRunProgress(runTime) : 0;

  // The infestation clearing is the level's one continuous state: it drives
  // strand light, bell light, and the whole colour grade.
  const target = parentDown ? 1 : MathUtils.clamp(killCount / REVIVAL_TARGET, 0, 1);
  revival += (target - revival) * Math.min(1, dt * 1.6);

  // The coda: on the killing blow — or at the last phrase regardless — the
  // water opens up and the camera falls away from the animal.
  const codaActive = ctx.running && (parentDown || runTime >= SERENE_TIME + 1.4);
  finale = MathUtils.clamp(finale + (codaActive ? dt / 3.6 : -dt * 2), 0, 1);

  environment?.update(dt, {
    camera: ctx.camera,
    elapsed: ctx.elapsed,
    runTime,
    running: ctx.running,
    progress,
    beatEnergy,
    revival,
    finale,
  });

  // Post grade. Caustics strengthen where the water is clear — the wide arc
  // and the final shot — and violet closes in with hull damage.
  causticTimeUniform.value = ctx.elapsed * 0.85;
  const clarity = ctx.running ? Math.max(bump(runTime, OPEN_WATER_TIME, DEEP_TIME), finale) : 0.4;
  causticUniform.value = 0.1 + clarity * 0.22 + beatEnergy * 0.03;
  revivalUniform.value = revival;
  infestUniform.value = Math.max(
    infestUniform.value - dt * 1.9,
    Math.min(0.5, damagePulse * 0.45 + (hitsTaken / STRANDLINE_PLAYER_HEALTH) * 0.12),
  );
  bloomFlashUniform.value = Math.max(0, bloomFlashUniform.value - dt * (bloomFlashUniform.value > 0.6 ? 0.9 : 2.1));

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Parasites bloat into existence rather than snapping in.
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.42)));

    animateParasite(record.mesh, record.kind, elapsedNow);
    updateEnemyTint(record, ctx.camera);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color, 0.4);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 1.3;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar((1 + Math.sin(elapsedNow * 7) * 0.05) * 1.85 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, hdr(BIO_GREEN, 0.7), 0.26);
  }

  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const active = reticle.userData.active === true;
    const spinner = reticle.userData.spinner as Mesh | undefined;
    if (spinner) spinner.rotation.z += dt * (active ? 2.6 : 0.7);
    const canals = reticle.userData.canals as Group | undefined;
    if (canals) canals.rotation.z -= dt * (active ? 1.1 : 0.28);
  }

  updateEffects(dt, ctx.camera);
}

// ---- camera ----------------------------------------------------------------

// A camera, not a plain Object3D: three's lookAt points +Z at the target for
// ordinary objects and -Z for cameras, and we want the camera convention.
const lookDummy = new PerspectiveCamera();
const bellLookPoint = BELL_CENTER.clone().setY(BELL_CENTER.y - 46);
// A three-quarter vantage on the whole animal, for the final pull-back.
const codaVantage = BELL_CENTER.clone().add(new Vector3(0.62, -0.34, 0.7).normalize().multiplyScalar(300));
// The reveal owns a hole punched in the spawn timeline: three seconds where
// nothing is shootable, so the camera can hand the frame to the animal.
const REVEAL_FROM = OPEN_WATER_TIME + STRANDLINE_TIME.beats(1.6);
const REVEAL_TO = OPEN_WATER_TIME + STRANDLINE_TIME.beats(6.6);

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  const camera = ctx.camera;
  const speed = strandlineSpeedAt(ctx.runTime);

  // Open water: the forest falls away and the level shows you the animal. The
  // look bias is gentle and eases out at both ends, so aiming stays the
  // player's — it biases the frame rather than taking it.
  const reveal = bump(ctx.runTime, REVEAL_FROM, REVEAL_TO);
  if (reveal > 0.001 && finale <= 0.001) {
    lookDummy.position.copy(camera.position);
    lookDummy.up.set(0, 1, 0);
    lookDummy.lookAt(bellLookPoint);
    camera.quaternion.slerp(lookDummy.quaternion, reveal * 0.9);
  }

  // A slow lean, the way a swimmer holds a turn.
  cameraRoll += (Math.sin(ctx.runTime * 0.31) * 0.04 - cameraRoll) * Math.min(1, dt * 1.4);
  camera.rotateZ(cameraRoll);

  // The coda: the camera lets go of the rail and falls away until the whole
  // animal is in frame for the first time. The lens widens as it goes.
  if (finale > 0.001) {
    const eased = finale * finale * (3 - 2 * finale);
    camera.position.lerp(codaVantage, eased);
    lookDummy.position.copy(camera.position);
    lookDummy.up.set(0, 1, 0);
    lookDummy.lookAt(BELL_CENTER);
    camera.quaternion.slerp(lookDummy.quaternion, eased);
  }

  const targetFov = (speed - 0.95) * 6.4 + beatEnergy * 0.8 + reveal * 7.5 + finale * 26;
  fovOffset += (targetFov - fovOffset) * Math.min(1, dt * 3.2);
  ctx.feel.setFovOffset(fovOffset);
  ctx.feel.update(dt, { shake: STRANDLINE_SHAKE });
}

/** Attract mode: hanging in the strands, breathing, looking down the swim. */
export function updateAttractCamera(camera: PerspectiveCamera, curve: CatmullRomCurve3, modeTime: number) {
  const base = curve.getPointAt(0.012);
  camera.position.copy(base).add(new Vector3(
    Math.sin(modeTime * 0.34) * 1.7,
    Math.cos(modeTime * 0.27) * 1.1 + 1.4,
    Math.sin(modeTime * 0.21) * 0.9,
  ));
  const look = curve.getPointAt(0.075);
  camera.lookAt(
    look.x + Math.sin(modeTime * 0.23) * 3.6,
    look.y + 2.6 + Math.cos(modeTime * 0.19) * 1.7,
    look.z,
  );
}

function updateEnemyTint(record: EnemyRecord, camera: PerspectiveCamera) {
  const userData = record.mesh.userData;
  const denied = ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const parts = userData.parts as TintPart[] | undefined;
  if (!parts) return;

  // Additive stacks quiet down with distance, so a far parasite reads as
  // silhouette and a near one as hot violet — the same body at two ranges.
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smoothstep(1 - clamp01((distance - 14) / 52));
  const locked = userData.locked === true;
  const damageFlash = ((userData.damageFlashUntil as number | undefined) ?? -Infinity) > elapsedNow;
  const pulse = (userData.pulse as number | undefined) ?? 0.5;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'shell' ? DENY_SHELL : DENY_VIOLET);
      continue;
    }
    if (locked) {
      if (part.kind === 'core') part.material.color.copy(hdr(LUMEN, 2.2));
      else if (part.kind === 'plate') part.material.color.copy(hdr(BIO_GOLD, 1.35));
      else part.material.color.copy(hdr(BIO_GREEN, 0.24));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(LUMEN, part.kind === 'shell' ? 0.6 : 2.0));
      continue;
    }
    const dim = part.kind === 'core'
      ? 0.45 + 0.55 * closeness + pulse * 0.35
      : part.kind === 'plate'
        ? 0.34 + 0.66 * closeness
        : 0.55 + 0.45 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) if (child.userData.isReticle) return child;
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  // A ring of medusa light closing on the target, with three margin ticks.
  const ring = new Mesh(
    new RingGeometry(0.82, 0.87, 40),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  const ticks = new Mesh(
    new RingGeometry(0.94, 1.04, 3),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(LUMEN, 0.45), 1.3), side: DoubleSide }),
  );
  group.add(ring, ticks);
  return group;
}

/** 1 through the middle of [from, to], 0 outside, eased at both ends. */
function bump(value: number, from: number, to: number) {
  if (value <= from || value >= to) return 0;
  const t = (value - from) / (to - from);
  return smoothstep(clamp01(Math.min(t, 1 - t) * 3.2));
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
