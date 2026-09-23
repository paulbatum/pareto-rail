import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  BORE,
  beatPosition,
  createMassDriverRail,
  heatAt,
  RAIL_LENGTH,
  railU,
  ringU,
  speedAt,
  WORLD,
} from '../gameplay';
import { runState } from '../run-state';
import { BAR, BEAT, CHARGE_TIME, FIRE_TIME, MASS_DRIVER_DURATION, MUZZLE_RING, STAGE_ONE_TIME, STAGE_TWO_TIME, VERDICT_TIME } from '../timing';
import { createBarrel, type Barrel } from './barrel';
import {
  createBoltMesh,
  createDischargeMesh,
  createInterlockMesh,
  createLeechMesh,
  createPicketMesh,
  createPylonMesh,
  createThreaderMesh,
  disposeDroneMaterials,
  type DronePalette,
  type DroneTint,
} from './drones';
import { createArcBank, createGlints, createShockRings, createSparkField, type ArcBank, type Glints, type ShockRings, type SparkField } from './effects';
import { createLetterMesh, type LetterParts } from './letters';
import { blackoutUniform, edgeChargeUniform, edgeColorUniform, flashColorUniform, flashUniform } from './post-fx';
import { createSpace } from './space';

// ---- palette ----------------------------------------------------------------------
// Hot means electric: arc blue → violet → blinding white. The gun's own
// defenses burn magenta so they never blend into the coils.

const ARC_BLUE = new Color(0.14, 0.46, 1.0);
const ARC_CYAN = new Color(0.42, 0.84, 1.0);
const VIOLET = new Color(0.6, 0.28, 1.0);
const WHITE_HOT = new Color(1.0, 0.96, 1.0);
const HAZARD = new Color(1.0, 0.14, 0.56);
const HAZARD_PALE = new Color(1.0, 0.72, 0.93);
const COIL_METAL = new Color(0.1, 0.115, 0.16);
const WINDING_METAL = new Color(0.13, 0.16, 0.26);
const RAIL_METAL = new Color(0.07, 0.08, 0.11);
const DRONE_HULL = new Color(0.2, 0.2, 0.28);
export const SPACE_BLACK = 0x010208;

const LOCK_GRADIENT = [ARC_CYAN, VIOLET, WHITE_HOT] as const;

const hdr = (color: Color, k: number) => color.clone().multiplyScalar(k);

/** Heat ramp: 0 arc blue, 0.5 violet, 1 white. */
function heatColor(heat: number, target = new Color()) {
  const h = MathUtils.clamp(heat, 0, 1);
  if (h < 0.5) return target.copy(ARC_BLUE).lerp(VIOLET, h / 0.5);
  return target.copy(VIOLET).lerp(WHITE_HOT, (h - 0.5) / 0.5);
}

const DRONE_PALETTES: Record<string, DronePalette> = {
  picket: { body: DRONE_HULL, edge: hdr(HAZARD_PALE, 1.35), core: hdr(HAZARD, 2.4) },
  threader: { body: DRONE_HULL, edge: hdr(HAZARD_PALE, 1.5), core: hdr(new Color(1, 0.45, 0.8), 2.4) },
  leech: { body: new Color(0.17, 0.15, 0.24), edge: hdr(HAZARD_PALE, 1.25), core: hdr(new Color(1, 0.08, 0.42), 2.6) },
  pylon: { body: DRONE_HULL, edge: hdr(new Color(0.95, 0.55, 1.0), 1.4), core: hdr(new Color(1, 0.35, 0.75), 2.6) },
  bolt: { body: DRONE_HULL, edge: hdr(HAZARD, 1.5), core: hdr(new Color(1, 0.7, 0.92), 2.1) },
  interlock: { body: new Color(0.1, 0.1, 0.15), edge: hdr(HAZARD, 1.5), core: hdr(WHITE_HOT, 2.8) },
};

const LETTER_PALETTE = {
  lit: hdr(ARC_CYAN, 1.55),
  dim: hdr(ARC_BLUE, 0.14),
  frame: hdr(ARC_BLUE, 1.25),
  plate: new Color(0.008, 0.014, 0.04),
};

const KILL_SPARKS: Record<string, number> = { picket: 22, threader: 20, leech: 30, pylon: 36, bolt: 12, interlock: 90, letter: 18 };
const KILL_RING: Record<string, number> = { picket: 4.5, threader: 4, leech: 5, pylon: 6, bolt: 2.5, interlock: 14, letter: 3.5 };

/** Drones are authored in barrel units and drawn a touch larger than the world scale for legibility. */
const DRONE_SCALE = WORLD * 1.12;

const CAMERA_SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.8,
  pitchDegrees: 0.4,
  yawDegrees: 0.34,
  rollDegrees: 0.9,
  frequency: 11,
  smoothing: 24,
};

// ---- module state ---------------------------------------------------------------------

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number;
  locks: number;
  bracket: LineSegments | null;
  hitFlashUntil: number;
};

const rail = createMassDriverRail();
const RING_COUNT = MUZZLE_RING + 1;
/** Rings crossed on section downbeats: stage one, stage two, final charge. */
const SHIFT_RINGS = new Set([STAGE_ONE_TIME, STAGE_TWO_TIME, CHARGE_TIME].map((time) => Math.round(time / BEAT)));
const RAIL_ANGLES = [45, 135, 225, 315].map((degrees) => MathUtils.degToRad(degrees));
const ringHeat = Array.from({ length: RING_COUNT }, (_, k) => heatAt(k * BEAT));
const ringVisible = new Array<boolean>(RING_COUNT).fill(true);

let barrel: Barrel | null = null;
let space: ReturnType<typeof createSpace> | null = null;
let sparks: SparkField | null = null;
let shocks: ShockRings | null = null;
let glints: Glints | null = null;
let arcs: ArcBank | null = null;
let sceneRef: Scene | null = null;

