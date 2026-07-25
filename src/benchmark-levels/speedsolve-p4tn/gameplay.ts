import { CatmullRomCurve3, Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sampleRailFrame } from '../../engine/rail';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { CAP_OUT, createSolveCube, type SolveCube } from './cube';
import {
  FACE_COUNT,
  FACE_START_BARS,
  SPEEDSOLVE_BARS,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_RUN_DURATION,
  SPEEDSOLVE_TIME,
  SWING_SECONDS,
} from './timing';

// One continuous fight against a colossal twisting cube. The rail corkscrews and
// the world rolls sixty degrees at every face swing, so a full run is one orbit
// around the puzzle. Four wrong squares glow per face; each one destroyed snaps a
// quarter turn of that face's layer on the next beat, and four turns later the
// face is a single colour, blows its caps off, and lifts a weakpoint out of the
// machinery. Six weakpoints down, the shell blooms open around the naked core.

export { SPEEDSOLVE_BPM, SPEEDSOLVE_RUN_DURATION } from './timing';
export const SPEEDSOLVE_PLAYER_HEALTH = 3;

const TIME = SPEEDSOLVE_TIME;
const BEAT = TIME.beatSeconds;
const BAR = TIME.barSeconds;

/** Tangent distance from the rail to the cube centre. */
const CUBE_DISTANCE = 40;
/** Each face swing rolls the world one sixth of a turn; six swings make one orbit. */
const SWING_ROLL = -Math.PI / 3;
/** Three-quarter view: enough tilt to read the cube as a solid, little enough to read the face. */
const CUBE_TILT = new Euler(0.19, -0.30, 0.03, 'YXZ');

const FACETS_PER_FACE = 4;
const FACE_SLOTS = 9;

/** Layer-turn snap directions, cycled so a solve never looks like a metronome. */
const TURN_SIGNS = [1, -1, -1, 1, 1, -1, 1, -1];

/**
 * The authored scramble for each face: which four squares arrive wrong and which
 * foreign colour each wears. Corners and edges alternate face to face so the
 * player's sweep never repeats, and every set spans all four screen quadrants.
 */
const FACE_SCRAMBLES: ReadonlyArray<ReadonlyArray<{ col: number; row: number; color: number }>> = [
  [{ col: -1, row: 1, color: 2 }, { col: 1, row: 1, color: 4 }, { col: -1, row: -1, color: 3 }, { col: 1, row: -1, color: 1 }],
  [{ col: 0, row: 1, color: 5 }, { col: -1, row: 0, color: 0 }, { col: 1, row: 0, color: 3 }, { col: 0, row: -1, color: 2 }],
  [{ col: -1, row: 1, color: 4 }, { col: 1, row: 0, color: 1 }, { col: 0, row: -1, color: 5 }, { col: -1, row: -1, color: 0 }],
  [{ col: 1, row: 1, color: 0 }, { col: -1, row: 1, color: 2 }, { col: 0, row: -1, color: 4 }, { col: 1, row: -1, color: 5 }],
  [{ col: -1, row: 0, color: 3 }, { col: 1, row: 1, color: 1 }, { col: 1, row: -1, color: 0 }, { col: 0, row: 1, color: 5 }],
  [{ col: 0, row: 1, color: 1 }, { col: 1, row: 0, color: 3 }, { col: -1, row: -1, color: 2 }, { col: -1, row: 1, color: 4 }],
];

export type SpeedsolveEnemyKind = 'facet' | 'weakpoint' | 'core' | 'tetra' | 'octa' | 'prism' | 'bolt';

