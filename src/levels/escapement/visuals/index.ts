import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import { float, uniform, vec3 } from 'three/tsl';
import { glyphOnCells } from '../../../engine/glyphs';
import { createGpuParticles, type GpuParticles } from '../../../engine/gpu-particles';
import { createSwarm, type Swarm } from '../../../engine/instanced-swarm';
import { colorForLockCount } from '../../../engine/locks';
import { createRibbonTrail, type RibbonTrail } from '../../../engine/ribbon-trail';
import { createAdditiveBasicMaterial, createAdornmentSlot, createPendingVisualRecords, disposeObject3D } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import type { BossPart } from '../boss-logic';
import { ESCAPEMENT_TIME } from '../timing';
import {
  createBurr,
  createChime,
  createJewelWasp,
  createOxideTick,
  createRatchet,
  createRubyBolt,
  moteGeometry,
  type EnemyRig,
} from './enemies';
import { createArborTarget, createEscapementBoss, createPalletJewel, type EscapementBoss, type PalletJewelRig } from './escapement-boss';
import type { EscapementEnvironment } from './environment/index';
import { BRASS, BRASS_DARK, hdr, LAMP_WARM, LOCK_COLD, LOCK_GRADIENT, RUBY, VERDIGRIS, WHITE_HOT } from './palette';

// Visual spine: palette decisions and event choreography. Every target is one
// of the rigs in enemies.ts or a mote in the instanced swarm; the boss body and
// its parts come from escapement-boss.ts. Player-owned colours are cold so they
// never blend with brass: the reticle, lock rings and shots use LOCK_COLD.

/** Per-mesh animation and state hooks the visuals drive each frame. */
type EnemyHandle = {
  update(dt: number, beatPhase: number): void;
  setLocked(locked: boolean): void;
  setDenied(): void;
  setDamaged(): void;
  dispose(): void;
};

type EnemyRecord = {
  mesh: Object3D;
  handle: EnemyHandle;
  lockRing: Group | null;
  trail: RibbonTrail | null;
  bornAt: number | null;
};

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  runTime: number;
  running: boolean;
  /** Run-section name from gameplay's `sectionAt`. */
  section: string;
};

const BEAT = ESCAPEMENT_TIME.beatSeconds;
const DUST_CAPACITY = 100_000;
const DUST_LIFE = 9;
const DUST_PER_SECOND = 2500;
/** Sections with dust in the lamp shafts. The swinging camera of the Pendulum and boss would smear it into streaks. */
const DUST_SECTIONS = new Set(['barrel', 'train', 'strike']);
const DENY_COLOR = new Color(1.4, 0.12, 0.08);

