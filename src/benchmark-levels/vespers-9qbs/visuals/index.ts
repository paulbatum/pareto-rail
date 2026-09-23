import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  FogExp2,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
  type Camera,
  type Material,
  type Object3D,
} from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';
import { createEventBus, type EventBus } from '../../../events';
import {
  cameraPointAt,
  inCrossing,
  PIER_ZS,
  railZAt,
  VAULT_Y,
  ROSE_CENTER,
  ROSE_RADIUS,
  WINDOWS,
} from '../cathedral';
import { createVespersGameplay } from '../gameplay';
import { VESPERS_MARKERS } from '../timing';
import { createArchitecture, createCoronae, createStoneLighting, STONE_LIGHT_SLOTS, type StoneLighting } from './architecture';
import {
  createCenser,
  createClaw,
  createHeart,
  createMoth,
  createRosette,
  createShade,
  createShard,
  type CreatureParts,
} from './creatures';
import { createEffects, type Effects } from './effects';
import { createGlassField, type GlassField } from './glass';
import { createStainedLetter, type LetterParts } from './letters';
import {
  ASH,
  CANDLE,
  CANDLE_FLAME,
  FLAME,
  hdr,
  jewel,
  JEWEL_ACCENTS,
  JEWELS,
  LOCK_GOLD,
  LOCK_GRADIENT,
  LOCK_WHITE,
  STONE,
  STONE_LIT,
  WAX,
} from './palette';
import { breathUniform, flashTint, flashUniform, washUniform } from './post-fx';
import { createRose, layoutTendrils, type RoseParts } from './rose';

// Spine: palette use and event choreography. The story on screen:
// windows that still hold light glow softly ahead; a creature peels off one
// and the window goes black as its colour is pulled into the creature's
// chest; a kill sends that colour home along an arc and the window blazes,
// throwing its colour onto the stone and down in a shaft, and stays lit.
// At the west end the rose is dead with something nested in it; when that
// dies the rose ignites all at once and every window in the building follows.

// ---- tuning -----------------------------------------------------------------------

const WINDOW_DEAD = 0.035;
const WINDOW_WAITING = 0.5;
const WINDOW_DRAINED = 0.01;
const WINDOW_RELIT = 1.75;
const WINDOW_RELIT_FLASH = 5.2;
const WINDOW_FINALE = 1.15;
const RELIT_LIGHT = 1.5;
const WAITING_LIGHT = 0.22;
const FINALE_LIGHT = 0.45;
const ROSE_LIGHT = 5.5;
const SHAFT_RELIT = 0.06;
const RETURN_SECONDS = 0.62; // one beat at 96 BPM: the glass chime lands with it
const IGNITION_WAVE_SPEED = 70; // units/s the ignition runs back down the nave
const QUIET_FROM = railZAt(VESPERS_MARKERS.quiet - 1);
const QUIET_TO = railZAt(VESPERS_MARKERS.rose + 1);

const SHAKE: CameraFeelShakeOptions = { decay: 2.2, maxTrauma: 1.6, pitchDegrees: 0.3, yawDegrees: 0.26, rollDegrees: 0.6, frequency: 7, smoothing: 18 };

const LETTER_HUES: Record<string, number> = { S: 0, T: 1, A: 2, R: 3, '!': 3, E: 0, P: 2, L: 1, Y: 0 };

// Windows the timeline will strip: these still hold light when the run begins.
const CLAIMED = new Set<number>();
for (const entry of createVespersGameplay(createEventBus()).spawnTimeline) {
  const data = entry.data as { window?: number };
  if (typeof data.window === 'number' && data.window >= 0) CLAIMED.add(data.window);
}

type WindowState = 'dead' | 'waiting' | 'drained' | 'relit';

type EnemyRecord = {
  mesh: Group;
  kind: string;
  parts?: CreatureParts;
  letter?: LetterParts;
  hue: Color;
  bornAt: number;
  charge: number;
  lockRing: Group | null;
  flashUntil: number;
  windowIndex: number;
};

type ProjectileRecord = { mesh: Object3D };

// ---- module state -------------------------------------------------------------------

let lighting: StoneLighting | null = null;
let glass: GlassField | null = null;
let rose: RoseParts | null = null;
let effects: Effects | null = null;
let feelRig: CameraFeelRig | null = null;
let elapsedNow = 0;
let runTime = 0;
let running = false;
let beatGlow = 0;
let heartSpawned = false;
let heartExposed = false;
let burnedAt = -1;
let burnedAtWall = -1;
// Same threshold the audio uses to pick its tutti beat (audio.ts `burn`).
const BREATH_SECONDS = 0.32;
let ignitedAt = -1;
let awaitingIgnition = false;
let breath = 0;
let finaleFov = 0;
let cameraRoll = 0;
let previewIgnitionAt = -1;
let previewRelight = false;
const previewRelights: Array<{ index: number; at: number }> = [];

/** Debug preview (snapshots cannot shoot): run the rose's ignition at a fixed run time. */
export function previewRoseIgnition(atRunTime: number) {
  previewIgnitionAt = atRunTime;
}

