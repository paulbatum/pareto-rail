import {
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdornmentSlot, createAdditiveBasicMaterial, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { crownChannel, parentPose } from '../crown';
import { HOST_STRANDS, STRANDLINE_TIMELINE, jellyDrift } from '../gameplay';
import { BEAT_SECONDS, STRANDLINE_DURATION, bar } from '../timing';
import { RAIL, cameraFrameAt, railSpeedAt, strandPointAt, strandlineRunProgress } from '../world';
import {
  createBladderMesh,
  createCreeperMesh,
  createDrifterMesh,
  createHatchlingMesh,
  createParentMesh,
  createSporeMesh,
  createTickMesh,
  type TintPart,
} from './enemies';
import { createEffects, type Effects } from './effects';
import { createEnvironment as buildEnvironment, type Environment } from './environment';
import { createLetterMesh, restLetter, tintLetter } from './letters';
import {
  DENY,
  JELLY_GOLD,
  JELLY_GREEN,
  LOCK_GRADIENT,
  PARASITE,
  PARASITE_DARK,
  PARASITE_HOT,
  PARASITE_PALE,
  PLAYER_LIGHT,
  WATER_DEEP,
  WATER_MID,
  WATER_SURFACE,
  hdr,
} from './palette';
import { createReticleMesh, createShotMesh, type ReticleParts } from './player';
import { bloomUniform, clarityUniform, stingUniform } from './post-fx';

// Spine: palette choices, event choreography, and the per-frame look.
//
// The whole visual arc is the jellyfish coming back to life. Global vitality
// rises with the music section by section; every parasite killed sends a
// cleansing flash up its own strand to the bell; every web sector that
// withers brightens the crown; and when the parent is torn loose, light
// floods down every strand from the roots to the tips while the water clears.

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  finaleElapsed: number;
  outcome: 'pending' | 'freed' | 'blighted';
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  lockRing: Group | null;
  locks: number;
  lockColor: Color;
  history: Vector3[];
  sacsBurst: number;
};

type ProjectileRecord = { mesh: Object3D; lastTrail: number };

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.6,
  pitchDegrees: 0.3,
  yawDegrees: 0.26,
  rollDegrees: 0.8,
  frequency: 6.5,
  smoothing: 16,
};

const KIND_SCALE: Record<string, number> = {
  tick: 1.35,
  creeper: 1.3,
  bladder: 1.3,
  drifter: 1.5,
  hatchling: 1.85,
  spore: 1.4,
  parent: 1,
};

// Vitality through the run, before kills and the crown add to it.
const LIFE_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.1],
  [bar(4), 0.2],
  [bar(8), 0.38],
  [bar(11), 0.5],
  [bar(14.5), 0.58],
  [bar(15.5), 0.44],
];

const WITHERED_THREAD = new Color(0.1, 0.08, 0.12);
const HIT_FLASH = new Color(1.4, 1.3, 1.0);

let environment: Environment | null = null;
let effects: Effects | null = null;
let now = 0;
let runTimeNow = 0;
let lastBeatNumber = -1;
let lastBeatAt = -Infinity;
let pulse = 0;
let beatEnergy = 0;
let kills = 0;
let withered = 0;
let finaleSeen: 'none' | 'freed' | 'blighted' = 'none';
let finaleClock = -1;
let cameraRoll = 0;
let surge = 0;
let fovOffset = 0;
let rejectAt = -Infinity;
let waveAt = -100;
let lastRunTimeSeen = 0;

// Section downbeats where the forest lights from the bell down — each time
// more of it comes back to life. (The crown's arrival is the parasite's
// moment, not the jelly's: no wave there.)
const PHRASE_BARS = [4, 8, 11].map((b) => bar(b));
let reticleRef: Group | null = null;

// Geometry is shared across instances; removal disposes only materials.
function disposeMaterials(object: Object3D) {
  object.traverse((child) => {
    const material = (child as Mesh).material;
    if (Array.isArray(material)) for (const item of material) item.dispose();
    else material?.dispose();
  });
}

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
  disposeAdornment: disposeMaterials,
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously
// right after calling it — pairing the queue with spawn events links mesh to id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({
    mesh,
    kind: String(mesh.userData.kind),
    bornAt: null,
    lockRing: null,
    locks: 0,
    lockColor: LOCK_GRADIENT[0].clone(),
    history: [],
    sacsBurst: 0,
  }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    disposeMaterials(record.mesh);
  },
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

// ---- factories ----------------------------------------------------------------------

// The webbed parent is scenery until it is bare: it shares the lockable
// parent's pose and body, plus the three-sector cage.
type CrownScenery = {
  group: Group;
  arrivedAt: number;
  pumpAt: number;
  burrowAt: number;
  hideAt: number;
  /** When the parent was torn loose: its body tumbles out of the crown. */
  fallAt: number;
  fallFrom: Vector3;
  fallQuaternion: Quaternion;
};

let crownScenery: CrownScenery | null = null;

// The title tableau: the first wave's ticks, already clamped on their strands
// behind START, sleeping. Each one hands over to its real spawn.
type TableauTick = { mesh: Group; spawnAt: number };
const tableau: TableauTick[] = [];

