import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { sortTimeline } from '../../engine/spawn-patterns';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { createEater, createEaterEntries, type EaterSpawnData } from './eater';
import { BOSS_TIME, VESPERS_BPM, VESPERS_RUN_DURATION, VESPERS_TIME, bar } from './timing';

// VESPERS — sixty seconds down the nave of a cathedral at night while
// something eats the light out of it. Every enemy is a stolen pane of glass;
// every kill sends that light back to the window it came from, and the
// deeper you fly the more of the building is burning colour you put there.
//
//   bars 0–2    pedal alone; the first shades peel off the clerestory
//   bars 2–8    voices enter one at a time; shades, moths, censers
//   bars 8–10   the swell: choir, bells, the densest wave
//   bars 10–12  the quiet: one voice, one lone shade, an empty nave
//   bars 12–18  the rose window: petals, then the eye, then the light returns

export { VESPERS_BPM, VESPERS_RUN_DURATION } from './timing';
export const VESPERS_PLAYER_HEALTH = 3;

export type VespersEnemyKind = 'shade' | 'moth' | 'censer' | 'cinder' | 'petal' | 'eye' | 'shard';
export type VespersTargetKind = VespersEnemyKind | 'letter';
export type Pane = 'cobalt' | 'blood' | 'bottle' | 'gold' | 'violet';

// Timeline entries are immutable and reused across runs; per-enemy runtime
// state lives in the runner's enemyState bags, and dynamically spawned
// hostile shots get fresh data objects each launch.
export type ShadeData = {
  role: 'shade';
  lead: number;
  pane: Pane;
  offset: Vector3;
  from: Vector3;
  seed: number;
  debugHold?: boolean;
};
export type MothData = {
  role: 'moth';
  lead: number;
  pane: Pane;
  fromX: number;
  toX: number;
  y: number;
  arc: number;
  crossTime: number;
  delay: number;
};
export type CenserData = {
  role: 'censer';
  lead: number;
  x: number;
  pivotY: number;
  length: number;
  period: number;
  phase: number;
  shots: number;
};
export type HostileShotData = {
  // Named 'bolt' so the engine gives incoming shots lock priority.
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impact: HostileShotImpactState;
};

export type VespersSpawnData = ShadeData | MothData | CenserData | HostileShotData | EaterSpawnData;
export type VespersSpawnEntry = LockOnSpawnEntry<VespersEnemyKind, VespersSpawnData>;
export type VespersUpdate = LockOnEnemyUpdate<VespersEnemyKind, VespersSpawnData>;

// ---- the nave --------------------------------------------------------------

export const NAVE_HALF_WIDTH = 15;
export const NAVE_FLOOR_Y = -14;
export const RAIL_END_Z = -420;
// The west wall stands twenty metres past the end of the rail: the run ends
// hovering in front of the rose window.
export const WEST_WALL_Z = RAIL_END_Z - 20;
export const ROSE_CENTER = new Vector3(0, 11.5, WEST_WALL_Z + 1.4);
export const ROSE_RADIUS = 11;

export function createVespersRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 6, 0),
      new Vector3(2, 6.5, -40),
      new Vector3(-2.5, 5.5, -85),
      new Vector3(2.5, 7.5, -130),
      new Vector3(-1.5, 5, -175),
      new Vector3(2.5, 7, -220),
      new Vector3(-2.5, 6, -265),
      new Vector3(1.5, 8, -310),
      new Vector3(-1.5, 6.5, -350),
      new Vector3(0, 7, -385),
      new Vector3(0, 7, RAIL_END_Z),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// ---- speed -------------------------------------------------------------------

// Cruise down the nave, push through the swell, rush the dark empty span,
// then slow almost to a hover in front of the rose window so the boss holds
// the screen and the run arrives rather than stops.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.85],
  [bar(1), 1.0],
  [bar(8), 1.0],
  [bar(8, 2), 1.15],
  [bar(10), 1.28],
  [bar(11, 2), 1.2],
  [bar(12), 0.5],
  [bar(13), 0.3],
  [bar(17), 0.24],
  [bar(18), 0.16],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, VESPERS_RUN_DURATION);
