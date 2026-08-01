import { CatmullRomCurve3, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { createEventBus } from '../../events';
import { createVespersBoss, type VespersBoss } from './boss';
import {
  VESPERS_BPM,
  VESPERS_MARKERS,
  VESPERS_RUN_DURATION,
  VESPERS_TIME,
} from './timing';

// VESPERS — a 60-second flight down the nave of a cathedral at night, while
// something is eating the light out of it. Enemies are flat black shapes with
// a stolen pane's colour burning in their chest; killing a pane sends the
// light back to the window it stripped, and every window you win back stays
// lit for the rest of the run. The nave goes quiet past the middle, and the
// finale breaks against the Devourer nested in the dead rose window at the
// west end. The player has a 3-point hull; wisps are dark homing motes that
// must be shot down before they land.

export { VESPERS_BPM, VESPERS_RUN_DURATION } from './timing';
export { VESPERS_BARS, VESPERS_MARKERS, VESPERS_TIME } from './timing';
export const VESPERS_PLAYER_HEALTH = 3;
export const WINDOW_COUNT = 30;

export type VespersEnemyKind =
  | 'pane'
  | 'censer'
  | 'choir'
  | 'herald'
  | 'wisp'
  | 'thorn'
  | 'core';

export type VespersMovementPattern = 'pane' | 'censer' | 'choir';

export type VespersSpawnData =
  | {
    role: 'pane';
    lead: number;
    offset: Vector3;
    descend: boolean;
    sway: number;
    engagement: { leadSeconds: number };
  }
  | {
    role: 'censer';
    lead: number;
    pivot: Vector3;
    amp: number;
    phase: number;
    engagement: { leadSeconds: number };
  }
  | {
    role: 'choir';
    lead: number;
    rx: number;
    ry: number;
    centerY: number;
    phase: number;
    speed: number;
    engagement: { leadSeconds: number };
  }
  | {
    role: 'herald';
    lead: number;
    offset: Vector3;
    seed: number;
    fireForever?: boolean;
    engagement: { leadSeconds: number };
  }
  | { role: 'wisp'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'thorn'; index: number }
  | { role: 'core' };

export type VespersSpawnEntry = LockOnSpawnEntry<VespersEnemyKind, VespersSpawnData>;
export type VespersUpdate = LockOnEnemyUpdate<VespersEnemyKind, VespersSpawnData>;

// ---- rail -------------------------------------------------------------------

// The nave: a long, mostly straight hall with a gentle sway, gliding at eye
// level toward the west end. The rail ends 27 units short of the west wall so
// the rose window keeps its scale and the camera never clips the wall.
export function createVespersRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 2, 0),
      new Vector3(5, 2.4, -35),
      new Vector3(-4, 1.8, -75),
      new Vector3(6.5, 2.2, -115),
      new Vector3(-6, 2, -158),
      new Vector3(5.5, 1.9, -198),
      new Vector3(-4, 2.2, -233),
      new Vector3(0, 2, -264),
    ],
    false,
    'catmullrom',
    0.5,
  );
}

// The rose window's world anchor: offsetFromRail at u=1, 27 units up the
// tangent, 8 units up. The Devourer nests here; the environment draws the
// window around the same point.
export function roseAnchor() {
  return offsetFromRail(createVespersRail(), 1, new Vector3(0, 8, 27));
}
export const ROSE_RADIUS = 16;
export const WEST_WALL_Z = -291;

// ---- speed profile → rail easing -------------------------------------------

// A stately glide: eases in, holds a moderate cruise through the nave, glides
// through the quiet, and eases toward the rose in the finale so the window
// keeps growing in the frame as the run ends.
const SPEED_KEYS: Array<[number, number]> = [
  [0, 0.55],
  [VESPERS_TIME.bar(5), 0.92],
  [VESPERS_TIME.bar(10), 1.06],
  [VESPERS_TIME.bar(12), 1.0],
  [VESPERS_TIME.bar(15), 1.1],
  [VESPERS_TIME.bar(16.5), 0.95],
  [VESPERS_TIME.bar(19), 0.7],
  [VESPERS_RUN_DURATION, 0.52],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, VESPERS_RUN_DURATION);