/** Debug preview: every stripped window relights shortly after, as if its creature died. */
export function previewRelitWindows() {
  previewRelight = true;
}

const windowState: WindowState[] = WINDOWS.map(() => 'dead');
const windowLevel = new Float32Array(WINDOWS.length);
const windowFlash = new Float32Array(WINDOWS.length);
const windowFinaleAt = new Float32Array(WINDOWS.length).fill(-1);
const windowShaftOn = new Uint8Array(WINDOWS.length);
const windowIgnited = new Uint8Array(WINDOWS.length);

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
  disposeAdornment: disposeMaterials,
});

const enemies = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({
    mesh,
    kind: mesh.userData.kind as string,
    parts: mesh.userData.parts as CreatureParts | undefined,
    letter: mesh.userData.letterParts as LetterParts | undefined,
    hue: new Color(1, 1, 1),
    bornAt: elapsedNow,
    charge: 1,
    lockRing: null,
    flashUntil: -1,
    windowIndex: -1,
  }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    disposeMaterials(record.mesh);
  },
});
const projectiles = createPendingVisualRecords<Object3D, ProjectileRecord>({ createRecord: (mesh) => ({ mesh }) });

function disposeMaterials(object: Object3D) {
  object.traverse((child) => {
    const material = (child as Mesh).material as Material | Material[] | undefined;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
  });
}

// ---- environment ------------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  const root = new Group();
  root.name = 'vespers-cathedral';
  scene.background = new Color(0, 0, 0);
  scene.fog = new FogExp2(0x000000, 0.0058);

  lighting = createStoneLighting();
  const quietDensity = (z: number) => (z < QUIET_FROM && z > QUIET_TO ? 0.18 : 1);
  createArchitecture(root, lighting, { stone: STONE, rib: STONE_LIT, candle: CANDLE, flame: CANDLE_FLAME }, quietDensity);
  // Coronae hang in every other bay, alternating sides, above the flight path.
  const hangs: Vector3[] = [];
  for (let i = 0; i < PIER_ZS.length - 1; i += 2) {
    const z = (PIER_ZS[i] + PIER_ZS[i + 1]) / 2;
    if (inCrossing(z) || z < QUIET_FROM && z > QUIET_TO) continue;
    hangs.push(new Vector3(((i / 2) % 2 === 0 ? -1 : 1) * 12.5, 24, z));
  }
  createCoronae(root, hangs, VAULT_Y - 4, lighting, { iron: STONE, candle: CANDLE, flame: CANDLE_FLAME });
  glass = createGlassField(root, WINDOWS, { jewels: JEWELS, accents: JEWEL_ACCENTS, highlight: WAX }, 32, 1.12);
  // The tracery is always seen against its own glass: backlit, it stays black.
  rose = createRose(ROSE_CENTER, ROSE_RADIUS, JEWELS, new MeshBasicMaterial({ color: new Color(0.006, 0.005, 0.006) }));
  root.add(rose.group, rose.tendrils);
  effects = createEffects(root);
  scene.add(root);
  resetWindows();
  return root;
}

function resetWindows() {
  for (let i = 0; i < WINDOWS.length; i += 1) {
    windowState[i] = CLAIMED.has(i) ? 'waiting' : 'dead';
    windowLevel[i] = CLAIMED.has(i) ? WINDOW_WAITING : WINDOW_DEAD;
    windowFlash[i] = 0;
    windowFinaleAt[i] = -1;
    windowShaftOn[i] = 0;
    windowIgnited[i] = 0;
    glass?.setShaft(i, null);
  }
}

// ---- creatures -----------------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  const placeholder = new Color(1, 0.66, 0.1);
  let mesh: Group;
  switch (kind) {
    case 'letter': {
      const hue = LETTER_HUES[(letter ?? 'A').toUpperCase()] ?? 3;
      mesh = createStainedLetter(letter ?? 'A', JEWELS[hue], JEWELS[JEWEL_ACCENTS[hue][0]], (letter ?? 'A').charCodeAt(0) * 17);
      break;
    }
    case 'moth': mesh = createMoth(placeholder); break;
    case 'rosette': mesh = createRosette(placeholder); break;
    case 'shade': mesh = createShade(placeholder); break;
    case 'censer': mesh = createCenser(placeholder); break;
    case 'shard': mesh = createShard(placeholder); break;
    case 'claw': mesh = createClaw(placeholder); break;
    case 'heart': mesh = createHeart(JEWELS); break;
    default: mesh = createMoth(placeholder);
  }
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemies.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  if (!effects) return;
  const facing = currentCameraQuaternion();
  effects.ring(mesh.position, facing, hdr(ASH, 1.4), 1.2, 3.4, 0.35);
  effects.burst(mesh.position, hdr(ASH, 0.8), 6, 5, { size: 0.7, life: 0.35 });
}

