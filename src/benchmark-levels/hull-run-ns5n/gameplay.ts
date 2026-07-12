import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import { hostileShotAimPoint, shotBehindCamera, steerHomingShot, updateHostileShotImpact, type HostileShotImpactState } from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { offsetFromRail } from '../../engine/rail';

export const HULL_RUN_NS5N_BPM = 144;
export const HULL_RUN_NS5N_TIME = createMusicTime(HULL_RUN_NS5N_BPM, { stepsPerBar: 16 });
export const HULL_RUN_NS5N_RUN_DURATION = HULL_RUN_NS5N_TIME.bar(38); // 63.33s, a complete 38-bar sortie.
export const HULL_RUN_NS5N_PLAYER_HEALTH = 4;

export const HULL_RUN_NS5N_MARKERS = {
  darkDeck: 0,
  firstWake: HULL_RUN_NS5N_TIME.bar(4),
  batteriesOnline: HULL_RUN_NS5N_TIME.bar(12),
  fullAlert: HULL_RUN_NS5N_TIME.bar(20),
  bowTurret: HULL_RUN_NS5N_TIME.bar(27),
  bowDrop: HULL_RUN_NS5N_TIME.bar(36),
};

export type HullRunNs5nEnemyKind = 'skimmer' | 'sentry' | 'interceptor' | 'mine' | 'shell' | 'turret';

export type HullRunNs5nSpawnData =
  | { role: 'skimmer'; lead: number; x: number; y: number; phase: number }
  | { role: 'sentry'; lead: number; x: number; y: number; phase: number }
  | { role: 'interceptor'; lead: number; fromX: number; toX: number; y: number; delay: number }
  | { role: 'mine'; lead: number; x: number; y: number; phase: number }
  | { role: 'shell'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'turret'; lead: number };

type Spawn = LockOnSpawnEntry<HullRunNs5nEnemyKind, HullRunNs5nSpawnData>;
type Update = LockOnEnemyUpdate<HullRunNs5nEnemyKind, HullRunNs5nSpawnData>;

export function createHullRunNs5nRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 4.2, 18), new Vector3(-1, 4.0, -72), new Vector3(2, 4.6, -164),
    new Vector3(-4, 5.2, -258), new Vector3(3, 4.1, -356), new Vector3(7, 6.8, -452),
    new Vector3(-3, 5.0, -552), new Vector3(-8, 4.0, -654), new Vector3(5, 7.2, -754),
    new Vector3(10, 4.4, -858), new Vector3(-4, 5.0, -968), new Vector3(0, 6.2, -1080),
    new Vector3(0, 5.2, -1188), new Vector3(0, 6.0, -1290),
    // Over the bow lip: the ship falls away while the camera flies straight into space.
    new Vector3(0, 8.5, -1382), new Vector3(0, 22, -1470), new Vector3(0, 38, -1560),
  ], false, 'catmullrom', 0.38);
}

const bar = (value: number) => HULL_RUN_NS5N_TIME.bar(value);

const fan = (time: number, kind: 'skimmer' | 'sentry' | 'mine', coords: Array<[number, number]>, lead = 4.5): Spawn[] =>
  coords.map(([x, y], i) => ({
    time: time + i * 0.11,
    kind,
    data: kind === 'skimmer'
      ? { role: 'skimmer', lead: lead * 0.7, x, y, phase: i * 1.71 + time }
      : kind === 'sentry'
        ? { role: 'sentry', lead: lead * 0.7, x, y, phase: i * 2.13 + time }
        : { role: 'mine', lead: lead * 0.7, x, y, phase: i * 1.37 + time },
  } as Spawn));

const cross = (time: number, count: number, leftToRight: boolean, y = 3, lead = 4.4): Spawn[] =>
  Array.from({ length: count }, (_, i) => ({
    time: time + i * 0.12,
    kind: 'interceptor' as const,
    data: {
      role: 'interceptor' as const,
      lead: lead * 0.7,
      fromX: leftToRight ? -18 : 18,
      toX: leftToRight ? 18 : -18,
      y: y + (i % 3) * 1.7,
      delay: i * 0.28,
    },
  }));

