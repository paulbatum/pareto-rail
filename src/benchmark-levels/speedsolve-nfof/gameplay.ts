import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createSpeedProfile } from '../../engine/speed-profile';
import { mulberry32 } from '../../engine/rng';
import type { EventBus } from '../../events';
import {
  BOLT_MAX_AGE,
  CELL_PITCH,
  CUBE_HALF,
  FACE_COUNT,
  FACE_LIFT,
  FACE_SECONDS,
  ORBIT_FAR,
  ORBIT_NEAR,
  SPEEDSOLVE_BARS,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_DURATION,
  SPEEDSOLVE_MARKERS,
  SPEEDSOLVE_TIME,
  SPEEDSOLVE_PLAYER_HEALTH,
  TETRA_FIRE_AGES,
  bar,
  faceStartTime,
} from './timing';
import { createSolveRig, solveState, type SolveRig } from './solve-state';

// SPEEDSOLVE — one continuous boss fight against a colossal twisting puzzle
// cube. The rail is a long helix around the cube's flight axis, so the camera
// genuinely revolves around the puzzle while it solves it. Six faces, each a
// 3.5-bar solve window: glowing cells advance the solve (every kill snaps a
// layer rotation on the beat), clearing a face drops the whole panel in a
// shower of cubies and exposes a machinery weakpoint, and killing that swings
// the rail around to the next face. Candy-polyhedron waves harass the player
// throughout. At bar 23 the shell gives way entirely: the naked core spins up,
// takes the last barrage, and bursts into a confetti storm as the music
// resolves at bar 32.

export type SpeedsolveEnemyKind =
  | 'conductor'
  | 'cell'
  | 'weak'
  | 'tetra'
  | 'octa'
  | 'prism'
  | 'bolt'
  | 'core'
  | 'mote';

export type SpeedsolveSpawnData =
  | { role: 'conductor' }
  | { role: 'cell'; face: number; row: number; col: number; expireAt: number }
  | { role: 'weak'; face: number; expireAt: number }
  | { role: 'tetra'; side: number; phase: number; life: number; seed: number; fires: number }
  | { role: 'octa'; dir: number; phase: number; life: number }
  | { role: 'prism'; fromX: number; toX: number; y: number; z: number; crossTime: number; delay: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'core' }
  | { role: 'mote'; drift: Vector3; life: number };

export type SpeedsolveSpawnEntry = LockOnSpawnEntry<SpeedsolveEnemyKind, SpeedsolveSpawnData>;
export type SpeedsolveUpdate = LockOnEnemyUpdate<SpeedsolveEnemyKind, SpeedsolveSpawnData>;

// ---- speed profile → rail easing --------------------------------------------

// Steady mechanical cruise; a small lift through the climax phases and a hard
// decel once the core bursts and the music resolves.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.85],
  [bar(2), 1],
  [bar(16), 1.08],
  [bar(21), 1.14],
  [bar(SPEEDSOLVE_BARS.coreReveal), 0.92],
  [bar(26), 1.02],
  [bar(29), 0.85],
  [bar(31), 0.45],
  [bar(32), 0.3],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SPEEDSOLVE_DURATION);

export const speedsolveSpeedAt = speedProfile.speedAt;