// ---- player marks: candle-flame gold ------------------------------------------------

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.2, 0), new MeshBasicMaterial({ color: hdr(FLAME, 3.2) }));
  core.scale.set(0.8, 0.8, 2.6);
  const glow = new Mesh(new OctahedronGeometry(0.42, 0), new MeshBasicMaterial({ color: hdr(FLAME, 0.9), transparent: true, blending: AdditiveBlending, depthWrite: false }));
  glow.scale.set(0.9, 0.9, 2.2);
  group.add(core, glow);
  group.userData.raildRole = 'projectile';
  projectiles.enqueue(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: MeshBasicMaterial[] = [];
  const material = () => {
    const created = new MeshBasicMaterial({ color: hdr(LOCK_GOLD, 1.1), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    parts.push(created);
    return created;
  };
  const ring = new Mesh(new RingGeometry(1.14, 1.21, 72), material());
  // Inner quatrefoil: four cusped arcs, the gothic sight.
  const spinner = new Group();
  for (let k = 0; k < 4; k += 1) {
    const angle = (k / 4) * Math.PI * 2;
    const lobe = new Mesh(new RingGeometry(0.3, 0.35, 28, 1, angle + Math.PI * 0.55, Math.PI * 0.9), material());
    lobe.position.set(Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0);
    spinner.add(lobe);
  }
  const dot = new Mesh(new CircleGeometry(0.06, 16), material());
  const pips = new Group();
  const pipMaterials: MeshBasicMaterial[] = [];
  for (let k = 0; k < 6; k += 1) {
    const angle = Math.PI / 2 - (k / 6) * Math.PI * 2;
    const pipMaterial = new MeshBasicMaterial({ color: hdr(LOCK_GOLD, 0.25), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    const pip = new Mesh(new CircleGeometry(0.1, 4), pipMaterial);
    pip.position.set(Math.cos(angle) * 1.42, Math.sin(angle) * 1.42, 0);
    pips.add(pip);
    pipMaterials.push(pipMaterial);
  }
  group.add(ring, spinner, dot, pips);
  group.userData.parts = parts;
  group.userData.pips = pipMaterials;
  group.userData.spinner = spinner;
  group.userData.reticle = true;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + (active ? 0.06 : 0) + lockCount * 0.025);
  const tone = lockCount === 0 ? LOCK_GOLD : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of reticle.userData.parts as MeshBasicMaterial[]) part.color.copy(hdr(tone, active ? 1.5 : 1.05));
  (reticle.userData.pips as MeshBasicMaterial[]).forEach((pip, index) => {
    pip.color.copy(index < lockCount ? hdr(LOCK_WHITE, 2.2) : hdr(LOCK_GOLD, 0.22));
  });
}

function makeLockRing(size: number, lockCount: number) {
  const group = new Group();
  const color = hdr(colorForLockCount(lockCount, LOCK_GRADIENT), 1.9);
  const material = new MeshBasicMaterial({ color, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  // Four arcs with gaps: a quatrefoil clamp closing on the creature.
  for (let k = 0; k < 4; k += 1) {
    const arc = new Mesh(new RingGeometry(1, 1.09, 20, 1, (k / 4) * Math.PI * 2 + 0.2, Math.PI / 2 - 0.4), material);
    group.add(arc);
  }
  group.scale.setScalar(size * 1.3);
  group.userData.size = size;
  return group;
}

// ---- event choreography ------------------------------------------------------------

let cameraForEvents: Camera | null = null;
function currentCameraQuaternion() {
  return cameraForEvents ? cameraForEvents.quaternion.clone() : new Quaternion();
}

function drainWindow(index: number, into: EnemyRecord, streak: boolean) {
  const slot = WINDOWS[index];
  if (!slot || !effects) return;
  windowState[index] = 'drained';
  windowFlash[index] = 1.4;
  const color = hdr(jewel(slot.hue), 1.6);
  effects.burst(slot.position.clone().addScaledVector(slot.inward, 1), color, 14, 6, { size: 1, life: 0.6 });
  if (streak) {
    into.charge = 0.15;
    effects.streak(slot.position, into.mesh.position, color, 0.7, 5, 1.1, () => {
      into.charge = 1;
    });
  }
}

function relight(index: number) {
  const slot = WINDOWS[index];
  if (!slot || !effects) return;
  windowState[index] = 'relit';
  windowFlash[index] = WINDOW_RELIT_FLASH - WINDOW_RELIT;
  const color = hdr(jewel(slot.hue), 1.8);
  const facing = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), slot.inward);
  effects.ring(slot.position.clone().addScaledVector(slot.inward, 0.6), facing, color, 1.5, slot.height * 0.9, 0.7);
  effects.burst(slot.position.clone().addScaledVector(slot.inward, 1.2), color, 26, 9, { size: 1.2, life: 0.9, gravity: 4 });
}

function applyCreatureHue(record: EnemyRecord, hueIndex: number) {
  record.hue.copy(hueIndex < 0 ? new Color(1, 1, 1) : jewel(hueIndex));
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  feelRig = feel;
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemies.claim(enemyId);
    if (!record || !effects) return;
    const hueIndex = typeof record.mesh.userData.hue === 'number' ? record.mesh.userData.hue as number : 3;
    applyCreatureHue(record, kind === 'letter' ? LETTER_HUES[record.mesh.userData.raildEnemyLetter as string] ?? 3 : hueIndex);
    record.windowIndex = typeof record.mesh.userData.windowIndex === 'number' ? record.mesh.userData.windowIndex as number : -1;
    if (kind === 'heart') {
      heartSpawned = true;
      return;
    }
    if (record.windowIndex >= 0) {
      drainWindow(record.windowIndex, record, kind === 'censer' || kind === 'claw');
      const index = record.windowIndex;
      if (previewRelight) previewRelights.push({ index, at: elapsedNow + 1.2 });
    }
    if (kind === 'letter') effects.ring(worldPosition, currentCameraQuaternion(), hdr(record.hue, 1.2), 0.5, 2.6, 0.5);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemies.get(enemyId);
    if (!effects) return;
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(record.parts?.size ?? 1.6, lockCount), scene);
    effects.ring(worldPosition, currentCameraQuaternion(), hdr(colorForLockCount(lockCount, LOCK_GRADIENT), 1.6), 0.4, 2.4, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemies.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectiles.claim(projectileId);
    effects?.burst(worldPosition, hdr(FLAME, 1.2), 3, 3, { size: 0.6, life: 0.25 });
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId);
    const record = enemies.get(enemyId);
    if (!effects) return;
    effects.burst(worldPosition, hdr(FLAME, 1.4), 6, 7, { size: 0.8, life: 0.3 });
    if (record && !lethal) {
      record.flashUntil = elapsedNow + 0.16;
      effects.burst(worldPosition, hdr(record.hue, 1.6), 10, 8, { size: 1, life: 0.5 });
      effects.shatter(worldPosition, record.kind === 'heart' ? 5 : 3, 7, record.kind === 'heart' ? 1.2 : 0.6);
      if (record.kind === 'heart') feelRig?.shake(0.25, SHAKE);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemies.get(enemyId);
    if (!record || !effects || record.kind !== 'heart') return;
    const shell = record.parts?.animated[`shell${stageIndex - 1}`];
    if (shell) shell.visible = false;
    effects.shatter(worldPosition, 60, 16, 1.8);
    effects.burst(worldPosition, hdr(JEWELS[stageIndex % 4], 2), 50, 16, { size: 1.4, life: 1 });
    effects.ring(worldPosition, currentCameraQuaternion(), hdr(WAX, 1.6), 3, 16, 0.7);
    feelRig?.shake(0.8, SHAKE);
    feelRig?.kickFov(2.5);
  });

  bus.on('kill', ({ enemyId, worldPosition, indexInVolley }) => {
    const record = enemies.get(enemyId);
    if (!record || !effects) return;
    const size = record.parts?.size ?? 1.4;
    const hot = hdr(record.hue, 1.8);
    lockRings.detach(record);
    if (record.kind === 'heart') {
      burnHeart(worldPosition);
      enemies.delete(enemyId, { dispose: true });
      return;
    }
    if (record.kind === 'letter') {
      effects.burst(worldPosition, hot, 24, 10, { size: 1, life: 0.7, gravity: 5 });
      effects.ring(worldPosition, currentCameraQuaternion(), hot, 0.6, 3.2, 0.45);
      enemies.delete(enemyId, { dispose: true });
      return;
    }
    effects.shatter(worldPosition, Math.round(8 + size * 5), 9, size * 0.7);
    effects.burst(worldPosition, hot, 18, 11, { size: 1.1, life: 0.6 });
    effects.ring(worldPosition, currentCameraQuaternion(), hot, 0.5, size * 2.6, 0.4);
    // The light goes home along an arc, a beat later the window blazes.
    const windowIndex = record.windowIndex;
    const slot = WINDOWS[windowIndex];
    if (slot && record.kind !== 'shard') {
      const target = slot.position.clone().addScaledVector(slot.inward, 0.8);
      effects.streak(worldPosition, target, hot, RETURN_SECONDS + (indexInVolley ?? 0) * 0.02, 6 + size * 2, 1.2, () => relight(windowIndex));
    }
    if ((indexInVolley ?? 0) >= 5) feelRig?.kickFov(1.2);
    enemies.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (record && effects && running && record.kind !== 'letter' && record.kind !== 'heart') {
      // It carries its colour off into the dark.
      effects.burst(worldPosition, hdr(record.hue, 0.5), 6, 3, { size: 0.8, life: 0.9, gravity: -3 });
    }
    if (record) enemies.delete(enemyId, { dispose: true });
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 6 && kills === size) {
      beatGlow = Math.max(beatGlow, 1.4);
      feelRig?.kickFov(1.6);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatGlow = Math.max(beatGlow, isDownbeat ? 1 : 0.35);
    if (awaitingIgnition && performance.now() / 1000 - burnedAtWall >= BREATH_SECONDS) ignite();
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      heartExposed = true;
      if (effects && rose) {
        // It tears loose from the glass.
        effects.shatter(ROSE_CENTER.clone().add(new Vector3(0, 0, 3)), 40, 14, 2);
        effects.ring(ROSE_CENTER.clone().add(new Vector3(0, 0, 2)), new Quaternion(), hdr(WAX, 1.2), 4, ROSE_RADIUS * 1.2, 0.8);
      }
      feelRig?.shake(0.7, SHAKE);
    }
  });

  bus.on('playerhit', () => {
    feelRig?.shake(1.1, SHAKE);
    flashTint.value.copy(new Color(0.8, 0.06, 0.05));
    flashUniform.value = Math.max(flashUniform.value, 0.28);
  });

  bus.on('runstart', () => {
    running = true;
    runTime = 0;
    heartSpawned = false;
    heartExposed = false;
    burnedAt = -1;
    ignitedAt = -1;
    awaitingIgnition = false;
    breath = 0;
    finaleFov = 0;
    enemies.clear({ dispose: true });
    projectiles.clear();
    effects?.clear();
    resetWindows();
    if (lighting) {
      lighting.candle.value = 1;
      lighting.ambient.value = 1;
    }
    flashUniform.value = 0;
    washUniform.value = 0;
    breathUniform.value = 0;
    feelRig?.restore();
  });

  bus.on('runend', () => {
    running = false;
  });
}