export const HULL_RUN_NS5N_SPAWN_TIMELINE: Spawn[] = [
  // Dark arrival: isolated hatch pairs teach the hull's left/right sweep.
  ...fan(bar(1.5), 'skimmer', [[-6, 0.8], [6, 0.8]], 4.8),
  ...fan(bar(3), 'skimmer', [[-8, 0.2], [-3, 2.4], [3, 2.4], [8, 0.2]], 4.7),
  ...cross(bar(4.5), 4, true, 1.0, 4.5),
  ...fan(bar(6), 'sentry', [[-7, 1], [0, 5], [7, 1]], 5.1),
  ...fan(bar(7.5), 'skimmer', [[-9, -0.2], [-5, 2], [0, 4.8], [5, 2], [9, -0.2]], 4.5),
  ...cross(bar(9), 5, false, 0.4, 4.4),
  ...fan(bar(10.5), 'mine', [[-8, 0], [-4, 4.6], [0, 1.8], [4, 4.6], [8, 0]], 4.7),

  // Secondary batteries wake. Alternating formations make six-lock phrases.
  ...fan(bar(12), 'sentry', [[-9, 1], [-4.5, 5], [4.5, 5], [9, 1]], 5.0),
  ...cross(bar(13), 6, true, -0.2, 4.2),
  ...fan(bar(14.5), 'skimmer', [[-10, 0], [-6, 3], [-2, 5.2], [2, 5.2], [6, 3], [10, 0]], 4.4),
  ...fan(bar(16), 'mine', [[-9, 4.5], [-5, 0], [0, 3], [5, 0], [9, 4.5]], 4.6),
  ...cross(bar(17.5), 6, false, 1, 4.1),
  ...fan(bar(19), 'sentry', [[-8, 0.6], [-2.8, 5.4], [2.8, 5.4], [8, 0.6]], 4.8),

  // Full alert: deck lights chase ahead and every hatch joins the cadence.
  ...fan(bar(20.5), 'skimmer', [[-11, 0], [-7, 3], [-3, 5], [3, 5], [7, 3], [11, 0]], 4.2),
  ...cross(bar(21.5), 6, true, 0, 4.0),
  ...fan(bar(22.5), 'mine', [[-10, 5], [-6, 1], [-2, 3.5], [2, 3.5], [6, 1], [10, 5]], 4.3),
  ...fan(bar(24), 'sentry', [[-9, 1], [-4.5, 4.8], [0, 6], [4.5, 4.8], [9, 1]], 4.6),
  ...cross(bar(25), 6, false, -0.4, 3.9),

  // Clear the sightline. The bow battery rises on bar 27.
  { time: bar(27), kind: 'turret', hitStages: [5, 5, 5], data: { role: 'turret', lead: 16 } } as Spawn,
  ...fan(bar(28), 'skimmer', [[-9, 0.5], [9, 0.5]], 3.8),
  ...cross(bar(30), 4, true, 0.2, 3.7),
  ...fan(bar(32), 'mine', [[-8, 4], [8, 4]], 3.7),
].sort((a, b) => a.time - b.time);

const KILL_SCORE: Record<HullRunNs5nEnemyKind, number> = {
  skimmer: 110, sentry: 190, interceptor: 150, mine: 130, shell: 45, turret: 2600,
};

