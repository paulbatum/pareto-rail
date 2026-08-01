import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
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
import { createVespersRail, roseAnchor, vespersRunProgress, VESPERS_RUN_DURATION } from '../gameplay';
import {
  createCenserMesh,
  createChoirMesh,
  createCoreMesh,
  createHeraldMesh,
  createPaneMesh,
  createProjectileMesh as buildProjectile,
  createThornMesh,
  createWispMesh,
  type CoreGem,
  type TintPart,
} from './enemies';
import {
  burstGlass,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  spawnStreak,
  updateEffects,
} from './effects';
import {
  createEnvironmentInternal,
  markRoseAsWindow,
  nextUnlitWindow,
  relightWindow,
  updateWindowFlash,
  type Environment,
} from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { BLOOD, COBALT, GOLD, hdr, LOCK_GRADIENT, STONE_EDGE, WHITE_HOT, WINDOW_PALETTE } from './palette';
import { flashRed, flashWarmth } from './post-fx';

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runProgress?: number;
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
  bornAt: number | null;
  lockRing: Group | null;
  accent: Color;
  baseParts: Array<TintPart & { base: Color }>;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

const VESPERS_CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.6,
  maxTrauma: 1.8,
  pitchDegrees: 0.32,
  yawDegrees: 0.26,
  rollDegrees: 0.7,
  frequency: 8.5,
  smoothing: 20,
};

let environment: Environment | null = null;
let atmosphere: ((progress: number) => void) | null = null;
let beatEnergy = 0;
let cameraRoll = 0;
let cameraFovOffset = 0;
let elapsedNow = 0;
let paneColourIndex = 0;

const rail = createVespersRail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({
    mesh,
    bornAt: null,
    lockRing: null,
    accent: (mesh.userData.accent as Color | undefined) ?? WHITE_HOT.clone(),
    baseParts: (mesh.userData.parts as TintPart[] | undefined)?.map((part) => ({
      ...part,
      base: part.material.color.clone(),
    })) ?? [],
  }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  markRoseAsWindow(environment.rose);
  atmosphere = environment.atmosphere;
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
      return createLetterMesh(letter ?? 'E');
    case 'pane':
      return createPaneMesh(nextWindowColour());
    case 'censer':
      return createCenserMesh(nextWindowColour());
    case 'choir':
      return createChoirMesh(nextWindowColour());
    case 'herald':
      return createHeraldMesh(nextWindowColour());
    case 'wisp':
      return createWispMesh();
    case 'thorn':
      return createThornMesh(nextWindowColour());
    case 'core':
      return createCoreMesh();
    default:
      return createPaneMesh(nextWindowColour());
  }
}

function nextWindowColour(): Color {
  return WINDOW_PALETTE[paneColourIndex++ % WINDOW_PALETTE.length].clone();
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnRing(mesh.position, hdr(BLOOD, 1.0), 2.6, 0.3);
}

export function createProjectileMesh() {
  const mesh = buildProjectile();
  projectileRecords.enqueue({ mesh, trailColor: GOLD.clone().multiplyScalar(0.9) });
  return mesh;
}

// ---- reticle: a thin gold ring, like candlelight held on a target. -------

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];

  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base });
    return material;
  };

  const outer = new Mesh(new RingGeometry(0.58, 0.62, 48), new MeshBasicMaterial());
  addPart(outer, hdr(GOLD, 1.1));

  const spinner = new Group();
  // A four-point star — the light of the nave, turning on the target.
  const starGeometry = new PlaneGeometry(1.0, 0.09);
  for (const rotation of [0, Math.PI / 2]) {
    const blade = new Mesh(starGeometry, new MeshBasicMaterial());
    blade.rotation.z = rotation;
    addPart(blade, hdr(WHITE_HOT, 0.95));
    spinner.add(blade);
  }

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.19, 0.035), new MeshBasicMaterial());
    addPart(tick, hdr(GOLD, 1.3));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 18), new MeshBasicMaterial());
  addPart(dot, hdr(WHITE_HOT, 2.0));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, [...LOCK_GRADIENT_COLORS]);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.7 : 1.3));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
}