let elapsedNow = 0;
let runTimeNow = 0;
let running = false;
let cameraU = 0;
let seatedPhase = Number.NaN;
let lastRingCrossed = -1;
let ambientBeatAt = -10;
let ambientDownbeat = false;
let ringSurge = 0;
let beatKick = 0;
let irisOpen = 0;
let launchedAt = -1;
let breachAt = -1;
let rejectUntil = -1;
let chargeCalm = 0;
let endedAt = -1;
const endedFrom = new Vector3();
const endedOffset = new Vector3();
const misfires = new Map<number, number>();
/** Sheared armour plates tumbling away from an interlock. */
const debris: Array<{ object: Object3D; velocity: Vector3; spin: Vector3; age: number; life: number }> = [];
/** Coils with a live leech on them, rebuilt every frame. */
const drainedRings = new Set<number>();
const volleyChains = new Map<number, Vector3>();
const records = new Map<number, EnemyRecord>();
const pendingMeshes: Group[] = [];
const pendingProjectiles: Object3D[] = [];
const projectiles = new Map<number, Object3D>();

const tmpColor = new Color();
const tmpGlow = new Color();
const tmpBody = new Color();
const tmpVec = new Vector3();
const forward = new Vector3();
const down = new Vector3();
const payload = new Vector3();

function timeAtU(u: number) {
  let lo = 0;
  let hi = MASS_DRIVER_DURATION;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (railU(mid) < u) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- environment ----------------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  sceneRef = scene;
  scene.fog = new Fog(SPACE_BLACK, 110 * WORLD, 380 * WORLD);
  barrel = createBarrel(scene, {
    curve: rail,
    ringCount: RING_COUNT,
    boreRadius: BORE,
    unit: WORLD,
    railAngles: RAIL_ANGLES,
    railEndU: railU(FIRE_TIME),
    coil: COIL_METAL,
    winding: WINDING_METAL,
    railMetal: RAIL_METAL,
    railGlowAt: (u) => heatColor(heatAt(timeAtU(u))).multiplyScalar(1.1),
  });
  space = createSpace(scene, {
    starCount: 1600,
    starColors: [new Color(0.8, 0.88, 1), new Color(0.6, 0.72, 1), new Color(1, 1, 1), new Color(0.78, 0.6, 1)],
    bandPole: new Vector3(0.3, 0.9, 0.25),
    planetCenter: new Vector3(-190, -250, -200),
    planetRadius: 250,
    // Just behind the planet's limb: a night side with a burning crescent.
    sunDirection: new Vector3(-0.18, -0.33, -0.93),
    ocean: new Color(0.012, 0.045, 0.12),
    landmass: new Color(0.05, 0.075, 0.1),
    cloud: new Color(0.26, 0.3, 0.38),
    nightLights: new Color(0.4, 0.6, 1.0),
    atmosphere: new Color(0.3, 0.6, 1.25),
    sun: new Color(2.2, 2.15, 2.4),
    flare: new Color(0.35, 0.6, 1.4),
  });
  sparks = createSparkField(scene, WORLD);
  shocks = createShockRings(scene, WORLD);
  glints = createGlints(scene, WORLD);
  arcs = createArcBank(scene, WORLD);
  seatRings(true);
  return barrel.root;
}

function muzzleDistanceAhead() {
  return (ringU(MUZZLE_RING) - cameraU) * RAIL_LENGTH;
}

/**
 * Visual distance of the muzzle. Far away it is pulled in (compressed) so the
 * sealed iris reads as the end of the tunnel from the start of the charge;
 * inside 140 units it sits at its true place and arrives exactly on the peak.
 */
function muzzleVisualDistance(actual: number) {
  const near = 140 * WORLD;
  if (actual <= near) return actual;
  return Math.min(330 * WORLD, near + (actual - near) * 0.22);
}

function gateActive() {
  return runTimeNow >= CHARGE_TIME - 2 * BAR && launchedAt < 0 && breachAt < 0;
}

function seatRings(force: boolean) {
  if (!barrel) return;
  const phaseMoved = Math.abs(runState.beatPhase - seatedPhase) > 0.002;
  const gate = gateActive() ? muzzleVisualDistance(muzzleDistanceAhead()) : Infinity;
  let changed = force || phaseMoved;
  for (let k = 0; k < RING_COUNT; k += 1) {
    const u = ringU(k);
    const ahead = (u - cameraU) * RAIL_LENGTH;
    const visible = k === MUZZLE_RING ? false : ahead < gate + WORLD;
    if (force || phaseMoved || visible !== ringVisible[k]) {
      barrel.placeRing(k, u, visible);
      ringVisible[k] = visible;
      changed = true;
    }
  }
  seatedPhase = runState.beatPhase;
  barrel.commitRings(changed);
}

// ---- enemy meshes -----------------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.01);
  pendingMeshes.push(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? 'A', LETTER_PALETTE);
    case 'picket':
      return createPicketMesh(DRONE_PALETTES.picket);
    case 'threader':
      return createThreaderMesh(DRONE_PALETTES.threader);
    case 'leech':
      return createLeechMesh(DRONE_PALETTES.leech);
    case 'pylon':
      return createPylonMesh(DRONE_PALETTES.pylon);
    case 'bolt':
      return createBoltMesh(DRONE_PALETTES.bolt);
    case 'interlock':
      return createInterlockMesh(DRONE_PALETTES.interlock, hdr(HAZARD, 2.3));
    case 'discharge':
      return createDischargeMesh();
    default:
      return createPicketMesh(DRONE_PALETTES.picket);
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount?: number) {
  mesh.userData.locked = locked;
  if (locked && lockCount !== undefined) mesh.userData.lockColor = colorForLockCount(lockCount, LOCK_GRADIENT);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  shocks?.spawn(mesh.position, hdr(HAZARD, 1.6), 2.6, 0.3);
}

// The slug: a white-hot needle in an arc-blue sheath.
const slugCore = new OctahedronGeometry(1, 0).scale(0.1, 0.1, 1.5);
const slugSheath = new OctahedronGeometry(1, 0).scale(0.28, 0.28, 2.1);
const slugCoreMaterial = new MeshBasicMaterial({ color: hdr(WHITE_HOT, 3), toneMapped: false });
const slugSheathMaterial = new MeshBasicMaterial({ color: hdr(ARC_CYAN, 0.9), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });

export function createProjectileMesh() {
  const group = new Group();
  group.add(new Mesh(slugCore, slugCoreMaterial), new Mesh(slugSheath, slugSheathMaterial));
  group.scale.setScalar(WORLD * 1.3);
  pendingProjectiles.push(group);
  return group;
}

// ---- reticle: a six-cell capacitor bank ---------------------------------------------------------

