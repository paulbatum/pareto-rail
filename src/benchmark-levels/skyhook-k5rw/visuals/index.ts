import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  FogExp2,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  RingGeometry,
  Scene,
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
import { createSkyhookRail, railU, skyhookRunProgress, speedFactorAt } from '../gameplay';
import { CONTACT_TIME, DECK_TIME, DOCK_TIME, QUIET_TIME, SIGHTING_TIME, SKYHOOK_DURATION } from '../timing';
import {
  breakLimpetShell,
  createCoreMesh,
  createGrapnelMesh,
  createKiteMesh,
  createLimpetMesh,
  createShrikeMesh,
  createSlugMesh,
  createSparMesh,
  type TintPart,
} from './enemies';
import {
  beaconUniform,
  beatUniform,
  cloudOpacityUniform,
  createEnvironmentInternal,
  deckOpacityUniform,
  skyGroundUniform,
  skyHorizonUniform,
  skyZenithUniform,
  starsUniform,
  streakGlowUniform,
  streakLengthUniform,
  streakOffsetUniform,
  sunGlowUniform,
  updateBackdrop,
  type Environment,
} from './environment';
import {
  burstPlating,
  burstSparks,
  createEffects,
  dropTrail,
  resetEffects,
  spawnGlint,
  spawnRing,
  updateEffects,
  type ShardSpec,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  AMBER,
  FAULT,
  HAZARD,
  HAZE_BREAK,
  HAZE_HIGH,
  HAZE_STORM,
  HAZE_THIN,
  hdr,
  ICE,
  LOCK_GRADIENT,
  PALE,
  PANEL,
  SKY_BREAK,
  SKY_HIGH,
  SKY_STORM,
  SKY_THIN,
  SKY_VOID,
  STEEL,
} from './palette';
import { strainPhaseUniform, strainUniform, whiteoutTintUniform, whiteoutUniform } from './post-fx';

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
  bornAt: number | null;
  bracket: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

// ---- the colour arc ------------------------------------------------------------

// This table is the level. Every visible property of the sky, the air, and the
// speed cues is a keyframe on altitude in metres, from the anchor at 0 to the
// station at the top of the rail. Reading down the columns is reading the climb:
// haze thins, stars come up, weather runs out, the sun goes hard and small.
type SkyKey = {
  altitude: number;
  horizon: Color;
  zenith: Color;
  ground: Color;
  fog: Color;
  density: number;
  stars: number;
  sun: number;
  cloud: number;
  deck: number;
  streakGlow: number;
  streakLength: number;
  planetDegrees: number;
};

