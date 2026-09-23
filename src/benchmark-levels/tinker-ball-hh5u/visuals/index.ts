import {
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, normalView, positionViewDirection, pow, sin, time, vec3, vertexColor } from 'three/tsl';
import type { EventBus } from '../../../events';
import type { VisualFactories } from '../../../engine/types';
import { TIER_SCALE, type Tier } from '../ball';
import { emitTinker } from '../channel';
import { KIND_INFO, type Family, type TinkerEnemyKind, type TinkerGameplay } from '../gameplay';
import { BAR_SECONDS } from '../timing';
import { createBallView } from './ball-view';
import { createEffects, createShadows } from './effects';
import { createEnvironment } from './environment';
import { createLetterMesh } from './letters';
import {
  BALL_IVORY,
  BALL_STAR,
  BALL_STRIPE,
  CREAM,
  DENY,
  GLUE,
  GLUE_SHEEN,
  GLUE_SHEEN_ALT,
  GRAPHITE,
  hdr,
  LOCK_COLORS,
  SOLVENT,
  SOLVENT_HOT,
  TOY_COLORS,
  WALNUT,
} from './palette';
import { createPieceSet, PIECE_FLAT, PIECE_RADIUS, PIECE_TYPES, pieceGeometry, type PieceType } from './pieces';
import { createReticleMesh, createShotMesh } from './player';
import { RECIPES, SPILL_CORE_RADIUS, SPILL_LAYERS, SPILL_TINTS, type Recipe } from './recipes';
import { createRig, createSpillRig, poseRig, poseSpillRig, type Rig, type RigPart } from './rigs';
import { createSpillView } from './spill-view';

// Spine: Tinker Ball's visual choreography. Glue monsters assemble out of
// supplies that hop up off the table; a lethal hit breaks the core and throws
// every piece, instantly clean, onto the route ahead where the ball arcs
// through and rolls them up. The ball's surface keeps them all.

const PIECE_GRAVITY: Record<Tier, number> = { 0: 46, 1: 90, 2: 120 };
const ASSEMBLE_SECONDS = 0.42;
const FLIGHT_SECONDS = [0.42, 0.62] as const;
const SHADOW = new Color(0x1a0d05);
const WORLD_CAPACITY = 460;
const STUCK_CAPACITY = 340;
const PICKUP_REACH = 0.5;
// Longest a stuck piece may be, in ball radii.
const STUCK_MAX_EXTENT = 1.0;
// How gummed-up a monster's supplies look: enough glue to read as stolen,
// not so much that the button or pencil underneath disappears.
const BODY_GRIME = 0.42;

type Mode = 'attract' | 'running' | 'ended';

type EnemyRecord = {
  id: number;
  kind: string;
  family: Family | 'core' | 'heart' | 'glob' | 'letter';
  tier: Tier;
  root: Object3D;
  rig?: Rig;
  recipe?: Recipe;
  bornAt: number;
  locked: boolean;
  deniedUntil: number;
  ring: Mesh | null;
  activeLayer: number;
  size: number;
  snap: number;
};

type Debris = {
  type: PieceType;
  slot: number;
  position: Vector3;
  velocity: Vector3;
  quaternion: Quaternion;
  spinAxis: Vector3;
  spinRate: number;
  scale: Vector3;
  from: Vector3;
  target: Vector3;
  flightTime: number;
  age: number;
  restQuat: Quaternion;
  state: 'flying' | 'settling' | 'resting' | 'magnet';
  settleAge: number;
  grimeAge: number;
  radius: number;
  rescued: boolean;
  tier: Tier;
  bornAt: number;
  persist: boolean;
};

type Stuck = {
  type: PieceType;
  slot: number;
  dir: Vector3;
  offset: number;
  quaternion: Quaternion;
  scale: Vector3;
  pop: number;
};

const _m = new Matrix4();
const _m2 = new Matrix4();
const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _s = new Vector3();
const _inv = new Matrix4();
const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

export type TinkerVisuals = ReturnType<typeof createTinkerVisuals>;