type ReticleParts = { ring: MeshBasicMaterial; cells: MeshBasicMaterial[]; ticks: MeshBasicMaterial; dot: MeshBasicMaterial; spinner: Group };

export function createReticle() {
  const group = new Group();
  // Drawn over everything: the sight must never sink behind a coil.
  const additive = { transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, side: DoubleSide } as const;
  const ring = new MeshBasicMaterial({ color: hdr(ARC_CYAN, 1.2), ...additive });
  group.add(new Mesh(new RingGeometry(0.6, 0.64, 64), ring));
  const spinner = new Group();
  const cells: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const material = new MeshBasicMaterial({ color: hdr(ARC_BLUE, 0.4), ...additive });
    const start = Math.PI / 2 - (i + 1) * (Math.PI / 3) + 0.07;
    spinner.add(new Mesh(new RingGeometry(0.74, 0.86, 12, 1, start, Math.PI / 3 - 0.14), material));
    cells.push(material);
  }
  group.add(spinner);
  const ticks = new MeshBasicMaterial({ color: hdr(ARC_CYAN, 1.4), ...additive });
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const tick = new Mesh(new RingGeometry(0.2, 0.4, 2, 1, angle - 0.03, 0.06), ticks);
    group.add(tick);
  }
  const dot = new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2), ...additive });
  group.add(new Mesh(new CircleGeometry(0.045, 16), dot));
  const parts: ReticleParts = { ring, cells, ticks, dot, spinner };
  group.userData.parts = parts;
  group.traverse((child) => {
    child.renderOrder = 50;
  });
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const parts = reticle.userData.parts as ReticleParts;
  const rejected = elapsedNow < rejectUntil;
  reticle.scale.setScalar(1 + lockCount * 0.05 + (active ? 0.06 : 0));
  const charge = lockCount > 0 ? colorForLockCount(lockCount, LOCK_GRADIENT) : ARC_CYAN;
  parts.ring.color.copy(rejected ? hdr(HAZARD, 1.8) : hdr(charge, active ? 1.5 : 1.1));
  parts.ticks.color.copy(rejected ? hdr(HAZARD, 1.4) : hdr(ARC_CYAN, active ? 1.6 : 1.1));
  parts.dot.color.copy(rejected ? hdr(HAZARD, 2) : hdr(WHITE_HOT, 2));
  parts.cells.forEach((cell, index) => {
    if (rejected) cell.color.copy(hdr(HAZARD, 1.2));
    else if (index < lockCount) cell.color.copy(hdr(colorForLockCount(index + 1, LOCK_GRADIENT), lockCount === 6 ? 2.6 : 1.8));
    else cell.color.copy(hdr(ARC_BLUE, active ? 0.45 : 0.25));
  });
  reticle.userData.active = active;
}

// ---- lock brackets --------------------------------------------------------------------------------

const bracketGeometry = (() => {
  const points: number[] = [];
  const r = 1;
  const arm = 0.38;
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
    points.push(sx * r, sy * r, 0, sx * (r - arm), sy * r, 0);
    points.push(sx * r, sy * r, 0, sx * r, sy * (r - arm), 0);
  }
  return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
})();

function attachBracket(record: EnemyRecord, color: Color) {
  if (!sceneRef) return;
  if (!record.bracket) {
    record.bracket = new LineSegments(bracketGeometry, new LineBasicMaterial({ color: 0xffffff, toneMapped: false }));
    sceneRef.add(record.bracket);
  }
  (record.bracket.material as LineBasicMaterial).color.copy(hdr(color, 2.2));
}

function detachBracket(record: EnemyRecord) {
  if (!record.bracket) return;
  record.bracket.removeFromParent();
  (record.bracket.material as LineBasicMaterial).dispose();
  record.bracket = null;
}

function dropRecord(enemyId: number) {
  const record = records.get(enemyId);
  if (!record) return;
  detachBracket(record);
  if (record.kind === 'letter') disposeObject3D(record.mesh);
  else disposeDroneMaterials(record.mesh);
  records.delete(enemyId);
}

// ---- helpers ------------------------------------------------------------------------------------

function cameraPayloadPoint(camera: PerspectiveCamera, target: Vector3) {
  camera.getWorldDirection(forward);
  down.set(0, -1, 0).applyQuaternion(camera.quaternion);
  return target.copy(camera.position).addScaledVector(forward, 7 * WORLD).addScaledVector(down, 1.6 * WORLD);
}

function railQuaternion(u: number) {
  const frame = sampleRailFrame(rail, u);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
}

function flash(amount: number, color: Color) {
  if (amount >= flashUniform.value * 0.8) flashColorUniform.value.copy(color);
  flashUniform.value = Math.max(flashUniform.value, amount);
}