/** Screen flash in linear RGB, added in composeOutput. The Strike is the only frame-wide flash. */
export const flashUniform = uniform(0);
/** Chromatic-aberration kick, written by the Strike and every boss ring. */
export const strikeKickUniform = uniform(0);

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<{ mesh: Object3D; handle: EnemyHandle }, EnemyRecord>({
  createRecord: ({ mesh, handle }) => ({ mesh, handle, lockRing: null, trail: null, bornAt: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    releaseTrail(record);
    record.handle.dispose();
  },
});

let runtime: EscapementVisualRuntime | null = null;
let elapsedNow = 0;
let reticleHand: Group | null = null;

// ---- runtime ------------------------------------------------------------------

export type EscapementVisualRuntime = {
  particles: GpuParticles;
  swarm: Swarm<{ glow: 'float' }>;
  body: EscapementBoss;
  bobTrail: RibbonTrail;
  /** Seats a boss part mesh on the body and attaches a jewel rig on first use. */
  seatBossPart(part: BossPart, mesh: Object3D): boolean;
  /** Dust flies away from `position`; `strength` in world units per second squared. */
  impulse(position: Vector3, strength: number, radius: number): void;
  /** Kicks the compose-stage ripple and, at `flash`, the gold frame flash. */
  kickStrike(kick: number, flash?: number): void;
  dispose(): void;
};

type VisualRuntimeOptions = {
  scene: Scene;
  renderer: WebGPURenderer;
  environment: EscapementEnvironment;
};

export function createEscapementVisualRuntime({ scene, renderer, environment }: VisualRuntimeOptions): EscapementVisualRuntime {
  const particles = createGpuParticles(renderer, {
    capacity: DUST_CAPACITY,
    forces: {
      gravity: new Vector3(0, -0.12, 0),
      drag: 0.5,
      turbulence: { strength: 0.7, scale: 0.05, drift: 0.08 },
    },
  });
  particles.object.name = 'escapement-dust';
  scene.add(particles.object);

  const swarmMaterial = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2, side: DoubleSide });
  const swarm = createSwarm({ geometry: moteGeometry(), material: swarmMaterial, capacity: 48, attributes: { glow: 'float' as const } });
  const verdigris = vec3(VERDIGRIS.r, VERDIGRIS.g, VERDIGRIS.b);
  swarmMaterial.colorNode = verdigris;
  swarmMaterial.emissiveNode = verdigris.mul(float(0.22).add(swarm.nodes.glow.mul(0.9)).max(0));
  swarm.mesh.name = 'escapement-motes';
  scene.add(swarm.mesh);

  const body = createEscapementBoss();
  environment.escapementMount.add(body);
  const jewelSides: Partial<Record<'left' | 'right', Object3D>> = {};

  const bobTrail = createRibbonTrail({
    points: 40,
    minSpacing: 0.5,
    width: ({ t }) => float(7).mul(float(1).sub(t)),
    fade: ({ t }) => float(0.28).mul(float(1).sub(t)),
    color: LAMP_WARM.clone().multiplyScalar(0.6),
  });
  bobTrail.mesh.name = 'escapement-bob-trail';
  scene.add(bobTrail.mesh);

  let impulseUntil = -1;
  let impulseStrength = 0;

  const created: EscapementVisualRuntime = {
    particles,
    swarm,
    body,
    bobTrail,
    seatBossPart(part, mesh) {
      if (part !== 'arbor') {
        const side = part === 'jewel-left' ? 'left' : 'right';
        if (jewelSides[side] !== mesh) {
          jewelSides[side] = mesh;
          mesh.userData.side = side;
          body.attachJewel(side, mesh as PalletJewelRig);
        }
      }
      body.seatPart(part === 'jewel-left' ? 'jewelLeft' : part === 'jewel-right' ? 'jewelRight' : 'arbor', mesh);
      return true;
    },
    impulse(position, strength, radius) {
      particles.forces.attractorPosition.value.copy(position);
      particles.forces.attractorStrength.value = -strength;
      particles.forces.attractorRadius.value = radius;
      impulseStrength = strength;
      impulseUntil = elapsedNow + 0.4;
    },
    kickStrike(kick, flash = 0) {
      strikeKickUniform.value = Math.max(strikeKickUniform.value, kick);
      flashUniform.value = Math.max(flashUniform.value, flash);
    },
    dispose() {
      enemyRecords.clear({ dispose: true, pending: true });
      particles.dispose();
      swarm.dispose();
      swarmMaterial.dispose();
      body.removeFromParent();
      body.dispose();
      bobTrail.mesh.removeFromParent();
      bobTrail.dispose();
      for (const trail of trailPool) {
        trail.mesh.removeFromParent();
        trail.dispose();
      }
      trailPool.length = 0;
      runtime = null;
    },
  };
  runtime = created;

  // The impulse decays back to nothing so dust settles after a kill.
  decayImpulse = (dt: number) => {
    if (impulseUntil < 0) return;
    const remaining = impulseUntil - elapsedNow;
    particles.forces.attractorStrength.value = remaining <= 0 ? 0 : -impulseStrength * MathUtils.clamp(remaining / 0.4, 0, 1);
    if (remaining <= 0) impulseUntil = -1;
    void dt;
  };
  return created;
}

let decayImpulse: (dt: number) => void = () => {};

// ---- trails -------------------------------------------------------------------

const trailPool: RibbonTrail[] = [];
const trailsInUse = new Set<RibbonTrail>();