const SKY_KEYS: SkyKey[] = [
  {
    altitude: 0,
    horizon: HAZE_STORM, zenith: SKY_STORM, ground: new Color(0.09, 0.1, 0.11),
    fog: new Color(0.17, 0.185, 0.21), density: 0.0085,
    stars: 0, sun: 0.05, cloud: 0.17, deck: 0, streakGlow: 0.5, streakLength: 1.7, planetDegrees: 86,
  },
  {
    altitude: 62,
    horizon: new Color(0.21, 0.23, 0.26), zenith: new Color(0.165, 0.183, 0.218), ground: new Color(0.094, 0.104, 0.114),
    fog: new Color(0.26, 0.28, 0.31), density: 0.0118,
    stars: 0, sun: 0.09, cloud: 0.19, deck: 0.05, streakGlow: 0.58, streakLength: 1.9, planetDegrees: 84.8,
  },
  {
    altitude: 100,
    horizon: new Color(0.2, 0.22, 0.25), zenith: new Color(0.18, 0.2, 0.24), ground: new Color(0.1, 0.11, 0.12),
    fog: new Color(0.33, 0.35, 0.38), density: 0.0135,
    stars: 0, sun: 0.14, cloud: 0.2, deck: 0.3, streakGlow: 0.62, streakLength: 2.0, planetDegrees: 84,
  },
  {
    altitude: 142,
    horizon: HAZE_BREAK, zenith: SKY_BREAK, ground: new Color(0.5, 0.54, 0.6),
    fog: new Color(0.6, 0.63, 0.68), density: 0.0045,
    stars: 0, sun: 0.5, cloud: 0.15, deck: 0.28, streakGlow: 0.44, streakLength: 1.4, planetDegrees: 82,
  },
  {
    altitude: 192,
    horizon: new Color(0.62, 0.7, 0.82), zenith: new Color(0.34, 0.5, 0.74), ground: new Color(0.42, 0.48, 0.56),
    fog: new Color(0.55, 0.62, 0.71), density: 0.003,
    stars: 0.02, sun: 0.56, cloud: 0.06, deck: 0.1, streakGlow: 0.36, streakLength: 1.2, planetDegrees: 79,
  },
  {
    altitude: 260,
    horizon: new Color(0.5, 0.62, 0.8), zenith: new Color(0.24, 0.4, 0.7), ground: new Color(0.34, 0.42, 0.52),
    fog: new Color(0.5, 0.6, 0.74), density: 0.0016,
    stars: 0.06, sun: 0.6, cloud: 0, deck: 0, streakGlow: 0.3, streakLength: 1.1, planetDegrees: 76,
  },
  {
    altitude: 400,
    horizon: HAZE_HIGH, zenith: SKY_HIGH, ground: new Color(0.2, 0.26, 0.36),
    fog: new Color(0.2, 0.3, 0.46), density: 0.0006,
    stars: 0.45, sun: 0.64, cloud: 0, deck: 0, streakGlow: 0.2, streakLength: 0.8, planetDegrees: 68,
  },
  {
    altitude: 530,
    horizon: HAZE_THIN, zenith: SKY_THIN, ground: new Color(0.08, 0.13, 0.22),
    fog: new Color(0.07, 0.12, 0.2), density: 0.00022,
    stars: 0.8, sun: 0.68, cloud: 0, deck: 0, streakGlow: 0.13, streakLength: 0.6, planetDegrees: 62,
  },
  {
    altitude: 700,
    horizon: new Color(0.05, 0.08, 0.16), zenith: SKY_VOID, ground: new Color(0.03, 0.05, 0.1),
    fog: new Color(0.02, 0.03, 0.06), density: 0.00006,
    stars: 1.0, sun: 0.7, cloud: 0, deck: 0, streakGlow: 0.09, streakLength: 0.45, planetDegrees: 58,
  },
];
const SKYHOOK_SHAKE: CameraFeelShakeOptions = {
  decay: 2.9,
  maxTrauma: 1.7,
  pitchDegrees: 0.34,
  yawDegrees: 0.26,
  rollDegrees: 0.62,
  frequency: 11,
  smoothing: 22,
};

// The one scripted camera move in the level: as the climber brakes into the
// dock, the mast tips over and looks back down the tether at the world below.
const LOOK_BACK_KEYS: Array<[number, number]> = [
  [QUIET_TIME - 2.4, 0],
  [QUIET_TIME - 0.6, 1.45],
  [QUIET_TIME + 0.7, 1.45],
  [QUIET_TIME + 2.4, 0],
];

const LOCKED_PLATE = new Color(0.17, 0.075, 0.02);
const DENY_PLATE = new Color(0.24, 0.02, 0.012);

const rail = createSkyhookRail();

let environment: Environment | null = null;
let beatEnergy = 0;
let surge = 0;
let strain = 0;
let elapsedNow = 0;
let lastRunTime = -1;
let cameraRoll = 0;
let cameraFov = 0;
let dockGlow = 0;