// ---- event choreography ----------------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, camera: PerspectiveCamera, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const mesh = pendingMeshes.shift();
    if (!mesh) return;
    records.set(enemyId, { mesh, kind, bornAt: elapsedNow, locks: 0, bracket: null, hitFlashUntil: -1 });
    switch (kind) {
      case 'picket':
      case 'threader': {
        glints?.spawn(worldPosition, hdr(HAZARD_PALE, 1.4), 1.6, 0.22);
        break;
      }
      case 'leech':
        shocks?.spawn(worldPosition, hdr(HAZARD, 1.2), 3, 0.35);
        break;
      case 'pylon':
        shocks?.spawn(worldPosition, hdr(HAZARD, 1.3), 4.5, 0.45);
        sparks?.emit(worldPosition, hdr(HAZARD_PALE, 1.4), 14, 9, 0.4);
        break;
      case 'bolt':
        glints?.spawn(worldPosition, hdr(HAZARD, 2.4), 1.8, 0.2);
        sparks?.emit(worldPosition, hdr(HAZARD, 1.8), 8, 12, 0.25);
        break;
      case 'interlock':
        shocks?.spawn(worldPosition, hdr(HAZARD, 1.6), 9, 0.6);
        feel.shake(0.35, CAMERA_SHAKE);
        break;
      case 'discharge':
        if (runState.outcome === 'launch') launch(camera, feel);
        else breach(camera, feel);
        break;
      case 'letter':
        glints?.spawn(worldPosition, hdr(ARC_CYAN, 1.3), 1.4, 0.3);
        break;
    }
  });

  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = records.get(enemyId);
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    if (record) {
      record.locks += 1;
      attachBracket(record, color);
    }
    glints?.spawn(worldPosition, hdr(color, 1.8), 1.1 + lockCount * 0.12, 0.18);
    if (lockCount === 6) shocks?.spawn(worldPosition, hdr(WHITE_HOT, 1.4), 3.5, 0.3);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = records.get(enemyId);
    if (!record) return;
    record.locks = 0;
    detachBracket(record);
  });

  bus.on('fire', ({ projectileId, worldPosition, targetPosition }) => {
    const mesh = pendingProjectiles.shift();
    if (mesh) projectiles.set(projectileId, mesh);
    tmpVec.copy(targetPosition).sub(worldPosition).normalize();
    glints?.spawn(worldPosition, hdr(ARC_CYAN, 2), 0.8, 0.1);
    sparks?.emit(worldPosition, hdr(ARC_CYAN, 1.6), 4, 14, 0.18, { bias: tmpVec.clone().multiplyScalar(1.5), length: 0.03 });
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId);
    const record = records.get(enemyId);
    sparks?.emit(worldPosition, hdr(WHITE_HOT, 1.6), lethal ? 6 : 12, 14, 0.3);
    if (record && !lethal) {
      record.hitFlashUntil = elapsedNow + 0.14;
      glints?.spawn(worldPosition, hdr(WHITE_HOT, 2.2), 1.4, 0.14);
      if (record.kind === 'interlock') feel.shake(0.18, CAMERA_SHAKE);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    if (!record || record.kind !== 'interlock') return;
    // Armour sheared off: plates spin away, the hot core is exposed.
    const armor = record.mesh.userData.armor as Group | undefined;
    if (armor && sceneRef) {
      // Each plate is flung off along its own side, spinning.
      for (const plate of [...armor.children]) {
        const side = (plate.userData.side as number | undefined) ?? 1;
        const at = plate.getWorldPosition(new Vector3());
        const quaternion = plate.getWorldQuaternion(new Quaternion());
        const scale = plate.getWorldScale(new Vector3());
        sceneRef.add(plate);
        plate.position.copy(at);
        plate.quaternion.copy(quaternion);
        plate.scale.copy(scale);
        const outward = new Vector3(side, 0.6, 0.8).applyQuaternion(record.mesh.quaternion).normalize();
        debris.push({
          object: plate,
          velocity: outward.multiplyScalar(9 * WORLD),
          spin: new Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, side * 9),
          age: 0,
          life: 0.9,
        });
      }
      armor.visible = false;
    }
    sparks?.emit(worldPosition, hdr(HAZARD, 2), 40, 22, 0.7, { length: 0.04 });
    sparks?.emit(worldPosition, hdr(WHITE_HOT, 1.8), 18, 16, 0.4);
    shocks?.spawn(worldPosition, hdr(HAZARD_PALE, 1.5), 8, 0.45);
    glints?.spawn(worldPosition, hdr(WHITE_HOT, 2.6), 3.5, 0.25);
    feel.shake(0.45, CAMERA_SHAKE);
  });

  bus.on('kill', ({ enemyId, worldPosition, volleyId }) => {
    const record = records.get(enemyId);
    const kind = record?.kind ?? 'picket';
    const tint = record?.mesh.userData.tint as DroneTint | undefined;
    const accent = kind === 'letter' ? hdr(ARC_CYAN, 1.6) : tint ? tint.baseCore.clone() : hdr(HAZARD, 2);
    sparks?.emit(worldPosition, accent, KILL_SPARKS[kind] ?? 20, 18, 0.55, { length: 0.035 });
    sparks?.emit(worldPosition, hdr(WHITE_HOT, 1.5), 8, 10, 0.3);
    shocks?.spawn(worldPosition, hdr(kind === 'letter' ? ARC_CYAN : HAZARD_PALE, 1.3), KILL_RING[kind] ?? 4, 0.4);
    glints?.spawn(worldPosition, hdr(WHITE_HOT, 2.4), 2 + (KILL_RING[kind] ?? 4) * 0.2, 0.2);

    // Chain lightning: each kill in a volley arcs to the one before it.
    if (volleyId !== undefined) {
      const previous = volleyChains.get(volleyId);
      if (previous) arcs?.spawn(previous, worldPosition, hdr(ARC_CYAN, 2.4), 0.3, 0.7);
      volleyChains.set(volleyId, worldPosition.clone());
    }

    if (kind === 'interlock') {
      cameraPayloadPoint(camera, payload);
      for (let i = 0; i < 3; i += 1) arcs?.spawn(worldPosition, payload, hdr(WHITE_HOT, 2.6), 0.35 + i * 0.1, 1.6);
      shocks?.spawn(worldPosition, hdr(WHITE_HOT, 1.6), 20, 0.7);
      feel.shake(0.9, CAMERA_SHAKE);
      flash(0.28, HAZARD_PALE);
      if (runState.outcome === 'launch') {
        // Safeties clear: the whole barrel exhales and the iris starts to open.
        ringSurge = 1.6;
        flash(0.55, ARC_CYAN);
      }
    }
    dropRecord(enemyId);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = records.get(enemyId);
    if (record?.kind === 'leech' && running) {
      // The drained coil misfires as the payload crosses it.
      misfires.set(Math.round(beatPosition(runTimeNow)), elapsedNow);
      sparks?.emit(worldPosition, hdr(HAZARD, 1.6), 16, 10, 0.5);
      flash(0.1, HAZARD);
    } else if (record && record.kind !== 'discharge') {
      sparks?.emit(worldPosition, hdr(VIOLET, 0.6), 5, 4, 0.35);
    }
    dropRecord(enemyId);
  });

  bus.on('reject', () => {
    rejectUntil = elapsedNow + 0.35;
    flash(0.06, HAZARD);
    feel.shake(0.15, CAMERA_SHAKE);
  });

  bus.on('volley', ({ volleyId, size, kills }) => {
    volleyChains.delete(volleyId);
    if (size >= 6 && kills === size) {
      ringSurge = Math.max(ringSurge, 1.1);
      flash(0.16, ARC_CYAN);
      feel.kickFov(2.2, { decay: 5 });
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    ambientBeatAt = elapsedNow;
    ambientDownbeat = isDownbeat;
    if (!running && barrel) {
      // The idling gun still breathes: a pulse down the rails on every beat.
      for (let r = 0; r < RAIL_ANGLES.length; r += 1) barrel.firePulse(cameraU * RAIL_LENGTH + 2 * WORLD, r, 70 * WORLD, 1.1, hdr(ARC_BLUE, isDownbeat ? 2.4 : 1.4));
    }
  });

  bus.on('playerhit', () => {
    cameraPayloadPoint(camera, payload);
    sparks?.emit(payload, hdr(HAZARD, 2), 40, 16, 0.5);
    flash(0.42, HAZARD);
    feel.shake(1.1, CAMERA_SHAKE);
    feel.kickFov(-3, { decay: 6 });
  });

  bus.on('runstart', () => {
    running = true;
    endedAt = -1;
    runTimeNow = 0;
    lastRingCrossed = -1;
    launchedAt = -1;
    breachAt = -1;
    irisOpen = 0;
    ringSurge = 0;
    chargeCalm = 0;
    misfires.clear();
    volleyChains.clear();
    for (const id of [...records.keys()]) if (records.get(id)?.kind !== 'letter') dropRecord(id);
    pendingMeshes.length = 0;
    pendingProjectiles.length = 0;
    projectiles.clear();
    sparks?.clear();
    shocks?.clear();
    arcs?.clear();
    for (const piece of debris) piece.object.removeFromParent();
    debris.length = 0;
    barrel?.clearPulses();
    flashUniform.value = 0;
    blackoutUniform.value = 0;
    edgeChargeUniform.value = 0;
    space?.setPlanetOffset(new Vector3(), 1);
    space?.setStarBrightness(1);
    space?.setSunFlare(0);
    feel.restore();
  });

  bus.on('runend', ({ died }) => {
    running = false;
    arcs?.clear();
    if (!died) feel.restore();
    endedAt = elapsedNow;
    endedFrom.copy(camera.position);
  });
}