function acquireTrail(scene: Scene, color: Color) {
  let trail = trailPool.find((entry) => !trailsInUse.has(entry));
  if (!trail) {
    trail = createRibbonTrail({
      points: 24,
      minSpacing: 0.08,
      width: ({ t }) => float(0.12).mul(float(1).sub(t)),
      fade: ({ t }) => float(0.7).mul(float(1).sub(t)),
      color: ({ t }) => vec3(color.r, color.g, color.b).mul(float(1.2).sub(t)),
    });
    trailPool.push(trail);
    scene.add(trail.mesh);
  }
  trailsInUse.add(trail);
  trail.reset();
  return trail;
}

function releaseTrail(record: EnemyRecord) {
  if (!record.trail) return;
  record.trail.reset();
  trailsInUse.delete(record.trail);
  record.trail = null;
}

// ---- enemy meshes -------------------------------------------------------------

function rigHandle(rig: EnemyRig): EnemyHandle {
  return {
    update: (dt, beatPhase) => rig.update(dt, beatPhase),
    setLocked: (locked) => rig.setLocked(locked),
    setDenied: () => rig.setDenied(),
    setDamaged: () => rig.setDamaged(),
    dispose: () => rig.dispose(),
  };
}

const moteSparkGeometry = new OctahedronGeometry(0.075, 1);

function createMoteProxy(): { mesh: Object3D; handle: EnemyHandle } {
  const active = runtime;
  const slot = active?.swarm.acquire() ?? null;
  if (!active || !slot) {
    // No swarm slot: a plain flake so the runner still has a target.
    const group = new Group();
    group.add(new Mesh(moteGeometry(), new MeshStandardMaterial({ color: VERDIGRIS, emissive: VERDIGRIS.clone().multiplyScalar(0.22), side: DoubleSide })));
    group.userData.kind = 'mote';
    group.userData.accent = VERDIGRIS.clone();
    return { mesh: group, handle: { update() {}, setLocked() {}, setDenied() {}, setDamaged() {}, dispose: () => disposeObject3D(group) } };
  }
  const { proxy, index } = slot;
  const sparkMaterial = new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.2) });
  const spark = new Mesh(moteSparkGeometry, sparkMaterial);
  spark.position.y = 0.015;
  proxy.add(spark);
  proxy.userData.kind = 'mote';
  proxy.userData.accent = VERDIGRIS.clone();
  proxy.userData.lockRingScale = 0.75;
  let locked = false;
  let deniedUntil = -1;
  let time = 0;
  active.swarm.write(index, 'glow', 0);
  return {
    mesh: proxy,
    handle: {
      update(dt, beatPhase) {
        time += dt;
        const denied = MathUtils.clamp((deniedUntil - time) / 0.5, 0, 1);
        const glow = (locked ? 1 : 0) - denied * 0.9;
        active.swarm.write(index, 'glow', glow);
        sparkMaterial.color.copy(WHITE_HOT).multiplyScalar(2.2 * (1 + (1 - beatPhase) ** 3 * 0.3) * (locked ? 1.6 : 1) * (1 - denied * 0.8));
      },
      setLocked(next) {
        locked = next;
      },
      setDenied() {
        deniedUntil = time + 0.5;
      },
      setDamaged() {},
      dispose() {
        active.swarm.release(index);
        sparkMaterial.dispose();
      },
    },
  };
}