function buildTableau(scene: Scene) {
  const camera = cameraFrameAt(0);
  for (const entry of STRANDLINE_TIMELINE) {
    if (entry.time > bar(1.5) || entry.data.role !== 'tick') continue;
    const inner = createTickMesh();
    inner.scale.setScalar(KIND_SCALE.tick);
    const mesh = new Group();
    mesh.add(inner);
    mesh.position.copy(entry.data.latch);
    const spec = HOST_STRANDS[entry.data.host];
    const up = strandPointAt(spec, entry.data.latch.y + 1).sub(entry.data.latch).normalize();
    const toCamera = camera.position.clone().sub(entry.data.latch);
    toCamera.addScaledVector(up, -toCamera.dot(up)).normalize();
    const x = new Vector3().crossVectors(toCamera, up).normalize();
    mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, toCamera, up));
    mesh.userData = { ...inner.userData, inner, latched: true };
    scene.add(mesh);
    tableau.push({ mesh, spawnAt: entry.time });
  }
}

export function createEnvironment(scene: Scene) {
  environment = buildEnvironment(scene);
  effects = createEffects(scene);
  const group = createParentMesh({ web: true });
  group.visible = false;
  scene.add(group);
  crownScenery = { group, arrivedAt: -1, pumpAt: -99, burrowAt: -1, hideAt: -1, fallAt: -1, fallFrom: new Vector3(), fallQuaternion: new Quaternion() };
  buildTableau(scene);
  return environment.root;
}

function resetCrownScenery() {
  if (!crownScenery) return;
  crownScenery.group.visible = false;
  crownScenery.arrivedAt = -1;
  crownScenery.pumpAt = -99;
  crownScenery.burrowAt = -1;
  crownScenery.hideAt = -1;
  crownScenery.fallAt = -1;
  crownScenery.group.scale.setScalar(1);
  for (const sector of crownScenery.group.userData.sectors as Group[]) {
    delete sector.userData.witherAt;
    delete sector.userData.pumpAt;
    sector.visible = true;
  }
}

const LETTER_LOOK = {
  bead: hdr(JELLY_GREEN.clone().lerp(JELLY_GOLD, 0.35), 1.25),
  halo: hdr(JELLY_GREEN, 0.5),
  lens: new Color(0.01, 0.06, 0.08),
  thread: hdr(JELLY_GREEN, 0.4),
};

export function createEnemyMesh(kind: string, letter?: string) {
  let built: Group;
  switch (kind) {
    case 'letter':
      built = createLetterMesh(letter ?? 'A', LETTER_LOOK);
      break;
    case 'tick':
      built = createTickMesh();
      break;
    case 'creeper':
      built = createCreeperMesh();
      break;
    case 'bladder':
      built = createBladderMesh();
      break;
    case 'drifter':
      built = createDrifterMesh();
      break;
    case 'hatchling':
      built = createHatchlingMesh();
      break;
    case 'spore':
      built = createSporeMesh();
      break;
    case 'parent':
      built = createParentMesh({ web: false });
      break;
    case 'crown':
      // The fight's invisible clock.
      built = new Group();
      break;
    default:
      built = createTickMesh();
  }
  const scale = KIND_SCALE[kind] ?? 1;
  const mesh = new Group();
  built.scale.setScalar(scale);
  mesh.add(built);
  mesh.userData = { ...built.userData, kind, inner: built };
  mesh.scale.setScalar(kind === 'letter' ? 1 : 0.001);
  if (kind !== 'letter') enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    if (locked) tintLetter(mesh as Group, hdr(JELLY_GOLD, 1.8), hdr(JELLY_GOLD, 0.8), new Color(0.06, 0.05, 0.01));
    else restLetter(mesh as Group);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = now + 0.55;
  if (mesh.userData.isLetter) tintLetter(mesh as Group, hdr(DENY, 1.3), hdr(PARASITE_HOT, 0.6), new Color(0.12, 0.0, 0.1));
  effects?.ring(mesh.position, hdr(DENY, 1.1), 2.2, 0.35);
}

export function createProjectileMesh() {
  const mesh = createShotMesh(hdr(PLAYER_LIGHT, 2.2), hdr(JELLY_GOLD, 0.9));
  projectileRecords.enqueue({ mesh, lastTrail: 0 });
  return mesh;
}

export function createReticle() {
  const reticle = createReticleMesh({
    ring: hdr(PLAYER_LIGHT, 0.9),
    bead: new Color(0.16, 0.3, 0.28),
    dot: hdr(PLAYER_LIGHT, 1.4),
  });
  reticleRef = reticle;
  return reticle;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const parts = reticle.userData.reticle as ReticleParts | undefined;
  if (!parts) return;
  const shake = Math.max(0, 1 - (now - rejectAt) / 0.35);
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.06 : 0) + shake * 0.12);
  parts.ringMaterial.color.copy(shake > 0 ? hdr(DENY, 1.4) : hdr(PLAYER_LIGHT, active ? 1.25 : 0.8));
  parts.innerMaterial.color.copy(hdr(PLAYER_LIGHT, active ? 0.7 : 0.35));
  // One bead per lock, walking the jelly's light from aqua to gold.
  for (let i = 0; i < parts.beadMaterials.length; i += 1) {
    const lit = i < lockCount;
    const color = colorForLockCount(i + 1, LOCK_GRADIENT);
    parts.beadMaterials[i].color.copy(lit ? hdr(color, 1.9) : parts.look.bead);
    parts.beadHaloMaterials[i].opacity = lit ? 0.75 : 0;
    parts.beadHaloMaterials[i].color.copy(hdr(color, 0.9));
  }
  parts.beads.rotation.z = shake > 0 ? Math.sin(now * 80) * 0.08 * shake : 0;
}