export function speedsolveRunProgress(time: number, duration = SPEEDSOLVE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- rail --------------------------------------------------------------------

// A helix around the -Z axis: the camera revolves around the cube's axis about
// twice over the run, which reads as an orbit while the look-along-tangent
// contract keeps the puzzle comfortably centred.
const RAIL_POINTS = 96;
const HELIX_RADIUS = 9;
const HELIX_Z_EXTENT = 560;
const HELIX_REVOLUTIONS = 2.1;

export function createSpeedsolveRail() {
  const points: Vector3[] = [];
  for (let i = 0; i < RAIL_POINTS; i += 1) {
    const t = i / (RAIL_POINTS - 1);
    const angle = t * Math.PI * 2 * HELIX_REVOLUTIONS + 0.6;
    points.push(new Vector3(
      Math.cos(angle) * HELIX_RADIUS,
      Math.sin(angle) * HELIX_RADIUS,
      -t * HELIX_Z_EXTENT,
    ));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- authored choreography ---------------------------------------------------

// Cells per face escalate as the solve heats up. Beat offsets are quarter-note
// beats inside the face's 3.5-bar (14-beat) window.
const FACE_CELL_COUNTS = [3, 3, 4, 4, 5, 5];
const CELL_BEATS: Record<number, number[]> = {
  3: [0, 5, 10],
  4: [0, 3.5, 7, 10.5],
  5: [0, 3, 6, 9, 12],
};

type PlanBase = { anchorFace: number; offset: number };
type CellPlan = PlanBase & { type: 'cell'; row: number; col: number };
type TetraPlan = PlanBase & { type: 'tetra'; side: number; index: number; fires: number };
type OctaPlan = PlanBase & { type: 'octa'; dir: number; phase: number };
type PrismPlan = PlanBase & { type: 'prism'; fromX: number; toX: number; y: number; crossTime: number };
type Plan = CellPlan | TetraPlan | OctaPlan | PrismPlan;

const beatSeconds = SPEEDSOLVE_TIME.beatSeconds;

// Deterministic per-face cell slots on the 3×3 grid, centre reserved for the
// weakpoint. Same scramble every run — the level is a composed piece.
function faceSlots(face: number): Array<{ row: number; col: number }> {
  const rng = mulberry32(0x51e7 + face * 97);
  const slots: Array<{ row: number; col: number }> = [];
  const taken = new Set<string>();
  const count = FACE_CELL_COUNTS[face];
  let guard = 0;
  while (slots.length < count && guard < 200) {
    guard += 1;
    const row = Math.floor(rng() * 3);
    const col = Math.floor(rng() * 3);
    if (row === 1 && col === 1) continue;
    const key = `${row}:${col}`;
    if (taken.has(key)) continue;
    taken.add(key);
    slots.push({ row, col });
  }
  return slots;
}

function buildPlan(): Plan[] {
  const plans: Plan[] = [];
  for (let face = 0; face < FACE_COUNT; face += 1) {
    const anchorFace = face;
    const slots = faceSlots(face);
    const beats = CELL_BEATS[FACE_CELL_COUNTS[face]];
    slots.forEach((slot, i) => {
      plans.push({ type: 'cell', anchorFace, offset: beats[i] * beatSeconds, row: slot.row, col: slot.col });
    });

    // Tumbling tetrahedra spiral in early and shoot back; later faces get a
    // second volley per tetra.
    const fires = face >= 4 ? 2 : 1;
    plans.push({ type: 'tetra', anchorFace, offset: 2 * beatSeconds, side: -1, index: 0, fires });
    plans.push({ type: 'tetra', anchorFace, offset: 2.75 * beatSeconds, side: 1, index: 1, fires });
    if (face >= 2) plans.push({ type: 'tetra', anchorFace, offset: 8.5 * beatSeconds, side: -1, index: 2, fires: 0 });
    if (face >= 4) plans.push({ type: 'tetra', anchorFace, offset: 9.25 * beatSeconds, side: 1, index: 3, fires: 1 });

    // Octahedra lap the face on fast equatorial ellipses.
    const octaCount = face >= 3 ? 4 : 3;
    for (let i = 0; i < octaCount; i += 1) {
      plans.push({ type: 'octa', anchorFace, offset: (6 + i * 0.38) * beatSeconds, dir: i % 2 === 0 ? 1 : -1, phase: i * 2.1 + face });
    }

    // Prisms cross the whole frame on straight strafing runs.
    plans.push({ type: 'prism', anchorFace, offset: 11.5 * beatSeconds, fromX: -17, toX: 17, y: face % 2 === 0 ? 4.5 : -2.5, crossTime: 2.7 });
    plans.push({ type: 'prism', anchorFace, offset: 12.25 * beatSeconds, fromX: 17, toX: -17, y: face % 2 === 0 ? -1 : 2.5, crossTime: 2.9 });
    if (face >= 1) plans.push({ type: 'prism', anchorFace, offset: 13 * beatSeconds, fromX: -15, toX: 15, y: 0.5, crossTime: 2.5 });
  }

  // Core-phase harassment, anchored to the reveal marker.
  const reveal = SPEEDSOLVE_MARKERS.coreReveal;
  plans.push({ type: 'prism', anchorFace: -1, offset: reveal + 2.0, fromX: -17, toX: 17, y: 4, crossTime: 2.8 });
  plans.push({ type: 'prism', anchorFace: -1, offset: reveal + 3.0, fromX: 17, toX: -17, y: -2, crossTime: 2.8 });
  plans.push({ type: 'tetra', anchorFace: -1, offset: reveal + 4.0, side: -1, index: 0, fires: 1 });
  plans.push({ type: 'tetra', anchorFace: -1, offset: reveal + 5.0, side: 1, index: 1, fires: 1 });
  plans.push({ type: 'octa', anchorFace: -1, offset: reveal + 6.0, dir: 1, phase: 0.4 });
  plans.push({ type: 'octa', anchorFace: -1, offset: reveal + 6.4, dir: -1, phase: 2.9 });

  return plans.sort((a, b) => earliestFor(a) - earliestFor(b));
}

function earliestFor(plan: Plan) {
  return plan.anchorFace >= 0 ? faceStartTime(plan.anchorFace) + plan.offset : plan.offset;
}

// ---- scoring -----------------------------------------------------------------

const KILL_SCORE: Record<SpeedsolveEnemyKind, number> = {
  conductor: 0,
  cell: 150,
  weak: 400,
  tetra: 120,
  octa: 130,
  prism: 110,
  bolt: 30,
  core: 2500,
  mote: 40,
};

const WEAK_MIN_WINDOW = 2.75;

export function createSpeedsolveGameplay(bus: EventBus): LockOnRunnerLevel<SpeedsolveEnemyKind, SpeedsolveSpawnData> & {
  /** Shared cube rig; the runtime drives it each frame before gameplay reads it. */
  rig: SolveRig;
} {
  const rig: SolveRig = createSolveRig(createSpeedsolveRail());
  const plans = buildPlan();

  // Face windows can compress when the player conquers a face early: the next
  // face activates at half a bar after the conquest, whichever is later.
  let activation: number[] = [];
  let coreEntry: SpeedsolveSpawnEntry | null = null;
  let lastRunTime = 0;
  const weakByEnemyId = new Map<number, number>();
  let coreId = -1;
  const intercepted = new Set<number>();
  let hitsTaken = 0;

  const resetRun = () => {
    activation = Array.from({ length: FACE_COUNT }, (_, face) => faceStartTime(face));
    weakByEnemyId.clear();
    coreId = -1;
    intercepted.clear();
    lastRunTime = 0;
    hitsTaken = 0;
    solveState.reset(rig);
  };

  bus.on('runstart', resetRun);
  bus.on('runend', () => solveState.stop());
  bus.on('playerhit', ({ damage }) => {
    hitsTaken += damage;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'core') coreId = enemyId;
  });

  bus.on('kill', ({ enemyId }) => {
    const cell = solveState.cellKilled(enemyId);
    if (cell) rig.impulse(0.05 + Math.min(0.06, solveState.solvedInFace * 0.004));
    const weakFace = weakByEnemyId.get(enemyId);
    if (weakFace !== undefined) {
      weakByEnemyId.delete(enemyId);
      solveState.weakKilled(weakFace);
      rig.impulse(0.22);
    }
    if (enemyId === coreId) solveState.markCoreDead(lastRunTime);
  });

  // Early conquest pulls the next face forward and swings the rail around.
  solveState.on((signal) => {
    if (signal.type !== 'face-conquered') return;
    const next = signal.face + 1;
    if (next < FACE_COUNT && !solveState.faceConquered[next]) {
      activation[next] = Math.max(activation[next], lastRunTime + SPEEDSOLVE_TIME.barSeconds * 0.75);
      rig.swingTo(next, lastRunTime);
      solveState.faceIndex = next;
      solveState.emit({ type: 'face-change', face: next, conquered: true });
    }
  });

  function fireBolt(context: SpeedsolveUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  // ---- conductor -------------------------------------------------------------

  function updateConductor(context: SpeedsolveUpdate) {
    const { runTime } = context;
    lastRunTime = runTime;
    solveState.runTime = runTime;
    const st = context.enemyState(() => ({ done: [] as boolean[], motesLeft: 0, nextMoteAt: Infinity, lastTime: -1, curated: false }));

    // The conductor drives the shared cube rig: it runs first every frame, so
    // every other system (cells, polyhedra, visuals) reads a fresh pose. This
    // also keeps the rig alive in headless simulations, which never run the
    // site-level runtime.
    const dt = st.lastTime < 0 ? 1 / 60 : Math.min(0.05, Math.max(0.0001, runTime - st.lastTime));
    st.lastTime = runTime;
    rig.update({ runTime, easedProgress: context.runProgress, cameraPos: context.camera.position, dt });

    // Boot → first face.
    if (solveState.faceIndex < 0 && runTime >= faceStartTime(0)) {
      rig.swingTo(0, runTime);
      solveState.faceIndex = 0;
      solveState.emit({ type: 'face-change', face: 0, conquered: false });
    }

    // Time-based face lapse: an unconquered face scrambles on at window end.
    const active = solveState.faceIndex;
    if (
      solveState.phase === 'face' && active >= 0 && active < FACE_COUNT - 1
      && !solveState.faceConquered[active]
      && runTime >= activation[active] + FACE_SECONDS
    ) {
      const next = active + 1;
      // Let the swing settle before the next face's targets arrive.
      activation[next] = Math.max(activation[next], runTime + SPEEDSOLVE_TIME.barSeconds * 0.5);
      rig.swingTo(next, runTime);
      solveState.faceIndex = next;
      solveState.emit({ type: 'face-change', face: next, conquered: false });
    }

    // Core reveal: the shell gives way entirely.
    if (!solveState.coreRevealed && runTime >= SPEEDSOLVE_MARKERS.coreReveal) {
      solveState.phase = 'core';
      solveState.coreRevealed = true;
      solveState.emit({ type: 'core-reveal' });
    }
    if (coreEntry && !coreEntry.lockable && runTime >= SPEEDSOLVE_MARKERS.coreReady) {
      coreEntry.lockable = true;
    }
    if (solveState.coreDeadAt !== null && st.motesLeft <= 0 && st.nextMoteAt === Infinity) {
      st.motesLeft = 26;
      st.nextMoteAt = runTime;
    }
    if (st.motesLeft > 0 && runTime >= st.nextMoteAt) {
      st.motesLeft -= 1;
      st.nextMoteAt = runTime + 0.15;
      const angle = st.motesLeft * 2.39996;
      context.spawnEnemy({
        time: runTime,
        kind: 'mote',
        countsTowardTotal: false,
        data: {
          role: 'mote',
          drift: new Vector3(Math.cos(angle) * (2 + (st.motesLeft % 3)), 1.5 + (st.motesLeft % 5) * 0.4, (st.motesLeft % 2) - 0.5),
          life: 3.4,
        },
      });
    }

    // Celebration curtain calls after the core bursts: candy prisms streaming
    // through the resolve phrase, worth points but outside the run totals.
    if (!st.curated && runTime >= SPEEDSOLVE_MARKERS.end - 6.5) {
      st.curated = true;
      for (const [offset, y] of [[0.4, 4.5], [1.6, -2.5], [2.8, 1]] as const) {
        context.spawnEnemy({
          time: SPEEDSOLVE_MARKERS.end - 6.5 + offset,
          kind: 'prism',
          countsTowardTotal: false,
          data: { role: 'prism', fromX: offset % 1 < 0.5 ? -17 : 17, toX: offset % 1 < 0.5 ? 17 : -17, y, z: ORBIT_NEAR + 1.5, crossTime: 3.1, delay: Math.max(0, SPEEDSOLVE_MARKERS.end - 6.5 + offset - runTime) },
        });
      }
    }

    // Due spawns from the authored plan.
    st.done.length = plans.length;
    for (let i = 0; i < plans.length; i += 1) {
      if (st.done[i]) continue;
      const plan = plans[i];
      const due = plan.anchorFace >= 0 ? activation[plan.anchorFace] + plan.offset : plan.offset;
      if (runTime < due) continue;
      st.done[i] = true;
      spawnPlan(context, plan, due);
    }
    return false;
  }

  function spawnPlan(context: SpeedsolveUpdate, plan: Plan, due: number) {
    switch (plan.type) {
      case 'cell': {
        const id = context.spawnEnemy({
          time: context.runTime,
          kind: 'cell',
          data: {
            role: 'cell',
            face: plan.anchorFace,
            row: plan.row,
            col: plan.col,
            expireAt: Math.min(activation[plan.anchorFace] + FACE_SECONDS, SPEEDSOLVE_MARKERS.coreReveal),
          },
        });
        solveState.registerCell(id, { face: plan.anchorFace, row: plan.row, col: plan.col });
        break;
      }
      case 'tetra':
        context.spawnEnemy({
          time: context.runTime,
          kind: 'tetra',
          hitPoints: 1,
          data: { role: 'tetra', side: plan.side, phase: plan.index * 1.9 + plan.side, life: FACE_SECONDS - plan.offset + 2.2, seed: plan.anchorFace * 3 + plan.index, fires: plan.fires },
        });
        break;
      case 'octa':
        context.spawnEnemy({
          time: context.runTime,
          kind: 'octa',
          hitPoints: 1,
          data: { role: 'octa', dir: plan.dir, phase: plan.phase, life: FACE_SECONDS - plan.offset + 2.4 },
        });
        break;
      case 'prism':
        context.spawnEnemy({
          time: context.runTime,
          kind: 'prism',
          hitPoints: 1,
          data: { role: 'prism', fromX: plan.fromX, toX: plan.toX, y: plan.y, z: ORBIT_NEAR + 1.5, crossTime: plan.crossTime, delay: Math.max(0, due - context.runTime) },
        });
        break;
    }
  }

  // ---- movement ----------------------------------------------------------------

  function placeOnFace(context: SpeedsolveUpdate, x: number, y: number, z: number) {
    const rigState = rig.state;
    context.enemy.mesh.position.copy(rigState.pos)
      .addScaledVector(rigState.right, x)
      .addScaledVector(rigState.up, y)
      .addScaledVector(rigState.normal, z);
  }

  function updateCell(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'cell' }>) {
    if (context.runTime >= data.expireAt) return true;
    placeOnFace(
      context,
      (data.col - 1) * CELL_PITCH,
      (1 - data.row) * CELL_PITCH,
      CUBE_HALF + FACE_LIFT,
    );
    context.enemy.mesh.quaternion.copy(rig.state.quat);
    return false;
  }

  function updateWeak(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'weak' }>) {
    if (context.runTime >= data.expireAt) return true;
    placeOnFace(context, 0, 0, CUBE_HALF + 1.5);
    context.enemy.mesh.quaternion.copy(rig.state.quat);
    context.enemy.mesh.rotateZ(context.age * 0.9);
    return false;
  }

  function updateTetra(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'tetra' }>) {
    const { age } = context;
    if (age >= data.life) return true;
    const st = context.enemyState(() => ({ fireIndex: 0 }));
    void data.fires;
    const q = Math.min(1, age / 3.6);
    const eased = q * q * (3 - 2 * q);
    const radius = MathUtils.lerp(15.5, 6.8, eased);
    const angle = data.phase * 0.7 + age * 1.85 * data.side;
    const x = Math.cos(angle) * radius * 1.18;
    const y = Math.sin(angle) * radius * 0.6 + Math.sin(age * 1.35 + data.seed) * 1.3;
    const z = MathUtils.lerp(ORBIT_FAR + 1.6, ORBIT_NEAR, eased) + Math.sin(age * 2.1 + data.seed) * 0.5;
    placeOnFace(context, x, y, z);
    context.enemy.mesh.rotation.set(age * 2.4 * data.side, age * 1.7, age * 1.1);

    if (st.fireIndex < data.fires && age >= TETRA_FIRE_AGES[st.fireIndex]) {
      st.fireIndex += 1;
      fireBolt(context, context.enemy.mesh.position);
    }
    return false;
  }

  function updateOcta(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'octa' }>) {
    const { age } = context;
    if (age >= data.life) return true;
    const theta = data.phase + age * 1.55 * data.dir;
    const x = Math.cos(theta) * 13.6;
    const y = Math.sin(theta) * 6.1 + Math.sin(age * 2.1 + data.phase) * 0.9;
    const z = 11 + Math.sin(age * 0.9 + data.phase) * 2;
    placeOnFace(context, x, y, z);
    context.enemy.mesh.rotation.set(age * 3.1, age * 2.2, age * 1.4 * data.dir);
    return false;
  }

  function updatePrism(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'prism' }>) {
    const t = (context.age - data.delay) / data.crossTime;
    if (t > 1.12) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * 1.6;
    placeOnFace(context, x, y, data.z);
    const ahead = context.enemy.mesh.position.clone();
    const rigState = rig.state;
    ahead.addScaledVector(rigState.right, Math.sign(data.toX - data.fromX) * 2);
    context.enemy.mesh.lookAt(ahead);
    context.enemy.mesh.rotateZ(context.age * 4.5);
    return false;
  }

  function updateBolt(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: intercepted.delete(enemy.id),
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
      baseSpeed: 5,
      maxSpeed: 10.5,
      accel: 3,
      turnRate: 2.9,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateCore(context: SpeedsolveUpdate) {
    placeOnFace(context, 0, 0, 0);
    return false;
  }

  function updateMote(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'mote' }>) {
    if (context.age >= data.life) return true;
    context.enemy.mesh.position.addScaledVector(data.drift, context.runTime > 0 ? lastDt(context) : 0);
    context.enemy.mesh.rotation.set(context.age * 2.2, context.age * 1.7, 0);
    return false;
  }

  function lastDt(context: SpeedsolveUpdate) {
    const dt = Math.max(0, Math.min(0.05, context.age - (moteLastAge.get(context.enemy.id) ?? context.age)));
    moteLastAge.set(context.enemy.id, context.age);
    return dt;
  }
  const moteLastAge = new Map<number, number>();

  // Weakpoints are queued by the kill handler once a face clears; the conductor
  // spawns them on its next tick so dynamic spawns stay on the runner's terms.
  function pumpWeakQueue(context: SpeedsolveUpdate) {
    const pending = solveState.takePendingWeak(context.runTime);
    if (!pending) return;
    if (context.runTime > SPEEDSOLVE_MARKERS.coreReveal - 1.6) return;
    const expireAt = Math.min(
      SPEEDSOLVE_MARKERS.coreReveal - 0.2,
      Math.max(activation[pending.face] + FACE_SECONDS, context.runTime + WEAK_MIN_WINDOW),
    );
    const id = context.spawnEnemy({
      time: context.runTime,
      kind: 'weak',
      hitStages: [1, 1],
      data: { role: 'weak', face: pending.face, expireAt },
    });
    weakByEnemyId.set(id, pending.face);
  }

  // ---- level definition --------------------------------------------------------

  const timeline: SpeedsolveSpawnEntry[] = [
    {
      time: 0,
      kind: 'conductor',
      lockable: false,
      countsTowardTotal: false,
      data: { role: 'conductor' },
    },
    {
      // Slightly after the reveal so the last falling shell clears the core.
      time: SPEEDSOLVE_MARKERS.coreReveal + 0.6,
      kind: 'core',
      lockable: false,
      hitStages: [2, 2, 2],
      data: { role: 'core' },
    },
  ];
  coreEntry = timeline[1];

  const level: LockOnRunnerLevel<SpeedsolveEnemyKind, SpeedsolveSpawnData> = {
    duration: SPEEDSOLVE_DURATION,
    bpm: SPEEDSOLVE_BPM,
    playerHealth: SPEEDSOLVE_PLAYER_HEALTH,
    createRail: createSpeedsolveRail,
    spawnTimeline: timeline,
    easeRunProgress: speedsolveRunProgress,
    timing: { shotDelay: { maxGridSeconds: 0.22 } },
    updateAttractCamera({ camera, curve, modeTime, dt }) {
      rig.update({ runTime: 0, easedProgress: 0, cameraPos: camera.position, dt: Math.min(0.05, Math.max(0.0001, dt)) });
      const base = curve.getPointAt(0.004);
      camera.position.copy(base).add(new Vector3(
        Math.sin(modeTime * 0.5) * 0.4,
        Math.cos(modeTime * 0.4) * 0.3,
        Math.sin(modeTime * 0.3) * 0.2,
      ));
      camera.lookAt(rig.state.pos.clone().add(new Vector3(Math.sin(modeTime * 0.45) * 0.5, Math.cos(modeTime * 0.6) * 0.3, 0)));
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      pumpWeakQueue(context);
      switch (data.role) {
        case 'conductor':
          return updateConductor(context);
        case 'cell':
          return updateCell(context, data);
        case 'weak':
          return updateWeak(context, data);
        case 'tetra':
          return updateTetra(context, data);
        case 'octa':
          return updateOcta(context, data);
        case 'prism':
          return updatePrism(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'core':
          return updateCore(context);
        case 'mote':
          return updateMote(context, data);
      }
    },
    scoreForHit: () => 40,
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.14;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * results.length * 25;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const solved = solveState.facesConquered;
      if (solveState.coreDeadAt !== null && solved >= 6 && clearRate >= 0.9 && score >= 14000) return 'WORLD RECORD';
      if (solveState.coreDeadAt !== null && clearRate >= 0.68) return 'SUB-60';
      if (solveState.coreDeadAt !== null) return 'CFOP';
      if (solved >= 4) return 'SOLVER';
      if (solved >= 2) return 'CUBER';
      return 'SCRAMBLED';
    },
    detailsForRun() {
      const hull = Math.max(0, SPEEDSOLVE_PLAYER_HEALTH - hitsTaken);
      const lines = [`FACES SOLVED ${solveState.facesConquered}/${FACE_COUNT}`, `HULL ${hull}/${SPEEDSOLVE_PLAYER_HEALTH}`];
      lines.push(solveState.coreDeadAt !== null ? 'CORE BURST' : 'CORE INTACT');
      return lines;
    },
  };

  return Object.assign(level, { rig });
}