function buildEnemy(kind: string, letter?: string): { mesh: Object3D; handle: EnemyHandle } {
  switch (kind) {
    case 'letter':
      return createLetterTarget(letter ?? 'I');
    case 'mote':
      return createMoteProxy();
    case 'burr': {
      const rig = createBurr();
      return { mesh: rig, handle: rigHandle(rig) };
    }
    case 'tick': {
      const rig = createOxideTick();
      return { mesh: rig, handle: rigHandle(rig) };
    }
    case 'ratchet': {
      const rig = createRatchet();
      return { mesh: rig, handle: rigHandle(rig) };
    }
    case 'wasp': {
      const rig = createJewelWasp();
      return { mesh: rig, handle: rigHandle(rig) };
    }
    case 'bolt': {
      const rig = createRubyBolt();
      // The bolt ends at the camera's nose, where a full white-hot trail would fill the frame.
      rig.userData.trailColor = WHITE_HOT.clone().multiplyScalar(0.45);
      return { mesh: rig, handle: rigHandle(rig) };
    }
    case 'jewel': {
      const rig = createPalletJewel('left');
      // The body updates an attached jewel itself; the handle only carries state.
      return { mesh: rig, handle: { ...rigHandle(rig), update() {} } };
    }
    case 'arbor': {
      const rig = createArborTarget();
      return { mesh: rig, handle: rigHandle(rig) };
    }
    case 'chime':
    default: {
      const rig = createChime();
      return { mesh: rig, handle: rigHandle(rig) };
    }
  }
}

export function createEnemyMesh(kind: string, letter?: string) {
  const built = buildEnemy(kind, letter);
  built.mesh.userData.kind = kind;
  enemyRecords.enqueue(built);
  return built.mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  const record = recordFor(mesh);
  record?.handle.setLocked(locked);
  if (!locked && record) lockRings.detach(record);
}

export function setEnemyDenied(mesh: Object3D) {
  const record = recordFor(mesh);
  record?.handle.setDenied();
  runtime?.particles.emit(mesh.position, 24, { color: DENY_COLOR, speed: 3, life: 0.5, size: 0.1, spread: 1 });
}

function recordFor(mesh: Object3D) {
  const id = mesh.userData.raildEnemyId as number | undefined;
  return id === undefined ? undefined : enemyRecords.get(id);
}

// ---- letters: START and REPLAY as brass numerals on the dial ------------------

const CELL = 0.32;
const letterCell = new BoxGeometry(CELL * 0.88, CELL * 0.88, 0.16);
const letterBrass = new MeshStandardMaterial({ color: BRASS, roughness: 0.4, metalness: 0.75 });
const letterBrassDark = new MeshStandardMaterial({ color: BRASS_DARK, roughness: 0.5, metalness: 0.7 });

function createLetterTarget(character: string): { mesh: Object3D; handle: EnemyHandle } {
  const group = new Group();
  const cells = glyphOnCells(character);
  for (const cell of cells) {
    const block = new Mesh(letterCell, letterBrass);
    block.position.set((cell.x - 2) * CELL, (3 - cell.y) * CELL, 0);
    group.add(block);
  }
  const backing = new Mesh(new PlaneGeometry(5 * CELL + 0.3, 7 * CELL + 0.3), letterBrassDark);
  backing.position.z = -0.1;
  group.add(backing);
  const ringMaterial = createAdditiveBasicMaterial({ color: hdr(LOCK_COLD, 0.6), side: DoubleSide });
  const ring = new Mesh(new RingGeometry(1.28, 1.34, 40), ringMaterial);
  group.add(ring);
  group.userData.isLetter = true;
  group.userData.accent = LOCK_COLD.clone();
  group.userData.lockRingScale = 1.3;
  let locked = false;
  let deniedUntil = -1;
  let time = 0;
  return {
    mesh: group,
    handle: {
      update(dt) {
        time += dt;
        const denied = MathUtils.clamp((deniedUntil - time) / 0.5, 0, 1);
        if (denied > 0) ringMaterial.color.copy(DENY_COLOR).multiplyScalar(0.4 + denied);
        else ringMaterial.color.copy(locked ? hdr(WHITE_HOT, 1.8) : hdr(LOCK_COLD, 0.6));
        ring.rotation.z += dt * (locked ? 2.2 : 0.5);
      },
      setLocked(next) {
        locked = next;
      },
      setDenied() {
        deniedUntil = time + 0.5;
      },
      setDamaged() {},
      dispose() {
        ringMaterial.dispose();
        ring.geometry.dispose();
        backing.geometry.dispose();
      },
    },
  };
}

// ---- projectile and reticle -----------------------------------------------------