// ---- finales ------------------------------------------------------------------------------------------

function launch(camera: PerspectiveCamera, feel: CameraFeelRig) {
  launchedAt = elapsedNow;
  flash(1.5, WHITE_HOT);
  feel.kickFov(24, { decay: 0.9 });
  feel.shake(1.2, CAMERA_SHAKE);
  camera.getWorldDirection(forward);
  const q = camera.quaternion.clone();
  for (const [distance, radius, life] of [[6, 26, 0.9], [18, 44, 1.2], [34, 70, 1.6]] as const) {
    shocks?.spawn(tmpVec.copy(camera.position).addScaledVector(forward, distance * WORLD), hdr(WHITE_HOT, 2), radius, life, q);
  }
  sparks?.emit(tmpVec.copy(camera.position).addScaledVector(forward, 12 * WORLD), hdr(ARC_CYAN, 2.4), 160, 60, 0.9, { length: 0.05 });
  barrel?.clearPulses();
}

function breach(camera: PerspectiveCamera, feel: CameraFeelRig) {
  breachAt = elapsedNow;
  flash(2.0, HAZARD_PALE);
  feel.shake(1.8, CAMERA_SHAKE);
  feel.kickFov(-8, { decay: 2 });
  camera.getWorldDirection(forward);
  for (let i = 0; i < 12; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const from = tmpVec.copy(camera.position).addScaledVector(forward, (6 + Math.random() * 40) * WORLD);
    const to = from.clone().add(new Vector3(Math.cos(a) * BORE * WORLD, Math.sin(a) * BORE * WORLD, 0).applyQuaternion(camera.quaternion));
    arcs?.spawn(from, to, hdr(HAZARD_PALE, 2.6), 0.6 + Math.random() * 0.6, 2.2);
  }
  sparks?.emit(tmpVec.copy(camera.position).addScaledVector(forward, 10 * WORLD), hdr(HAZARD, 2.4), 260, 50, 1.2, { length: 0.05 });
}

// ---- per-frame ------------------------------------------------------------------------------------------

export type VisualFrame = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
};

export function updateVisuals(dt: number, frame: VisualFrame) {
  const { camera } = frame;
  elapsedNow = frame.elapsed;
  running = frame.running;
  if (frame.running) {
    runTimeNow = frame.runTime;
    cameraU = railU(runTimeNow);
  }
  space?.follow(camera.position);

  updateRingCrossings(frame);
  seatRings(false);
  updateRingColors();
  updateGate(dt);
  updateRecords(camera);
  updateProjectiles();
  updateDebris(dt);
  updateOpenSpace(dt, camera);
  barrel?.updatePulses(dt, railU(FIRE_TIME) * RAIL_LENGTH + 4);
  sparks?.update(dt);
  shocks?.update(dt, camera);
  glints?.update(dt, camera);
  arcs?.update(dt);
  updatePost(dt);
  ringSurge = Math.max(0, ringSurge - dt * 2.2);
  beatKick = Math.max(0, beatKick - dt * 4);
  if (!frame.running) {
    driftOutOfBarrel(camera);
    frame.feel.update(dt, { shake: CAMERA_SHAKE });
  }
}

// ---- attract and end-screen cameras --------------------------------------------------------------------

/**
 * Attract: hang beside the breech in open space, looking down the length of
 * the gun toward the planet. The START letters float between you and it.
 */
export function updateAttractCamera(camera: PerspectiveCamera, modeTime: number) {
  const sway = Math.sin(modeTime * 0.23) * 2;
  const from = offsetPoint(0, -50 + sway, 14 + Math.sin(modeTime * 0.31) * 1.5, -30);
  const to = offsetPoint(0.22, -44, 3, 0);
  camera.position.copy(from);
  camera.lookAt(to);
}

function offsetPoint(u: number, x: number, y: number, z: number) {
  const frame = sampleRailFrame(rail, u);
  return frame.position
    .addScaledVector(frame.right, x * WORLD)
    .addScaledVector(frame.up, y * WORLD)
    .addScaledVector(frame.tangent, z * WORLD);
}