// ---- event wiring -----------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'core') {
      cameraFeel.shake(1.2, VESPERS_CAMERA_SHAKE);
      spawnRing(worldPosition, hdr(WHITE_HOT, 1.2), 26, 0.9);
      spawnRing(worldPosition, hdr(GOLD, 0.9), 14, 0.7);
    } else if (kind === 'wisp') {
      spawnRing(worldPosition, hdr(BLOOD, 0.7), 1.8, 0.3);
    } else {
      spawnRing(worldPosition, hdr(record.accent, 0.8), 2.8, 0.45);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [...LOCK_GRADIENT_COLORS]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.2, 0.28);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(WHITE_HOT, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (!lethal) {
      if (record) record.mesh.userData.damageFlashUntil = elapsedNow + 0.35;
      spawnGlint(worldPosition, hdr(WHITE_HOT, 1.8), 1.1, 0.16);
      spawnRing(worldPosition, hdr(GOLD, 1.1), 3.4, 0.3);
      // Chipping the Devourer spills one of the colours it holds.
      if (record?.mesh.userData.gems) spillCoreGem(record, worldPosition);
    }
    burstSparks(worldPosition, hdr(WHITE_HOT, 0.9), 5, 8);
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    record.mesh.userData.damageLevel = Math.max(record.mesh.userData.damageLevel ?? 0, 1);
    if (record.mesh.userData.gems) {
      // The shell breaks: two more colours leave it at once.
      spillCoreGem(record, worldPosition);
      spillCoreGem(record, worldPosition);
    }
    spawnRing(worldPosition, hdr(GOLD, 1.4), 5.6, 0.5);
    burstSparks(worldPosition, hdr(record.accent, 1.1), 14, 10);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const accent = record.accent;
      if (record.mesh.userData.kind === 'pane' && environment) {
        // The light goes back where it belongs: a streak flies to the next
        // dead window and lights it for the rest of the run.
        burstGlass(worldPosition, accent, 9);
        const target = nextUnlitWindow(environment.windows);
        if (target) {
          spawnStreak(worldPosition, target.position, hdr(accent, 1.4));
          relightWindow(target, accent, elapsedNow);
        }
        spawnGlint(worldPosition, hdr(WHITE_HOT, 1.4), 1.2, 0.18);
      } else if (record.mesh.userData.kind === 'core' && environment) {
        igniteRose(record, worldPosition, cameraFeel);
      } else {
        burstSparks(worldPosition, hdr(accent, 1.0), 8, 12);
        spawnRing(worldPosition, hdr(accent, 0.9), 4.6, 0.42);
        spawnGlint(worldPosition, hdr(WHITE_HOT, 1.5), 1.1, 0.16);
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId, { dispose: true });
      burstSparks(worldPosition, STONE_EDGE.clone().multiplyScalar(0.8), 3, 3);
    }
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.shieldFlashUntil = elapsedNow + 0.6;
      spawnRing(shield.worldPosition, hdr(GOLD, 1.3), 4.6, 0.4);
      spawnRing(shield.worldPosition, hdr(BLOOD, 0.7), 2.4, 0.26);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) beatEnergy = Math.max(beatEnergy, 1.4);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    flashRed.value = Math.max(flashRed.value, 0.55);
    cameraFeel.shake(1.3, VESPERS_CAMERA_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    paneColourIndex = 0;
    beatEnergy = 0;
    flashWarmth.value = 0;
    flashRed.value = 0;
    if (environment) {
      resetWindows(environment);
      resetRose(environment.rose);
    }
  });
}

function igniteRose(record: EnemyRecord, worldPosition: Vector3, cameraFeel: CameraFeelRig) {
  if (!environment) return;
  // The biggest event in the level: every colour it swallowed pours out and
  // the dead rose window ignites all at once.
  const gems = record.mesh.userData.gems as CoreGem[] | undefined;
  if (gems) {
    for (const gem of gems) {
      burstSparks(worldPosition, hdr(gem.colour, 1.4), 6, 16);
    }
  }
  cameraFeel.shake(1.7, VESPERS_CAMERA_SHAKE);
  beatEnergy = 1.6;
  flashWarmth.value = Math.max(flashWarmth.value, 1.1);
  const centre = roseAnchor();
  spawnRing(centre, hdr(WHITE_HOT, 1.6), 80, 1.8);
  spawnRing(centre, hdr(GOLD, 1.3), 46, 1.3);
  spawnRing(centre, hdr(COBALT, 1.0), 26, 1.0);
  burstSparks(centre, hdr(GOLD, 1.3), 40, 18);
  environment.rose.ignited = true;
  environment.rose.igniteAt = elapsedNow;
}