/** The player's shot: a cold dart, the one cold-moving thing in a brass world. */
export function createProjectileMesh() {
  const group = new Group();
  const core = new OctahedronGeometry(0.3, 0);
  core.scale(0.4, 0.4, 2.2);
  group.add(new Mesh(core, new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.6) })));
  const shell = new OctahedronGeometry(0.48, 0);
  shell.scale(0.5, 0.5, 1.9);
  group.add(new Mesh(shell, createAdditiveBasicMaterial({ color: hdr(LOCK_COLD, 1.0), opacity: 0.5 })));
  return group;
}

/** A clock-face sight: a cold ring, twelve tick marks, a hand that walks with the locks, a centre dot. */
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
  const add = (mesh: Mesh, base: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.copy(base);
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    parts.push({ material, base });
    return mesh;
  };
  group.add(add(new Mesh(new RingGeometry(0.6, 0.64, 48), new MeshBasicMaterial()), hdr(LOCK_COLD, 1.2)));
  const ticks = new Group();
  for (let i = 0; i < 12; i += 1) {
    const long = i % 3 === 0;
    const tick = add(new Mesh(new PlaneGeometry(long ? 0.16 : 0.09, 0.035), new MeshBasicMaterial()), hdr(LOCK_COLD, long ? 1.5 : 1.0));
    const angle = (i / 12) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.76, Math.sin(angle) * 0.76, 0);
    tick.rotation.z = angle;
    ticks.add(tick);
  }
  group.add(ticks);
  const hand = new Group();
  const handMesh = add(new Mesh(new PlaneGeometry(0.04, 0.5), new MeshBasicMaterial()), hdr(WHITE_HOT, 1.2));
  handMesh.position.y = 0.25;
  hand.add(handMesh);
  group.add(hand);
  group.add(add(new Mesh(new CircleGeometry(0.045, 18), new MeshBasicMaterial()), hdr(WHITE_HOT, 2.0)));
  group.userData.parts = parts;
  group.userData.hand = hand;
  group.userData.active = false;
  reticleHand = hand;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
  const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
  for (const part of parts) {
    if (charge) part.material.color.copy(hdr(charge, active ? 1.6 : 1.2));
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
  }
  // The hand points at the hour of the lock count: one lock is I, six is VI.
  const hand = reticle.userData.hand as Group;
  hand.userData.target = lockCount === 0 ? 0 : -(lockCount / 12) * Math.PI * 2;
}

// ---- event choreography ------------------------------------------------------------

function makeLockRing(color: Color) {
  const group = new Group();
  group.add(new Mesh(new RingGeometry(0.84, 0.9, 12), createAdditiveBasicMaterial({ color: hdr(color, 1.6), side: DoubleSide })));
  group.add(new Mesh(new RingGeometry(0.66, 0.69, 36), createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WHITE_HOT, 0.5), 1.2), side: DoubleSide })));
  return group;
}