/** After a run that did not leave the muzzle, ease the camera out through the barrel wall. */
function driftOutOfBarrel(camera: PerspectiveCamera) {
  if (endedAt < 0 || launchedAt >= 0) return;
  const t = MathUtils.smoothstep(elapsedNow - endedAt, 0.4, 2.6);
  const frame = sampleRailFrame(rail, cameraU);
  endedOffset.copy(frame.right).multiplyScalar(-40 * WORLD * t).addScaledVector(frame.up, 9 * WORLD * t);
  camera.position.copy(endedFrom).add(endedOffset);
}

function updateRingCrossings(frame: VisualFrame) {
  if (!frame.running || !barrel) return;
  const crossed = Math.floor(beatPosition(runTimeNow));
  if (crossed <= lastRingCrossed) return;
  for (let k = lastRingCrossed + 1; k <= crossed; k += 1) {
    if (k < 0 || k > MUZZLE_RING) continue;
    const heat = ringHeat[k];
    const downbeat = k % 4 === 0;
    const speed = speedAt(runTimeNow);
    const pulseColor = heatColor(heat).multiplyScalar(downbeat ? 3.2 : 2);
    if (k < MUZZLE_RING) {
      for (let r = 0; r < RAIL_ANGLES.length; r += 1) barrel.firePulse(cameraU * RAIL_LENGTH + WORLD, r, speed + (90 + heat * 150) * WORLD, 1.2, pulseColor);
    }
    beatKick = downbeat ? 1 : 0.6;
    if (SHIFT_RINGS.has(k)) {
      // Gear shift: the key jumps and the whole barrel surges with it.
      ringSurge = 1.4;
      flash(0.22, heatColor(heat + 0.15, tmpColor).clone());
      frame.feel.kickFov(3.5, { decay: 2.5 });
      frame.feel.shake(0.4, CAMERA_SHAKE);
    }
    if (misfires.has(k)) continue;
    // Every coil you cross fires: the frame breathes with it.
    flash(downbeat ? 0.07 + heat * 0.05 : 0.035 + heat * 0.03, heatColor(heat, tmpColor).clone());
    frame.feel.kickFov(-(0.5 + heat * 0.9) * (downbeat ? 1.4 : 1), { decay: 9 });
  }
  lastRingCrossed = crossed;
}

function updateRingColors() {
  if (!barrel) return;
  const b = running ? beatPosition(runTimeNow) : 0;
  const sinceBeat = running ? b - Math.floor(b) : MathUtils.clamp((elapsedNow - ambientBeatAt) / BEAT, 0, 1);
  const downbeat = running ? Math.floor(b) % 4 === 0 : ambientDownbeat;
  const heatNow = running ? heatAt(runTimeNow) : 0;
  const waveSpeed = (running ? 90 + heatNow * 150 : 70) * WORLD * BEAT;
  const waveFront = sinceBeat * waveSpeed;
  const waveStrength = (1 - sinceBeat) ** 0.7 * (downbeat ? 1.5 : 1);
  const breaching = breachAt >= 0 ? elapsedNow - breachAt : -1;

  for (let k = 0; k < RING_COUNT; k += 1) {
    if (!ringVisible[k]) continue;
    const ahead = (ringU(k) - cameraU) * RAIL_LENGTH;
    const heat = ringHeat[k];
    heatColor(heat, tmpGlow);
    let intensity = 0.55 + heat * 1.2;

    // Rings about to be crossed charge up and fire as the payload passes.
    if (running) {
      const beatsAway = k - b;
      if (beatsAway > -0.2 && beatsAway < 2) intensity += 1.8 * (1 - Math.max(0, beatsAway) / 2) ** 2;
    }
    // The pulse racing down the rails lights each coil as it passes.
    const spacing = Math.max(5 * WORLD, speedAt(running ? runTimeNow : 0) * BEAT);
    const bump = Math.exp(-(((ahead - waveFront) / (spacing * 0.9)) ** 2)) * waveStrength;
    intensity += bump * 2.2 + ringSurge * 1.4;

    const misfire = misfires.get(k);
    if (drainedRings.has(k)) {
      // A leech is bleeding this coil: its glow sputters magenta.
      const sputter = 0.35 + 0.65 * Math.abs(Math.sin(elapsedNow * 23 + k));
      tmpGlow.lerp(HAZARD, 0.75);
      intensity *= sputter * 0.8;
    }
    if (misfire !== undefined && elapsedNow - misfire < 0.5) {
      const flicker = Math.sin((elapsedNow - misfire) * 90) > 0 ? 1 : 0.1;
      tmpGlow.copy(HAZARD);
      intensity = 1.6 * flicker;
    } else if (misfire !== undefined) {
      intensity *= 0.2;
    }
    if (breaching >= 0) {
      tmpGlow.copy(HAZARD_PALE);
      intensity = breaching < 0.6 ? 4 * (Math.random() > 0.3 ? 1 : 0.2) : Math.max(0, 1.5 - breaching);
    }
    if (ahead < -4 * WORLD) intensity *= 0.35;

    tmpGlow.multiplyScalar(intensity);
    if (intensity > 2.2) tmpGlow.lerp(tmpColor.copy(WHITE_HOT).multiplyScalar(intensity), MathUtils.clamp((intensity - 2.2) / 3, 0, 0.8));
    // The payload's own glow lights the coils nearest to it.
    const light = 0.22 + 1.05 * Math.exp(-Math.max(0, ahead) / (20 * WORLD)) + bump * 0.45 + ringSurge * 0.3;
    tmpBody.setRGB(1, 1, 1).lerp(heatColor(heat, tmpColor), 0.7).multiplyScalar(light);
    barrel.setRingColors(k, tmpBody, tmpGlow);
  }
  barrel.commitRings(false);
  barrel.railGlow.color.setScalar(0.7 + ringSurge * 0.8 + (1 - sinceBeat) * 0.35);
}

