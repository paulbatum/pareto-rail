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
import type { EventBus } from '../../events';
import {
  HULL_RUN_CVS3_BARS,
  HULL_RUN_CVS3_BPM,
  HULL_RUN_CVS3_RUN_DURATION,
  HULL_RUN_CVS3_TIME,
} from './timing';

export { HULL_RUN_CVS3_BPM, HULL_RUN_CVS3_RUN_DURATION, HULL_RUN_CVS3_TIME } from './timing';

export type HullRunCvs3EnemyKind = 'watcher' | 'skater' | 'sentry' | 'shell' | 'turret';

type DeckData = { role: 'deck'; lead: number; x: number; y: number; pattern: 'rise' | 'cross' | 'brace'; phase: number };
type ShellData = { role: 'shell'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState };
type TurretData = { role: 'turret'; lead: number };
export type HullRunCvs3SpawnData = DeckData | ShellData | TurretData;
export type HullRunSpawn = LockOnSpawnEntry<HullRunCvs3EnemyKind, HullRunCvs3SpawnData>;
type HullRunUpdate = LockOnEnemyUpdate<HullRunCvs3EnemyKind, HullRunCvs3SpawnData>;

const bar = (value: number, beat = 0) => HULL_RUN_CVS3_TIME.bar(value, beat);

export function hullRunProgress(time: number, duration = HULL_RUN_CVS3_RUN_DURATION) {
  const x = MathUtils.clamp(time / duration, 0, 1);
  // A brisk mid-deck push, a deliberate boss hold, then a launch off the bow.
  const keys: Array<[number, number]> = [[0, 0], [0.18, 0.15], [0.55, 0.57], [0.72, 0.76], [0.92, 0.91], [1, 1]];
  for (let i = 1; i < keys.length; i += 1) {
    if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1];
      const [x1, y1] = keys[i];
      const t = MathUtils.smoothstep(x, x0, x1);
      return MathUtils.lerp(y0, y1, t);
    }
  }
  return 1;
}

export function createHullRunCvs3Rail() {
  return new CatmullRomCurve3([
    new Vector3(0, 8.2, 20), new Vector3(1, 8, -110), new Vector3(-5, 8.5, -240),
    new Vector3(6, 12.5, -370), new Vector3(0, 8.3, -500), new Vector3(-8, 8.8, -650),
    new Vector3(7, 13.8, -790), new Vector3(0, 8.1, -930), new Vector3(-5, 9.2, -1070),
    new Vector3(6, 12.2, -1210), new Vector3(0, 8.6, -1350), new Vector3(0, 9.5, -1510),
    new Vector3(0, 10.5, -1660), new Vector3(0, 16, -1780), new Vector3(0, 35, -1900),
  ], false, 'catmullrom', 0.42);
}

const deckWave = (time: number, kind: 'watcher' | 'skater' | 'sentry', pattern: DeckData['pattern'], points: Array<[number, number]>, lead = 4.7): HullRunSpawn[] =>
  points.map(([x, y], index) => ({
    time: time + index * 0.11,
    kind,
    ...(kind === 'sentry' ? { hitStages: [2, 2] } : {}),
    data: { role: 'deck', lead: lead * 0.74, x: x * 1.55, y, pattern, phase: index * 1.73 + time },
  }));

const TURRET_ENTRY: HullRunSpawn = {
  time: bar(HULL_RUN_CVS3_BARS.boss), kind: 'turret', hitStages: [1, 1, 1], lockable: false,
  data: { role: 'turret', lead: 14 },
};

export const HULL_RUN_CVS3_SPAWN_TIMELINE: HullRunSpawn[] = [
  ...deckWave(bar(2), 'watcher', 'rise', [[-6, 0], [-2, 2], [2, 2], [6, 0]]),
  ...deckWave(bar(4), 'watcher', 'rise', [[-9, -1], [-5, 2], [0, 4], [5, 2], [9, -1]]),
  ...deckWave(bar(6), 'skater', 'cross', [[-13, 1], [-8, 3], [8, 3], [13, 1]], 4.4),
  ...deckWave(bar(8), 'watcher', 'rise', [[-10, 3], [-6, 0], [-2, 4], [2, 4], [6, 0], [10, 3]]),
  ...deckWave(bar(10), 'skater', 'cross', [[-14, 0], [-9, 4], [9, 4], [14, 0]], 4.3),
  ...deckWave(bar(12), 'sentry', 'brace', [[-8, 1], [8, 1]], 5.3),
  ...deckWave(bar(13), 'watcher', 'rise', [[-4, 4], [0, 1], [4, 4]], 4.5),
  ...deckWave(bar(15), 'skater', 'cross', [[-15, 1], [-10, 5], [10, 5], [15, 1], [0, 3]], 4.2),
  ...deckWave(bar(17), 'sentry', 'brace', [[-10, 0], [0, 5], [10, 0]], 5.1),
  ...deckWave(bar(18.5), 'watcher', 'rise', [[-11, 4], [-7, 1], [-3, 5], [3, 5], [7, 1], [11, 4]], 4.4),
  ...deckWave(bar(20), 'skater', 'cross', [[-16, 1], [-11, 4], [-5, 2], [5, 2], [11, 4], [16, 1]], 4.1),
  ...deckWave(bar(22), 'sentry', 'brace', [[-11, 1], [-4, 5], [4, 5], [11, 1]], 5),
  ...deckWave(bar(24), 'watcher', 'rise', [[-12, 0], [-8, 4], [-4, 1], [0, 5], [4, 1], [8, 4], [12, 0]], 4.2),
  TURRET_ENTRY,
].sort((a, b) => a.time - b.time);

const SCORE: Record<HullRunCvs3EnemyKind, number> = { watcher: 100, skater: 140, sentry: 260, shell: 50, turret: 2400 };