export const vespersSpeedAt = speedProfile.speedAt;

export function vespersRunProgress(time: number, duration = VESPERS_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- spawn timeline ---------------------------------------------------------

const time = VESPERS_TIME;
// The engagement contract is the intended on-screen (lockable) window, which
// for wide-sweep targets is shorter than the rail anchor lead: a pane at
// x=±5 leaves the frustum as the camera closes on it, which is exactly the
// wide sweep this level asks for. The anchor lead still controls the pass.
const engagement = (windowSeconds: number) => ({ leadSeconds: windowSeconds });

const panes = (
  at: number,
  lead: number,
  offsets: Array<[number, number]>,
  options: { descend?: boolean } = {},
): VespersSpawnEntry[] =>
  formation(at, 0.16, offsets, (offset, index) => ({
    kind: 'pane',
    data: {
      role: 'pane',
      lead,
      offset: new Vector3(offset[0], offset[1], 0),
      descend: options.descend ?? false,
      sway: index * 1.9 + at * 0.7,
      engagement: engagement(options.descend ? 1.5 : 2.3),
    },
  }));

const censers = (
  at: number,
  lead: number,
  pivots: Array<[number, number]>,
): VespersSpawnEntry[] =>
  formation(at, 0.18, pivots, (pivot, index) => ({
    kind: 'censer',
    data: {
      role: 'censer',
      lead,
      pivot: new Vector3(pivot[0], pivot[1], 0),
      amp: 1.8 + (index % 3) * 0.3,
      phase: index * 1.15,
      engagement: engagement(1.4),
    },
  }));

const choirs = (
  at: number,
  lead: number,
  runs: Array<{ rx: number; ry: number; centerY: number; phase: number; speed: number }>,
): VespersSpawnEntry[] =>
  formation(at, 0.22, runs.map((run) => [0, 0] as const), (_offset, index) => ({
    kind: 'choir',
    data: {
      role: 'choir',
      lead,
      rx: runs[index].rx,
      ry: runs[index].ry,
      centerY: runs[index].centerY,
      phase: runs[index].phase,
      speed: runs[index].speed,
      engagement: engagement(1.9),
    },
  }));

const heralds = (at: number, lead: number, offsets: Array<[number, number]>): VespersSpawnEntry[] =>
  formation(at, 0.28, offsets, (offset, index) => ({
    kind: 'herald',
    hitStages: [2, 1],
    data: {
      role: 'herald',
      lead,
      offset: new Vector3(offset[0], offset[1], 0),
      seed: index * 3.1 + at,
      engagement: engagement(2.4),
    },
  }));

function buildVespersTimeline(boss: VespersBoss): VespersSpawnEntry[] {
  return [
    // --- The Opening (bars 0–8): the cathedral wakes. Voices enter one at a
    // time; so do the panes.
    ...section(time.bar(1),
      panes(time.beats(0), 4.4, [[-5, 1], [-2, 3], [2, 3], [5, 1]]),
    ),
    ...section(time.bar(2.5),
      panes(time.beats(0), 4.3, [[-7, 3], [-3.5, 5], [3.5, 5], [7, 3]], { descend: true }),
    ),
    ...section(time.bar(4),
      censers(time.beats(0), 4.4, [[-6.5, 9], [-4.5, 8], [4.5, 8], [6.5, 9]]),
    ),
    ...section(time.bar(5),
      choirs(time.beats(0), 4.6, [
        { rx: 10, ry: 3, centerY: 1.6, phase: 0, speed: 0.55 },
        { rx: 10, ry: 2.6, centerY: 5, phase: 2.6, speed: -0.48 },
      ]),
    ),
    ...section(time.bar(6),
      panes(time.beats(0), 4.2, [[-8, -1], [-5.5, 4.6], [5.5, 4.6], [8, -1]]),
    ),
    ...section(time.bar(7),
      censers(time.beats(0), 4.3, [[-7, 8], [7, 8]]),
      panes(time.beats(1.5), 4.3, [[-5.5, 5.8], [-5.5, 0.4], [5.5, 0.4], [5.5, 5.8]]),
    ),
    ...section(time.bar(7.75),
      heralds(time.beats(0), 4.8, [[-3.5, 4.6]]),
    ),

    // --- Swell 1 (bars 8–10): the densest counterpoint so far.
    ...section(time.bar(8.5),
      panes(time.beats(0), 4.2, [[-6, 6], [-3, 7.4], [3, 7.4], [6, 6]], { descend: true }),
      choirs(time.beats(0.5), 4.4, [
        { rx: 11, ry: 2.8, centerY: 0.6, phase: 1.2, speed: 0.62 },
        { rx: 11, ry: 2.4, centerY: 4.6, phase: 4.2, speed: -0.55 },
      ]),
      censers(time.beats(1), 4.4, [[-6.5, 9], [6.5, 9]]),
    ),
    ...section(time.bar(9.5),
      heralds(time.beats(0), 4.6, [[-6, 1.8], [6, 1.8]]),
    ),

    // --- The Settle (bars 10–12): the voices hold, the nave builds.
    ...section(time.bar(10.5),
      panes(time.beats(0), 4.2, [[-7, 1], [-2, 3.6], [2, 3.6], [7, 1]]),
    ),
    ...section(time.bar(11.25),
      censers(time.beats(0), 4.2, [[-5, 7.5], [-4, 7.4], [4, 7.4], [5, 7.5]]),
    ),

    // --- The Quiet (bars 12–15): a long dark empty span. One voice, almost
    // nothing on screen — a couple of slow distant panes high in the dark.
    ...section(time.bar(12),
      panes(time.beats(0.5), 6.2, [[-2, 7.2]], { descend: true }),
    ),
    ...section(time.bar(13.75),
      panes(time.beats(0), 6.0, [[5, 6.4]], { descend: true }),
    ),

    // --- The Rebuild (bars 15–16): the voices return.
    ...section(time.bar(14.5),
      panes(time.beats(0), 4.0, [[-6.5, 3.2], [0, 5.6], [6.5, 3.2]]),
    ),
    ...section(time.bar(15.25),
      choirs(time.beats(0), 4.0, [
        { rx: 9.5, ry: 2.6, centerY: 2.2, phase: 0.7, speed: 0.6 },
      ]),
      censers(time.beats(0.6), 3.6, [[-4, 7]]),
      panes(time.beats(1.2), 3.6, [[-3.5, 4.5]]),
    ),

    // --- The Finale (bar 16+): the Devourer in the dead rose window.
    ...boss.entries(VESPERS_MARKERS.bossEntrance),
  ];
}

const traceBoss = createVespersBoss(createEventBus(), () => {});
export const VESPERS_TIMELINE: VespersSpawnEntry[] = sortTimeline(buildVespersTimeline(traceBoss));

const KILL_SCORE: Record<VespersEnemyKind, number> = {
  pane: 100,
  censer: 120,
  choir: 150,
  herald: 240,
  wisp: 40,
  thorn: 220,
  core: 2000,
};

const WISP_MAX_AGE = 14;

export function createVespersGameplay(bus: EventBus): LockOnRunnerLevel<VespersEnemyKind, VespersSpawnData> {
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let windowsRelit = 0;

  function fireWisp(context: VespersUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.4);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'wisp',
      countsTowardTotal: false,
      data: { role: 'wisp', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const boss = createVespersBoss(bus, fireWisp);
  const timeline = sortTimeline(buildVespersTimeline(boss));

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    windowsRelit = 0;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (windowsRelit < WINDOW_COUNT) windowsRelit += 1;
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  // ---- movement -------------------------------------------------------------

  function updatePane(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'pane' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    if (data.descend) {
      // It came off the glass: drift down from the arcade tier into the nave.
      const eased = smoothstepClamp(Math.min(1, age / 1.6));
      offset.y += (1 - eased) * 3.4;
    }
    offset.x += Math.sin(age * 0.8 + data.sway) * 1.15;
    offset.y += Math.sin(age * 0.62 + data.sway * 2.1) * 0.5;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateY(Math.sin(age * 0.9 + data.sway) * 0.5);
    enemy.mesh.rotateZ(Math.sin(age * 0.72 + data.sway * 1.6) * 0.4);
    return runProgress > anchorU + 0.02;
  }

  function updateCenser(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'censer' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const swing = Math.sin(age * 1.55 + data.phase) * data.amp;
    const offset = data.pivot.clone();
    offset.x += swing;
    offset.y += Math.sin(age * 2.2 + data.phase) * 0.35 - 0.5;
    offset.z += Math.sin(age * 1.05 + data.phase) * 0.4;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(-(swing / data.amp) * 0.22);
    enemy.mesh.rotateX(Math.sin(age * 1.05 + data.phase) * 0.12);
    return runProgress > anchorU + 0.02;
  }

  function updateChoir(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'choir' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = age * data.speed + data.phase;
    const x = Math.cos(t) * data.rx;
    const y = Math.sin(t) * data.ry + data.centerY;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 1.4) * 0.5)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.85) * 0.3);
    enemy.mesh.rotateY(Math.cos(age * 0.6) * 0.2);
    return runProgress > anchorU + 0.02;
  }

  function updateHerald(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'herald' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.8 + data.seed) * 1.5;
    offset.y += Math.sin(age * 1.1 + data.seed * 2.1) * 0.85;

    // Telegraphed lunge: rear back, then push toward the camera as it looses
    // a stolen wisp of light.
    const fire = context.enemyState(() => ({ nextAt: 1.7 }));
    const untilShot = fire.nextAt - age;
    if (untilShot < 0.9 && untilShot > 0.55) offset.z += (0.9 - untilShot) * 6.5;
    else if (untilShot <= 0.55 && untilShot > 0) offset.z -= (0.55 - untilShot) * 11;
    if (age >= fire.nextAt) {
      fire.nextAt = age + (data.fireForever ? 1.9 : 3.6);
      fireWisp(context, enemy.mesh.position);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.4 + data.seed) * 0.16);
    return runProgress > anchorU + 0.02;
  }

  function updateWisp(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'wisp' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

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
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.2,
      maxSpeed: 9.8,
      accel: 2.6,
      turnRate: 2.0,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 2.8);

    return shotBehindCamera(camera, data.position) || age > WISP_MAX_AGE;
  }

  // ---- level definition ------------------------------------------------------

  return {
    duration: VESPERS_RUN_DURATION,
    bpm: VESPERS_BPM,
    playerHealth: VESPERS_PLAYER_HEALTH,
    createRail: createVespersRail,
    spawnTimeline: timeline,
    easeRunProgress: vespersRunProgress,
    startWord: 'ENTER',
    replayWord: 'RISE',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'pane':
          return updatePane(context, data);
        case 'censer':
          return updateCenser(context, data);
        case 'choir':
          return updateChoir(context, data);
        case 'herald':
          return updateHerald(context, data);
        case 'wisp':
          return updateWisp(context, data);
        case 'thorn':
        case 'core':
          return boss.update(context, data);
      }
    },
    validateRelease(enemies) {
      return boss.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping the Devourer's core (non-lethal stage hits) pays a little.
    scoreForHit: () => 50,
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (boss.destroyed() && score >= 8400 && clearRate >= 0.84) return 'S';
      if (score >= 6200 && clearRate >= 0.66) return 'A';
      if (score >= 3900 && clearRate >= 0.45) return 'B';
      if (score >= 1700 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, VESPERS_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${VESPERS_PLAYER_HEALTH}`];
      lines.push(`Windows relit ${Math.min(WINDOW_COUNT, windowsRelit)}/${WINDOW_COUNT}`);
      const bossLine = boss.summary();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}

function smoothstepClamp(t: number): number {
  return t * t * (3 - 2 * t);
}