function spillCoreGem(record: EnemyRecord, worldPosition: Vector3) {
  const gems = record.mesh.userData.gems as CoreGem[] | undefined;
  if (!gems) return;
  const gem = gems.find((candidate) => candidate.mesh.visible);
  if (!gem) return;
  gem.mesh.visible = false;
  burstSparks(worldPosition, hdr(gem.colour, 1.5), 10, 14);
  spawnRing(worldPosition, hdr(gem.colour, 1.1), 5.2, 0.45);
}

function resetWindows(env: Environment) {
  for (const window of env.windows) {
    if (!window.lit) continue;
    window.lit = false;
    (window.fill.material as MeshBasicMaterial).color.set(0.008, 0.01, 0.022);
    window.glow.visible = false;
    window.pool.visible = false;
    (window.frame.material as LineBasicMaterial).color.copy(STONE_EDGE);
  }
  // The two entrance windows are always lit.
  relightWindow(env.windows[0], COBALT, 0);
  relightWindow(env.windows[1], GOLD, 0);
}

function resetRose(rose: Environment['rose']) {
  rose.ignited = false;
  rose.litCount = 0;
  for (const petal of rose.petals) {
    petal.lit = false;
    petal.material.color.copy(new Color(0.018, 0.02, 0.038));
  }
  for (const material of rose.ringMaterials) material.color.copy(new Color(0.035, 0.04, 0.07));
  rose.centreGlow.visible = false;
}

// ---- per-frame update ---------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.2);

  if (environment) {
    environment.candleFlicker.value = elapsedNow * 1.4;
    atmosphere?.(ctx.runProgress ?? 0);
    for (const window of environment.windows) {
      if (window.lit) updateWindowFlash(window, elapsedNow);
    }
    animateRose(environment.rose);
  }

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    updateEnemyTint(record, ctx);

    // The Devourer's stolen colours swirl in its chest.
    const gems = record.mesh.userData.gems as CoreGem[] | undefined;
    if (gems) {
      for (let i = 0; i < gems.length; i += 1) {
        if (!gems[i].mesh.visible) continue;
        const angle = elapsedNow * 0.85 + (i / gems.length) * Math.PI * 2;
        gems[i].mesh.position.set(Math.cos(angle) * 3.35, Math.sin(angle) * 3.35 * 0.8, 0.3);
        gems[i].mesh.rotation.y += dt * 1.4;
      }
    }

    // The dark heart of the rose bursts once the core is exposed.
    const shell = record.mesh.userData.shell as Object3D | undefined;
    if (shell && shell.visible && record.mesh.userData.exposed === true) {
      if (record.mesh.userData.shellBurst !== true) {
        record.mesh.userData.shellBurst = true;
        spawnRing(record.mesh.position, hdr(GOLD, 1.2), 10, 0.6);
        spawnGlint(record.mesh.position, hdr(WHITE_HOT, 1.6), 2.4, 0.25);
      }
      const next = shell.scale.x - dt * 2.4;
      if (next <= 0.02) shell.visible = false;
      else shell.scale.setScalar(next);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.5;
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
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 5 : 1.1);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 3.2 : 0.7);
  }

  updateEffects(dt, ctx.camera);
}