export function createHullRunCvs3Gameplay(bus: EventBus): LockOnRunnerLevel<HullRunCvs3EnemyKind, HullRunCvs3SpawnData> {
  const intercepted = new Set<number>();
  let hitsTaken = 0;
  let shellsDown = 0;
  bus.on('runstart', () => { intercepted.clear(); hitsTaken = 0; shellsDown = 0; TURRET_ENTRY.lockable = false; });
  bus.on('fire', ({ enemyId }) => intercepted.add(enemyId));
  bus.on('kill', ({ enemyId }) => intercepted.delete(enemyId));
  bus.on('miss', ({ enemyId }) => intercepted.delete(enemyId));
  bus.on('playerhit', () => { hitsTaken += 1; });

  function launchShell(context: HullRunUpdate, x: number) {
    const from = context.enemy.mesh.position.clone().add(new Vector3(x, 1.5, 2));
    context.spawnEnemy({
      time: context.runTime, kind: 'shell', countsTowardTotal: false,
      data: { role: 'shell', position: from, velocity: hostileShotAimPoint(context.camera, from, 2).sub(from).normalize().multiplyScalar(7), lastAge: 0, impact: {} },
    });
  }

  function updateDeck(context: HullRunUpdate, data: DeckData) {
    const anchor = context.railAnchor(data.lead);
    const hatch = MathUtils.smoothstep(context.age, 0, 0.7);
    let x = data.x;
    let y = data.y * 1.55 + hatch * 4.6 - 5.6;
    if (data.pattern === 'cross') {
      const direction = Math.sign(data.x) || 1;
      x = data.x - direction * Math.min(18, context.age * 7.5);
      y += Math.sin(context.age * Math.PI * 0.75) * 3.4;
    } else if (data.pattern === 'rise') {
      x += Math.sin(context.age * 1.8 + data.phase) * 1.3;
      y += Math.sin(context.age * 2.2 + data.phase) * 0.55;
    } else {
      y += 0.5 + Math.sin(context.age * 0.8 + data.phase) * 0.25;
      const fire = context.enemyState(() => ({ next: 2.1 + (context.enemy.id % 3) * 0.35 }));
      if (context.age >= fire.next) { fire.next += 3.2; launchShell(context, 0); }
    }
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(x, y, 0)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(data.pattern === 'cross' ? -Math.sign(data.x) * 0.35 : Math.sin(context.age + data.phase) * 0.15);
    return context.runProgress > anchor + 0.016 || context.age > 7.4;
  }

  function updateShell(context: HullRunUpdate, data: ShellData) {
    const dt = Math.max(0, context.age - data.lastAge); data.lastAge = context.age;
    const impact = updateHostileShotImpact({ age: context.age, camera: context.camera, position: data.position, velocity: data.velocity, state: data.impact, intercepted: intercepted.delete(context.enemy.id) });
    if (impact.phase === 'braking') {
      context.enemy.mesh.position.copy(data.position);
      if (impact.damaged) { context.damagePlayer(1); return true; }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(context.camera, data.position, 2.2), context.age, dt, { baseSpeed: 7, maxSpeed: 17, accel: 5, turnRate: 1.5 });
    context.enemy.mesh.position.copy(data.position);
    context.enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return context.age > 9 || shotBehindCamera(context.camera, data.position);
  }

  function updateTurret(context: HullRunUpdate, data: TurretData) {
    const anchor = context.railAnchor(data.lead);
    const rise = MathUtils.smoothstep(context.age, 0.2, 2.4);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(0, rise * 14 - 4, 0)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    const cycle = Math.max(0, context.age - 2.4) % 4.8;
    const venting = cycle >= 1.1 && cycle <= 4.7;
    context.enemy.entry.lockable = venting;
    context.enemy.mesh.userData.venting = venting;
    context.enemy.mesh.userData.cycle = cycle;
    const state = context.enemyState(() => ({ volley: -1 }));
    const volley = Math.floor(Math.max(0, context.age - 2.4) / 4.8);
    if (cycle < 0.16 && volley !== state.volley) {
      state.volley = volley;
      launchShell(context, -14); launchShell(context, 14);
      bus.emit('bossphase', { phase: 'summoned' });
    }
    if (venting && cycle < 1.25) bus.emit('bossphase', { phase: 'exposed' });
    return false;
  }

  return {
    duration: HULL_RUN_CVS3_RUN_DURATION,
    bpm: HULL_RUN_CVS3_BPM,
    playerHealth: 4,
    createRail: createHullRunCvs3Rail,
    spawnTimeline: HULL_RUN_CVS3_SPAWN_TIMELINE,
    easeRunProgress: hullRunProgress,
    lockRadiusNdc: 0.2,
    startWord: 'LAUNCH',
    replayWord: 'REARM',
    timing: { shotDelay: { maxGridSeconds: 0.15 }, actionSfx: { gridThirtyseconds: 2 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'deck') return updateDeck(context, data);
      if (data.role === 'shell') return updateShell(context, data);
      return updateTurret(context, data);
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'shell') shellsDown += 1;
      return Math.round(SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.2));
    },
    scoreForHit: () => 55,
    scoreForVolley: (results) => results.length === 6 ? 400 : 0,
    rankForRun(score, kills, total) {
      const ratio = total ? kills / total : 0;
      if (ratio >= 0.94 && hitsTaken === 0 && score >= 9000) return 'ADMIRAL';
      if (ratio >= 0.78) return 'CAPTAIN';
      if (ratio >= 0.58) return 'GUNNER';
      return 'DECKHAND';
    },
    detailsForRun: () => [`HULL ${Math.max(0, 4 - hitsTaken)}/4`, `SHELLS INTERCEPTED ${shellsDown}`],
  };
}