// ---- the rose ----------------------------------------------------------------------

function burnHeart(position: Vector3) {
  if (!effects) return;
  effects.shatter(position, 90, 22, 2.2);
  for (let i = 0; i < 4; i += 1) effects.burst(position, hdr(JEWELS[i], 2.4), 30, 20, { size: 1.6, life: 1.2 });
  effects.ring(position, currentCameraQuaternion(), hdr(WAX, 2.2), 2, 30, 0.9);
  flashTint.value.copy(new Color(1, 0.92, 0.8));
  flashUniform.value = 0.7;
  feelRig?.shake(1.2, SHAKE);
  // The breath: the building goes dark for a beat before it ignites.
  burnedAt = elapsedNow;
  burnedAtWall = performance.now() / 1000;
  awaitingIgnition = true;
  heartExposed = false;
}

function ignite() {
  if (!awaitingIgnition || !effects || !rose) return;
  awaitingIgnition = false;
  ignitedAt = elapsedNow;
  flashTint.value.copy(new Color(1, 0.84, 0.58));
  flashUniform.value = 0.8;
  washUniform.value = 0.3;
  feelRig?.shake(1.3, SHAKE);
  feelRig?.kickFov(6);
  for (let i = 0; i < 4; i += 1) {
    effects.ring(ROSE_CENTER.clone().add(new Vector3(0, 0, 2 + i)), new Quaternion(), hdr(JEWELS[i], 2.2), ROSE_RADIUS * 0.6, ROSE_RADIUS * (2.2 + i * 0.7), 1.2 + i * 0.3);
  }
  for (let i = 0; i < 4; i += 1) effects.burst(ROSE_CENTER.clone().add(new Vector3(0, 0, 4)), hdr(JEWELS[i], 2), 60, 26, { size: 2, life: 2.2, gravity: 6 });
  // The fire runs back down the nave, window by window.
  for (let i = 0; i < WINDOWS.length; i += 1) {
    const distance = WINDOWS[i].position.distanceTo(ROSE_CENTER);
    windowFinaleAt[i] = elapsedNow + 0.15 + distance / IGNITION_WAVE_SPEED;
  }
}