function animateRose(rose: Environment['rose']) {
  if (!rose.ignited) return;
  const since = elapsedNow - rose.igniteAt;
  const target = Math.min(rose.petals.length, Math.floor(since / 0.055));
  while (rose.litCount < target) {
    const petal = rose.petals[rose.litCount];
    petal.lit = true;
    petal.material.color.copy(hdr(petal.colour, 1.25));
    rose.litCount += 1;
  }
  const ringBright = Math.min(1, since / 0.7);
  for (const material of rose.ringMaterials) {
    material.color.copy(hdr(GOLD, 0.25 + ringBright * 0.8));
  }
  rose.centreGlow.visible = true;
  (rose.centreGlow.material as MeshBasicMaterial).color.copy(hdr(WHITE_HOT, ringBright * 1.3));
  rose.centreGlow.scale.setScalar(1 + Math.sin(elapsedNow * 7) * 0.04);
}

function updateEnemyTint(record: EnemyRecord, ctx: VisualContext) {
  const userData = record.mesh.userData;
  const denied = (userData.deniedUntil as number | undefined ?? -Infinity) > elapsedNow;

  if (userData.isLetter) {
    if (denied) setLetterDenied(record.mesh, true);
    else if (userData.locked !== true) setLetterLocked(record.mesh, false);
    return;
  }

  const distance = record.mesh.position.distanceTo(ctx.camera.position);
  const closeness = smootherstep(1 - clamp01((distance - 16) / (54 - 16)));
  const locked = userData.locked === true;
  const damageFlash = (userData.damageFlashUntil as number | undefined ?? -Infinity) > elapsedNow;
  const shieldFlash = (userData.shieldFlashUntil as number | undefined ?? -Infinity) > elapsedNow;

  for (const part of record.baseParts) {
    if (denied) {
      part.material.color.copy(part.kind === 'core' ? hdr(BLOOD, 1.6) : hdr(BLOOD, 0.45));
      continue;
    }
    if (locked) {
      if (part.kind === 'core') part.material.color.copy(hdr(WHITE_HOT, 2.2));
      else if (part.kind === 'edge') part.material.color.copy(hdr(GOLD, 1.1));
      else part.material.color.copy(hdr(COBALT, 0.4));
      continue;
    }
    if (damageFlash) {
      part.material.color.copy(hdr(WHITE_HOT, part.kind === 'core' ? 2.4 : 0.7));
      continue;
    }
    if ((userData.damageLevel as number | undefined ?? 0) > 0) {
      // Armour broken: the held light blazes out through the crack.
      if (part.kind === 'core') part.material.color.copy(hdr(part.base, 2.6));
      else if (part.kind === 'edge') part.material.color.copy(hdr(GOLD, 0.5));
      else part.material.color.copy(part.base).multiplyScalar(0.85);
      continue;
    }
    if (shieldFlash && (part.kind === 'edge' || part.kind === 'core')) {
      part.material.color.copy(hdr(GOLD, 1.2 + Math.sin(elapsedNow * 22) * 0.4));
      continue;
    }
    const dim = part.kind === 'edge' ? 0.6 + 0.4 * closeness : part.kind === 'core' ? 0.4 + 0.6 * closeness : 0.7 + 0.3 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const targetFovOffset = beatEnergy * 1.0 + (ctx.running ? 0.5 : 0);
  cameraFovOffset += (targetFovOffset - cameraFovOffset) * Math.min(1, dt * 5);

  if (ctx.running) {
    // Bank into the rail's turns — purely cosmetic, kept modest.
    const u = MathUtils.clamp(vespersRunProgress(ctx.runTime, VESPERS_RUN_DURATION), 0, 1);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 30, -0.14, 0.14);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3.2);
    camera.rotateZ(cameraRoll);
  }

  ctx.feel.setFovOffset(cameraFovOffset);
  ctx.feel.update(dt, { shake: VESPERS_CAMERA_SHAKE });
}

export function updatePostUniforms(dt: number) {
  flashWarmth.value = Math.max(0, flashWarmth.value - dt * (flashWarmth.value > 0.7 ? 1.1 : 2.0));
  flashRed.value = Math.max(0, flashRed.value - dt * 1.6);
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
    new RingGeometry(0.66, 0.69, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WHITE_HOT, 0.55), 1.4), side: DoubleSide }),
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

// LOCK_GRADIENT is a readonly tuple of Color; the lock helpers want Color[].
const LOCK_GRADIENT_COLORS: Color[] = LOCK_GRADIENT.map((colour) => colour.clone());