type FacetData = { role: 'facet'; face: number; index: number; color: number };
type WeakData = { role: 'weak'; face: number };
type CoreData = { role: 'core' };
type OrbitData = { role: 'orbit'; angle: number; rate: number; depth: number; phase: number; life: number; shots: number };
type DiveData = { role: 'dive'; u0: number; v0: number; u1: number; v1: number; life: number; spin: number };
type CrossData = { role: 'cross'; dir: number; v: number; life: number; phase: number };
type BoltData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type SpeedsolveSpawnData = FacetData | WeakData | CoreData | OrbitData | DiveData | CrossData | BoltData;
export type SpeedsolveSpawnEntry = LockOnSpawnEntry<SpeedsolveEnemyKind, SpeedsolveSpawnData>;
export type SpeedsolveUpdate = LockOnEnemyUpdate<SpeedsolveEnemyKind, SpeedsolveSpawnData>;

const KILL_SCORE: Record<SpeedsolveEnemyKind, number> = {
  facet: 160,
  weakpoint: 520,
  core: 2400,
  tetra: 110,
  octa: 190,
  prism: 130,
  bolt: 55,
};

// ---------------------------------------------------------------------------
// Rail: a slow corkscrew. The cube rides a fixed tangent offset ahead, so the
// rail's job is parallax and bank — the pale hall wheels around the puzzle.
// ---------------------------------------------------------------------------