const brackets = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.bracket,
  set: (record, bracket) => {
    record.bracket = bracket;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously right
// after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, bracket: null }),
  disposeRecord: (record) => brackets.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  scene.fog = new FogExp2(SKY_KEYS[0].fog.getHex(), SKY_KEYS[0].density);
  scene.background = SKY_KEYS[0].zenith.clone();
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  applySky(0);
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
      return createLetterMesh(letter ?? 'A');
    case 'kite':
      return createKiteMesh();
    case 'spar':
      return createSparMesh();
    case 'shrike':
      return createShrikeMesh();
    case 'limpet':
      return createLimpetMesh();
    case 'slug':
      return createSlugMesh();
    case 'grapnel':
      return createGrapnelMesh();
    case 'core':
      return createCoreMesh();
    default:
      return createSparMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnRing(mesh.position, FAULT.clone(), 2.4, 0.26);
}

// The player's round: a stubby hazard-orange flechette with a white-hot tip.
export function createProjectileMesh() {
  const group = new Group();
  const core = new OctahedronGeometry(0.26, 0);
  core.scale(0.5, 0.5, 2.4);
  group.add(new Mesh(core, new MeshBasicMaterial({ color: hdr(PANEL, 2.6) })));
  const shell = new OctahedronGeometry(0.42, 0);
  shell.scale(0.6, 0.6, 2.0);
  group.add(new Mesh(shell, createAdditiveBasicMaterial({ color: hdr(HAZARD, 1.1), opacity: 0.55, fog: false })));
  projectileRecords.enqueue({ mesh: group, trailColor: HAZARD.clone().multiplyScalar(0.85) });
  return group;
}

// ---- reticle -------------------------------------------------------------------

// A gunner's sight out of the climber's own toolbox: four corner brackets, a
// thin ranging ring, and six load ticks that fill as the tubes charge.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const addPart = (mesh: Mesh, base: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    material.fog = false;
    parts.push({ material, base });
  };

  const corners = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 2) * i + Math.PI / 4;
    const corner = new Group();
    for (const [w, h, x, y] of [[0.34, 0.045, 0.17, 0], [0.045, 0.34, 0, 0.17]] as const) {
      const bar = new Mesh(new BoxGeometry(w, h, 0.02), new MeshBasicMaterial());
      addPart(bar, hdr(PANEL, 1.1));
      bar.position.set(x, y, 0);
      corner.add(bar);
    }
    corner.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    corner.rotation.z = angle - Math.PI / 4;
    corners.add(corner);
  }

  const ranging = new Mesh(new RingGeometry(0.5, 0.525, 44), new MeshBasicMaterial());
  addPart(ranging, hdr(PANEL, 0.8));

  const ticks: Array<{ material: MeshBasicMaterial }> = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + ((i - 2.5) / 6) * Math.PI * 1.15;
    const tick = new Mesh(new BoxGeometry(0.055, 0.15, 0.02), new MeshBasicMaterial());
    addPart(tick, hdr(STEEL, 0.9));
    tick.position.set(Math.cos(angle) * 0.63, Math.sin(angle) * 0.63, 0);
    tick.rotation.z = angle + Math.PI / 2;
    ticks.push({ material: tick.material as MeshBasicMaterial });
    group.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.042, 16), new MeshBasicMaterial());
  addPart(dot, hdr(HAZARD, 2.0));

  group.add(corners, ranging, dot);
  group.userData.parts = parts;
  group.userData.corners = corners;
  group.userData.ticks = ticks;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.04 : 0));
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.5 : 1.15));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
  // Load ticks: one lit tube per lock, so a full six reads before the release.
  for (const [index, tick] of (reticle.userData.ticks as Array<{ material: MeshBasicMaterial }>).entries()) {
    tick.material.color.copy(index < lockCount ? hdr(colorForLockCount(index + 1, LOCK_GRADIENT), 2.1) : hdr(STEEL, 0.55));
  }
}