function accentOf(mesh: Object3D) {
  return (mesh.userData.accent as Color | undefined) ?? LOCK_COLD;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition, kind }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'bolt') runtime?.particles.emit(worldPosition, 30, { color: RUBY, speed: 4, life: 0.5, size: 0.12 });
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) lockRings.attach(record, makeLockRing(color), scene);
    runtime?.particles.emit(worldPosition, 16, { color: hdr(color, 1.4), speed: 2.5, life: 0.45, size: 0.1 });
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ worldPosition }) => {
    runtime?.particles.emit(worldPosition, 10, { color: hdr(LOCK_COLD, 1.5), speed: 3, life: 0.3, size: 0.09 });
  });

  bus.on('hit', ({ enemyId, worldPosition, lethal }) => {
    const record = enemyRecords.get(enemyId);
    runtime?.particles.emit(worldPosition, 40, { color: hdr(WHITE_HOT, 1.4), speed: 7, life: 0.5, size: 0.11 });
    if (record && !lethal) record.handle.setDamaged();
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const stager = record.mesh as Object3D & { setStage?(stage: number): void };
    stager.setStage?.(stageIndex);
    runtime?.particles.emit(worldPosition, 90, { color: hdr(accentOf(record.mesh), 1.2), speed: 9, life: 0.8, size: 0.14 });
    runtime?.impulse(worldPosition, 40, 8);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      const accent = accentOf(record.mesh);
      const isBossPart = record.mesh.userData.kind === 'jewel' || record.mesh.userData.kind === 'arbor';
      runtime?.particles.emit(worldPosition, isBossPart ? 400 : 110, { color: hdr(accent, 1.3), speed: isBossPart ? 16 : 9, life: 1.1, size: isBossPart ? 0.3 : 0.14 });
      runtime?.particles.emit(worldPosition, isBossPart ? 120 : 30, { color: hdr(WHITE_HOT, 2.0), speed: 12, life: 0.5, size: 0.12 });
      runtime?.impulse(worldPosition, isBossPart ? 120 : 60, isBossPart ? 24 : 10);
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    runtime?.particles.emit(worldPosition, 8, { color: BRASS_DARK, speed: 1.5, life: 0.6, size: 0.1 });
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) flashUniform.value = Math.max(flashUniform.value, 0.12);
  });

  bus.on('playerhit', () => {
    strikeKickUniform.value = Math.max(strikeKickUniform.value, 0.5);
  });

  bus.on('runstart', () => {
    enemyRecords.clear({ dispose: true, pending: true });
    runtime?.particles.reset();
    runtime?.swarm.reset();
    runtime?.bobTrail.reset();
    flashUniform.value = 0;
    strikeKickUniform.value = 0;
  });
}

// ---- per-frame update ----------------------------------------------------------------

const scratch = new Vector3();
const forward = new Vector3();
const right = new Vector3();
const up = new Vector3();
let dustCarry = 0;

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  const camera = ctx.camera as PerspectiveCamera;
  const beatPhase = ((ctx.running ? ctx.runTime : ctx.elapsed) / BEAT) % 1;

  flashUniform.value = Math.max(0, flashUniform.value - dt * 2.6);
  strikeKickUniform.value = Math.max(0, strikeKickUniform.value - dt * 1.8);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    if (!record.mesh.userData.isLetter && record.mesh.userData.kind !== 'jewel' && record.mesh.userData.kind !== 'arbor') {
      record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.35)));
    }
    record.handle.update(dt, beatPhase);

    const trailColor = record.mesh.userData.trailColor as Color | undefined;
    if (trailColor && runtime) {
      if (!record.trail) record.trail = acquireTrail(ctx.scene, trailColor);
      record.trail.pushPoint(record.mesh.getWorldPosition(scratch));
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(camera.quaternion);
      record.lockRing.rotation.z += dt * 2.4;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const trail of trailPool) trail.update(dt, camera.position);

  if (reticleHand) {
    const target = (reticleHand.userData.target as number | undefined) ?? 0;
    reticleHand.rotation.z = MathUtils.damp(reticleHand.rotation.z, target, 12, dt);
  }

  if (runtime) {
    runtime.swarm.update(dt);
    decayImpulse(dt);
    emitDust(dt, ctx, camera);
    runtime.particles.update(dt);
  }
}

/** Tarnish specks drift in the lamp shafts ahead of the camera while the rail is inside the works. */
function emitDust(dt: number, ctx: VisualContext, camera: PerspectiveCamera) {
  if (!runtime || !DUST_SECTIONS.has(ctx.section)) return;
  dustCarry += dt * DUST_PER_SECOND;
  const batches = Math.min(6, Math.floor(dustCarry / 24));
  if (batches === 0) return;
  dustCarry -= batches * 24;
  camera.getWorldDirection(forward);
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  for (let i = 0; i < batches; i += 1) {
    const origin = scratch
      .copy(camera.position)
      .addScaledVector(forward, 24 + Math.random() * 100)
      .addScaledVector(right, (Math.random() - 0.5) * 70)
      .addScaledVector(up, (Math.random() - 0.5) * 44);
    runtime.particles.emit(origin, 24, {
      direction: new Vector3(0, -1, 0),
      speed: 0.4,
      spread: 1,
      life: DUST_LIFE,
      size: 0.07,
      jitter: 0.5,
      color: LAMP_WARM.clone().multiplyScalar(0.22),
    });
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