// ---- events ---------------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  const channel = crownChannel(bus);

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || !effects) return;
    if (kind === 'crown') return;
    // Taking over from a sleeping title-tableau tick: no grow-in, no ripple.
    if (tableau.some((tick) => tick.mesh.position.distanceTo(worldPosition) < 0.6)) {
      record.bornAt = now - 10;
      return;
    }
    if (kind === 'spore') {
      effects.glint(worldPosition, hdr(PARASITE_HOT, 1.3), 1.6, 0.25);
    } else if (kind === 'parent') {
      // Bare: the lockable body takes over from the scenery in place.
      if (crownScenery) crownScenery.hideAt = now;
      record.bornAt = now - 10;
    } else if (kind === 'drifter' || kind === 'hatchling') {
      effects.ring(worldPosition, hdr(PARASITE, 0.55), 2.2, 0.5);
    } else {
      // A parasite wakes on its strand: a sour ripple.
      effects.ring(worldPosition, hdr(PARASITE, 0.7), 3.2, 0.7);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemyRecords.get(enemyId);
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    if (record) {
      record.locks += 1;
      record.lockColor.copy(color);
      if (!record.lockRing) lockRings.attach(record, makeLockRing(), scene);
    }
    effects?.glint(worldPosition, hdr(color, 1.1), 1.4, 0.18);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    record.locks = 0;
    lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    effects?.glint(worldPosition, hdr(PLAYER_LIGHT, 0.8), 0.7, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    if (!effects) return;
    effects.burst(worldPosition, { count: 7, speed: 7, from: hdr(PLAYER_LIGHT, 1.4), to: hdr(JELLY_GOLD, 0.5), size: 0.12, life: 0.4 });
    const record = enemyRecords.get(enemyId);
    if (!record || lethal) return;
    record.mesh.userData.hitFlashUntil = now + 0.22;
    // Violet ink bleeds from the wound.
    effects.burst(worldPosition, { count: 10, speed: 2.5, from: hdr(PARASITE, 0.9), to: hdr(PARASITE_DARK, 0.3), size: 0.45, life: 0.9, drag: 3 });
    if (record.kind === 'bladder') {
      const sacs = record.mesh.userData.sacs as Mesh[] | undefined;
      const sac = sacs?.[record.sacsBurst];
      if (sac) {
        sac.visible = false;
        record.sacsBurst += 1;
        effects.burst(worldPosition, { count: 14, speed: 6, from: hdr(PARASITE_PALE, 1.1), to: hdr(PARASITE, 0.4), size: 0.2, life: 0.7 });
      }
    }
    if (record.kind === 'parent') {
      effects.glint(worldPosition, hdr(JELLY_GOLD, 1.4), 4, 0.25);
      effects.burst(worldPosition, { count: 18, speed: 9, from: hdr(PARASITE_HOT, 1.2), to: hdr(JELLY_GOLD, 0.6), size: 0.3, life: 0.9 });
      feel.shake(0.25, SHAKE);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || !effects || record.kind !== 'parent') return;
    // Torn half loose: the claws on one side rip out of the bell.
    record.mesh.userData.tornAt = now;
    feel.shake(1.1, SHAKE);
    bloomUniform.value = Math.max(bloomUniform.value, 0.3);
    effects.ring(worldPosition, hdr(JELLY_GOLD, 1.3), 18, 0.9);
    effects.ring(worldPosition, hdr(PARASITE_HOT, 1.1), 11, 0.7);
    effects.burst(worldPosition, { count: 60, speed: 14, from: hdr(PARASITE_HOT, 1.2), to: hdr(PARASITE_DARK, 0.4), size: 0.35, life: 1.4 });
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || !effects) return;
    kills += 1;
    const big = record.kind === 'parent';
    // Cleansing: violet flakes burn off into the jelly's gold and rise.
    effects.burst(worldPosition, {
      count: big ? 140 : record.kind === 'spore' ? 8 : 22,
      speed: big ? 22 : 8,
      from: hdr(PARASITE_PALE, 1.3),
      to: hdr(JELLY_GOLD, 1.1),
      size: big ? 0.5 : 0.22,
      life: big ? 2.2 : 1.1,
      buoyancy: 1.2,
    });
    effects.burst(worldPosition, {
      count: big ? 40 : 6,
      speed: 1.5,
      from: new Color(0.55, 0.85, 0.85),
      to: new Color(0.2, 0.5, 0.55),
      size: big ? 0.3 : 0.12,
      life: big ? 3 : 1.8,
      buoyancy: 3.5,
      drag: 1.2,
      spread: new Vector3(0.6, 0.6, 0.6),
    });
    effects.ring(worldPosition, hdr(JELLY_GOLD, big ? 1.6 : 1.0), big ? 40 : 4.2, big ? 1.8 : 0.45);
    effects.glint(worldPosition, hdr(PLAYER_LIGHT, big ? 2.4 : 1.4), big ? 16 : 2.2, big ? 0.7 : 0.2);

    const host = record.mesh.userData.host as number | undefined;
    if (host !== undefined && environment) environment.strands.heal(host, now);

    if (big && crownScenery) {
      // Torn loose: the body drops out of the crown and tumbles away.
      crownScenery.fallAt = now;
      crownScenery.fallFrom.copy(record.mesh.position);
      crownScenery.fallQuaternion.copy(record.mesh.quaternion);
    }
    if (big) {
      feel.shake(1.6, SHAKE);
      bloomUniform.value = 0.85;
      effects.ring(worldPosition, hdr(JELLY_GREEN, 1.3), 70, 2.6);
      effects.ring(worldPosition, hdr(PLAYER_LIGHT, 1.2), 24, 1.2);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    if (record && record.kind !== 'spore' && record.kind !== 'parent') {
      effects?.burst(worldPosition, { count: 6, speed: 1.2, from: hdr(PARASITE, 0.45), to: hdr(PARASITE_DARK, 0.15), size: 0.5, life: 0.8, drag: 3 });
    }
  });

  bus.on('reject', () => {
    rejectAt = now;
    stingUniform.value = Math.max(stingUniform.value, 0.25);
    const reticle = reticleRef;
    if (reticle && effects) effects.ring(reticle.position, hdr(DENY, 1.2), 1.8, 0.3);
  });

  bus.on('volley', ({ size, kills: volleyKills }) => {
    if (volleyKills < 5 || volleyKills < size) return;
    // A clean full sweep: the whole forest flares on it.
    beatEnergy = Math.max(beatEnergy, 1.5);
    bloomUniform.value = Math.max(bloomUniform.value, size >= 6 ? 0.26 : 0.16);
    if (size >= 6) feel.kickFov(1.8);
  });

  bus.on('beat', ({ beatNumber, isDownbeat }) => {
    lastBeatNumber = beatNumber;
    lastBeatAt = now;
    if (isDownbeat) pulse = 1;
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.4);
  });

  bus.on('playerhit', () => {
    stingUniform.value = 0.7;
    feel.shake(1.2, SHAKE);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'exposed' || !effects) return;
    bloomUniform.value = Math.max(bloomUniform.value, 0.3);
    if (crownScenery) {
      effects.ring(crownScenery.group.position, hdr(PARASITE_HOT, 1.3), 16, 0.9);
      effects.ring(crownScenery.group.position, hdr(JELLY_GOLD, 1.2), 22, 1.2);
    }
  });

  channel.on((signal) => {
    if (!effects || !crownScenery) return;
    const scenery = crownScenery;
    const at = scenery.group.position;
    if (signal.type === 'arrive') {
      scenery.arrivedAt = now;
      scenery.group.visible = true;
      effects.ring(PARENT_RING_POINT.copy(at), hdr(PARASITE, 1.2), 26, 1.4);
    }
    if (signal.type === 'pump') {
      scenery.pumpAt = now;
      const pumping = (scenery.group.userData.sectors as Group[])[signal.sector];
      if (pumping) pumping.userData.pumpAt = now;
      effects.ring(at, hdr(PARASITE_HOT, 1.0), 12, 0.6);
    }
    if (signal.type === 'wither') {
      withered += 1;
      const sector = (scenery.group.userData.sectors as Group[])[signal.sector];
      if (sector) sector.userData.witherAt = now;
      bloomUniform.value = Math.max(bloomUniform.value, 0.22);
      feel.shake(0.5, SHAKE);
      effects.ring(at, hdr(JELLY_GREEN, 1.2), 20, 1.1);
      effects.burst(at, {
        count: 50,
        speed: 6,
        from: hdr(PARASITE_PALE, 0.8),
        to: WITHERED_THREAD.clone(),
        size: 0.18,
        life: 2.2,
        buoyancy: -2,
        spread: new Vector3(7, 7, 4),
      });
    }
    if (signal.type === 'burrow') {
      scenery.burrowAt = now;
      stingUniform.value = Math.max(stingUniform.value, 0.5);
      effects.ring(at, hdr(PARASITE, 1.2), 30, 1.6);
    }
  });

  bus.on('runstart', () => {
    resetCrownScenery();
    effects?.clear();
    environment?.strands.reset();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    kills = 0;
    withered = 0;
    finaleSeen = 'none';
    finaleClock = -1;
    bloomUniform.value = 0;
    stingUniform.value = 0;
    clarityUniform.value = 0;
    cameraRoll = 0;
    surge = 0;
    fovOffset = 0;
    feel.restore();
  });

  bus.on('runend', () => {
    feel.restore();
  });
}