// ---- event choreography -----------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'core') {
      // It arrives as a silhouette a very long way up the cable.
      spawnRing(worldPosition, hdr(HAZARD, 1.1), 34, 1.1);
      surge = Math.max(surge, 0.4);
    } else if (kind === 'grapnel') {
      spawnRing(worldPosition, hdr(HAZARD, 0.9), 7, 0.5);
    } else if (kind === 'limpet') {
      spawnRing(worldPosition, hdr(ICE, 0.8), 5, 0.45);
    } else if (kind !== 'slug' && kind !== 'letter') {
      spawnGlint(worldPosition, hdr(PALE, 0.9), 0.7, 0.14);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.bracket) brackets.attach(record, makeBracket(lockColor), scene);
    spawnRing(worldPosition, hdr(lockColor, 1.3), 1.9, 0.24);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) brackets.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(AMBER, 1.4), 0.42, 0.1);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    burstSparks(worldPosition, hdr(AMBER, 1.6), 6, 11);
    const record = enemyRecords.get(enemyId);
    if (record && !lethal) {
      record.mesh.userData.flashUntil = elapsedNow + 0.3;
      spawnGlint(worldPosition, hdr(PANEL, 1.8), 1.0, 0.15);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (record.mesh.userData.kind === 'limpet') {
      breakLimpetShell(record.mesh);
      burstSparks(worldPosition, hdr(PANEL, 1.5), 14, 15);
      spawnRing(worldPosition, hdr(PANEL, 1.2), 5.5, 0.42);
    } else if (record.mesh.userData.isDescender) {
      // It hauls itself down a body-length. The whole car feels it.
      cameraFeel.shake(1.1, SKYHOOK_SHAKE);
      surge = Math.max(surge, 0.6);
      strain = Math.max(strain, 0.55);
      spawnRing(worldPosition, hdr(HAZARD, 1.5), 26, 0.85);
      burstSparks(worldPosition, hdr(AMBER, 1.8), 30, 22);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const specs = record.mesh.userData.shardSpecs as ShardSpec[] | undefined;
    if (specs) burstPlating(worldPosition, specs);
    const accent = (record.mesh.userData.accent as Color | undefined) ?? PALE;
    burstSparks(worldPosition, hdr(accent, 1.5), 8, 13);
    spawnRing(worldPosition, hdr(accent, 1.4), 3.8, 0.36);
    spawnGlint(worldPosition, hdr(PANEL, 1.5), 1.1, 0.16);

    if (record.mesh.userData.isDescender) {
      // It loses the cable. The one moment in the level that is pure relief.
      cameraFeel.shake(1.6, SKYHOOK_SHAKE);
      surge = 1.0;
      strain = 0;
      whiteoutTintUniform.value.set(1.0, 0.72, 0.36);
      whiteoutUniform.value = Math.max(whiteoutUniform.value, 0.42);
      spawnRing(worldPosition, hdr(HAZARD, 1.6), 68, 1.4);
      spawnRing(worldPosition, hdr(AMBER, 1.2), 42, 1.1);
      spawnRing(worldPosition, hdr(PANEL, 1.0), 24, 0.8);
      burstSparks(worldPosition, hdr(AMBER, 1.9), 70, 34, 24);
    } else if (record.mesh.userData.kind === 'grapnel') {
      cameraFeel.shake(0.5, SKYHOOK_SHAKE);
      spawnRing(worldPosition, hdr(HAZARD, 1.2), 9, 0.5);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      if (record.mesh.userData.isDescender) {
        // It reached the car. This is what losing looks like.
        cameraFeel.shake(1.7, SKYHOOK_SHAKE);
        strain = 1.0;
        surge = Math.max(surge, 0.8);
        whiteoutTintUniform.value.set(0.9, 0.3, 0.12);
        whiteoutUniform.value = Math.max(whiteoutUniform.value, 0.55);
        spawnRing(worldPosition, hdr(FAULT, 1.2), 50, 1.0);
        burstSparks(worldPosition, hdr(FAULT, 1.0), 50, 26, 22);
      }
      enemyRecords.delete(enemyId, { dispose: true });
    }
    burstSparks(worldPosition, PALE.clone().multiplyScalar(0.32), 3, 4, 8);
  });

  bus.on('reject', () => {
    strain = Math.max(strain, 0.4);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      beatEnergy = Math.max(beatEnergy, 1.5);
      whiteoutTintUniform.value.set(1.0, 0.76, 0.42);
      whiteoutUniform.value = Math.max(whiteoutUniform.value, 0.16);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });

  bus.on('playerhit', () => {
    // Damage is the climber's problem, so it reads as airframe strain, not a flash.
    strain = Math.max(strain, 0.85);
    beatEnergy = 1.4;
    cameraFeel.shake(1.2, SKYHOOK_SHAKE);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    lastRunTime = -1;
    cameraRoll = 0;
    cameraFov = 0;
    beatEnergy = 0;
    surge = 0;
    strain = 0;
    dockGlow = 0;
    whiteoutUniform.value = 0;
    whiteoutTintUniform.value.set(0.78, 0.8, 0.84);
    strainUniform.value = 0;
    cameraFeel.restore();
  });

  bus.on('runend', () => {
    strain = 0;
    cameraFeel.restore();
  });
}