export const speedFactorAt = speedProfile.speedAt;
export function vespersRunProgress(time: number, duration = VESPERS_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- spawn timeline -------------------------------------------------------------

const FORMATION_GAP = 0.16;

// The wall a shade peels off: it starts at clerestory height on the side it
// will hover on, and drifts in.
function wallOrigin(x: number, y: number) {
  return new Vector3(x >= 0 ? 12.5 : -12.5, 8.5 + y * 0.2, 4);
}

const shades = (time: number, lead: number, panes: Pane[], offsets: Array<[number, number]>): VespersSpawnEntry[] =>
  offsets.map(([x, y], index) => ({
    time: time + index * FORMATION_GAP,
    kind: 'shade',
    data: {
      role: 'shade',
      lead,
      pane: panes[index % panes.length],
      offset: new Vector3(x, y, 0),
      from: wallOrigin(x, y),
      seed: index * 1.71 + time * 0.37,
    },
  }));

const moths = (
  time: number,
  lead: number,
  panes: Pane[],
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): VespersSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.1,
    kind: 'moth',
    data: {
      role: 'moth',
      lead,
      pane: panes[index % panes.length],
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.38,
      crossTime: run.crossTime ?? 2.5,
    },
  }));

const censers = (time: number, lead: number, swings: Array<{ x: number; phase?: number; shots?: number }>): VespersSpawnEntry[] =>
  swings.map((swing, index) => ({
    time: time + index * 0.25,
    kind: 'censer',
    hitPoints: 2,
    data: {
      role: 'censer',
      lead,
      x: swing.x,
      pivotY: 10.5,
      length: 7.5,
      period: 3.333,
      phase: swing.phase ?? index * 1.6,
      shots: swing.shots ?? 2,
    },
  }));

function buildVespersTimeline(eaterEntries: VespersSpawnEntry[]): VespersSpawnEntry[] {
  return [
    // --- bars 0–2: pedal alone. Three cobalt shades peel off the glass, then
    // two low and wide; the player learns the sweep against one held note.
    ...shades(bar(0, 1.5), 4.2, ['cobalt'], [[-7, 3], [0, 7.5], [7, 3]]),
    ...shades(bar(1, 1.5), 4.0, ['cobalt', 'blood'], [[-10, -3.5], [10, -3.5]]),

    // --- bars 2–4: the tenor enters. A wide arch, then moths crossing.
    ...shades(bar(2, 0.5), 4.0, ['cobalt', 'blood', 'cobalt', 'blood'], [[-10.5, 0.5], [-4.5, 7], [4.5, 7], [10.5, 0.5]]),
    ...moths(bar(3, 1), 3.8, ['bottle', 'bottle', 'gold'], [
      { fromX: -11.5, toX: 11.5, y: 1.5, arc: 4.5 },
      { fromX: -11.5, toX: 11.5, y: 6.5, arc: 2 },
      { fromX: 11.5, toX: -11.5, y: -3.5, arc: 5 },
    ]),

    // --- bars 4–6: the alto. Five across the whole frame, then the first
    // censer swinging under the vault with two moths under it.
    ...shades(bar(4, 0.5), 4.0, ['blood', 'gold', 'cobalt', 'gold', 'blood'], [[-10.5, -4.5], [-6, 4], [0, 8.5], [6, 4], [10.5, -4.5]]),
    ...censers(bar(5, 1), 4.6, [{ x: 0 }]),
    ...moths(bar(5, 2.5), 3.8, ['bottle', 'violet'], [
      { fromX: 11.5, toX: -11.5, y: -2.5, arc: 4 },
      { fromX: -11.5, toX: 11.5, y: 4.5, arc: 3.5 },
    ]),

    // --- bars 6–8: the soprano. A double row, twin censers, and a crossing
    // of moths in both directions.
    ...shades(bar(6, 0.5), 4.0, ['cobalt', 'bottle', 'blood', 'cobalt', 'bottle', 'blood'], [
      [-9.5, 6.5], [-3.5, 8.5], [3.5, 8.5], [9.5, 6.5], [-6.5, -4.5], [6.5, -4.5],
    ]),
    ...censers(bar(7, 0.5), 4.4, [{ x: -8.5, phase: 0 }, { x: 8.5, phase: Math.PI }]),
    ...moths(bar(7, 2), 3.8, ['gold', 'bottle', 'violet', 'gold'], [
      { fromX: -11.5, toX: 11.5, y: -1, arc: 4, delay: 0 },
      { fromX: 11.5, toX: -11.5, y: 7, arc: -3, delay: 0.3 },
      { fromX: -11.5, toX: 11.5, y: 3, arc: 2.5, delay: 0.6 },
      { fromX: 11.5, toX: -11.5, y: -4.5, arc: 4.5, delay: 0.9 },
    ]),

    // --- bars 8–10: the swell. Choir and bells: a rose of shades fills the
    // frame, then the last dense wave before the nave empties.
    ...shades(bar(8, 0.25), 3.9, ['gold', 'blood', 'cobalt', 'bottle', 'violet', 'gold'], [
      [-10.5, 1.5], [-5.5, 8], [5.5, 8], [10.5, 1.5], [-5.5, -5], [5.5, -5],
    ]),
    ...moths(bar(8, 3), 3.7, ['bottle', 'gold', 'cobalt'], [
      { fromX: -11.5, toX: 11.5, y: 0.5, arc: 3.5, crossTime: 2.1 },
      { fromX: 11.5, toX: -11.5, y: 5, arc: 3, crossTime: 2.1 },
      { fromX: -11.5, toX: 11.5, y: 8, arc: 1.5, crossTime: 2.1 },
    ]),
    ...shades(bar(9, 0.5), 3.7, ['blood', 'violet', 'gold', 'cobalt', 'blood'], [
      [-10.5, 5], [-5.5, -3.5], [0, 8.5], [5.5, -3.5], [10.5, 5],
    ]),
    ...censers(bar(9, 1.5), 4.0, [{ x: 0, phase: 0.8, shots: 1 }]),

    // --- bars 10–12: the quiet. One lone violet shade far down the nave,
    // the only thing in a dark empty span.
    ...shades(bar(10, 3), 4.6, ['violet'], [[0, 7]]),

    // --- bars 12–18: the rose window.
    ...eaterEntries,
  ];
}

