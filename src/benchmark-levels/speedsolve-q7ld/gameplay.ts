import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type {
  LockOnCameraEffectsUpdate,
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import type { EventBus } from '../../events';
import {
  CUBE_CENTER,
  FACE_FRAMES,
  FACE_QUATS,
  aimPointAt,
  buildArcLengthEase,
  buildRailPoints,
  faceWorld,
  swingAt,
  tileCenter,
} from './structure';
import {
  CODA_TIME,
  CORE_TIME,
  SOLVE_DEADLINE_BEATS,
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_DURATION,
  WEAKPOINT_RETIRE_BEATS,
  bar,
  beats,
  faceStart,
} from './timing';

// SPEEDSOLVE — one continuous boss fight against a colossal twisting-puzzle
// cube. Six 4-bar face sections, each the same mechanical ritual:
//
//   solve   four squares glow on the face; destroying one ratchets a layer
//           rotation onto the next beat, one step closer to a single color
//   breach  the solved face sheds its tiles (or the hatch is forced), baring
//           a weakpoint in the machinery underneath
//   swing   the rail snaps 90° around an edge to the next face, on the beat
//
// All the while candy-colored polyhedra — tetrahedra, octahedra, prisms —
// orbit in shooting waves. Six faces down, the shells blast away and the
// naked core takes the final barrage.

export { SPEEDSOLVE_BPM, SPEEDSOLVE_DURATION, CORE_TIME, CODA_TIME, bar, beats } from './timing';

export const SPEEDSOLVE_PLAYER_HEALTH = 3;

// ---- rail --------------------------------------------------------------------

const railPoints = buildRailPoints();
const speedsolveRail = new CatmullRomCurve3(railPoints, false, 'centripetal', 0.5);
speedsolveRail.arcLengthDivisions = 2000;
speedsolveRail.getLength();

export function createSpeedsolveRail() {
  return speedsolveRail;
}

export const speedsolveRunProgress = buildArcLengthEase(railPoints);

// ---- spawn data --------------------------------------------------------------

export type SpeedsolveEnemyKind =
  | 'panel'
  | 'weakpoint'
  | 'tetra'
  | 'octa'
  | 'prism'
  | 'bolt'
  | 'core';

// Timeline data is immutable and reused across runs; per-enemy runtime state
// lives in enemyState bags. Dynamically spawned bolts get fresh data objects.
// `face` -1 places an enemy in the live camera frame (finale escorts).
export type SpeedsolveSpawnData =
  | { role: 'panel'; face: number; tile: number }
  | { role: 'weakpoint'; face: number }
  | { role: 'tetra'; face: number; fromX: number; fromY: number; toX: number; toY: number; forward: number; arc: number; delay: number; crossTime: number }
  | { role: 'prism'; face: number; y: number; fromX: number; toX: number; forward: number; delay: number; crossTime: number }
  | { role: 'octa'; face: number; x: number; y: number; forward: number; seed: number; leaveAge: number; quietAfter: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; colorIndex: number }
  | { role: 'core' };

export type SpeedsolveSpawnEntry = LockOnSpawnEntry<SpeedsolveEnemyKind, SpeedsolveSpawnData>;
export type SpeedsolveUpdate = LockOnEnemyUpdate<SpeedsolveEnemyKind, SpeedsolveSpawnData>;

// ---- spawn timeline -----------------------------------------------------------

// Which four of the eight outer tiles glow per face. The center tile is never
// a target (it pops for the weakpoint hatch), and each set spans left/right
// and top/bottom so the lock sweep crosses the whole face.
const PANEL_TILES: ReadonlyArray<readonly number[]> = [
  [0, 2, 8, 6], // corners — the first face teaches the full sweep
  [1, 5, 7, 3], // edge cross
  [0, 5, 7, 2],
  [6, 1, 8, 3],
  [2, 7, 0, 5],
  [8, 3, 1, 6],
];

function panels(face: number): SpeedsolveSpawnEntry[] {
  return PANEL_TILES[face].map((tile, index) => ({
    time: faceStart(face) + beats(1 + index * 0.5),
    kind: 'panel',
    data: { role: 'panel', face, tile },
  }));
}

function weakpoint(face: number): SpeedsolveSpawnEntry {
  return {
    time: faceStart(face) + beats(SOLVE_DEADLINE_BEATS + 0.25),
    kind: 'weakpoint',
    hitPoints: 2,
    data: { role: 'weakpoint', face },
  };
}

function tetras(
  face: number,
  atBeats: number,
  runs: Array<{ fromX: number; fromY: number; toX: number; toY: number; forward?: number; arc?: number; crossTime?: number }>,
): SpeedsolveSpawnEntry[] {
  return runs.map((run, index) => ({
    time: faceStart(face) + beats(atBeats) + index * 0.11,
    kind: 'tetra',
    data: {
      role: 'tetra',
      face,
      fromX: run.fromX,
      fromY: run.fromY,
      toX: run.toX,
      toY: run.toY,
      forward: run.forward ?? 8,
      arc: run.arc ?? 5,
      delay: index * 0.42,
      crossTime: run.crossTime ?? 2.3,
    },
  }));
}

function prisms(
  face: number,
  atBeats: number,
  runs: Array<{ y: number; fromX: number; toX: number; forward?: number; crossTime?: number }>,
): SpeedsolveSpawnEntry[] {
  return runs.map((run, index) => ({
    time: faceStart(face) + beats(atBeats) + index * 0.13,
    kind: 'prism',
    data: {
      role: 'prism',
      face,
      y: run.y,
      fromX: run.fromX,
      toX: run.toX,
      forward: run.forward ?? 8.5,
      delay: index * 0.5,
      crossTime: run.crossTime ?? 2.5,
    },
  }));
}

function octas(
  face: number,
  atBeats: number,
  posts: Array<[number, number]>,
  options: { leaveAge?: number; quietAfter?: number } = {},
): SpeedsolveSpawnEntry[] {
  return posts.map(([x, y], index) => ({
    time: faceStart(face) + beats(atBeats) + index * 0.24,
    kind: 'octa',
    hitPoints: 2,
    data: {
      role: 'octa',
      face,
      x,
      y,
      forward: 9.5,
      seed: face * 7.3 + index * 2.17 + 1,
      leaveAge: options.leaveAge ?? beats(11.5 - atBeats),
      quietAfter: options.quietAfter ?? faceStart(face) + beats(11),
    },
  }));
}

const CORE_ENTRY: SpeedsolveSpawnEntry = {
  time: bar(24.25),
  kind: 'core',
  hitStages: [4, 4, 6],
  lockable: false,
  data: { role: 'core' },
};

function buildTimeline(): SpeedsolveSpawnEntry[] {
  const entries: SpeedsolveSpawnEntry[] = [];
  for (let face = 0; face < 6; face += 1) {
    entries.push(...panels(face), weakpoint(face));
  }

  // Wave choreography per face — pressure thickens as the solve advances.
  entries.push(
    ...prisms(0, 4, [
      { y: -9.5, fromX: -24, toX: 24 },
      { y: 9.5, fromX: 24, toX: -24 },
    ]),

    ...tetras(1, 3.5, [
      { fromX: -22, fromY: -12, toX: 20, toY: 12 },
      { fromX: 22, fromY: -10, toX: -20, toY: 13, arc: 6 },
      { fromX: -20, fromY: 14, toX: 22, toY: -11, arc: 4 },
    ]),

    ...octas(2, 3, [
      [-13.5, 6],
      [13.5, -5],
    ]),
    ...prisms(2, 6, [{ y: 0.5, fromX: -25, toX: 25, forward: 7 }]),

    ...tetras(3, 3, [
      { fromX: -23, fromY: 12, toX: 21, toY: -12 },
      { fromX: 23, fromY: 13, toX: -21, toY: -10, arc: 6 },
      { fromX: -21, fromY: -13, toX: 23, toY: 10, arc: 4.5 },
    ]),
    ...octas(3, 3.5, [[0, 12.5]]),

    ...prisms(4, 3.5, [
      { y: -10.5, fromX: 25, toX: -25, crossTime: 2.2 },
      { y: 11, fromX: -25, toX: 25, crossTime: 2.2 },
    ]),
    ...octas(4, 3, [
      [-14, -7],
      [14, 8],
    ]),

    ...tetras(5, 3, [
      { fromX: -24, fromY: -12, toX: 22, toY: 12, crossTime: 2.1 },
      { fromX: 24, fromY: -12, toX: -22, toY: 12, crossTime: 2.1, arc: 6 },
      { fromX: -22, fromY: 13, toX: 24, toY: -12, crossTime: 2.1, arc: 4 },
      { fromX: 22, fromY: 14, toX: -24, toY: -10, crossTime: 2.1, arc: 5.5 },
    ]),
    ...octas(5, 3.5, [[0, -12]]),

    // Finale escorts ride the camera frame while the naked core spins up.
    ...octas(-1, 0, [
      [-14.5, 6.5],
      [14.5, -5.5],
    ]).map((entry) => ({
      ...entry,
      time: bar(25) + (entry.time - faceStart(-1)),
      data: { ...entry.data, forward: 26, leaveAge: bar(4.2), quietAfter: CODA_TIME - 2.5 } as SpeedsolveSpawnData,
    })),
    ...prisms(-1, 0, [
      { y: -9, fromX: -26, toX: 26, forward: 24, crossTime: 2.6 },
      { y: 10, fromX: 26, toX: -26, forward: 27, crossTime: 2.6 },
    ]).map((entry, index) => ({
      ...entry,
      time: bar(26.5 + index) + 0.13 * index,
    })),

    CORE_ENTRY,
  );

  return entries.sort((a, b) => a.time - b.time);
}

// ---- camera ------------------------------------------------------------------

const WORLD_UP = new Vector3(0, 1, 0);
const lookMatrix = new Matrix4();
const qBase = new Quaternion();
const qEdge = new Quaternion();
const qMine = new Quaternion();
const railLookPoint = new Vector3();
const aimScratch = new Vector3();

// The runner aims the camera down the rail tangent and layers the player's
// edge-look on top. This hook re-bases that orientation onto the cube (the
// rail is an orbit — the tangent never faces the action) while preserving the
// edge-look delta so pointer look-around still works.
function updateSpeedsolveCamera({ camera, curve, runTime, runProgress }: LockOnCameraEffectsUpdate) {
  railLookPoint.copy(curve.getPointAt(MathUtils.clamp(runProgress + 0.025, 0, 1)));
  lookMatrix.lookAt(camera.position, railLookPoint, WORLD_UP);
  qBase.setFromRotationMatrix(lookMatrix);
  qEdge.copy(qBase).invert().multiply(camera.quaternion);

  aimPointAt(runTime, aimScratch);
  lookMatrix.lookAt(camera.position, aimScratch, WORLD_UP);
  qMine.setFromRotationMatrix(lookMatrix).multiply(qEdge);

  // Blend in over the first bar so the runner's attract→run ease stays smooth.
  const blend = MathUtils.smoothstep(runTime, 0, 1.2);
  camera.quaternion.slerp(qMine, blend);

  const swing = swingAt(runTime);
  if (swing) camera.rotateZ(Math.sin(swing.t * Math.PI) * 0.055 * swing.sign);
  camera.updateMatrixWorld();
}

// ---- gameplay ----------------------------------------------------------------

const KILL_SCORE: Record<SpeedsolveEnemyKind, number> = {
  panel: 150,
  weakpoint: 350,
  tetra: 120,
  octa: 200,
  prism: 140,
  bolt: 40,
  core: 3000,
};

const BOLT_MAX_AGE = 9;
const OCTA_HOP_SECONDS = 0.26;

export function createSpeedsolveGameplay(bus: EventBus): LockOnRunnerLevel<SpeedsolveEnemyKind, SpeedsolveSpawnData> {
  const timeline = buildTimeline();

  const interceptions = new Set<number>();
  const panelKillsByFace = [0, 0, 0, 0, 0, 0];
  let facesSolved = 0;
  let weakpointsBroken = 0;
  let boltsShot = 0;
  let hitsTaken = 0;
  let coreKilled = false;
  let coreKilledAt = -1;
  let coreExposed = false;
  let coreId = -1;
  let coreFlinchUntil = -1;

  bus.on('runstart', () => {
    interceptions.clear();
    panelKillsByFace.fill(0);
    facesSolved = 0;
    weakpointsBroken = 0;
    boltsShot = 0;
    hitsTaken = 0;
    coreKilled = false;
    coreKilledAt = -1;
    coreExposed = false;
    coreId = -1;
    coreFlinchUntil = -1;
    CORE_ENTRY.lockable = false;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'core') {
      coreId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });
  // Stage break: the core loses containment for a breath and cannot be locked
  // while it whips; then it re-arms hotter.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== coreId) return;
    coreFlinchUntil = lastRunTime + 1.25;
    CORE_ENTRY.lockable = false;
  });

  let lastRunTime = 0;

  function fireBolt(context: SpeedsolveUpdate, from: Vector3, colorIndex: number) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(6);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {}, colorIndex },
    });
  }

  /** Resolve a wave enemy's frame basis: an authored cube face, or the live camera. */
  function wavePosition(context: SpeedsolveUpdate, face: number, x: number, y: number, forward: number, out: Vector3) {
    if (face >= 0) return faceWorld(face, x, y, forward, out);
    const camera = context.camera;
    out.copy(camera.position);
    const fwd = new Vector3();
    camera.getWorldDirection(fwd);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    return out.addScaledVector(fwd, forward).addScaledVector(right, x).addScaledVector(up, y);
  }

  // ---- movement ---------------------------------------------------------------

  function updatePanel(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'panel' }>) {
    const { enemy, runTime, age } = context;
    if (runTime >= faceStart(data.face) + beats(SOLVE_DEADLINE_BEATS)) return true;
    tileCenter(data.face, data.tile, 1.8 + Math.sin(age * 2.1 + data.tile) * 0.16, enemy.mesh.position);
    enemy.mesh.quaternion.copy(FACE_QUATS[data.face]);
    enemy.mesh.userData.faceIndex = data.face;
    enemy.mesh.userData.tileIndex = data.tile;
    return false;
  }

  function updateWeakpoint(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'weakpoint' }>) {
    const { enemy, runTime, age } = context;
    const retireAt = faceStart(data.face) + beats(WEAKPOINT_RETIRE_BEATS);
    if (runTime >= retireAt) return true;
    // Piston head: emerges from the hatch, pumps on the half-beat, and starts
    // retracting just before the swing.
    const emerge = MathUtils.smoothstep(age, 0, 0.5);
    const retract = MathUtils.smoothstep(runTime, retireAt - 0.45, retireAt);
    const pump = Math.max(0, Math.sin((runTime / beats(0.5)) * Math.PI)) * 0.5;
    tileCenter(data.face, 4, 0.6 + (3.0 + pump) * emerge * (1 - retract), enemy.mesh.position);
    enemy.mesh.quaternion.copy(FACE_QUATS[data.face]);
    enemy.mesh.userData.faceIndex = data.face;
    enemy.mesh.userData.emerge = emerge * (1 - retract);
    return false;
  }

  function updateTetra(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'tetra' }>) {
    const { enemy, age } = context;
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = MathUtils.lerp(data.fromY, data.toY, eased);
    // The dive bulges toward the camera mid-crossing — a strafing run, not a drift.
    const forward = data.forward + Math.sin(eased * Math.PI) * data.arc;
    wavePosition(context, data.face, x, y, forward, enemy.mesh.position);
    const ahead = wavePosition(
      context,
      data.face,
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)),
      MathUtils.lerp(data.fromY, data.toY, Math.min(1, eased + 0.05)),
      data.forward + Math.sin(Math.min(1, eased + 0.05) * Math.PI) * data.arc,
      new Vector3(),
    );
    enemy.mesh.lookAt(ahead);
    enemy.mesh.userData.spinRate = 7;
    return false;
  }

  function updatePrism(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'prism' }>) {
    const { enemy, age } = context;
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.1) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(age * 4.2 + data.y) * 0.5;
    wavePosition(context, data.face, x, y, data.forward, enemy.mesh.position);
    const ahead = wavePosition(context, data.face, MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.06)), y, data.forward, new Vector3());
    enemy.mesh.lookAt(ahead);
    enemy.mesh.userData.spinRate = 3.2;
    return false;
  }

  function updateOcta(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'octa' }>) {
    const { enemy, runTime, age, camera } = context;
    const state = context.enemyState(() => ({
      x: data.x,
      y: data.y,
      fromX: data.x,
      fromY: data.y,
      toX: data.x,
      toY: data.y,
      hopStarted: -1,
      lastHopBeat: Math.floor(runTime / beats(2)),
      nextFireAt: runTime + beats(2) + (data.seed % 1) * beats(2),
    }));

    // Station-keeping hops quantized to the two-beat grid — the escorts move
    // the way the cube does, in snaps.
    const hopBeat = Math.floor(runTime / beats(2));
    if (hopBeat !== state.lastHopBeat && age > 0.7 && age < data.leaveAge - 0.6) {
      state.lastHopBeat = hopBeat;
      state.hopStarted = runTime;
      state.fromX = state.x;
      state.fromY = state.y;
      const jitter = (n: number) => Math.sin(data.seed * 39.7 + hopBeat * n);
      state.toX = MathUtils.clamp(data.x + jitter(11) * 5.5, -16.5, 16.5);
      state.toY = MathUtils.clamp(data.y + jitter(17) * 4.5, -12, 13);
    }
    if (state.hopStarted >= 0) {
      const k = MathUtils.clamp((runTime - state.hopStarted) / OCTA_HOP_SECONDS, 0, 1);
      const snap = 1 - (1 - k) ** 3;
      state.x = MathUtils.lerp(state.fromX, state.toX, snap);
      state.y = MathUtils.lerp(state.fromY, state.toY, snap);
      enemy.mesh.userData.hopping = k < 1;
    }

    // Telegraphed return fire in the cube's own colors.
    const untilShot = state.nextFireAt - runTime;
    enemy.mesh.userData.charge = untilShot < 0.7 && runTime < data.quietAfter ? 1 - untilShot / 0.7 : 0;
    if (runTime >= state.nextFireAt) {
      state.nextFireAt = runTime + beats(4);
      if (runTime < data.quietAfter) fireBolt(context, enemy.mesh.position, (Math.abs(Math.floor(data.seed * 13)) + hopBeat) % 6);
    }

    if (age > data.leaveAge) {
      // Burners out: it kicks away from the face and is gone.
      const leave = age - data.leaveAge;
      wavePosition(context, data.face, state.x + Math.sign(state.x || 1) * leave * 26, state.y + leave * 8, data.forward + leave * 14, enemy.mesh.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      return leave > 0.9;
    }

    wavePosition(context, data.face, state.x, state.y, data.forward, enemy.mesh.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.userData.spinRate = 1.6;
    return false;
  }

  function updateBolt(context: SpeedsolveUpdate, data: Extract<SpeedsolveSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    enemy.mesh.userData.colorIndex = data.colorIndex;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: interceptions.delete(enemy.id),
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
      baseSpeed: 6.5,
      maxSpeed: 14,
      accel: 3.2,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateCore(context: SpeedsolveUpdate) {
    const { enemy, runTime, age } = context;
    if (runTime >= CODA_TIME) {
      // Unbroken, it seals itself away: containment shells snap shut and the
      // machine goes quiet with the music.
      enemy.mesh.userData.sealed = true;
      return true;
    }
    const flinching = coreFlinchUntil > runTime;
    enemy.mesh.position.copy(CUBE_CENTER);
    if (flinching) {
      enemy.mesh.position.x += Math.sin(runTime * 31) * 0.5;
      enemy.mesh.position.y += Math.sin(runTime * 26 + 2) * 0.4;
    } else {
      enemy.mesh.position.y += Math.sin(runTime * 1.3) * 0.5;
    }

    if (!coreExposed && age > 0.9) {
      coreExposed = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
    if (coreExposed && !flinching) CORE_ENTRY.lockable = true;

    enemy.mesh.userData.flinching = flinching;
    enemy.mesh.userData.stageIndex = enemy.hitStageIndex;
    enemy.mesh.userData.chargeLevel = 1 - context.enemy.hitPointsRemaining / 14;

    // The spun-up core spits paired bolts — the finale never goes passive.
    const state = context.enemyState(() => ({ nextSalvoAt: runTime + 2.2 }));
    if (runTime >= state.nextSalvoAt && runTime < CODA_TIME - 3) {
      state.nextSalvoAt = runTime + 3.4 - enemy.hitStageIndex * 0.5;
      const side = Math.sin(runTime * 17.3) > 0 ? 1 : -1;
      const frame = FACE_FRAMES[(enemy.hitStageIndex * 2 + (side > 0 ? 0 : 1)) % 6];
      for (const s of [side, -side]) {
        const from = enemy.mesh.position.clone()
          .addScaledVector(frame.right, s * 6)
          .addScaledVector(frame.up, 3 * s);
        fireBolt(context, from, (enemy.hitStageIndex * 2 + (s > 0 ? 0 : 3)) % 6);
      }
    }
    return false;
  }

  // ---- level definition ---------------------------------------------------------

  return {
    duration: SPEEDSOLVE_DURATION,
    bpm: SPEEDSOLVE_BPM,
    playerHealth: SPEEDSOLVE_PLAYER_HEALTH,
    createRail: createSpeedsolveRail,
    spawnTimeline: timeline,
    easeRunProgress: speedsolveRunProgress,
    startWord: 'SOLVE!',
    replayWord: 'REPLAY',
    // A half-bar cap on the volley grid ramp keeps six-lock releases tight and
    // mechanical — clicks in a ratchet, not a drum fill.
    timing: { shotDelay: { maxGridSeconds: 0.9375 } },
    updateCameraEffects(context) {
      lastRunTime = context.runTime;
      updateSpeedsolveCamera(context);
    },
    updateAttractCamera({ camera, modeTime }) {
      const az = modeTime * 0.11 + 0.7;
      const el = 0.14 + Math.sin(modeTime * 0.21) * 0.1;
      const radius = 47;
      camera.position.set(
        Math.cos(el) * Math.sin(az) * radius,
        Math.sin(el) * radius,
        Math.cos(el) * Math.cos(az) * radius,
      );
      camera.lookAt(CUBE_CENTER.x, CUBE_CENTER.y + 1.5, CUBE_CENTER.z);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'panel':
          return updatePanel(context, data);
        case 'weakpoint':
          return updateWeakpoint(context, data);
        case 'tetra':
          return updateTetra(context, data);
        case 'prism':
          return updatePrism(context, data);
        case 'octa':
          return updateOcta(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'core':
          return updateCore(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'panel') {
        const data = enemy.entry.data as Extract<SpeedsolveSpawnData, { role: 'panel' }>;
        panelKillsByFace[data.face] += 1;
        if (panelKillsByFace[data.face] === 4) facesSolved += 1;
      }
      if (enemy.kind === 'weakpoint') weakpointsBroken += 1;
      if (enemy.kind === 'bolt') boltsShot += 1;
      if (enemy.kind === 'core') {
        coreKilled = true;
        coreKilledAt = lastRunTime;
        bus.emit('bossphase', { phase: 'destroyed' });
      }
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (octa casings, weakpoint housing, core stages) pays a little.
    scoreForHit: (_volleySize, enemy) => (enemy.kind === 'core' ? 60 : 40),
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (coreKilled && facesSolved === 6 && score >= 13200 && clearRate >= 0.9) return 'S';
      if (coreKilled && score >= 10200 && clearRate >= 0.65) return 'A';
      if (score >= 6200 && clearRate >= 0.4) return 'B';
      if (score >= 2600 && clearRate >= 0.18) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [`Faces solved ${facesSolved}/6`];
      if (weakpointsBroken > 0) lines.push(`${weakpointsBroken} weakpoint${weakpointsBroken === 1 ? '' : 's'} destroyed`);
      lines.push(coreKilled
        ? `Core burst at ${coreKilledAt.toFixed(1)}s — confetti everywhere`
        : 'The core sealed itself away');
      if (boltsShot > 0) lines.push(`${boltsShot} bolt${boltsShot === 1 ? '' : 's'} shot down`);
      const hull = Math.max(0, SPEEDSOLVE_PLAYER_HEALTH - hitsTaken);
      lines.push(`Hull ${hull}/${SPEEDSOLVE_PLAYER_HEALTH}`);
      return lines;
    },
  };
}