// ---- per frame ----------------------------------------------------------------------

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
};

const lightCandidates: Array<{ index: number; score: number; intensity: number }> = [];
// The rose throws its light down the nave, not onto its own wall.
const ROSE_POOLS: Array<[number, number, number]> = [[-17, -6, 0], [17, -6, 1], [0, -24, 3]];
const tmpVector = new Vector3();
const inverseParent = new Quaternion();

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  runTime = ctx.runTime;
  cameraForEvents = ctx.camera;
  if (previewIgnitionAt >= 0 && ctx.running && runTime >= previewIgnitionAt && ignitedAt < 0 && !awaitingIgnition) {
    burnHeart(ctx.camera.position.clone().add(ctx.camera.getWorldDirection(new Vector3()).multiplyScalar(29)));
  }
  beatGlow = Math.max(0, beatGlow - dt * 3);
  for (let i = previewRelights.length - 1; i >= 0; i -= 1) {
    if (elapsedNow < previewRelights[i].at) continue;
    relight(previewRelights[i].index);
    previewRelights.splice(i, 1);
  }
  // Without audio there are no beats to land on; ignite on the visual clock.
  if (awaitingIgnition && elapsedNow - burnedAt >= 0.95) ignite();
  if (awaitingIgnition) breath = Math.min(0.72, breath + dt * 4);
  else breath = Math.max(0, breath - dt * 2.5);
  breathUniform.value = breath;
  flashUniform.value = Math.max(0, flashUniform.value - dt * 1.7);

  updateWindows(dt, ctx);
  updateRose(dt, ctx);
  updateEnemies(dt, ctx);
  updateLights(ctx);

  for (const [id, record] of projectiles.entries()) {
    if (!record.mesh.parent) {
      projectiles.delete(id);
      continue;
    }
    effects?.spark(record.mesh.position, tmpVector.set(0, 0, 0), hdr(FLAME, 0.9), 0.9, 0.25, 0, 0);
  }

  const reticle = ctx.scene.children.find((child) => child.userData.reticle || child.children.some((inner) => inner.userData.reticle));
  const inner = reticle?.userData.reticle ? reticle : reticle?.children.find((child) => child.userData.reticle);
  if (inner) {
    const spinner = inner.userData.spinner as Group;
    spinner.rotation.z += dt * (inner.userData.active ? 3.2 : 0.6);
  }

  effects?.update(dt, ctx.camera);
  glass?.commit();
}