function updateGate(dt: number) {
  if (!barrel) return;
  const muzzle = barrel.muzzle;
  // After a breach the sealed muzzle stays where it jammed, as wreckage.
  const active = gateActive() || breachAt >= 0 || (runTimeNow >= FIRE_TIME && runTimeNow < FIRE_TIME + 0.4 && running);
  muzzle.visible = active;
  if (!active) return;
  const actual = muzzleDistanceAhead();
  const u = actual <= 140 * WORLD ? ringU(MUZZLE_RING) : Math.min(1, cameraU + muzzleVisualDistance(actual) / RAIL_LENGTH);
  muzzle.position.copy(rail.getPointAt(u));
  muzzle.quaternion.copy(railQuaternion(u));

  const target = runState.outcome === 'launch' ? 1 : 0;
  irisOpen += (target - irisOpen) * Math.min(1, dt * 2.2);
  const charge = MathUtils.clamp((runTimeNow - CHARGE_TIME) / (FIRE_TIME - CHARGE_TIME), 0, 1);
  const beatGlow = Math.exp(-(beatPosition(runTimeNow) % 1) * 5);
  const sealed = hdr(HAZARD, 1.2 + charge * 1.6 + beatGlow * 0.8);
  const edge = tmpColor.copy(sealed).lerp(hdr(WHITE_HOT, 2.4), irisOpen);
  const core = hdr(HAZARD_PALE, 2 + charge * 3 + Math.sin(elapsedNow * 30) * 0.6);
  barrel.setIris(irisOpen, edge, core);
  barrel.setMuzzleGlow(heatColor(1, tmpGlow).multiplyScalar(2.2 + beatGlow * 1.5));
}

function updateRecords(camera: PerspectiveCamera) {
  drainedRings.clear();
  const charge = MathUtils.clamp((runTimeNow - CHARGE_TIME) / (VERDICT_TIME - CHARGE_TIME), 0, 1);
  cameraPayloadPoint(camera, payload);
  for (const [id, record] of records) {
    const { mesh } = record;
    if (!mesh.parent) {
      dropRecord(id);
      continue;
    }
    const age = elapsedNow - record.bornAt;
    const grow = easeOutBack(MathUtils.clamp(age / 0.32, 0, 1));
    const lockPulse = record.locks > 0 ? 1 + 0.07 * Math.sin(elapsedNow * 22) : 1;
    // Bolts shrink as they reach the lens so an impact reads as a spark, not a wall.
    const nearLens = record.kind === 'bolt' ? MathUtils.clamp(mesh.position.distanceTo(camera.position) / (4 * WORLD), 0.12, 1) : 1;
    mesh.scale.setScalar(record.kind === 'letter' ? Math.max(0.01, grow * lockPulse) : Math.max(0.001, grow * lockPulse * DRONE_SCALE * nearLens));
    const denied = elapsedNow < (mesh.userData.deniedUntil ?? -1);

    if (record.kind === 'letter') {
      updateLetter(mesh, record, denied);
    } else {
      updateDroneTint(mesh, record, denied);
      if (record.kind === 'bolt' && nearLens < 1) {
        const tint = mesh.userData.tint as DroneTint;
        for (const material of tint.cores) material.color.multiplyScalar(0.35 + nearLens * 0.65);
      }
    }

    if (record.bracket) {
      const radius = ((mesh.userData.radius as number | undefined) ?? 1.6) * (record.kind === 'letter' ? 1 : DRONE_SCALE) * (1.05 + record.locks * 0.08);
      record.bracket.position.copy(mesh.position);
      record.bracket.quaternion.copy(camera.quaternion);
      record.bracket.rotateZ(Math.PI / 4 + elapsedNow * 1.8);
      record.bracket.scale.setScalar(radius * (1 + 0.25 * Math.exp(-(elapsedNow % 0.47) * 10)));
    }

    if (!running) continue;
    if (record.kind === 'interlock' && mesh.userData.latched && launchedAt < 0) {
      // Jammed safeties tether the payload with live arcs.
      arcs?.hold(`tether-${id}`, mesh.position, payload, hdr(HAZARD, 1.4 + charge * 1.4), 0.7 + charge * 0.6);
    } else if (record.kind === 'leech' && age > 0.4) {
      const ring = mesh.userData.drainingRing as number | undefined;
      if (ring !== undefined) drainedRings.add(ring);
      tmpVec.copy(mesh.position).sub(camera.position);
      camera.getWorldDirection(forward);
      tmpVec.addScaledVector(forward, -tmpVec.dot(forward)).normalize();
      const rim = tmpVec.multiplyScalar(2.6 * WORLD).add(mesh.position);
      arcs?.hold(`drain-${id}`, mesh.position, rim, hdr(HAZARD, 1.3), 0.35);
    } else if (record.kind === 'pylon') {
      const chargeLevel = (mesh.userData.charge as number | undefined) ?? 0;
      const tipMaterial = mesh.userData.tipMaterial as MeshBasicMaterial | undefined;
      if (tipMaterial) tipMaterial.color.copy(DRONE_PALETTES.pylon.edge).lerp(hdr(WHITE_HOT, 3.5), chargeLevel);
      if (chargeLevel > 0.55 && Math.random() < 0.25) {
        const a = Math.random() * Math.PI * 2;
        const b = a + Math.PI * (0.5 + Math.random());
        const reach = 2 * DRONE_SCALE;
        tmpVec.set(Math.cos(a) * reach, Math.sin(a) * reach, 0).applyQuaternion(mesh.quaternion).add(mesh.position);
        arcs?.spawn(tmpVec, new Vector3(Math.cos(b) * reach, Math.sin(b) * reach, 0).applyQuaternion(mesh.quaternion).add(mesh.position), hdr(WHITE_HOT, 2), 0.08, 0.5);
      }
    } else if (record.kind === 'threader' && mesh.userData.dash) {
      sparks?.emit(mesh.position, hdr(HAZARD_PALE, 1.1), 1, 1, 0.3, { length: 0.02 });
    }
  }
}

function updateDroneTint(mesh: Group, record: EnemyRecord, denied: boolean) {
  const tint = mesh.userData.tint as DroneTint | undefined;
  if (!tint) return;
  const flashing = elapsedNow < record.hitFlashUntil;
  const lockColor = mesh.userData.lockColor as Color | undefined;
  let edge: Color;
  if (denied) edge = Math.sin(elapsedNow * 60) > 0 ? hdr(HAZARD, 2.6) : hdr(HAZARD, 0.4);
  else if (flashing) edge = hdr(WHITE_HOT, 3);
  else if (mesh.userData.locked && lockColor) edge = hdr(lockColor, 2.2);
  else edge = tint.baseEdge;
  for (const material of tint.edges) material.color.copy(edge);
  const throb = 0.85 + 0.25 * Math.sin(elapsedNow * 7 + record.bornAt * 3);
  const core = flashing ? hdr(WHITE_HOT, 4) : tmpColor.copy(tint.baseCore).multiplyScalar(throb);
  for (const material of tint.cores) material.color.copy(core);
}