export function createTinkerVisuals(scene: Scene, bus: EventBus, gameplay: TinkerGameplay) {
  const director = gameplay.director;
  const route = director.route;
  const environment = createEnvironment(scene, route);
  const effects = createEffects(scene, { glue: GLUE, glueSheen: GLUE_SHEEN });
  const shadows = createShadows(scene, 180, SHADOW);
  const staticShadows = createShadows(scene, environment.shadowSpots.length + 4, SHADOW);
  staticShadows.begin();
  for (const spot of environment.shadowSpots) {
    staticShadows.cast(spot.position, spot.radius, 0, environment.lampShadowDirection(spot.position, _v), 0.42);
  }
  staticShadows.end();

  const ball = createBallView({ ivory: BALL_IVORY, stripe: BALL_STRIPE, star: BALL_STAR });
  scene.add(ball.group);
  const world = createPieceSet(scene, GLUE, {}, WORLD_CAPACITY);
  // This bank draws the monsters' own bodies (parented by transform, not by
  // scene graph) and loose debris in flight: parts of targets, not scenery.
  for (const mesh of world.meshes()) mesh.userData.raildIgnoreOcclusion = true;
  const stuckSet = createPieceSet(ball.group, GLUE, {}, STUCK_CAPACITY);
  const spill = createSpillView(route.spillCenter, { glue: GLUE, sheen: GLUE_SHEEN, sheenAlt: GLUE_SHEEN_ALT, radius: 27 });
  scene.add(spill.group);

  // ── Materials: the glue cores. Idle cores breathe an oily rim; locked
  // cores ring hot solvent-yellow; denied cores go dull grey.
  const coreIdle = coreMaterial(GLUE, rimNode(GLUE_SHEEN, GLUE_SHEEN_ALT, 0.9));
  const coreLocked = coreMaterial(GLUE.clone().lerp(SOLVENT, 0.25), rimNode(SOLVENT_HOT, SOLVENT, 2.6));
  const coreDenied = coreMaterial(DENY.clone().multiplyScalar(0.5), rimNode(DENY, DENY, 0.8));
  const dripMaterial = coreMaterial(GLUE, rimNode(GLUE_SHEEN, GLUE_SHEEN_ALT, 0.5));
  const globMaterial = coreMaterial(GLUE, rimNode(GLUE_SHEEN_ALT, GLUE_SHEEN, 1.4));

  const letterIdle = letterMaterial(0.55);
  const letterLocked = letterMaterial(0.9, SOLVENT);
  const letterDenied = letterMaterial(0.15, DENY);

  const ringGeometry = new TorusGeometry(1, 0.07, 8, 40);
  const globGeometry = new SphereGeometry(1, 20, 14);

  const pending: Array<{ root: Object3D; kind: string; rig?: Rig; recipe?: Recipe; letter?: string }> = [];
  const records = new Map<number, EnemyRecord>();
  const debris: Debris[] = [];
  const stuck: Stuck[] = [];
  const stuckByType = new Map<PieceType, Stuck[]>();
  const moundJunk: Debris[] = [];
  let now = 0;
  let mode: Mode = 'attract';
  let runTime = 0;
  let beatPulse = 0;
  let downbeat = 0;
  let lastRadius = director.radius;
  let spillCleanAt = -1;
  let seedCounter = 1;
  let lastTier = 0;
  let letterIndex = 0;
  const tierFlash = { value: 0 };
  let piecesRescued = 0;

  // ── Factories ────────────────────────────────────────────────────────────
  function createEnemyMesh(kind: string, letter?: string): Object3D {
    if (kind === 'letter' || letter) {
      const peg = LETTER_PEGS[letterIndex % LETTER_PEGS.length];
      letterIndex += 1;
      const root = createLetterMesh(letter ?? 'A', { board: WALNUT, hole: GRAPHITE, peg, pegCap: peg.clone().lerp(CREAM, 0.2) }, letterIdle);
      pending.push({ root, kind: 'letter', letter });
      return root;
    }
    if (kind === 'glue-glob') {
      const root = new Group();
      const blob = new Mesh(globGeometry, globMaterial);
      blob.scale.setScalar(1.5);
      root.add(blob);
      root.userData.blob = blob;
      pending.push({ root, kind });
      return root;
    }
    if (kind === 'spill-core' || kind === 'spill-heart') {
      const spillKind = kind === 'spill-core' ? 'core' : 'heart';
      const rig = createSpillRig({
        kind: spillKind,
        coreRadius: SPILL_CORE_RADIUS[spillKind],
        layers: SPILL_LAYERS[spillKind],
        tints: SPILL_TINTS,
        seed: seedCounter++ * 0.37,
        coreMaterial: coreIdle,
        dripMaterial,
      });
      pending.push({ root: rig.root, kind, rig });
      return rig.root;
    }
    const info = KIND_INFO[kind as TinkerEnemyKind];
    const family = info.family as Family;
    const recipe = RECIPES[family][info.tier];
    const rig = createRig({ family, recipe, scale: TIER_SCALE[info.tier], seed: seedCounter++ * 1.618, coreMaterial: coreIdle, dripMaterial });
    pending.push({ root: rig.root, kind, rig, recipe });
    return rig.root;
  }

  function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount?: number) {
    mesh.userData.locked = locked;
    if (locked && lockCount) mesh.userData.lockColor = LOCK_COLORS[Math.min(LOCK_COLORS.length, lockCount) - 1];
    applyCoreLook(mesh);
  }

  function setEnemyDenied(mesh: Object3D) {
    mesh.userData.deniedUntil = now + 0.5;
    applyCoreLook(mesh);
    effects.ring(mesh.position, hdr(DENY, 0.9), 0.6, 2.6, 0.35);
  }

  function applyCoreLook(mesh: Object3D) {
    const denied = (mesh.userData.deniedUntil ?? -1) > now;
    const locked = mesh.userData.locked === true;
    if (mesh.userData.isLetter) {
      const letterMesh = mesh.userData.letterMesh as Mesh;
      letterMesh.material = denied ? letterDenied : locked ? letterLocked : letterIdle;
      return;
    }
    const core = mesh.children[0] as Mesh | undefined;
    if (!core || mesh.userData.blob) {
      const blob = mesh.userData.blob as Mesh | undefined;
      if (blob) blob.material = denied ? coreDenied : locked ? coreLocked : globMaterial;
      return;
    }
    core.material = denied ? coreDenied : locked ? coreLocked : coreIdle;
  }

  const reticleColors = { base: hdr(SOLVENT, 1.25), active: hdr(SOLVENT_HOT, 1.6), pip: hdr(SOLVENT_HOT, 1.4), dot: hdr(SOLVENT_HOT, 1.5) };
  function createReticle() {
    return createReticleMesh(reticleColors);
  }

  function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
    const parts = reticle.userData.parts as {
      washerMaterial: MeshBasicMaterial;
      innerMaterial: MeshBasicMaterial;
      tickMaterial: MeshBasicMaterial;
      ticks: Group;
      pips: Mesh[];
    };
    reticle.userData.active = active;
    const pulse = 1 + beatPulse * 0.06;
    reticle.scale.setScalar((active ? 1.06 : 1) * pulse * (1 + lockCount * 0.035));
    parts.washerMaterial.color.copy(active ? reticleColors.active : reticleColors.base);
    parts.tickMaterial.color.copy(active ? reticleColors.active : reticleColors.base);
    parts.pips.forEach((pip, index) => {
      pip.visible = index < lockCount;
      (pip.material as MeshBasicMaterial).color.copy(hdr(LOCK_COLORS[index], 1.4));
    });
    parts.ticks.rotation.z += active ? 0.09 : 0.012;
  }

  function createProjectileMesh() {
    return createShotMesh({ core: hdr(SOLVENT_HOT, 3), glow: hdr(SOLVENT, 1.2), tail: hdr(SOLVENT, 0.9) });
  }

  const factories: VisualFactories = {
    createEnemyMesh,
    setEnemyLocked,
    setEnemyDenied,
    createProjectileMesh,
    createReticle,
    setReticleActive,
  };

  // ── Events ───────────────────────────────────────────────────────────────
  bus.on('spawn', ({ enemyId, kind }) => {
    const item = pending.shift();
    if (!item) return;
    const info = KIND_INFO[kind as TinkerEnemyKind];
    const family = kind === 'letter' ? 'letter' : info.family;
    const tier: Tier = kind === 'letter' ? 0 : info.tier;
    const record: EnemyRecord = {
      id: enemyId,
      kind,
      family,
      tier,
      root: item.root,
      rig: item.rig,
      recipe: item.recipe,
      bornAt: now,
      locked: false,
      deniedUntil: -1,
      ring: null,
      activeLayer: 0,
      size: sizeOf(kind, tier),
      snap: 0,
    };
    records.set(enemyId, record);
    if (item.rig) {
      item.rig.root.updateMatrixWorld(true);
      const ground = _v.set(item.root.position.x, 0, item.root.position.z);
      for (const part of item.rig.parts) {
        if (part.role === 'layer' && part.layer !== 0) continue;
        claimPart(part, ground, family === 'core' || family === 'heart');
      }
      if (family !== 'core' && family !== 'heart') {
        effects.splat(ground, record.size * 0.4, 0.7);
        effects.ring(ground.setY(0.1), hdr(GLUE_SHEEN, 0.6), record.size * 0.2, record.size * 0.9, 0.4, true);
      } else {
        effects.droplets(item.root.position, 14, 20, 0.9, 3);
      }
    }
  });

  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = records.get(enemyId);
    const color = LOCK_COLORS[Math.min(LOCK_COLORS.length, lockCount) - 1];
    if (record && !record.ring && record.family !== 'letter') {
      const ring = new Mesh(ringGeometry, new MeshBasicMaterial({ color: hdr(color, 1.8), toneMapped: false }));
      scene.add(ring);
      record.ring = ring;
    }
    effects.ring(worldPosition, hdr(color, 0.9), (record?.size ?? 2) * 0.3, (record?.size ?? 2) * 0.75, 0.24);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = records.get(enemyId);
    if (record?.ring) {
      record.ring.removeFromParent();
      (record.ring.material as MeshBasicMaterial).dispose();
      record.ring = null;
    }
  });

  bus.on('fire', ({ worldPosition }) => {
    effects.sparkle(worldPosition, hdr(SOLVENT_HOT, 1.6), 3, 4, 0.35, 0.25);
  });

  bus.on('hit', ({ enemyId, worldPosition, lethal }) => {
    const record = records.get(enemyId);
    const size = record?.size ?? 2;
    effects.sparkle(worldPosition, hdr(SOLVENT_HOT, 1.8), lethal ? 6 : 10, size * 1.5, sparkleSize(size), 0.35);
    if (!lethal && record) {
      effects.ring(worldPosition, hdr(SOLVENT, 0.9), size * 0.3, size * 0.7, 0.22);
      effects.droplets(worldPosition, 4, size * 2, size * 0.05, size * 0.12);
      // Heavy haulers shed a piece with every non-lethal hit.
      if (record.rig && record.family !== 'core' && record.family !== 'heart') {
        const loose = record.rig.parts.find((part) => part.slot >= 0 && (part.role === 'hat' || part.role === 'head' || part.role === 'body'));
        if (loose) releasePartAsDebris(record, loose, true);
      }
      record.root.userData.hitFlash = now + 0.2;
    }
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const record = records.get(enemyId);
    if (!record?.rig) return;
    // The broken layer showers the route; the spill wraps the next one on.
    for (const part of record.rig.parts) {
      if (part.role === 'layer' && part.layer === stageIndex - 1 && part.slot >= 0) releasePartAsDebris(record, part, true);
    }
    record.activeLayer = stageIndex;
    const lakeCenter = route.spillCenter;
    for (const part of record.rig.parts) {
      if (part.role === 'layer' && part.layer === stageIndex) claimPart(part, lakeCenter, true);
    }
    const size = record.size;
    effects.ring(record.root.position, hdr(SOLVENT, 1.0), size * 0.4, size * 1.1, 0.45);
    effects.sparkle(record.root.position, hdr(SOLVENT_HOT, 1.4), 18, size * 2.2, sparkleSize(size), 0.6);
    emitTinker(bus, 'tinker:recycle', { enemyId, layer: stageIndex });
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    if (!record) return;
    const size = record.size;
    if (record.family === 'letter') {
      burstLetter(record, worldPosition);
    } else if (record.rig) {
      for (const part of record.rig.parts) if (part.slot >= 0) releasePartAsDebris(record, part, true);
    }
    // The glue core snaps: black droplets, a splat that evaporates, and a
    // bright clean sparkle where it was.
    if (record.family !== 'letter') {
      effects.droplets(worldPosition, record.family === 'heart' ? 30 : 6, size * 2.4, size * 0.06, size * 0.12);
      effects.ring(worldPosition, hdr(SOLVENT_HOT, record.family === 'heart' ? 0.5 : 1.2), size * 0.3, size * (record.family === 'heart' ? 0.9 : 1.3), 0.35);
    }
    effects.sparkle(worldPosition, hdr(CREAM, 1.8), record.family === 'heart' ? 60 : 12, size * 2.2, sparkleSize(size), 0.7);
    if (record.family === 'heart') {
      spillCleanAt = now;
      emitTinker(bus, 'tinker:clean', undefined);
      for (const junk of moundJunk) {
        junk.state = 'flying';
        junk.rescued = true;
        junk.grimeAge = 0;
        junk.bornAt = now;
        junk.tier = 2;
        launchTo(junk, director.position.clone().addScaledVector(director.focus, director.view * (0.4 + Math.random() * 0.5)).setY(0), 0.9 + Math.random() * 0.5);
        world.setGrime(junk.type, junk.slot, -1);
      }
      moundJunk.length = 0;
    }
    removeRecord(record);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    if (!record) return;
    if (record.rig) for (const part of record.rig.parts) releasePart(part);
    if (record.family === 'glob') effects.droplets(worldPosition, 6, 6, 0.4, 1.2);
    removeRecord(record);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatPulse = 1;
    if (isDownbeat) downbeat = 1;
    for (const record of records.values()) record.snap = 1;
  });

  bus.on('runstart', () => {
    mode = 'running';
    // Keep the START beads that are still falling; clear everything else.
    for (let i = debris.length - 1; i >= 0; i -= 1) {
      if (debris[i].persist && now - debris[i].bornAt < 3) continue;
      world.release(debris[i].type, debris[i].slot);
      debris.splice(i, 1);
    }
    for (const piece of stuck) stuckSet.release(piece.type, piece.slot);
    stuck.length = 0;
    stuckByType.clear();
    spillCleanAt = -1;
    lastTier = 0;
    piecesRescued = 0;
    ball.group.quaternion.identity();
    placeAmbientPickups();
    placeMoundJunk();
  });

  bus.on('runend', () => {
    mode = 'ended';
    director.beginCoast();
  });

  // ── Parts, debris, and the ball ────────────────────────────────────────
  function sizeOf(kind: string, tier: Tier) {
    if (kind === 'letter') return 2.4;
    if (kind === 'spill-core') return 13;
    if (kind === 'spill-heart') return 22;
    if (kind === 'glue-glob') return 3;
    return 3.2 * TIER_SCALE[tier];
  }

  function claimPart(part: RigPart, ground: Vector3, fromLake: boolean) {
    part.slot = world.alloc(part.type);
    if (part.slot < 0) return;
    world.setTint(part.type, part.slot, part.tint, 0);
    const spread = fromLake ? 18 : 2.4 * (part.scale.x + part.scale.z);
    const angle = Math.random() * Math.PI * 2;
    const radius = spread * (0.5 + Math.random() * 0.5);
    part.from.set(ground.x + Math.cos(angle) * radius, 0.2, ground.z + Math.sin(angle) * radius);
    part.delay = Math.random() * 0.12 + (fromLake ? 0.05 : 0);
    part.extra = now;
  }

  function releasePart(part: RigPart) {
    if (part.slot < 0) return;
    world.release(part.type, part.slot);
    part.slot = -1;
  }

  function removeRecord(record: EnemyRecord) {
    if (record.ring) {
      record.ring.removeFromParent();
      (record.ring.material as MeshBasicMaterial).dispose();
    }
    if (record.rig) for (const part of record.rig.parts) releasePart(part);
    records.delete(record.id);
  }

  /** A part leaves its monster: it keeps its world transform and flies clean. */
  function releasePartAsDebris(record: EnemyRecord, part: RigPart, rescued: boolean) {
    if (part.slot < 0) return;
    record.root.updateMatrixWorld(true);
    _m.multiplyMatrices(record.root.matrixWorld, part.local);
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    _m.decompose(position, quaternion, scale);
    const piece: Debris = {
      type: part.type,
      slot: part.slot,
      position,
      velocity: new Vector3(),
      quaternion,
      spinAxis: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spinRate: (Math.random() * 6 + 4) * (Math.random() < 0.5 ? -1 : 1),
      scale,
      from: position.clone(),
      target: new Vector3(),
      flightTime: 0.5,
      age: 0,
      restQuat: new Quaternion(),
      state: 'flying',
      settleAge: 0,
      grimeAge: 0,
      radius: PIECE_RADIUS[part.type] * Math.max(scale.x, scale.y, scale.z),
      rescued,
      tier: record.tier,
      bornAt: now,
      persist: false,
    };
    part.slot = -1;
    world.setGrime(piece.type, piece.slot, -1);
    const field = director.fieldFor(record.id);
    const landing = new Vector3();
    if (field) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * field.radius;
      landing.set(field.center.x + Math.cos(angle) * r, 0, field.center.z + Math.sin(angle) * r);
    } else {
      landing.set(position.x + (Math.random() - 0.5) * 4, 0, position.z + (Math.random() - 0.5) * 4);
    }
    launchTo(piece, landing, FLIGHT_SECONDS[0] + Math.random() * (FLIGHT_SECONDS[1] - FLIGHT_SECONDS[0]));
    debris.push(piece);
  }

  function launchTo(piece: Debris, landing: Vector3, flightTime: number) {
    restingPose(piece.type, piece.scale, piece.restQuat);
    const restY = restHeight(piece.type, piece.scale, piece.restQuat);
    piece.target.set(landing.x, restY, landing.z);
    piece.from.copy(piece.position);
    piece.flightTime = flightTime;
    piece.age = 0;
    piece.state = 'flying';
    const g = PIECE_GRAVITY[piece.tier];
    piece.velocity.copy(piece.target).sub(piece.from).divideScalar(flightTime);
    piece.velocity.y += 0.5 * g * flightTime;
  }

  function burstLetter(record: EnemyRecord, position: Vector3) {
    const pegs = record.root.userData.pegs as Array<{ position: Vector3; color: Color }> | undefined;
    if (!pegs) return;
    record.root.updateMatrixWorld(true);
    for (const peg of pegs) {
      const slot = world.alloc('bead');
      if (slot < 0) continue;
      world.setTint('bead', slot, peg.color, -1);
      const p = peg.position.clone().applyMatrix4(record.root.matrixWorld);
      const piece: Debris = {
        type: 'bead',
        slot,
        position: p,
        velocity: new Vector3(),
        quaternion: new Quaternion(),
        spinAxis: new Vector3(0, 1, 0),
        spinRate: 6,
        scale: new Vector3(0.9, 0.9, 0.9),
        from: p.clone(),
        target: new Vector3(),
        flightTime: 0.8,
        age: 0,
        restQuat: new Quaternion(),
        state: 'flying',
        settleAge: 0,
        grimeAge: 0,
        radius: PIECE_RADIUS.bead * 0.9,
        rescued: false,
        tier: 0,
        bornAt: now,
        persist: true,
      };
      const drop = position.clone().sub(director.position).setY(0);
      const landing = director.position.clone().setY(0).addScaledVector(drop.normalize(), 3 + Math.random() * 10);
      landing.x += (Math.random() - 0.5) * 6;
      landing.z += (Math.random() - 0.5) * 6;
      launchTo(piece, landing, 0.7 + Math.random() * 0.35);
      debris.push(piece);
    }
    effects.sparkle(position, hdr(SOLVENT_HOT, 1.5), 8, 5, 0.4, 0.5);
  }

  function spawnLoose(type: PieceType, scale: number, x: number, z: number, tint: Color, grime: number) {
    const slot = world.alloc(type);
    if (slot < 0) return null;
    world.setTint(type, slot, tint, grime);
    const piece: Debris = {
      type,
      slot,
      position: new Vector3(x, 0, z),
      velocity: new Vector3(),
      quaternion: new Quaternion(),
      spinAxis: new Vector3(0, 1, 0),
      spinRate: 0,
      scale: new Vector3(scale, scale, scale),
      from: new Vector3(),
      target: new Vector3(),
      flightTime: 1,
      age: 0,
      restQuat: new Quaternion(),
      state: 'resting',
      settleAge: 1,
      grimeAge: 1,
      radius: PIECE_RADIUS[type] * scale,
      rescued: false,
      tier: 0,
      bornAt: now,
      persist: false,
    };
    restingPose(type, piece.scale, piece.restQuat);
    piece.quaternion.copy(piece.restQuat);
    piece.position.y = restHeight(type, piece.scale, piece.restQuat);
    piece.target.copy(piece.position);
    writeWorld(piece);
    debris.push(piece);
    return piece;
  }

  // Loose supplies lying right on the route: the ball rolls them up on its
  // own, so it keeps growing lumpier even between waves.
  function placeAmbientPickups() {
    const lists: Array<{ from: number; to: number; every: number; spread: number; items: Array<[PieceType, number, number]> }> = [
      { from: 8, to: 170, every: 3.2, spread: 4, items: [['sequin', 0.9, 1.3], ['bead', 0.6, 0.9], ['button', 0.5, 0.8], ['paperclip', 0.7, 0.9]] },
      { from: 180, to: 515, every: 6, spread: 8, items: [['button', 1.4, 2.2], ['bead', 1.4, 2.0], ['paperclip', 1.8, 2.4], ['sequin', 2.5, 3.2], ['eraser', 1.1, 1.3]] },
      { from: 525, to: 1000, every: 8, spread: 11, items: [['spool', 1.4, 1.8], ['paintpot', 1.6, 2.0], ['block', 1.5, 2.0], ['crayon', 1.6, 2.0], ['eraser', 2.0, 2.4]] },
    ];
    for (const list of lists) {
      for (let d = list.from; d < list.to; d += list.every * (0.6 + Math.random() * 0.8)) {
        const frame = route.frameAt(d);
        const lateral = (Math.random() - 0.5) * 2 * list.spread;
        const [type, min, max] = list.items[Math.floor(Math.random() * list.items.length)];
        const tint = TOY_COLORS[Math.floor(Math.random() * TOY_COLORS.length)];
        spawnLoose(type, min + Math.random() * (max - min), frame.position.x + frame.right.x * lateral, frame.position.z + frame.right.z * lateral, tint, 0);
      }
    }
  }

  // Supplies the spill has swallowed, half-sunk in the mound.
  function placeMoundJunk() {
    for (const junk of moundJunk) {
      world.release(junk.type, junk.slot);
      const index = debris.indexOf(junk);
      if (index >= 0) debris.splice(index, 1);
    }
    moundJunk.length = 0;
    const center = route.spillCenter;
    const kinds: Array<[PieceType, number]> = [['jar', 3.2], ['ruler', 2.2], ['card', 4], ['spool', 3.5], ['block', 3], ['paintpot', 3.4], ['pencil', 3.2]];
    for (let i = 0; i < 22; i += 1) {
      const [type, scale] = kinds[i % kinds.length];
      const angle = i * 2.39996;
      const radius = 3 + Math.sqrt(i / 22) * 16;
      const piece = spawnLoose(type, scale, center.x + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius, TOY_COLORS[i % TOY_COLORS.length], 1);
      if (!piece) continue;
      piece.persist = false;
      piece.state = 'resting';
      piece.position.y -= 1.5;
      piece.quaternion.setFromAxisAngle(_v.set(Math.random() - 0.5, 0.3, Math.random() - 0.5).normalize(), Math.random() * 1.2);
      piece.target.copy(piece.position);
      piece.bornAt = -999;
      moundJunk.push(piece);
      writeWorld(piece);
    }
  }

  function restingPose(type: PieceType, scale: Vector3, out: Quaternion) {
    const yaw = Math.random() * Math.PI * 2;
    out.setFromAxisAngle(UP, yaw);
    if (!PIECE_FLAT[type] && type !== 'block' && type !== 'paintpot' && type !== 'bead') {
      // Long and round things lie on their side.
      out.multiply(_q2.setFromAxisAngle(X_AXIS, Math.PI / 2));
    }
    return out;
  }

  function restHeight(type: PieceType, scale: Vector3, rest: Quaternion) {
    const geometry = pieceGeometry(type);
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    _m2.compose(_v2.set(0, 0, 0), rest, scale);
    let minY = Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      minY = Math.min(minY, _v.set(x, y, z).applyMatrix4(_m2).y);
    }
    return -minY + 0.01;
  }

  function writeWorld(piece: Debris, extraScale = 1) {
    _s.copy(piece.scale).multiplyScalar(extraScale);
    world.setMatrix(piece.type, piece.slot, _m.compose(piece.position, piece.quaternion, _s));
  }

  function attach(piece: Debris) {
    const tint = readTint(piece);
    const list = stuckByType.get(piece.type) ?? [];
    stuckByType.set(piece.type, list);
    if (stuckSet.available(piece.type) === 0 && list.length > 0) {
      const oldest = list.shift()!;
      stuckSet.release(oldest.type, oldest.slot);
      const index = stuck.indexOf(oldest);
      if (index >= 0) stuck.splice(index, 1);
    }
    const slot = stuckSet.alloc(piece.type);
    world.release(piece.type, piece.slot);
    if (slot < 0) return;
    ball.group.updateMatrixWorld(true);
    _inv.copy(ball.group.matrixWorld).invert();
    const local = piece.position.clone().applyMatrix4(_inv);
    const distance = Math.max(0.001, local.length());
    const dir = local.divideScalar(distance);
    const radius = director.radius;
    // A stilt that was a monster's leg would dwarf a marble: shrink anything
    // longer than the ball is wide so the ball stays lumpy, not a pincushion.
    const fit = Math.min(1, (radius * STUCK_MAX_EXTENT) / Math.max(0.001, piece.radius));
    const thin = Math.min(piece.scale.x, piece.scale.y, piece.scale.z) * PIECE_RADIUS[piece.type] * fit;
    const record: Stuck = {
      type: piece.type,
      slot,
      dir,
      offset: Math.min(piece.radius * fit * 0.25, thin * 0.8 + radius * 0.02) - radius * 0.03,
      quaternion: _q.copy(ball.group.quaternion).invert().multiply(piece.quaternion).clone(),
      scale: piece.scale.clone().multiplyScalar(fit),
      pop: 1,
    };
    stuckSet.setTint(piece.type, slot, tint, 0);
    stuck.push(record);
    list.push(record);
    writeStuck(record);
    if (piece.rescued) {
      piecesRescued += 1;
      gameplay.notePieces(1);
    }
    emitTinker(bus, 'tinker:pickup', { size: piece.radius / Math.max(0.3, radius), rescued: piece.rescued });
  }

  // Tints live in the world instance buffer; carry them across on attach.
  function readTint(piece: Debris) {
    const mesh = world.meshes()[PIECE_TYPES.indexOf(piece.type)];
    const attribute = mesh.geometry.getAttribute('tintGrime');
    return new Color(attribute.getX(piece.slot), attribute.getY(piece.slot), attribute.getZ(piece.slot));
  }

  function writeStuck(record: Stuck) {
    const radius = director.radius;
    const popScale = 1 + record.pop * record.pop * 0.45;
    _v.copy(record.dir).multiplyScalar(radius + record.offset);
    _s.copy(record.scale).multiplyScalar(popScale);
    stuckSet.setMatrix(record.type, record.slot, _m.compose(_v, record.quaternion, _s));
  }

  // ── Per frame ──────────────────────────────────────────────────────────
  function update(dt: number, context: { camera: PerspectiveCamera; elapsed: number; mode: Mode; runTime: number }) {
    now = context.elapsed;
    mode = context.mode;
    runTime = context.runTime;
    beatPulse = Math.max(0, beatPulse - dt * 5);
    downbeat = Math.max(0, downbeat - dt * 3);
    tierFlash.value = Math.max(0, tierFlash.value - dt * 1.6);
    if (mode === 'ended') director.coast(dt);
    const camera = context.camera;
    environment.dome.position.copy(camera.position);

    // Size-ups: a pop of sparkle around the ball as it swells into the next tier.
    const tier = mode === 'running' ? director.tierAt(runTime) : lastTier;
    if (mode === 'running' && tier !== lastTier) {
      lastTier = tier;
      tierFlash.value = 1;
      effects.ring(director.position.clone().setY(0.2), hdr(SOLVENT_HOT, 1.2), director.radius, director.radius * 5, 0.8, true);
      effects.sparkle(director.position, hdr(CREAM, 1.6), 40, director.radius * 4, director.radius * 0.25, 0.9);
      emitTinker(bus, 'tinker:grow', { tier });
    }

    ball.update(director.position, director.radius, director.velocity, dt);
    ball.group.updateMatrixWorld(true);

    shadows.begin();
    const lampOffset = _v2;
    environment.lampShadowDirection(director.position, lampOffset);
    shadows.cast(director.position, director.radius * 1.05, 0, lampOffset, 0.7);

    // Monsters.
    for (const record of records.values()) {
      if (!record.root.parent) {
        removeRecord(record);
        continue;
      }
      record.snap = Math.max(0, record.snap - dt * 5);
      record.root.updateMatrixWorld(true);
      const age = now - record.bornAt;
      if (record.family === 'letter') {
        record.root.scale.setScalar(Math.min(1, 0.4 + age * 3));
        applyCoreLook(record.root);
        continue;
      }
      if (record.family === 'glob') {
        const blob = record.root.userData.blob as Mesh;
        const wobble = Math.sin(now * 17 + record.id) * 0.12;
        blob.scale.set(1.5 * (1 + wobble), 1.5 * (1 - wobble), 1.5 * (1 + wobble));
        applyCoreLook(record.root);
        if (Math.random() < dt * 12) effects.droplets(record.root.position, 1, 2, 0.25, 0.8);
        shadows.cast(record.root.position, 1.6, record.root.position.y, environment.lampShadowDirection(record.root.position, lampOffset), 0.45);
        continue;
      }
      const rig = record.rig!;
      if (record.family === 'core' || record.family === 'heart') {
        poseSpillRig(rig, now);
      } else {
        poseRig(rig, record.recipe!, {
          time: now + record.id,
          dash: (record.root.userData.dash as number | undefined) ?? 0,
          gait: (record.root.userData.gait as number | undefined) ?? now * 2,
          flap: (record.root.userData.flap as number | undefined) ?? now * 2,
          height: record.root.position.y,
          snap: record.snap,
          heading: 0,
        });
      }
      const flash = (record.root.userData.hitFlash as number | undefined ?? -1) > now;
      applyCoreLook(record.root);
      const assemble = (part: RigPart) => Math.min(1, Math.max(0, (now - part.extra - part.delay) / ASSEMBLE_SECONDS));
      for (const part of rig.parts) {
        if (part.slot < 0) continue;
        _m.multiplyMatrices(record.root.matrixWorld, part.local);
        const k = assemble(part);
        if (k < 1) {
          // Hop up off the table into place, getting gummed up as it goes.
          _m.decompose(_v, _q, _s);
          const e = easeOutCubic(k);
          _v2.lerpVectors(part.from, _v, e);
          _v2.y += Math.sin(Math.PI * k) * record.size * 0.6;
          _s.multiplyScalar(0.5 + 0.5 * e);
          _m.compose(_v2, _q, _s);
          world.setGrime(part.type, part.slot, e * BODY_GRIME);
        } else if (flash) {
          world.setGrime(part.type, part.slot, -0.6);
        } else {
          world.setGrime(part.type, part.slot, BODY_GRIME);
        }
        world.setMatrix(part.type, part.slot, _m);
      }
      const denied = (record.root.userData.deniedUntil ?? -1) > now;
      if (denied) record.root.rotateZ(Math.sin(now * 60) * 0.08);
      if (record.ring) {
        const pulse = 1 + Math.sin(now * 14) * 0.06;
        record.ring.position.copy(record.root.position);
        record.ring.quaternion.copy(camera.quaternion);
        record.ring.scale.setScalar(record.size * 0.62 * pulse);
      }
      const height = record.root.position.y;
      shadows.cast(record.root.position, record.size * 0.42, height, environment.lampShadowDirection(record.root.position, lampOffset), 0.5);
    }

    // Debris: flight, settling, the table thump, and pickup.
    const ballPosition = director.position;
    const radius = director.radius;
    const view = director.view;
    for (let i = debris.length - 1; i >= 0; i -= 1) {
      const piece = debris[i];
      if (piece.grimeAge < 1) {
        piece.grimeAge += dt * 1.8;
        world.setGrime(piece.type, piece.slot, Math.min(0, -1 + piece.grimeAge));
      }
      if (piece.state === 'flying') {
        piece.age += dt;
        const g = PIECE_GRAVITY[piece.tier];
        const t = Math.min(piece.age, piece.flightTime);
        piece.position.copy(piece.from).addScaledVector(piece.velocity, t);
        piece.position.y -= 0.5 * g * t * t;
        piece.quaternion.premultiply(_q.setFromAxisAngle(piece.spinAxis, piece.spinRate * dt));
        if (piece.age >= piece.flightTime) {
          piece.state = 'settling';
          piece.settleAge = 0;
          piece.position.copy(piece.target);
        }
      } else if (piece.state === 'settling') {
        piece.settleAge += dt;
        const k = Math.min(1, piece.settleAge / 0.24);
        piece.quaternion.slerp(piece.restQuat, Math.min(1, dt * 14));
        piece.position.copy(piece.target);
        piece.position.y += Math.sin(Math.PI * k) * piece.radius * 0.5 * (1 - k);
        if (k >= 1) {
          piece.state = 'resting';
          piece.quaternion.copy(piece.restQuat);
        }
      } else if (piece.state === 'resting') {
        // The kick is somebody thumping the table: loose pieces near the
        // ball jump on the beat.
        const near = piece.position.distanceToSquared(ballPosition) < view * view * 4;
        if (near && !moundJunk.includes(piece)) {
          piece.position.y = piece.target.y + beatPulse * beatPulse * piece.radius * 0.35 * (downbeat > 0.5 ? 1.6 : 1);
        }
      }

      // Pickup: the ball rolls over it, or it slides in when the ball passes close.
      const isJunk = piece.bornAt < -100;
      if (!isJunk && mode !== 'attract') {
        _v.copy(piece.position).sub(ballPosition);
        const distance = _v.length();
        const reach = radius + piece.radius * PICKUP_REACH + radius * 0.1;
        if (distance < reach) {
          attach(piece);
          debris.splice(i, 1);
          continue;
        }
        const horizontal = Math.hypot(_v.x, _v.z);
        if ((piece.state === 'resting' || piece.state === 'magnet') && horizontal < radius * 2.4 + piece.radius) {
          piece.state = 'magnet';
          const pull = Math.min(1, dt * (6 + 10 / Math.max(0.5, horizontal / radius)));
          piece.position.lerp(_v2.copy(ballPosition).addScaledVector(_v.normalize(), radius * 0.95), pull);
          piece.position.y = Math.max(piece.target.y * 0.6, piece.position.y);
        }
        // Pieces far behind the ball are out of the picture for good.
        if (piece.state === 'resting' && now - piece.bornAt > 2) {
          const behind = _v.set(piece.position.x - ballPosition.x, 0, piece.position.z - ballPosition.z).dot(director.focus);
          if (behind < -view * 4 - 40) {
            world.release(piece.type, piece.slot);
            debris.splice(i, 1);
            continue;
          }
        }
      }
      writeWorld(piece);
    }

    // Stuck pieces ride the surface as the ball grows.
    const radiusChanged = Math.abs(radius - lastRadius) > 1e-4;
    lastRadius = radius;
    for (const record of stuck) {
      if (record.pop > 0) {
        record.pop = Math.max(0, record.pop - dt * 5.5);
        writeStuck(record);
      } else if (radiusChanged) {
        writeStuck(record);
      }
    }

    // The spill grows in as the ball approaches and evaporates when the heart breaks.
    const b = runTime / BAR_SECONDS;
    const growth = mode === 'attract' ? 0 : smooth((b - 20.2) / 1.6);
    spill.setGrowth(mode === 'ended' && spillCleanAt < 0 ? 1 : growth);
    if (spillCleanAt >= 0) {
      const k = Math.min(1, (now - spillCleanAt) / 1.5);
      spill.setClean(easeInOut(k));
      if (k < 1 && Math.random() < dt * 40) {
        const angle = Math.random() * Math.PI * 2;
        const r = spill.radius;
        effects.sparkle(_v.set(route.spillCenter.x + Math.cos(angle) * r, 0.5, route.spillCenter.z + Math.sin(angle) * r), hdr(CREAM, 1.6), 3, 8, 0.8, 0.6);
      }
    } else {
      spill.setClean(0);
    }
    for (const junk of moundJunk) {
      // Swallowed supplies bob in the glue.
      junk.position.y = junk.target.y - 1.2 + Math.sin(now * 1.3 + junk.slot) * 0.4 - (1 - growth) * 8;
      writeWorld(junk);
    }

    shadows.end();
    effects.update(dt, camera.quaternion, PIECE_GRAVITY[director.tierAt(runTime)]);
    environment.bulbMaterial.color.copy(hdr(LAMP_BULB_BASE, 3.1 + downbeat * 0.35));
    world.flush();
    stuckSet.flush();
  }

  function reset() {
    for (const record of [...records.values()]) removeRecord(record);
    pending.length = 0;
    effects.clear();
  }

  return {
    factories,
    update,
    reset,
    tierFlash,
    get piecesRescued() {
      return piecesRescued;
    },
    get stuckCount() {
      return stuck.length;
    },
  };
}