// ---- per-frame ----------------------------------------------------------------------

function keyed(keys: ReadonlyArray<readonly [number, number]>, t: number) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return MathUtils.lerp(v0, v1, smooth((t - t0) / (t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}

function smooth(x: number) {
  const t = MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function window01(t: number, start: number, full: number, fade: number, end: number) {
  return Math.min(smooth((t - start) / (full - start)), 1 - smooth((t - fade) / (end - fade)));
}

const surfaceColor = new Color();
const horizonColor = new Color();
const abyssColor = new Color();
const fogColor = new Color();
const driftVector = new Vector3();

export function updateVisuals(dt: number, ctx: VisualContext) {
  now = ctx.elapsed;
  runTimeNow = ctx.running || ctx.finaleElapsed >= 0 ? ctx.runTime : 0;
  pulse = Math.max(0, pulse - dt * 1.3);
  beatEnergy = Math.max(0, beatEnergy - dt * 3.5);
  bloomUniform.value = Math.max(0, bloomUniform.value - dt * (bloomUniform.value > 0.5 ? 0.35 : 0.9));
  stingUniform.value = Math.max(0, stingUniform.value - dt * 1.8);

  // A continuous beat clock for the strand bands: follow the audio's beats,
  // free-run on the tempo when there are none (before audio starts).
  const sinceBeat = now - lastBeatAt;
  const beat = sinceBeat < BEAT_SECONDS * 3 ? lastBeatNumber + Math.min(1.5, sinceBeat / BEAT_SECONDS) : now / BEAT_SECONDS;

  // Phrase waves: crossing a section downbeat sends light down every strand.
  if (ctx.running) {
    for (const at of PHRASE_BARS) {
      if (lastRunTimeSeen < at && runTimeNow >= at) {
        waveAt = now;
        pulse = 1.4;
      }
    }
    lastRunTimeSeen = runTimeNow;
  } else {
    lastRunTimeSeen = 0;
  }

  // ---- the arc of the animal's health ----
  const finale = ctx.finaleElapsed;
  if (finale >= 0 && finaleSeen === 'none') {
    finaleSeen = ctx.outcome === 'freed' ? 'freed' : 'blighted';
    finaleClock = now - finale;
    if (finaleSeen === 'freed') environment?.strands.healAll(finaleClock + 0.3, 2.8);
  }
  const freed = finaleSeen === 'freed';
  const finaleK = finale >= 0 ? smooth(finale / 3.2) : 0;
  let life = keyed(LIFE_KEYS, runTimeNow) + Math.min(0.22, kills * 0.005) + withered * 0.07;
  if (finale >= 0) life = MathUtils.lerp(life, freed ? 1 : 0.3, finaleK);

  const swing = window01(runTimeNow, bar(8.3), bar(9.2), bar(10.3), bar(11.1));
  const crown = smooth((runTimeNow - bar(13.8)) / bar(1.2));
  const camera = ctx.camera as PerspectiveCamera;
  const depthK = MathUtils.clamp((camera.position.y + 62) / 190, 0, 1);
  const clear = freed ? finaleK : finaleK * 0.4;

  surfaceColor.copy(WATER_SURFACE).multiplyScalar(0.82 + 0.25 * depthK + 0.25 * clear);
  horizonColor.copy(WATER_MID).multiplyScalar(0.72 + 0.4 * depthK + 0.15 * swing + 0.35 * clear);
  abyssColor.copy(WATER_DEEP).multiplyScalar(0.9 + 0.4 * clear);
  fogColor.copy(horizonColor).multiplyScalar(0.92);
  if (finale >= 0 && !freed) horizonColor.lerp(PARASITE_DARK, 0.25 * finaleK);

  if (finale >= 0) jellyDrift(finale, driftVector);
  else driftVector.set(0, 0, 0);

  environment?.update(camera, {
    clock: now,
    beat,
    pulse: pulse * pulse,
    life,
    hostLife: 0.05,
    bellVisibility: Math.min(1, 0.42 + 0.58 * swing + 0.35 * crown + finaleK),
    stain: freed ? 1 - smooth(finale / 2.2) : 1,
    strandFade: MathUtils.lerp(MathUtils.lerp(0.0115, 0.0082, swing), freed ? 0.0021 : 0.004, finaleK),
    // Pulled back, hundreds of healed strands overlap: thin the glow so the
    // animal reads as strands of light rather than one white mass.
    strandGlow: MathUtils.lerp(1 + beatEnergy * 0.06, freed ? 0.42 : 0.6, finaleK),
    strandInflate: MathUtils.lerp(0.0007, 0.0012, finaleK),
    // One strand cleansed is a bright flash; all of them at once is a wave.
    strandFlash: finale >= 0 ? 0.55 : 2.2,
    strandWaveAt: waveAt,
    drift: driftVector,
    surface: surfaceColor,
    horizon: horizonColor,
    abyss: abyssColor,
    sunStrength: 0.8 + 0.4 * depthK + 0.4 * clear,
    shafts: 0.75 + 0.45 * depthK + 0.3 * swing + beatEnergy * 0.1 + bloomUniform.value * 0.6,
    fogDensity: MathUtils.lerp(MathUtils.lerp(0.0085, 0.0064, swing), freed ? 0.0017 : 0.004, finaleK),
    fogColor,
  });
  clarityUniform.value = clear;

  // ---- enemies ----
  const offBeat = Math.exp(-(((beat + 0.5) % 1) * 6));
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = now;
    const age = now - record.bornAt;
    const grow = record.kind === 'parent' ? smooth(age / 1.6) : easeOutBack(Math.min(1, age / 0.45));
    const emerging = (record.mesh.userData.emerging as number | undefined) ?? 0;
    record.mesh.scale.setScalar(Math.max(0.001, grow * (1 - emerging * 0.7)));
    animateEnemy(record, age, dt, offBeat);
    tintEnemy(record, camera);
    if (record.lockRing) {
      record.lockRing.position.copy(record.mesh.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      const fit = ((record.mesh.userData.lockScale as number | undefined) ?? 1) * (KIND_SCALE[record.kind] ?? 1);
      record.lockRing.scale.setScalar(fit * 1.55 * (1 + Math.sin(now * 10) * 0.04));
      record.lockRing.rotation.z = -now * 1.6;
      paintLockRing(record);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    if (now - record.lastTrail > 0.025) {
      record.lastTrail = now;
      effects?.burst(record.mesh.position, { count: 1, speed: 0.4, from: hdr(JELLY_GOLD, 0.9), to: hdr(JELLY_GREEN, 0.3), size: 0.12, life: 0.45, drag: 4 });
    }
  }

  updateCrownScenery(runTimeNow);
  for (const tick of tableau) {
    tick.mesh.visible = !ctx.running ? ctx.finaleElapsed < 0 && runTimeNow === 0 : runTimeNow < tick.spawnAt;
    if (!tick.mesh.visible) continue;
    for (const leg of tick.mesh.userData.legs as Group[]) {
      leg.rotation.z = (leg.userData.side as number) * (-0.35 + Math.sin(now * 2.2 + (leg.userData.phase as number)) * 0.08);
    }
  }
  effects?.update(dt, ctx.camera);
}

function animateEnemy(record: EnemyRecord, age: number, dt: number, offBeat: number) {
  const data = record.mesh.userData;
  const inner = data.inner as Group;
  switch (record.kind) {
    case 'tick': {
      const legs = data.legs as Group[];
      const latched = data.latched === true;
      for (const leg of legs) {
        const side = leg.userData.side as number;
        const phase = leg.userData.phase as number;
        if (latched) {
          leg.rotation.z = side * (-0.35 + Math.sin(now * 5 + phase) * 0.12);
          leg.rotation.x = 0;
        } else {
          leg.rotation.z = side * 0.35;
          leg.rotation.x = Math.sin(now * 16 + phase) * 0.55;
        }
      }
      inner.rotation.z = latched ? 0 : Math.sin(now * 6) * 0.25;
      inner.scale.setScalar((KIND_SCALE.tick) * (1 + offBeat * 0.06));
      break;
    }
    case 'creeper': {
      const segments = data.segments as Mesh[];
      const spacing = (data.segmentSpacing as number) * (KIND_SCALE.creeper ?? 1);
      const head = record.mesh.position;
      const last = record.history[0];
      if (!last || last.distanceTo(head) > 0.08) record.history.unshift(head.clone());
      if (record.history.length > 160) record.history.length = 160;
      record.mesh.updateMatrixWorld();
      let walked = 0;
      let cursor = 0;
      const world = new Vector3();
      segments.forEach((segment, index) => {
        const want = (index + 1) * spacing;
        while (cursor < record.history.length - 1) {
          const step = record.history[cursor].distanceTo(record.history[cursor + 1]);
          if (walked + step >= want) {
            const k = (want - walked) / Math.max(1e-4, step);
            world.copy(record.history[cursor]).lerp(record.history[cursor + 1], k);
            break;
          }
          walked += step;
          cursor += 1;
        }
        if (cursor >= record.history.length - 1) {
          // Not enough path yet: trail straight behind the head.
          world.set(0, 0, -want / (KIND_SCALE.creeper ?? 1)).applyMatrix4(inner.matrixWorld);
        }
        segment.position.copy(inner.worldToLocal(world.clone()));
        segment.scale.setScalar(1 + Math.sin(now * 7 - index * 0.8) * 0.06);
      });
      break;
    }
    case 'bladder': {
      const charge = (data.charge as number | undefined) ?? 0;
      const sacs = data.sacs as Mesh[];
      sacs.forEach((sac, index) => {
        const swell = 1 + charge * charge * 0.4 + Math.sin(now * 2.2 + index) * 0.05;
        sac.scale.setScalar(swell);
      });
      (data.core as Mesh).scale.setScalar(1 + charge * 0.6 + offBeat * 0.15);
      break;
    }
    case 'drifter': {
      const jet = (data.jet as number | undefined) ?? 0;
      const squeeze = Math.exp(-jet * 5);
      const bell = data.bell as Mesh;
      bell.scale.set(1 - squeeze * 0.28, 1 - squeeze * 0.28, 1 + squeeze * 0.25);
      for (const tendril of data.tendrils as Group[]) {
        tendril.rotation.x = Math.sin(now * 4 + (tendril.userData.phase as number)) * 0.25 - squeeze * 0.35;
      }
      break;
    }
    case 'hatchling':
      inner.rotation.z += dt * 2.4;
      inner.rotation.x = Math.sin(now * 3 + age) * 0.3;
      break;
    case 'spore': {
      const spin = data.spin as Mesh;
      spin.rotation.x += dt * 3.1;
      spin.rotation.y += dt * 4.3;
      inner.scale.setScalar((KIND_SCALE.spore ?? 1) * (1 + Math.sin(now * 18) * 0.08));
      break;
    }
    case 'parent':
      animateParentBody(record.mesh.userData.inner as Group, {
        exposed: true,
        pumpAge: 99,
        tornAt: record.mesh.userData.tornAt as number | undefined,
      });
      break;
  }
}

function animateParentBody(group: Group, state: { exposed: boolean; pumpAge: number; tornAt?: number }) {
  const data = group.userData;
  const pump = Math.exp(-state.pumpAge * 3);
  (data.pouch as Mesh).scale.setScalar(1 + pump * 0.35 + Math.sin(now * 2.4) * 0.04);
  for (const [index, egg] of (data.eggs as Mesh[]).entries()) {
    const home = egg.userData.home as Vector3;
    egg.position.copy(home).addScaledVector(new Vector3(Math.sin(now * 3 + index), Math.cos(now * 2.6 + index * 2), 0), 0.18);
    egg.scale.setScalar(1 + pump * 0.5);
  }
  for (const [index, eye] of (data.eyes as Mesh[]).entries()) {
    const flicker = 0.75 + 0.25 * Math.sin(now * (state.exposed ? 22 : 3) + index * 2);
    eye.scale.set(1.5, 0.32 * (state.exposed ? 1.6 : 1) * flicker, 0.5);
  }
  for (const [index, claw] of (data.claws as Group[]).entries()) {
    const thrash = state.exposed ? 0.18 : 0.05;
    claw.rotation.z = Math.sin(now * (state.exposed ? 7 : 1.6) + index) * thrash;
    if (state.tornAt !== undefined && index % 2 === 0) {
      // The ripped-out claws swing free.
      const k = smooth((now - state.tornAt) / 0.8);
      claw.rotation.x = k * (0.9 + Math.sin(now * 5 + index) * 0.2);
    } else {
      claw.rotation.x = 0;
    }
  }
}

function animateWeb(group: Group) {
  for (const sector of group.userData.sectors as Group[]) {
    // Only the sector feeding the current brood flares with the pump.
    const pump = Math.exp(-(now - ((sector.userData.pumpAt as number | undefined) ?? -99)) * 2.2);
    const witherAt = sector.userData.witherAt as number | undefined;
    const threads = sector.userData.threads as Mesh;
    const sheen = sector.userData.sheen as Mesh;
    const threadMaterial = threads.material as MeshBasicMaterial;
    const sheenMaterial = sheen.material as MeshBasicMaterial;
    if (witherAt === undefined) {
      sector.visible = true;
      sector.position.set(0, 0, 0);
      sector.scale.setScalar(1 + Math.sin(now * 1.8 + (sector.userData.centerAngle as number)) * 0.02 + pump * 0.05);
      sheenMaterial.color.copy(hdr(PARASITE_HOT, 0.35 + pump * 0.6));
      threadMaterial.color.copy(hdr(PARASITE_PALE, 0.85));
      threadMaterial.opacity = 0.85;
      continue;
    }
    // Withering: the threads blacken, sag, and drop away out of the crown.
    const k = MathUtils.clamp((now - witherAt) / 2.2, 0, 1);
    const angle = sector.userData.centerAngle as number;
    threadMaterial.color.copy(hdr(PARASITE_PALE, 0.85)).lerp(WITHERED_THREAD, Math.min(1, k * 2.5));
    threadMaterial.opacity = 0.85 * (1 - k);
    sheenMaterial.color.copy(hdr(JELLY_GREEN, 0.6 * Math.max(0, 1 - k * 3)));
    sector.scale.setScalar(1 - k * 0.3);
    sector.position.set(Math.cos(angle) * k * 3, Math.sin(angle) * k * 3 - k * k * 6, -k * 2);
    sector.visible = k < 1;
  }
}

const sceneryPose = { position: new Vector3(), quaternion: new Quaternion() };
const FALL_AXIS = new Vector3(0.6, 0.2, 0.77).normalize();
const PARENT_RING_POINT = new Vector3();

function updateCrownScenery(runTime: number) {
  const scenery = crownScenery;
  if (!scenery || scenery.arrivedAt < 0) return;
  const burrowK = scenery.burrowAt >= 0 ? smooth((now - scenery.burrowAt) / 1.6) : 0;
  parentPose(runTime, { torn: false, burrowK }, sceneryPose);
  const group = scenery.group;
  group.position.copy(sceneryPose.position);
  group.quaternion.copy(sceneryPose.quaternion);
  group.scale.setScalar(smooth((now - scenery.arrivedAt) / 1.6) * (1 - burrowK * 0.25));
  animateWeb(group);
  const body = group.userData.bodyParts as Object3D[] | undefined;
  if (scenery.fallAt >= 0) {
    // Torn loose: it drops out of the crown, tumbling, and is gone into the blue.
    const k = now - scenery.fallAt;
    if (body) for (const part of body) part.visible = k < 3.2;
    group.position.copy(scenery.fallFrom).add(new Vector3(0, -k * k * 7 - k * 3, 0));
    group.quaternion.copy(scenery.fallQuaternion).multiply(new Quaternion().setFromAxisAngle(FALL_AXIS, k * 1.3));
    group.scale.setScalar(Math.max(0.001, 1 - smooth(k / 3.2) * 0.6));
    animateParentBody(group, { exposed: true, pumpAge: 99, tornAt: scenery.fallAt - 1 });
    return;
  }
  // The body hands over to the lockable parent the moment it is bare.
  const bodyVisible = scenery.hideAt < 0;
  if (body) for (const part of body) part.visible = bodyVisible;
  if (bodyVisible) animateParentBody(group, { exposed: false, pumpAge: now - scenery.pumpAt });
}

function tintEnemy(record: EnemyRecord, camera: PerspectiveCamera) {
  const data = record.mesh.userData;
  const parts = data.parts as TintPart[] | undefined;
  if (!parts) return;
  const denied = ((data.deniedUntil as number | undefined) ?? -Infinity) > now;
  const locked = data.locked === true;
  const flash = ((data.hitFlashUntil as number | undefined) ?? -Infinity) > now;
  const distance = record.mesh.position.distanceTo(camera.position);
  const near = 1 - smooth((distance - 14) / 50) * 0.35;
  const exposed = record.kind === 'parent' && (data.crownPhase === 'exposed' || data.crownPhase === 'torn');
  for (const part of parts) {
    const material = part.material;
    let color: Color;
    if (denied) color = part.kind === 'shell' ? hdr(DENY, 0.55) : hdr(DENY, 1.5);
    else if (flash) color = part.kind === 'shell' ? HIT_FLASH.clone().multiplyScalar(0.7) : HIT_FLASH;
    else if (locked) color = part.kind === 'shell' ? part.base.clone().lerp(JELLY_GOLD, 0.45) : hdr(record.lockColor, 1.5);
    else color = part.base.clone().multiplyScalar(part.kind === 'shell' ? near : near * (exposed ? 1.4 : 1));
    material.color.copy(color);
    if (material instanceof MeshPhongMaterial) {
      material.emissive.copy(color).multiplyScalar(locked ? 0.6 : denied ? 0.7 : 0.32);
    }
  }
}

const LOCK_RING_GEOMETRY = new RingGeometry(0.96, 1.02, 48);
const LOCK_BEAD_GEOMETRY = new SphereGeometry(0.085, 8, 6);

function makeLockRing() {
  const group = new Group();
  const ringMaterial = createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide });
  const ring = new Mesh(LOCK_RING_GEOMETRY, ringMaterial);
  group.add(ring);
  const beadGeometry = LOCK_BEAD_GEOMETRY;
  const beads: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 2 - (i / 6) * Math.PI * 2;
    const material = new MeshBasicMaterial({ color: 0xffffff });
    const bead = new Mesh(beadGeometry, material);
    bead.position.set(Math.cos(angle), Math.sin(angle), 0.02);
    group.add(bead);
    beads.push(material);
  }
  group.userData.ringMaterial = ringMaterial;
  group.userData.beads = beads;
  group.userData.bornAt = now;
  return group;
}

function paintLockRing(record: EnemyRecord) {
  const ring = record.lockRing;
  if (!ring) return;
  const capacity = record.kind === 'parent' || record.kind === 'bladder';
  const lit = capacity ? record.locks : 6;
  const born = ring.userData.bornAt as number;
  const snap = 1 + 0.6 * Math.exp(-(now - born) * 14);
  ring.scale.multiplyScalar(snap);
  (ring.userData.ringMaterial as MeshBasicMaterial).color.copy(hdr(record.lockColor, 1.1));
  (ring.userData.beads as MeshBasicMaterial[]).forEach((material, index) => {
    material.color.copy(index < lit ? hdr(record.lockColor, 1.8) : new Color(0.08, 0.14, 0.12));
  });
}

// ---- camera feel ------------------------------------------------------------------------

const tangentA = new Vector3();
const tangentB = new Vector3();
const rightVector = new Vector3();

export function updateCameraFeel(dt: number, camera: PerspectiveCamera, runTime: number, finaleElapsed: number, feel: CameraFeelRig) {
  // Bank into the rail's turns: the orbit around the animal is a constant
  // gentle lean, the swing out and the dive back in roll harder.
  // A coordinated turn: lean by v²κ, so the slow drift barely tilts and the
  // swoops out and back lean hard.
  const u = strandlineRunProgress(runTime);
  const du = 0.012;
  RAIL.curve.getTangentAt(MathUtils.clamp(u, 0, 1), tangentA);
  RAIL.curve.getTangentAt(MathUtils.clamp(u + du, 0, 1), tangentB);
  rightVector.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const curvature = tangentB.sub(tangentA).dot(rightVector) / (du * RAIL.length);
  const speed = runTime < STRANDLINE_DURATION ? railSpeedAt(runTime) : 0;
  const settle = 1 - smooth((runTime - bar(14)) / bar(1.5));
  const targetRoll = finaleElapsed >= 0 ? 0 : MathUtils.clamp(Math.atan((-speed * speed * curvature) / 22), -0.3, 0.3) * settle;
  cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 2.4);
  camera.rotateZ(cameraRoll);

  // Each bell contraction pushes a surge of water through: the camera
  // gives with it, gently in the forest and more under the crown.
  const surgeTarget = pulse * pulse * (runTime > bar(14.5) && finaleElapsed < 0 ? 0.45 : 0.15);
  surge += (surgeTarget - surge) * Math.min(1, dt * 9);
  camera.translateY(-surge);

  const targetFov = MathUtils.clamp((speed - 10) * 0.35, -2, 4.5) + beatEnergy * 0.5 + (finaleElapsed >= 0 ? 4 * smooth(finaleElapsed / 3) : 0);
  fovOffset += (targetFov - fovOffset) * Math.min(1, dt * 3);
  feel.setFovOffset(fovOffset);
  feel.update(dt, { shake: SHAKE });
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