function makeBracket(color: Color): Group {
  const group = new Group();
  // A four-corner target box, not a halo: the same shape as the reticle, so a
  // locked enemy reads as already being inside the sight.
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 2) * i + Math.PI / 4;
    const corner = new Group();
    for (const [w, h, x, y] of [[0.5, 0.08, 0.25, 0], [0.08, 0.5, 0, 0.25]] as const) {
      const bar = new Mesh(
        new BoxGeometry(w, h, 0.03),
        createAdditiveBasicMaterial({ color: hdr(color, 1.9), side: DoubleSide, fog: false }),
      );
      bar.position.set(x, y, 0);
      corner.add(bar);
    }
    corner.position.set(Math.cos(angle) * 1.0, Math.sin(angle) * 1.0, 0);
    corner.rotation.z = angle - Math.PI / 4;
    group.add(corner);
  }
  return group;
}

// ---- per-frame ---------------------------------------------------------------------

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);
  surge = Math.max(0, surge - dt * 0.9);
  strain = Math.max(0, strain - dt * 1.1);
  beatUniform.value = beatEnergy;
  strainUniform.value = strain;
  strainPhaseUniform.value = (strainPhaseUniform.value + dt * 9) % 6283;

  const camera = ctx.camera as PerspectiveCamera;
  const runTime = ctx.running ? ctx.runTime : 0;
  const speed = ctx.running ? speedFactorAt(runTime) : 0.5;

  applySky(camera.position.y);
  applySceneAtmosphere(ctx.scene);
  updateSetPieces(ctx);
  updateEnvironmentFrame(dt, ctx, speed, runTime);

  whiteoutUniform.value = Math.max(deckWhiteout(camera.position.y), whiteoutUniform.value - dt * 1.8);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Incoming rounds brake to a stop a couple of metres off the canopy. Left
    // at full size that is a wall of glowing plate across the whole frame, so
    // anything that gets that close shrinks instead of swallowing the view.
    const range = record.mesh.position.distanceTo(camera.position);
    const near = range < 6 ? MathUtils.clamp(0.3 + range * 0.12, 0.3, 1) : 1;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.32)) * near);

    updateEnemyTint(record, camera);
    updateEnemySignals(record, dt);

    if (record.mesh.userData.isHostileShot) {
      dropTrail(record.mesh.position, record.mesh.userData.trailColor as Color);
    }

    if (record.bracket) {
      record.mesh.getWorldPosition(record.bracket.position);
      record.bracket.quaternion.copy(camera.quaternion);
      const pulse = 1 + Math.sin(elapsedNow * 11) * 0.045;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.bracket.scale.setScalar(pulse * 1.35 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const corners = findReticleCorners(ctx.scene);
  if (corners) {
    const active = corners.parent?.userData.active === true;
    corners.rotation.z += dt * (active ? 1.4 : 0.3);
  }

  updateEffects(dt, camera);
}

// Deck punch-through, the sighting, and the moment the Descender arrives: three
// beats the whole frame answers to.
function updateSetPieces(ctx: VisualContext) {
  if (!ctx.running) {
    lastRunTime = -1;
    return;
  }
  const crossed = (t: number) => lastRunTime >= 0 && lastRunTime < t && ctx.runTime >= t;
  if (crossed(DECK_TIME)) {
    ctx.feel.shake(0.75, SKYHOOK_SHAKE);
    ctx.feel.kickFov(6.5, { decay: 2.4 });
    surge = Math.max(surge, 1.0);
  }
  if (crossed(SIGHTING_TIME)) surge = Math.max(surge, 0.35);
  if (crossed(CONTACT_TIME)) surge = Math.max(surge, 0.5);
  lastRunTime = ctx.runTime;
}

function updateEnvironmentFrame(dt: number, ctx: VisualContext, speed: number, runTime: number) {
  if (!environment) return;
  const camera = ctx.camera as PerspectiveCamera;
  const cameraU = ctx.running ? railU(runTime) : 0;

  updateBackdrop(environment, camera, MathUtils.degToRad(sky.planetDegrees));
  environment.clouds.update(cameraU, dt);
  environment.flotsam.update(cameraU, dt);

  // Streaks live in camera space; their scroll rate is the felt airspeed.
  environment.streaks.position.copy(camera.position);
  environment.streaks.quaternion.copy(camera.quaternion);
  streakOffsetUniform.value = (streakOffsetUniform.value + dt * speed * 30) % 100000;

  // Dock beacons come up once the station is worth looking at.
  const dockTarget = !ctx.running ? 0 : MathUtils.clamp((runTime - (DOCK_TIME - 8)) / 5, 0, 1);
  dockGlow += (dockTarget - dockGlow) * Math.min(1, dt * 1.6);
  beaconUniform.value = dockGlow * (0.5 + beatEnergy * 0.2);
}

/** Grey-out that peaks the instant the climber is inside the cloud layer. */
function deckWhiteout(altitude: number) {
  if (!environment) return 0;
  const delta = altitude - environment.deckAltitude;
  const scaled = delta < 0 ? delta / 26 : delta / 13;
  return Math.exp(-scaled * scaled) * 0.88;
}

// ---- sky ramp --------------------------------------------------------------------

const sky = {
  horizon: new Color(),
  zenith: new Color(),
  ground: new Color(),
  fog: new Color(),
  density: 0.01,
  stars: 0,
  sun: 0,
  cloud: 0,
  deck: 0,
  streakGlow: 1,
  streakLength: 1,
  planetDegrees: 86,
};

function applySky(altitude: number) {
  let from = SKY_KEYS[0];
  let to = SKY_KEYS[0];
  for (let i = 1; i < SKY_KEYS.length; i += 1) {
    from = SKY_KEYS[i - 1];
    to = SKY_KEYS[i];
    if (altitude <= SKY_KEYS[i].altitude) break;
    from = SKY_KEYS[i];
  }
  const span = Math.max(0.0001, to.altitude - from.altitude);
  const t = MathUtils.clamp((altitude - from.altitude) / span, 0, 1);

  sky.horizon.copy(from.horizon).lerp(to.horizon, t);
  sky.zenith.copy(from.zenith).lerp(to.zenith, t);
  sky.ground.copy(from.ground).lerp(to.ground, t);
  sky.fog.copy(from.fog).lerp(to.fog, t);
  sky.density = MathUtils.lerp(from.density, to.density, t);
  sky.stars = MathUtils.lerp(from.stars, to.stars, t);
  sky.sun = MathUtils.lerp(from.sun, to.sun, t);
  sky.cloud = MathUtils.lerp(from.cloud, to.cloud, t);
  sky.deck = MathUtils.lerp(from.deck, to.deck, t);
  sky.streakGlow = MathUtils.lerp(from.streakGlow, to.streakGlow, t);
  sky.streakLength = MathUtils.lerp(from.streakLength, to.streakLength, t);
  sky.planetDegrees = MathUtils.lerp(from.planetDegrees, to.planetDegrees, t);

  skyHorizonUniform.value.set(sky.horizon.r, sky.horizon.g, sky.horizon.b);
  skyZenithUniform.value.set(sky.zenith.r, sky.zenith.g, sky.zenith.b);
  skyGroundUniform.value.set(sky.ground.r, sky.ground.g, sky.ground.b);
  starsUniform.value = sky.stars;
  sunGlowUniform.value = sky.sun;
  cloudOpacityUniform.value = sky.cloud;
  deckOpacityUniform.value = sky.deck;
  streakGlowUniform.value = sky.streakGlow * (0.85 + beatEnergy * 0.2);
  streakLengthUniform.value = sky.streakLength;
}

function applySceneAtmosphere(scene: Scene) {
  if (scene.fog instanceof FogExp2) {
    scene.fog.color.copy(sky.fog);
    scene.fog.density = sky.density;
  }
  if (scene.background instanceof Color) scene.background.copy(sky.zenith);
}

// ---- camera ---------------------------------------------------------------------

export function updateCameraEffects(dt: number, ctx: CameraEffectsContext) {
  if (!(ctx.camera instanceof PerspectiveCamera)) return;
  const camera = ctx.camera;
  const speed = ctx.running ? speedFactorAt(ctx.runTime) : 0.5;

  const targetFov = (speed - 1) * 7 + beatEnergy * 1.1 + surge * 7 - strain * 2.5;
  cameraFov = MathUtils.lerp(cameraFov, targetFov, Math.min(1, dt * 5));

  if (ctx.running) {
    const u = skyhookRunProgress(ctx.runTime, SKYHOOK_DURATION);
    const tangent = rail.getTangentAt(MathUtils.clamp(u, 0, 1));
    const ahead = rail.getTangentAt(MathUtils.clamp(u + 0.006, 0, 1));
    // Bank into the tether's sway, plus a real wind roll that dies with the air.
    const wind = Math.sin(ctx.runTime * 0.9) * 0.04 + Math.sin(ctx.runTime * 2.3) * 0.013;
    const airborne = 1 - MathUtils.clamp((camera.position.y - 130) / 260, 0, 1);
    const targetRoll = MathUtils.clamp((ahead.x - tangent.x) * 26, -0.1, 0.1) + wind * airborne;
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 3);
    camera.rotateZ(cameraRoll);

    const lookBack = keyed(LOOK_BACK_KEYS, ctx.runTime);
    if (lookBack > 0.001) camera.rotateX(-lookBack);
  }

  ctx.feel.setFovOffset(cameraFov);
  ctx.feel.update(dt, { shake: SKYHOOK_SHAKE });
}