export function createVespersTimeline() {
  const eater = createEaterEntries(BOSS_TIME);
  return {
    eyeEntry: eater.eyeEntry,
    timeline: sortTimeline(buildVespersTimeline(eater.timeline)),
  };
}

export const VESPERS_TIMELINE: VespersSpawnEntry[] = createVespersTimeline().timeline;

const KILL_SCORE: Record<VespersEnemyKind, number> = {
  shade: 100,
  moth: 130,
  censer: 260,
  cinder: 40,
  petal: 220,
  eye: 1800,
  shard: 40,
};

const HOSTILE_SHOT_MAX_AGE = 13;

export function createVespersGameplay(bus: EventBus): LockOnRunnerLevel<VespersEnemyKind, VespersSpawnData> {
  const { timeline, eyeEntry } = createVespersTimeline();
  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let glassWonBack = 0;
  let shotsDowned = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    glassWonBack = 0;
    shotsDowned = 0;
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

  function fireHostileShot(context: VespersUpdate, kind: 'cinder' | 'shard', from: Vector3, speed: number) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind,
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const eater = createEater(bus, {
    eyeEntry,
    fireShard: (context, from) => fireHostileShot(context, 'shard', from, 6),
  });

  // ---- motion ----------------------------------------------------------------

  function updateShade(context: VespersUpdate, data: ShadeData) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = data.debugHold ? MathUtils.clamp(runProgress + 0.014, 0, 1) : railAnchor(data.lead);
    // Peel off the wall and drift into formation, then hover like smoke over
    // a candle: a slow sway, a slower sink toward the player.
    const rise = smoothstep(Math.min(1, age / 1.15));
    const offset = data.from.clone().lerp(data.offset, rise);
    offset.x += Math.sin(age * 0.7 + data.seed) * 0.8;
    offset.y += Math.sin(age * 1.1 + data.seed * 1.3) * 0.5 + (1 - rise) * Math.sin(age * 6) * 0.3;
    offset.z -= age * 0.35;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.9 + data.seed) * 0.12);
    enemy.mesh.userData.pane = data.pane;
    enemy.mesh.userData.rise = rise;
    return !data.debugHold && runProgress > anchorU + 0.012;
  }

  function updateMoth(context: VespersUpdate, data: MothData) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 7 + enemy.id) * 0.25;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 2.3 + enemy.id) * 0.5)));
    // Flat silhouette faces the player; it banks into the direction it flies.
    const slope = Math.cos(clamped * Math.PI) * data.arc * Math.PI;
    const direction = Math.sign(data.toX - data.fromX) || 1;
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(MathUtils.clamp(Math.atan2(slope, Math.abs(data.toX - data.fromX)) * direction, -0.7, 0.7) - direction * 0.15);
    enemy.mesh.userData.pane = data.pane;
    enemy.mesh.userData.flap = age;
    return false;
  }

  function updateCenser(context: VespersUpdate, data: CenserData) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // A pendulum under the vault. The swing is one bar long, so the censer
    // passes its low point on every downbeat, and that is when it throws.
    const theta = 0.72 * Math.sin((age / data.period) * Math.PI * 2 + data.phase);
    const offset = new Vector3(
      data.x + Math.sin(theta) * data.length,
      data.pivotY - Math.cos(theta) * data.length,
      Math.sin(age * 0.6) * 0.4,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(theta);
    enemy.mesh.userData.swing = theta;

    const fire = context.enemyState(() => ({ lastTheta: theta, shotsLeft: data.shots, cooldownUntil: 1.2 }));
    const crossedLowPoint = Math.sign(fire.lastTheta) !== Math.sign(theta) && Math.abs(theta) < 0.2;
    fire.lastTheta = theta;
    if (crossedLowPoint && fire.shotsLeft > 0 && age >= fire.cooldownUntil) {
      fire.shotsLeft -= 1;
      fire.cooldownUntil = age + 2.6;
      enemy.mesh.userData.throwAt = age;
      fireHostileShot(context, 'cinder', enemy.mesh.position, 5);
    }
    return runProgress > anchorU + 0.012;
  }

  function updateHostileShot(context: VespersUpdate, data: HostileShotData, steer: { baseSpeed: number; maxSpeed: number; accel: number; turnRate: number }) {
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
      enemy.mesh.rotateZ(age * 7);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, steer);
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 4);
    return age > HOSTILE_SHOT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ------------------------------------------------------------

  return {
    duration: VESPERS_RUN_DURATION,
    bpm: VESPERS_BPM,
    playerHealth: VESPERS_PLAYER_HEALTH,
    createRail: createVespersRail,
    spawnTimeline: timeline,
    easeRunProgress: vespersRunProgress,
    // A slow chorale: let volley impacts land as far out as the half-bar so a
    // six-lock release fans across a whole phrase, and keep lock/fire ticks
    // on the 32nd grid so the organ answers immediately.
    timing: {
      shotDelay: { maxGridSeconds: VESPERS_TIME.barSeconds / 2 + 0.01 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'shade':
          return updateShade(context, data);
        case 'moth':
          return updateMoth(context, data);
        case 'censer':
          return updateCenser(context, data);
        case 'bolt':
          return context.enemy.kind === 'shard'
            ? updateHostileShot(context, data, { baseSpeed: 6, maxSpeed: 12, accel: 3, turnRate: 2.3 })
            : updateHostileShot(context, data, { baseSpeed: 5, maxSpeed: 10.5, accel: 2.8, turnRate: 2.1 });
        case 'petal':
          return eater.updatePetal(context, data);
        case 'eye':
          return eater.updateEye(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'cinder' || enemy.kind === 'shard') shotsDowned += 1;
      else if (enemy.kind !== 'eye') glassWonBack += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping a censer or the eye pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (eater.eyeKilled() && score >= 10500 && clearRate >= 0.85) return 'S';
      if (score >= 7500 && clearRate >= 0.62) return 'A';
      if (score >= 4500 && clearRate >= 0.42) return 'B';
      if (score >= 2000 && clearRate >= 0.24) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, VESPERS_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${VESPERS_PLAYER_HEALTH}`, `${glassWonBack} window${glassWonBack === 1 ? '' : 's'} relit`];
      if (shotsDowned > 0) lines.push(`${shotsDowned} ember${shotsDowned === 1 ? '' : 's'} put out`);
      const rose = eater.summaryLine();
      if (rose) lines.push(rose);
      return lines;
    },
  };
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