export function createHullRunNs5nGameplay(bus: EventBus): LockOnRunnerLevel<HullRunNs5nEnemyKind, HullRunNs5nSpawnData> {
  const intercepted = new Set<number>();
  let hullHits = 0;
  let bossDestroyed = false;
  let bossId = -1;
  bus.on('runstart', () => { intercepted.clear(); hullHits = 0; bossDestroyed = false; bossId = -1; });
  bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'turret') bossId = enemyId; });
  bus.on('fire', ({ enemyId }) => intercepted.add(enemyId));
  bus.on('kill', ({ enemyId }) => {
    intercepted.delete(enemyId);
    if (enemyId === bossId) { bossDestroyed = true; bus.emit('bossphase', { phase: 'destroyed' }); }
  });
  bus.on('bossphase', ({ phase }) => { if (phase === 'destroyed') bossDestroyed = true; });
  bus.on('playerhit', () => { hullHits += 1; });

  const fireShell = (context: Update, from: Vector3) => {
    const velocity = hostileShotAimPoint(context.camera, from, 1.2).sub(from).normalize().multiplyScalar(7);
    context.spawnEnemy({ time: context.runTime, kind: 'shell', countsTowardTotal: false, data: { role: 'shell', position: from.clone(), velocity, lastAge: 0, impact: {} } });
  };

  const place = (context: Update, lead: number, offset: Vector3) => {
    const anchor = context.railAnchor(lead);
    if (context.enemy.kind !== 'turret') {
      offset.x *= 1.48;
      offset.y = offset.y * 2.2 - 1.5;
    }
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, offset));
    return anchor;
  };

  return {
    duration: HULL_RUN_NS5N_RUN_DURATION,
    bpm: HULL_RUN_NS5N_BPM,
    playerHealth: HULL_RUN_NS5N_PLAYER_HEALTH,
    lockRadiusNdc: 0.16,
    timing: { shotDelay: { maxGridSeconds: 0.18 }, actionSfx: { gridThirtyseconds: 1 } },
    createRail: createHullRunNs5nRail,
    spawnTimeline: HULL_RUN_NS5N_SPAWN_TIMELINE,
    startWord: 'LAUNCH',
    replayWord: 'REARM',
    updateEnemy(context) {
      const { enemy, age, runProgress, camera } = context;
      const data = enemy.entry.data;
      if (data.role === 'skimmer') {
        const rise = Math.min(1, age / 0.65);
        const offset = new Vector3(data.x + Math.sin(age * 1.7 + data.phase) * 1.5, data.y + rise * 2.8, Math.sin(age * 2.4) * 0.5);
        const anchor = place(context, data.lead, offset);
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateZ(Math.sin(age * 2.2 + data.phase) * 0.34);
        return runProgress > anchor + 0.016;
      }
      if (data.role === 'sentry') {
        const rise = Math.min(1, age / 0.9);
        const offset = new Vector3(data.x + Math.sin(age * 0.8 + data.phase) * 0.8, data.y + rise * 2.2 + Math.sin(age * 1.4) * 0.6, 0);
        const anchor = place(context, data.lead, offset);
        enemy.mesh.quaternion.copy(camera.quaternion);
        const state = context.enemyState(() => ({ fired: false }));
        if (!state.fired && age > 2.15) { state.fired = true; fireShell(context, enemy.mesh.position); }
        return runProgress > anchor + 0.016;
      }
      if (data.role === 'interceptor') {
        const t = MathUtils.clamp((age - data.delay) / 2.5, 0, 1);
        const smooth = t * t * (3 - 2 * t);
        const x = MathUtils.lerp(data.fromX, data.toX, smooth);
        const anchor = place(context, data.lead, new Vector3(x, data.y + Math.sin(t * Math.PI) * 5, -Math.sin(t * Math.PI) * 2));
        const ahead = offsetFromRail(context.curve, anchor, new Vector3(MathUtils.lerp(data.fromX, data.toX, Math.min(1, smooth + 0.05)), data.y, 0));
        enemy.mesh.lookAt(ahead);
        return t >= 1 || runProgress > anchor + 0.016;
      }
      if (data.role === 'mine') {
        const offset = new Vector3(data.x + Math.sin(age * 0.9 + data.phase) * 1.2, data.y + 0.8 + Math.sin(age * 1.6 + data.phase) * 1.1, 0);
        const anchor = place(context, data.lead, offset);
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateZ(age * 1.8);
        return runProgress > anchor + 0.016;
      }
      if (data.role === 'shell') {
        const dt = Math.max(0, age - data.lastAge); data.lastAge = age;
        const impact = updateHostileShotImpact({ age, camera, position: data.position, velocity: data.velocity, state: data.impact, intercepted: intercepted.delete(enemy.id) });
        if (impact.phase === 'braking') {
          enemy.mesh.position.copy(data.position); enemy.mesh.quaternion.copy(camera.quaternion);
          if (impact.damaged) { context.damagePlayer(1); return true; }
          return false;
        }
        steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position, 1.3), age, dt, { baseSpeed: 7, maxSpeed: 15, accel: 3.6, turnRate: 2.0 });
        enemy.mesh.position.copy(data.position); enemy.mesh.lookAt(data.position.clone().add(data.velocity));
        return age > 10 || shotBehindCamera(camera, data.position);
      }

      // Bow turret: armor opens on three scored vent windows. Its stage changes
      // are the volley cadence; between them it hammers shells down the deck.
      const anchor = place(context, data.lead, new Vector3(0, Math.min(0, age * 2.5 - 4), 0));
      enemy.mesh.quaternion.copy(camera.quaternion);
      const phaseAge = age % 4.15;
      enemy.entry.lockable = age > 1.7 && phaseAge >= 1.65 && phaseAge <= 3.45;
      enemy.mesh.userData.ventOpen = enemy.entry.lockable;
      enemy.mesh.userData.stage = enemy.hitStageIndex;
      const turretState = context.enemyState(() => ({ nextShot: 1.0, summoned: false, lastStage: -1 }));
      if (!turretState.summoned) { turretState.summoned = true; bus.emit('bossphase', { phase: 'summoned' }); }
      if (turretState.lastStage !== enemy.hitStageIndex) {
        if (turretState.lastStage >= 0) bus.emit('bossphase', { phase: 'exposed' });
        turretState.lastStage = enemy.hitStageIndex;
      }
      if (age >= turretState.nextShot && !enemy.entry.lockable) {
        turretState.nextShot = age + 0.62;
        const muzzle = enemy.mesh.position.clone().add(new Vector3(((Math.floor(age * 2) % 3) - 1) * 4.5, 1, 0));
        fireShell(context, muzzle);
      }
      return runProgress > anchor + 0.03;
    },
    scoreForKill(volleySize, enemy) { return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.2)); },
    scoreForHit: (_volleySize, enemy) => enemy.kind === 'turret' ? 120 : 40,
    scoreForVolley(results) { return results.length === 6 && results.every((item) => item.killed) ? 700 : 0; },
    rankForRun(score, kills, total) {
      const clear = total ? kills / total : 0;
      if (bossDestroyed && score >= 19000 && clear >= 0.78) return 'S';
      if (score >= 12500 && clear >= 0.62) return 'A';
      if (score >= 7500 && clear >= 0.42) return 'B';
      if (score >= 3200) return 'C';
      return 'D';
    },
    detailsForRun() { return [`Hull ${Math.max(0, HULL_RUN_NS5N_PLAYER_HEALTH - hullHits)}/${HULL_RUN_NS5N_PLAYER_HEALTH}`, bossDestroyed ? 'Bow battery destroyed' : 'Bow battery survived']; },
  };
}