function updateLetter(mesh: Group, record: EnemyRecord, denied: boolean) {
  const parts = mesh.userData.letterParts as LetterParts | undefined;
  if (!parts) return;
  const shimmer = 1 + 0.08 * Math.sin(elapsedNow * 3 + record.bornAt * 7);
  if (denied) {
    const on = Math.sin(elapsedNow * 50) > 0;
    parts.litMaterial.color.copy(hdr(HAZARD, on ? 2 : 0.6));
    parts.frameMaterial.color.copy(hdr(HAZARD, 1.6));
  } else if (mesh.userData.locked) {
    parts.litMaterial.color.copy(hdr(WHITE_HOT, 2.2));
    parts.frameMaterial.color.copy(hdr(VIOLET, 2.2));
    parts.dimMaterial.color.copy(hdr(VIOLET, 0.3));
  } else {
    parts.litMaterial.color.copy(LETTER_PALETTE.lit).multiplyScalar(shimmer);
    parts.frameMaterial.color.copy(LETTER_PALETTE.frame);
    parts.dimMaterial.color.copy(LETTER_PALETTE.dim);
  }
}

function updateDebris(dt: number) {
  for (let i = debris.length - 1; i >= 0; i -= 1) {
    const piece = debris[i];
    piece.age += dt;
    if (piece.age >= piece.life) {
      piece.object.removeFromParent();
      debris.splice(i, 1);
      continue;
    }
    piece.object.position.addScaledVector(piece.velocity, dt);
    piece.object.rotation.x += piece.spin.x * dt;
    piece.object.rotation.y += piece.spin.y * dt;
    piece.object.rotation.z += piece.spin.z * dt;
    piece.object.scale.multiplyScalar(1 - dt * 1.6);
  }
}

function updateProjectiles() {
  for (const [id, mesh] of projectiles) {
    if (!mesh.parent) {
      projectiles.delete(id);
      continue;
    }
    sparks?.emit(mesh.position, hdr(ARC_CYAN, 1.2), 1, 1.5, 0.16, { length: 0.02 });
  }
}

function updateOpenSpace(dt: number, camera: PerspectiveCamera) {
  if (launchedAt < 0 || !space) return;
  const since = elapsedNow - launchedAt;
  // Hyperspace for a heartbeat: streaks tear past, then the sky goes still.
  const streak = Math.max(0, 1 - since / 1.6);
  if (streak > 0) {
    camera.getWorldDirection(forward);
    const count = Math.round(26 * streak);
    const rush = forward.clone().negate();
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = (4 + Math.random() * 26) * WORLD;
      tmpVec.set(Math.cos(a) * r, Math.sin(a) * r, -(40 + Math.random() * 90) * WORLD).applyQuaternion(camera.quaternion).add(camera.position);
      sparks?.emit(tmpVec, hdr(Math.random() < 0.3 ? VIOLET : ARC_CYAN, 1.6 + streak), 1, 320 * streak + 40, 0.35, { bias: rush, spread: 0, drag: 0, length: 0.06 });
    }
  }
  // Falling away from the planet, the sun clears its limb: an orbital sunrise.
  const drift = MathUtils.smoothstep(since, 0, 7);
  space.setPlanetOffset(new Vector3(-30 * drift, -95 * drift, 20 * drift), 1 - drift * 0.18);
  space.setStarBrightness(1 + streak * 0.8);
  space.setSunFlare(MathUtils.smoothstep(since, 1.8, 6.5));
  void dt;
}

function updatePost(dt: number) {
  flashUniform.value *= Math.exp(-dt * 5.5);
  if (flashUniform.value < 0.001) flashUniform.value = 0;
  const charging = running && runTimeNow >= CHARGE_TIME && launchedAt < 0 && breachAt < 0;
  if (runState.outcome === 'launch') chargeCalm = Math.min(1, chargeCalm + dt * 1.5);
  const charge = MathUtils.clamp((runTimeNow - CHARGE_TIME) / (FIRE_TIME - CHARGE_TIME), 0, 1);
  const target = charging ? (0.05 + charge * 0.2) * (1 + beatKick * 0.7) * (1 - chargeCalm * 0.6) : 0;
  edgeChargeUniform.value += (target - edgeChargeUniform.value) * Math.min(1, dt * 6);
  edgeColorUniform.value.copy(runState.outcome === 'launch' ? ARC_CYAN : VIOLET);
  if (breachAt >= 0) {
    // The barrel goes dark, then the frame lifts enough to read REPLAY.
    const since = elapsedNow - breachAt;
    const fall = MathUtils.smoothstep(since, 0.5, 1.6) * 0.86;
    const lift = MathUtils.smoothstep(since, 2.6, 4.2) * 0.56;
    blackoutUniform.value = Math.max(0, fall - lift);
  }
}

// ---- camera ---------------------------------------------------------------------------------------------

export function updateCameraEffects(dt: number, camera: PerspectiveCamera, runTime: number, feel: CameraFeelRig) {
  const heat = heatAt(runTime);
  const charge = MathUtils.clamp((runTime - CHARGE_TIME) / (FIRE_TIME - CHARGE_TIME), 0, 1);
  const sinceLaunch = launchedAt >= 0 ? elapsedNow - launchedAt : -1;
  let fov = heat * 9;
  if (sinceLaunch >= 0) fov = 9 + 6 * Math.exp(-sinceLaunch * 0.6);
  feel.setFovOffset(fov, { response: 4 });
  // A slow sway through the bends; the charge adds a nervous electric tremor.
  const sway = Math.sin(runTime * 0.42) * 0.035 + Math.sin(runTime * 0.17 + 1.3) * 0.02;
  const settle = sinceLaunch >= 0 ? Math.exp(-sinceLaunch * 0.8) : 1;
  camera.rotateZ(sway * settle);
  if (charge > 0 && launchedAt < 0 && breachAt < 0 && runState.outcome !== 'launch') feel.shake(dt * (0.25 + charge * 1.1), CAMERA_SHAKE);
  feel.update(dt, { shake: CAMERA_SHAKE });
}

function easeOutBack(t: number) {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}