function updateWindows(dt: number, ctx: VisualContext) {
  if (!glass) return;
  const shimmer = Math.sin(elapsedNow * 2.3);
  const finale = ignitedAt >= 0;
  for (let i = 0; i < WINDOWS.length; i += 1) {
    const state = windowState[i];
    let target = state === 'relit' ? WINDOW_RELIT + beatGlow * 0.25 : state === 'waiting' ? WINDOW_WAITING + shimmer * 0.05 + ((i * 7) % 5) * 0.02 : state === 'drained' ? WINDOW_DRAINED : WINDOW_DEAD;
    const lit = finale && windowFinaleAt[i] >= 0 && elapsedNow >= windowFinaleAt[i];
    if (lit) {
      if (!windowIgnited[i]) {
        windowIgnited[i] = 1;
        windowFlash[i] = Math.max(windowFlash[i], state === 'relit' ? 1.2 : 2.6);
      }
      target = Math.max(target, state === 'relit' ? WINDOW_RELIT + 0.4 : WINDOW_FINALE);
    }
    const rate = state === 'drained' ? 4 : 2.5;
    windowLevel[i] += (target - windowLevel[i]) * Math.min(1, dt * rate);
    windowFlash[i] = Math.max(0, windowFlash[i] - dt * 3.2);
    glass.setBrightness(i, windowLevel[i] + windowFlash[i]);

    // Only the windows the player won back pour a shaft; the rest simply glow.
    const shaft = state === 'relit' ? 1 : 0;
    if (shaft !== windowShaftOn[i]) {
      windowShaftOn[i] = shaft;
      // High lantern lights are far from anything; their shafts stay faint.
      const tierScale = WINDOWS[i].tier === 'lantern' ? 0.35 : WINDOWS[i].tier === 'transept' ? 0.6 : 1;
      glass.setShaft(i, shaft === 0 ? null : hdr(jewel(WINDOWS[i].hue), SHAFT_RELIT * tierScale));
    }
  }
  void ctx;
}

function updateRose(dt: number, ctx: VisualContext) {
  if (!rose) return;
  const since = ignitedAt >= 0 ? elapsedNow - ignitedAt : -1;
  const escaped = ctx.running && ignitedAt < 0 && !awaitingIgnition && runTime >= VESPERS_MARKERS.deadline - 1.3;
  // Glass: dead until ignition, then a blinding flare settling into a blaze.
  const glow = since < 0 ? 0.012 : 1.35 + 1.8 * Math.exp(-since * 1.4) + Math.sin(elapsedNow * 1.7) * 0.05;
  rose.glass.color.setScalar(glow);
  rose.burst.color.setScalar(since < 0 ? 0 : 0.55 * Math.exp(-since * 1.1));
  // The rays belong to the moment of ignition; afterwards the glass speaks for itself.
  rose.shafts.color.setScalar(since < 0 ? 0 : 0.16 * Math.exp(-since * 0.8));
  rose.group.children[2].rotation.z += dt * 0.05;
  washUniform.value = since < 0 ? 0 : 0.25 * Math.exp(-since * 1.2);

  // The Thing in the glass: dormant, waking, gone, or — if it wins — back.
  const nestVisible = ignitedAt < 0 && !awaitingIgnition && (!heartExposed || escaped);
  rose.nest.visible = nestVisible;
  const wake = heartSpawned ? 1 : MathUtils.clamp((runTime - VESPERS_MARKERS.quiet) / 6, 0, 0.35);
  rose.nest.rotation.z += dt * (0.05 + wake * 0.1);
  rose.nestEyes.forEach((eye, index) => {
    const pulse = 0.6 + 0.4 * Math.sin(elapsedNow * (1.3 + index * 0.21) + index);
    eye.color.copy(JEWELS[index % 4]).multiplyScalar((escaped ? 2.6 : 0.25 + wake * 1.8) * pulse);
  });

  if (lighting) {
    const quiet = ctx.running && runTime > VESPERS_MARKERS.quiet - 0.5 && runTime < VESPERS_MARKERS.rose;
    const candleTarget = since >= 0 ? 1.05 : quiet ? 0.55 : escaped ? 0.6 : 1;
    const ambientTarget = since >= 0 ? 0.8 : quiet ? 0.55 : escaped ? 0.6 : 1;
    lighting.candle.value += (candleTarget + beatGlow * 0.06 - lighting.candle.value) * Math.min(1, dt * 1.5);
    lighting.ambient.value += (ambientTarget - lighting.ambient.value) * Math.min(1, dt * 1.2);
  }
}