export function createSpeedsolveRail() {
  const points: Vector3[] = [];
  const segments = 30;
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const angle = 0.6 + t * 1.85 * Math.PI * 2;
    points.push(new Vector3(
      Math.cos(angle) * 38,
      Math.sin(angle) * 21 + 8,
      -t * 520,
    ));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---------------------------------------------------------------------------
// Arena frame: every non-cube target is authored as (across, up, depth) in a frame
// that shares the camera's roll, so screen spread is authored directly while the
// player's edge-look still slides the whole arena.
// ---------------------------------------------------------------------------

const RING_ACROSS = 29;
const RING_UP = 18;
const CROSS_DEPTH = 24;
const CROSS_SPAN = 40;
const DIVE_START_DEPTH = 52;
const DIVE_END_DEPTH = 12;
const DIVE_CORNERS = [
  { u0: -44, v0: 26, u1: 19, v1: -8 },
  { u0: 44, v0: 26, u1: -19, v1: -8 },
  { u0: -44, v0: -26, u1: 19, v1: 9 },
  { u0: 44, v0: -26, u1: -19, v1: 9 },
] as const;

const SWING_TIMES = FACE_START_BARS.map((bar) => TIME.bar(bar) - SWING_SECONDS);
const CORE_SWING_TIME = TIME.bar(SPEEDSOLVE_BARS.core) - SWING_SECONDS;

function faceStartTime(face: number) {
  return TIME.bar(FACE_START_BARS[face]);
}

/** The world rolls in six quantized steps; the cube shares the roll so its face stays square to the screen. */
function rollAt(runTime: number) {
  let roll = 0;
  for (const start of SWING_TIMES) {
    const t = MathUtils.clamp((runTime - start) / SWING_SECONDS, 0, 1);
    roll += SWING_ROLL * (t * t * (3 - 2 * t));
  }
  return roll;
}

export function createSpeedsolveGameplay(bus: EventBus) {
  const cube = createSolveCube();
  const curve = createSpeedsolveRail();

  const arenaOrigin = new Vector3();
  const arenaForward = new Vector3(0, 0, -1);
  const arenaRight = new Vector3(1, 0, 0);
  const arenaUp = new Vector3(0, 1, 0);
  const cubeCenter = new Vector3();
  const cubeBaseQuat = new Quaternion();
  const tiltQuat = new Quaternion().setFromEuler(CUBE_TILT);
  const hoverQuat = new Quaternion();
  const hoverEuler = new Euler(0, 0, 0, 'YXZ');
  const scratch = new Vector3();
  const scratchQuat = new Quaternion();
  const basisMatrix = new Matrix4();

  type FaceRun = { solved: boolean; solvedAt: number; cleared: number; caps: number[]; targetCaps: number[] };
  const faces: FaceRun[] = Array.from({ length: FACE_COUNT }, () => ({
    solved: false,
    solvedAt: 0,
    cleared: 0,
    caps: [],
    targetCaps: [],
  }));
  const facetCaps = new Map<number, { face: number; cap: number }>();
  const kindById = new Map<number, SpeedsolveEnemyKind>();
  const turnQueue: number[] = [];
  const interceptions = new Set<number>();

  let cueIndex = 0;
  let turnCount = 0;
  let coreId = -1;
  let coreExposed = false;
  let coreKilled = false;
  let hitsTaken = 0;
  let facesSolved = 0;
  let weakpointsBroken = 0;
  let boltsIntercepted = 0;
  let runTimeNow = 0;

  function arenaPoint(across: number, up: number, depth: number, target: Vector3) {
    return target.copy(arenaOrigin)
      .addScaledVector(arenaForward, depth)
      .addScaledVector(arenaRight, across)
      .addScaledVector(arenaUp, up);
  }

  // --- cues: the authored clock that swings the cube and scrambles faces -----

  const cues: Array<{ time: number; run: () => void }> = [
    ...FACE_START_BARS.map((_bar, face) => ({ time: SWING_TIMES[face], run: () => swingToFace(face) })),
    {
      time: CORE_SWING_TIME,
      run: () => {
        cube.openShell(1);
        bus.emit('bossphase', { phase: 'summoned' });
      },
    },
    { time: TIME.bar(SPEEDSOLVE_BARS.core, 2), run: () => { coreExposed = true; } },
  ].sort((a, b) => a.time - b.time);

  function swingToFace(face: number) {
    cube.presentFace(face, SWING_SECONDS);
    scrambleFace(face);
  }

  /**
   * Paint the incoming face: the centre and four ring slots in the face colour,
   * four authored ring slots wrong. Earlier layer turns can migrate a cap off a
   * face, so empty slots are re-seated from the stripped pool first.
   */
  function scrambleFace(face: number) {
    const slots = cube.faceCaps(face);
    for (let slot = 0; slot < FACE_SLOTS; slot += 1) {
      if (slots[slot] >= 0) continue;
      slots[slot] = cube.fillSlot(face, (slot % 3) - 1, 1 - Math.floor(slot / 3));
    }
    faces[face].caps = slots.filter((index) => index >= 0);
    for (const index of faces[face].caps) {
      cube.setCapVisible(index, true);
      cube.setCapColor(index, face);
    }
    // Resolve the four wrong squares once, here: layer turns move caps between
    // slots, so a facet that spawns after the first snap must still own the cap it
    // was authored for rather than whatever now sits in that slot.
    faces[face].targetCaps = FACE_SCRAMBLES[face].map((target) => cube.slotCap(face, target.col, target.row));
    for (const [index, target] of FACE_SCRAMBLES[face].entries()) {
      const cap = faces[face].targetCaps[index];
      if (cap >= 0) cube.setCapColor(cap, target.color);
    }
  }

  /** Paint every face wrong up front, so the cube is visibly scrambled all over. */
  function scrambleAllFaces() {
    for (let face = 0; face < FACE_COUNT; face += 1) scrambleFace(face);
  }

  function conquerFace(face: number) {
    const run = faces[face];
    if (run.solved) return;
    run.solved = true;
    run.solvedAt = runTimeNow;
    facesSolved += 1;
    for (const index of run.caps) cube.setCapVisible(index, false);
    bus.emit('bossphase', { phase: 'exposed' });
  }

  // --- per-frame arena and cube pose ----------------------------------------

  function poseArena(runTime: number, runProgress: number) {
    const frame = sampleRailFrame(curve, runProgress);
    const roll = rollAt(runTime);
    arenaOrigin.copy(frame.position);
    arenaForward.copy(frame.tangent);
    arenaRight.copy(frame.right).applyAxisAngle(arenaForward, -roll);
    arenaUp.copy(frame.up).applyAxisAngle(arenaForward, -roll);

    // Arrival: the cube comes in from deep in the hall and decelerates into its
    // station exactly as the first face swings round.
    const arrival = cube.arrival;
    const settled = 1 - (1 - arrival) ** 3;
    arenaPoint(
      Math.sin(runTime * 0.29) * 1.7,
      Math.sin(runTime * 0.23 + 1.1) * 1.3,
      CUBE_DISTANCE + Math.sin(runTime * 0.37) * 2.2 + (1 - settled) * 58,
      cubeCenter,
    );

    basisMatrix.makeBasis(arenaRight, arenaUp, scratch.copy(arenaForward).negate());
    cubeBaseQuat.setFromRotationMatrix(basisMatrix);
    hoverEuler.set(
      Math.sin(runTime * 0.53) * 0.04,
      Math.sin(runTime * 0.41) * 0.055 + (1 - settled) * 5.5,
      0,
    );
    hoverQuat.setFromEuler(hoverEuler);
    cubeBaseQuat.multiply(tiltQuat).multiply(hoverQuat).normalize();
    return roll;
  }

  // --- enemy motion ---------------------------------------------------------

  function updateFacet(context: SpeedsolveUpdate, data: FacetData) {
    const { enemy, runTime } = context;
    const state = context.enemyState(() => {
      const cap = faces[data.face].targetCaps[data.index] ?? -1;
      facetCaps.set(enemy.id, { face: data.face, cap });
      return { cap };
    });
    if (state.cap >= 0) cube.capWorld(state.cap, enemy.mesh.position);
    else cube.faceWorld(data.face, 0, 0, CAP_OUT, enemy.mesh.position);
    enemy.mesh.quaternion.copy(cube.capQuat(state.cap, scratchQuat));
    enemy.mesh.userData.solvePulse = 0.5 + 0.5 * Math.sin(runTime * 7.4 + enemy.id);
    return runTime > faceStartTime(data.face) + BAR * 3.75;
  }

  function updateWeakpoint(context: SpeedsolveUpdate, data: WeakData) {
    const { enemy, runTime } = context;
    const run = faces[data.face];
    const expired = runTime > faceStartTime(data.face) + BAR * 4.2;
    const rise = run.solved ? MathUtils.clamp((runTime - run.solvedAt) / 0.42, 0, 1) : 0;
    const eased = rise * rise * (3 - 2 * rise);
    enemy.mesh.visible = run.solved;
    enemy.entry.lockable = run.solved;
    enemy.mesh.userData.charge = eased;
    if (!run.solved) {
      // Still buried in the machinery: park it out of frame entirely rather than
      // leave an unlockable target sitting dead centre of the player's sweep.
      enemy.mesh.position.copy(context.camera.position).addScaledVector(arenaForward, -24);
      return expired;
    }
    const breathe = Math.sin(runTime * 9.5) * 0.34;
    cube.faceWorld(data.face, 0, 0, CAP_OUT + 0.8 + eased * 6.4 + breathe, enemy.mesh.position);
    enemy.mesh.quaternion.copy(cube.faceQuat(data.face, scratchQuat));
    enemy.mesh.rotateZ(runTime * 2.1);
    return expired;
  }

  function updateCore(context: SpeedsolveUpdate, _data: CoreData) {
    const { enemy, runTime, age } = context;
    scratch.set(Math.sin(runTime * 1.7) * 1.5, Math.cos(runTime * 1.3) * 1.2, 0)
      .applyQuaternion(cube.rootQuat);
    enemy.mesh.position.copy(cube.center).add(scratch);
    enemy.mesh.quaternion.copy(cube.rootQuat);
    enemy.mesh.rotateY(runTime * 2.4);
    enemy.mesh.rotateX(runTime * 1.1);
    enemy.mesh.userData.exposed = coreExposed;
    enemy.mesh.userData.spinUp = MathUtils.clamp(age / 1.4, 0, 1);
    enemy.entry.lockable = coreExposed;

    if (coreExposed) {
      const fire = context.enemyState(() => ({ nextAt: age + 0.9 }));
      if (age >= fire.nextAt) {
        fire.nextAt = age + 2.6;
        fireBolt(context, arenaPoint(22, 11, CUBE_DISTANCE - 18, scratch));
        fireBolt(context, arenaPoint(-22, -10, CUBE_DISTANCE - 18, scratch));
      }
    }
    return false;
  }

  function updateOrbit(context: SpeedsolveUpdate, data: OrbitData) {
    const { enemy, runTime, age } = context;
    const angle = data.angle + age * data.rate;
    // The ring precesses a little instead of spinning flat, so a wave reads as a
    // real orbit around the cube without ever swinging a target off-screen.
    const precess = Math.sin(runTime * 0.23 + data.phase) * 0.1;
    const across = Math.cos(angle) * RING_ACROSS;
    const up = Math.sin(angle) * RING_UP;
    const ringAcross = across * Math.cos(precess) - up * Math.sin(precess);
    const ringUp = across * Math.sin(precess) + up * Math.cos(precess);
    arenaPoint(ringAcross, ringUp, data.depth + Math.sin(angle * 2) * 2, enemy.mesh.position);
    enemy.mesh.quaternion.copy(cube.rootQuat);
    enemy.mesh.rotateY(runTime * 1.6 + enemy.id);
    enemy.mesh.rotateX(runTime * 1.15);

    const fire = context.enemyState(() => ({ fired: 0, nextAt: 1.1 }));
    if (fire.fired < data.shots && age >= fire.nextAt) {
      fire.fired += 1;
      fire.nextAt = age + 2.4;
      // Launch from in front of the cube, and pulled toward the centre line: the
      // whole flight stays clear of the cube and still has room to close on the
      // player before the rail carries them past it.
      fireBolt(context, arenaPoint(ringAcross * 0.5, ringUp * 0.5, data.depth - 18, scratch));
    }
    return age > data.life;
  }

  function updateDive(context: SpeedsolveUpdate, data: DiveData) {
    const { enemy, runTime, age } = context;
    const t = MathUtils.clamp(age / data.life, 0, 1);
    // Depth collapses first, so a diver is already in front of the cube before it
    // sweeps across the frame; the long lateral run is the readable part.
    const depth = MathUtils.lerp(DIVE_START_DEPTH, DIVE_END_DEPTH, t ** 0.55);
    const sweep = t * t * (3 - 2 * t);
    arenaPoint(
      MathUtils.lerp(data.u0, data.u1, sweep),
      MathUtils.lerp(data.v0, data.v1, sweep) + Math.sin(age * 4.2) * 1.2,
      depth,
      enemy.mesh.position,
    );
    enemy.mesh.quaternion.copy(cube.rootQuat);
    enemy.mesh.rotateZ(runTime * data.spin);
    enemy.mesh.rotateX(runTime * data.spin * 0.7);
    return age > data.life;
  }

  function updateCross(context: SpeedsolveUpdate, data: CrossData) {
    const { enemy, runTime, age } = context;
    const t = MathUtils.clamp(age / data.life, 0, 1);
    arenaPoint(
      MathUtils.lerp(-CROSS_SPAN, CROSS_SPAN, t) * data.dir,
      data.v + Math.sin(age * 2.6 + data.phase) * 3.6,
      CROSS_DEPTH + Math.cos(age * 1.7 + data.phase) * 2,
      enemy.mesh.position,
    );
    enemy.mesh.quaternion.copy(cube.rootQuat);
    enemy.mesh.rotateZ((Math.PI / 2) * data.dir);
    enemy.mesh.rotateY(runTime * 3.4 + data.phase);
    return age > data.life;
  }

  function fireBolt(context: SpeedsolveUpdate, from: Vector3) {
    const origin = from.clone();
    const velocity = hostileShotAimPoint(context.camera, origin).sub(origin).normalize().multiplyScalar(4.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: origin, velocity, lastAge: 0 },
    });
  }

  function updateBolt(context: SpeedsolveUpdate, data: BoltData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: interceptions.delete(enemy.id),
      // Bolts brake further out than the engine default: a candy cube filling the
      // whole lens reads as a bug, and the HUD flash already sells the hit.
      config: { hitDistance: 3.2, damageDistance: 1.9 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 7,
      maxSpeed: 15,
      accel: 3.2,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 4.4);
    return shotBehindCamera(camera, data.position) || age > 11;
  }

  // --- timeline -------------------------------------------------------------

  function facetEntries(face: number): SpeedsolveSpawnEntry[] {
    const base = faceStartTime(face);
    return FACE_SCRAMBLES[face].map((target, index) => ({
      time: base + TIME.step(0, index * 2),
      kind: 'facet' as const,
      letter: String(target.color),
      hitPoints: 1,
      data: { role: 'facet' as const, face, index, color: target.color },
    }));
  }

  function weakpointEntry(face: number): SpeedsolveSpawnEntry {
    return {
      time: faceStartTime(face) + BEAT * 2,
      kind: 'weakpoint',
      hitStages: [2, 2],
      lockable: false,
      data: { role: 'weak', face },
    };
  }

  function crossWave(bar: number, rows: number[], dir: number, gapSteps: number): SpeedsolveSpawnEntry[] {
    return rows.map((v, index) => ({
      time: TIME.bar(bar) + TIME.step(0, index * gapSteps),
      kind: 'prism' as const,
      hitPoints: 1,
      data: { role: 'cross' as const, dir, v, life: 4.1, phase: index * 1.37 },
    }));
  }

  function diveWave(bar: number, corners: number[], gapSteps: number): SpeedsolveSpawnEntry[] {
    return corners.map((corner, index) => ({
      time: TIME.bar(bar) + TIME.step(0, index * gapSteps),
      kind: 'tetra' as const,
      hitPoints: 1,
      data: {
        role: 'dive' as const,
        u0: DIVE_CORNERS[corner].u0,
        v0: DIVE_CORNERS[corner].v0,
        u1: DIVE_CORNERS[corner].u1,
        v1: DIVE_CORNERS[corner].v1,
        life: 3.6,
        spin: 2.2 + index * 0.4,
      },
    }));
  }

  function orbitWave(bar: number, count: number, dir: number, shots: number): SpeedsolveSpawnEntry[] {
    return Array.from({ length: count }, (_unused, index) => ({
      time: TIME.bar(bar) + TIME.step(0, index * 2),
      kind: 'octa' as const,
      hitPoints: 2,
      data: {
        role: 'orbit' as const,
        angle: (index / count) * Math.PI * 2 + (dir > 0 ? 0.4 : 2.2),
        rate: 0.52 * dir,
        depth: CUBE_DISTANCE,
        phase: index * 2.1,
        life: 6.6,
        shots,
      },
    }));
  }

  const timeline: SpeedsolveSpawnEntry[] = sortTimeline([
    // Intro: two crossers, so the reticle has something to sweep while the cube arrives.
    ...crossWave(0.5, [9, -7], 1, 4),

    ...FACE_START_BARS.flatMap((_bar, face) => [...facetEntries(face), weakpointEntry(face)]),

    // Face 1 — room to learn the solve: one crossing train, one slow ring.
    ...crossWave(2.75, [11, 3, -6], 1, 4),
    ...orbitWave(4, 2, 1, 1),
    // Face 2 — divers arrive out of all four corners.
    ...diveWave(7.5, [0, 3, 1, 2], 3),
    ...orbitWave(9.2, 2, -1, 1),
    // Face 3 — a full-width crossing train under a counter-rotating ring.
    ...crossWave(12.5, [-12, -3, 6, 13], -1, 3),
    ...orbitWave(14, 2, 1, 1),
    // Face 4 — both grammars at once, and the ring starts firing twice.
    ...diveWave(17.4, [1, 3, 0], 4),
    ...orbitWave(18.6, 2, -1, 2),
    ...crossWave(20, [9, -9], 1, 4),
    // Face 5 — the widest sweep in the level.
    ...crossWave(22.5, [13, 4, -6, -13], 1, 4),
    ...orbitWave(24.2, 2, -1, 1),
    // Face 6 — everything at once, three rings and a train under the last solve.
    ...diveWave(27.4, [0, 2, 3, 1], 3),
    ...orbitWave(28.6, 3, 1, 2),
    ...crossWave(30, [10, -2, -11], -1, 4),

    // Core.
    {
      time: TIME.bar(SPEEDSOLVE_BARS.core),
      kind: 'core',
      hitStages: [3, 3],
      lockable: false,
      data: { role: 'core' },
    },
    ...crossWave(33, [12, -3, -12], 1, 4),
    ...diveWave(34.2, [1, 3], 5),
  ]);

  // --- run bookkeeping ------------------------------------------------------

  bus.on('runstart', () => {
    cube.reset();
    cueIndex = 0;
    turnCount = 0;
    turnQueue.length = 0;
    facetCaps.clear();
    kindById.clear();
    interceptions.clear();
    coreId = -1;
    coreExposed = false;
    coreKilled = false;
    hitsTaken = 0;
    facesSolved = 0;
    weakpointsBroken = 0;
    boltsIntercepted = 0;
    runTimeNow = 0;
    for (const face of faces) {
      face.solved = false;
      face.solvedAt = 0;
      face.cleared = 0;
      face.caps = [];
      face.targetCaps = [];
    }
    scrambleAllFaces();
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'letter') return;
    kindById.set(enemyId, kind as SpeedsolveEnemyKind);
    if (kind === 'core') coreId = enemyId;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    const kind = kindById.get(enemyId);
    kindById.delete(enemyId);
    if (kind === 'bolt') boltsIntercepted += 1;
    if (kind === 'weakpoint') weakpointsBroken += 1;
    if (enemyId === coreId && !coreKilled) {
      coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
    const facet = facetCaps.get(enemyId);
    if (!facet) return;
    facetCaps.delete(enemyId);
    // The wrong square snaps to the face colour and the layer twists on the next
    // beat: order never matters, every kill is one move closer to a single colour.
    if (facet.cap >= 0) cube.setCapColor(facet.cap, facet.face);
    turnQueue.push(facet.face);
    const run = faces[facet.face];
    run.cleared += 1;
    if (run.cleared >= FACETS_PER_FACE) conquerFace(facet.face);
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    facetCaps.delete(enemyId);
    kindById.delete(enemyId);
  });

  // Every rotation lands exactly on the beat: kills queue a turn, the transport
  // spends one per beat. A volley that clears a face performs four snaps in a row.
  bus.on('beat', () => {
    if (turnQueue.length === 0) return;
    const face = turnQueue.shift();
    if (face !== cube.faceIndex) return;
    cube.startTurn(TURN_SIGNS[turnCount % TURN_SIGNS.length]);
    turnCount += 1;
  });

  const level: LockOnRunnerLevel<SpeedsolveEnemyKind, SpeedsolveSpawnData> = {
    duration: SPEEDSOLVE_RUN_DURATION,
    bpm: SPEEDSOLVE_BPM,
    playerHealth: SPEEDSOLVE_PLAYER_HEALTH,
    createRail: createSpeedsolveRail,
    spawnTimeline: timeline,
    startWord: 'SOLVE!',
    replayWord: 'RESET!',
    // A speedcube run is metronomic: constant rail speed, no ease in or out.
    easeRunProgress: (time, duration) => MathUtils.clamp(time / duration, 0, 1),
    // Tight volleys. The engine default lets a sixth shot drift a whole bar, which
    // is too loose for a level whose entire identity is snapping onto the grid.
    timing: { shotDelay: { maxGridSeconds: 1.2 } },
    // Cube squares sit on a 3x3 grid roughly a quarter of a screen apart, so a
    // slightly wider lock still cannot catch two squares at once.
    lockRadiusNdc: 0.1,

    updateCameraEffects({ camera, runTime, runProgress, dt }) {
      runTimeNow = runTime;
      while (cueIndex < cues.length && cues[cueIndex].time <= runTime) {
        cues[cueIndex].run();
        cueIndex += 1;
      }
      cube.setArrival(MathUtils.clamp(runTime / (BAR * 1.1), 0, 1));
      const roll = poseArena(runTime, runProgress);
      cube.advance(dt);
      cube.place(cubeCenter, cubeBaseQuat);
      camera.rotateZ(roll);
      camera.updateMatrixWorld();
    },

    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'facet':
          return updateFacet(context, data);
        case 'weak':
          return updateWeakpoint(context, data);
        case 'core':
          return updateCore(context, data);
        case 'orbit':
          return updateOrbit(context, data);
        case 'dive':
          return updateDive(context, data);
        case 'cross':
          return updateCross(context, data);
        case 'bolt':
          return updateBolt(context, data);
      }
    },

    // The mechanism will not take a shot while a layer is in motion. A release
    // during a snap has its cube squares refused — everything else still fires —
    // so the level teaches its own rule: shoot the cube between the beats it turns
    // on. Snaps last one eighth note, and you can see the layer moving.
    validateRelease(enemies) {
      if (!cube.turning) return true;
      const blocked = enemies.filter((enemy) => enemy.kind === 'facet' || enemy.kind === 'weakpoint');
      if (blocked.length === 0) return true;
      bus.emit('shielded', {
        shields: blocked.map((enemy) => ({ enemyId: enemy.id, worldPosition: enemy.mesh.position.clone() })),
        blockedEnemyIds: blocked.map((enemy) => enemy.id),
      });
      const allowed = enemies.filter((enemy) => enemy.kind !== 'facet' && enemy.kind !== 'weakpoint');
      return allowed.length > 0 ? allowed : false;
    },

    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },

    scoreForHit(_volleySize, enemy) {
      return enemy.kind === 'core' ? 140 : 70;
    },

    // A single release that clears an entire face is this level's trick shot.
    scoreForVolley(results) {
      const facetKills = results.filter((result) => result.killed && result.enemy.kind === 'facet').length;
      const clean = results.length >= 4 && results.every((result) => result.killed);
      let bonus = 0;
      if (facetKills >= FACETS_PER_FACE) bonus += 900;
      if (clean && results.length >= 6) bonus += 400;
      else if (clean) bonus += 150;
      return bonus;
    },

    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (facesSolved === FACE_COUNT && coreKilled && score >= 19000 && clearRate >= 0.95) return 'S';
      if (facesSolved >= 5 && score >= 15000 && clearRate >= 0.8) return 'A';
      if (facesSolved >= 3 && score >= 10000 && clearRate >= 0.6) return 'B';
      if (score >= 5000 && clearRate >= 0.35) return 'C';
      return 'D';
    },

    detailsForRun() {
      return [
        `Faces solved ${facesSolved}/${FACE_COUNT}`,
        `Weakpoints ${weakpointsBroken}/${FACE_COUNT}`,
        coreKilled ? 'Core shattered' : 'Core intact',
        `Hull ${Math.max(0, SPEEDSOLVE_PLAYER_HEALTH - hitsTaken)}/${SPEEDSOLVE_PLAYER_HEALTH} · ${boltsIntercepted} shots cut`,
      ];
    },
  };

  // The attract screen already shows a scrambled cube behind the start word.
  scrambleAllFaces();

  return { ...level, cube };
}

export type { SolveCube };