const LAMP_BULB_BASE = new Color(0xfff2d6);
const LETTER_PEGS = [TOY_COLORS[0], TOY_COLORS[1], TOY_COLORS[2], TOY_COLORS[3], TOY_COLORS[9], TOY_COLORS[7]];

function coreMaterial(base: Color, emissive: ReturnType<typeof rimNode>) {
  const material = new MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.25 });
  material.color = base.clone();
  material.emissiveNode = emissive;
  return material;
}

/** Oily fresnel rim that slowly shifts between two sheen colours. */
function rimNode(a: Color, b: Color, intensity: number) {
  const facing = normalView.dot(positionViewDirection).abs();
  const rim = pow(float(1).sub(facing), float(2.6));
  const shift = sin(time.mul(1.7)).mul(0.5).add(0.5);
  const color = vec3(a.r, a.g, a.b).mul(float(1).sub(shift)).add(vec3(b.r, b.g, b.b).mul(shift));
  return color.mul(rim.mul(intensity));
}

function letterMaterial(glow: number, tint?: Color) {
  const material = new MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0 });
  material.vertexColors = true;
  const base = vertexColor();
  material.emissiveNode = tint
    ? vec3(tint.r, tint.g, tint.b).mul(glow).add(base.xyz.mul(0.25))
    : base.xyz.mul(glow);
  if (tint && glow < 0.3) material.colorNode = vec3(tint.r, tint.g, tint.b);
  return material;
}

/** Sparkles stay glints, never big crosses, however large the target. */
function sparkleSize(size: number) {
  return Math.min(size, 7) * 0.1;
}

function smooth(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