// Attract: parked at the anchor with the mast levelled, looking out over a storm
// nobody is going to miss, the tether climbing out of the top of frame.
export function updateAttractCamera(camera: PerspectiveCamera, modeTime: number) {
  const base = rail.getPointAt(0.004);
  camera.position.set(
    base.x + Math.sin(modeTime * 0.32) * 0.7,
    base.y + Math.sin(modeTime * 0.21) * 0.35,
    base.z + Math.cos(modeTime * 0.27) * 0.5,
  );
  const yaw = Math.sin(modeTime * 0.16) * 0.22;
  const pitch = 0.4 + Math.sin(modeTime * 0.23) * 0.05;
  camera.lookAt(
    camera.position.x + Math.sin(yaw) * Math.cos(pitch) * 40,
    camera.position.y + Math.sin(pitch) * 40,
    camera.position.z - Math.cos(yaw) * Math.cos(pitch) * 40,
  );
}

function keyed(keys: Array<[number, number]>, time: number) {
  if (time <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (time <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const t = MathUtils.clamp((time - t0) / Math.max(0.0001, t1 - t0), 0, 1);
      return MathUtils.lerp(v0, v1, t * t * (3 - 2 * t));
    }
  }
  return keys[keys.length - 1][1];
}

// ---- enemy dressing -----------------------------------------------------------------

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

  // Distance falloff keeps far edge lines from stacking into a bright smear.
  const distance = record.mesh.position.distanceTo(camera.position);
  const closeness = smoothstep(1 - clamp01((distance - 18) / 90));
  const locked = userData.locked === true;
  const flash = ((userData.flashUntil as number | undefined) ?? -Infinity) > elapsedNow;

  for (const part of parts) {
    if (denied) {
      part.material.color.copy(part.kind === 'plate' ? DENY_PLATE : FAULT);
      continue;
    }
    if (locked) {
      // Locked hardware wears the climber's paint.
      if (part.kind === 'plate') part.material.color.copy(LOCKED_PLATE);
      else if (part.kind === 'edge') part.material.color.copy(hdr(HAZARD, 1.75));
      else part.material.color.copy(hdr(AMBER, 2.2));
      continue;
    }
    if (flash) {
      part.material.color.copy(hdr(PANEL, part.kind === 'plate' ? 0.55 : 1.9));
      continue;
    }
    const dim = part.kind === 'plate' ? 0.45 + 0.55 * closeness : 0.5 + 0.5 * closeness;
    part.material.color.copy(part.base).multiplyScalar(dim);
  }
}