function updateEnemies(dt: number, ctx: VisualContext) {
  const camera = ctx.camera;
  const links: Array<{ from: Vector3; to: Vector3; thickness: number; sway: number }> = [];
  for (const [id, record] of enemies.entries()) {
    const mesh = record.mesh;
    if (!mesh.parent) {
      enemies.delete(id, { dispose: true });
      continue;
    }
    const age = elapsedNow - record.bornAt;
    const grow = Math.min(1, age / 0.35);
    const back = 1 + 2.2 * (grow - 1) ** 3 + 1.2 * (grow - 1) ** 2;
    mesh.scale.setScalar(Math.max(0.001, back));

    const locked = mesh.userData.locked === true;
    const denied = ((mesh.userData.deniedUntil as number | undefined) ?? -1) > elapsedNow;
    const flashing = record.flashUntil > elapsedNow;

    if (record.letter) {
      const parts = record.letter;
      if (denied) parts.glass.color.setRGB(0.25, 0.25, 0.3);
      else parts.glass.color.setScalar(locked ? 2.6 : 1.5 + Math.sin(elapsedNow * 2 + id) * 0.12);
      parts.frame.color.copy(denied ? hdr(ASH, 1.4) : locked ? hdr(LOCK_GOLD, 2) : new Color(0, 0, 0));
      parts.halo.color.copy(record.hue).multiplyScalar(locked ? 0.7 : 0.3);
    } else if (record.parts) {
      const parts = record.parts;
      const distance = mesh.position.distanceTo(camera.position);
      const near = MathUtils.clamp(1 - (distance - 14) / 50, 0.45, 1);
      const pulse = 1 + beatGlow * 0.18 + Math.sin(elapsedNow * 5 + id) * 0.06;
      const charge = record.charge;
      record.charge = Math.min(1, record.charge + dt * 0.25);
      const heartLevel = flashing ? 4 : (locked ? 3.4 : 2.1) * pulse * (0.3 + 0.7 * charge);
      if (record.kind === 'heart') parts.heart.color.setScalar(flashing ? 3 : 1.3 + beatGlow * 0.6);
      else if (record.kind === 'shard') parts.heart.color.copy(record.hue).multiplyScalar(flashing ? 3 : 1.4 + Math.sin(elapsedNow * 14 + id) * 0.4);
      else parts.heart.color.copy(flashing ? hdr(LOCK_WHITE, 1) : record.hue).multiplyScalar(heartLevel);
      parts.halo.color.copy(record.kind === 'heart' ? new Color(0.5, 0.5, 0.5) : record.hue).multiplyScalar((locked ? 0.7 : 0.32) * near * (0.4 + 0.6 * charge) * (record.kind === 'shard' ? 0.5 : 1));
      parts.rim.color.copy(denied ? ASH : locked ? LOCK_GOLD : record.hue).multiplyScalar(denied ? 1.8 : locked ? 1.2 : 0.22 * near);

      animateCreature(record, age, dt, camera);
    }

    if (record.lockRing) {
      record.lockRing.position.copy(mesh.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotateZ(elapsedNow * 1.8);
      const size = record.lockRing.userData.size as number;
      record.lockRing.scale.setScalar(size * (1.3 + Math.sin(elapsedNow * 10) * 0.04));
    }

    const anchor = mesh.userData.anchor as Vector3 | undefined;
    if (anchor && (record.kind === 'claw' || (record.kind === 'heart' && !mesh.userData.hidden))) {
      const from = anchor.clone().lerp(mesh.position, 0.08);
      const direction = mesh.position.clone().sub(anchor);
      from.x += Math.sign(direction.x) * ROSE_RADIUS * 0.35;
      from.y += Math.sign(direction.y) * ROSE_RADIUS * 0.25;
      const sway = Math.sin(elapsedNow * 1.3 + id) * 2;
      if (record.kind === 'heart') {
        for (let k = 0; k < 4; k += 1) {
          const angle = (k / 4) * Math.PI * 2 + 0.6;
          links.push({ from: ROSE_CENTER.clone().add(new Vector3(Math.cos(angle) * 6, Math.sin(angle) * 6, 1)), to: mesh.position, thickness: 0.9, sway: sway + k });
        }
      } else {
        links.push({ from, to: mesh.position, thickness: 0.55, sway });
      }
    }
  }
  if (rose) layoutTendrils(rose.tendrils, links);
}

function animateCreature(record: EnemyRecord, age: number, dt: number, camera: PerspectiveCamera) {
  const parts = record.parts!;
  const mesh = record.mesh;
  switch (record.kind) {
    case 'moth': {
      // Wingbeat: the panes fold toward the viewer and open again.
      const beat = Math.sin(age * 11 + record.mesh.id) * 0.85;
      parts.animated.left.rotation.y = beat;
      parts.animated.right.rotation.y = -beat;
      break;
    }
    case 'censer': {
      const chainLength = (mesh.userData.chainLength as number | undefined) ?? 10;
      parts.animated.chain.scale.set(1, Math.max(0.1, chainLength - 1.6) / mesh.scale.y, 1);
      for (const billboard of parts.billboards) {
        billboard.parent?.getWorldQuaternion(inverseParent);
        billboard.quaternion.copy(inverseParent.invert().multiply(camera.quaternion));
      }
      break;
    }
    case 'claw':
      parts.animated.gem.rotation.y += dt * 2.4;
      parts.animated.gem.rotation.x += dt * 1.1;
      break;
    case 'shard': {
      parts.animated.pane.rotation.y += dt * 5;
      const distance = mesh.position.distanceTo(camera.position);
      mesh.scale.multiplyScalar(MathUtils.clamp(distance / 15, 0.12, 1));
      break;
    }
    case 'heart': {
      mesh.visible = !mesh.userData.hidden;
      parts.animated.core.rotation.y += dt * 0.8;
      parts.animated.core.rotation.x += dt * 0.37;
      const stage = (mesh.userData.stage as number | undefined) ?? 0;
      for (let k = 0; k < 3; k += 1) {
        const shell = parts.animated[`shell${k}`];
        if (k < stage) shell.visible = false;
        shell.rotation.y += dt * (0.3 + k * 0.17) * (k % 2 === 0 ? 1 : -1);
        shell.rotation.z += dt * 0.11 * (k + 1);
      }
      break;
    }
    default:
      break;
  }
}

function updateLights(ctx: VisualContext) {
  if (!lighting) return;
  const camera = ctx.camera.position;
  lightCandidates.length = 0;
  const finale = ignitedAt >= 0;
  for (let i = 0; i < WINDOWS.length; i += 1) {
    const level = windowLevel[i] + windowFlash[i] * 0.4;
    if (level < 0.25) continue;
    const state = windowState[i];
    const tierScale = WINDOWS[i].tier === 'lantern' ? 0.45 : 1;
    const intensity = tierScale * (state === 'relit' ? RELIT_LIGHT * (level / WINDOW_RELIT) : finale ? FINALE_LIGHT * Math.min(1, level / WINDOW_FINALE) : WAITING_LIGHT * (level / WINDOW_WAITING));
    const distance = WINDOWS[i].position.distanceTo(camera);
    lightCandidates.push({ index: i, intensity, score: intensity / (1 + (distance * distance) / 3000) });
  }
  lightCandidates.sort((a, b) => b.score - a.score);
  const roseSlots = finale ? 3 : 0;
  const windowSlots = STONE_LIGHT_SLOTS - roseSlots;
  for (let s = 0; s < STONE_LIGHT_SLOTS; s += 1) {
    const position = lighting.positions[s];
    const color = lighting.colors[s];
    if (s < windowSlots) {
      const candidate = lightCandidates[s];
      if (!candidate) {
        position.set(0, -1000, 0, 0);
        continue;
      }
      const slot = WINDOWS[candidate.index];
      const hue = jewel(slot.hue);
      tmpVector.copy(slot.position).addScaledVector(slot.inward, 4.5);
      position.set(tmpVector.x, tmpVector.y - 2, tmpVector.z, candidate.intensity);
      color.set(hue.r, hue.g, hue.b, 0);
    } else {
      // The rose throws three separate pools: cobalt left, blood red right,
      // gold across the floor beneath it.
      const k = s - windowSlots;
      const since = elapsedNow - ignitedAt;
      const [x, y, hue] = ROSE_POOLS[k];
      position.set(ROSE_CENTER.x + x, ROSE_CENTER.y + y, ROSE_CENTER.z + 26, ROSE_LIGHT * (0.8 + 1.2 * Math.exp(-since * 1.2)));
      color.set(JEWELS[hue].r, JEWELS[hue].g, JEWELS[hue].b, 0);
    }
  }
}

// ---- camera ---------------------------------------------------------------------------

export type CameraEffectsContext = { camera: PerspectiveCamera; runTime: number; dt: number; running: boolean };

export function updateCameraEffects(context: CameraEffectsContext) {
  const { camera, dt } = context;
  if (!feelRig) return;
  // Bank gently with the weave of the rail.
  if (context.running) {
    const ahead = cameraPointAt(context.runTime + 0.8);
    const here = cameraPointAt(context.runTime);
    const targetRoll = MathUtils.clamp((ahead.x - here.x) * -0.05, -0.06, 0.06);
    cameraRoll += (targetRoll - cameraRoll) * Math.min(1, dt * 2);
    camera.rotateZ(cameraRoll);
  }
  // After ignition the view opens out to take in the lit building.
  const finaleTarget = ignitedAt >= 0 ? 11 : 0;
  finaleFov += (finaleTarget - finaleFov) * Math.min(1, dt * 0.45);
  feelRig.setFovOffset(finaleFov);
  if (ignitedAt >= 0) camera.rotateX(MathUtils.degToRad(finaleFov * 0.35));
  feelRig.update(dt, { shake: SHAKE });
}

export function updateAttractCamera(camera: PerspectiveCamera, modeTime: number) {
  // A slow upward look: the height of the place before the run begins.
  camera.rotateX(MathUtils.degToRad(3.5 + Math.sin(modeTime * 0.2) * 1.2));
}