function updateEnemySignals(record: EnemyRecord, dt: number) {
  const userData = record.mesh.userData;
  if (userData.locked === true || ((userData.deniedUntil as number | undefined) ?? -Infinity) > elapsedNow) return;

  // Shrike: the intake goes from cold to hazard as it commits to the ram.
  const commitParts = userData.commitParts as Mesh[] | undefined;
  if (commitParts) {
    const commit = (userData.commit as number | undefined) ?? 0;
    const color = ICE.clone().lerp(HAZARD, commit);
    const pulse = 1 + commit * (0.6 + Math.sin(elapsedNow * 18) * 0.4);
    for (const part of commitParts) (part.material as MeshBasicMaterial).color.copy(color).multiplyScalar(1.2 * pulse);
  }

  // Limpet: the beacon strobes harder the closer it is to cutting the cable.
  const beacon = userData.beacon as Mesh | undefined;
  if (beacon) {
    const grind = (userData.grind as number | undefined) ?? 0;
    const blink = 0.35 + 0.65 * (Math.sin(elapsedNow * (3 + grind * 22)) * 0.5 + 0.5) ** 2;
    (beacon.material as MeshBasicMaterial).color.copy(ICE).lerp(FAULT, grind).multiplyScalar(1.2 + blink * 1.6);
    if (grind > 0.05 && Math.random() < dt * 26 * grind) {
      burstSparks(record.mesh.position, hdr(AMBER, 1.7), 2, 8, 20);
    }
  }

  // Descender: the furnace slot is sealed and dull until the grapnels are gone.
  const slotParts = userData.slotParts as Mesh[] | undefined;
  if (slotParts) {
    const exposed = userData.exposed === true;
    const approach = (userData.approach as number | undefined) ?? 0;
    const lunge = (userData.lunge as number | undefined) ?? 0;
    const heat = (exposed ? 1 : 0.22) * (0.55 + approach * 0.45) + lunge * 0.5;
    const throb = 1 + Math.sin(elapsedNow * (exposed ? 7.5 : 2.2)) * (exposed ? 0.3 : 0.1);
    for (const part of slotParts) {
      (part.material as MeshBasicMaterial).color.copy(HAZARD).multiplyScalar(heat * throb * 0.95);
    }
  }

  const jointParts = userData.jointParts as Mesh[] | undefined;
  if (jointParts) {
    const grip = (userData.grip as number | undefined) ?? 0.5;
    for (const part of jointParts) {
      (part.material as MeshBasicMaterial).color.copy(HAZARD).multiplyScalar(0.5 + grip * 1.4);
    }
  }
}

function findReticleCorners(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.corners) return child.userData.corners as Group;
  }
  return null;
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
