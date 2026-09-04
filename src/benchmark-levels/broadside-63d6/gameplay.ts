import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry, LockOnEnemyUpdate } from '../../engine/lock-on-runner';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { offsetFromRail } from '../../engine/rail';
import { hostileShotAimPoint, shotBehindCamera, steerHomingShot, updateHostileShotImpact, type HostileShotImpactState } from '../../engine/hostile-shot';
import type { EventBus } from '../../events';
import { BPM, DURATION, TIME } from './timing';

export const WORLD_SCALE = 0.4;

export type Kind = 'raptor' | 'helix' | 'bomber' | 'battery' | 'generator' | 'reactor' | 'shell';
export type SpawnData = {
  x: number; y: number; seed: number; engagement?: RailLead;
  socket?: number; position?: Vector3; velocity?: Vector3;
};
type Entry = LockOnSpawnEntry<Kind, SpawnData>;
type Update = LockOnEnemyUpdate<Kind, SpawnData>;

// One knot per bar. Arc-length lookup preserves the authored arrival times.
const ROUTE = [
  [0, 10, 140], [0, 12, 30], [-10, 24, -130], [-70, 65, -360],
  [-180, 100, -550], [-80, 65, -730], [40, 0, -880], [100, -40, -1040],
  [0, 0, -1200], [-5, 0, -1450], [0, 8, -1730], [30, 10, -2010],
  [110, 5, -2240], [200, 5, -2440], [240, -20, -2650], [220, 25, -2860],
  [90, 90, -3030], [-70, 150, -3140], [-170, 100, -3240], [-135, 20, -3350],
  [-135, 15, -3530], [-135, 18, -3730], [-135, 25, -3920], [-40, 95, -4200],
  [160, 155, -4250], [190, 110, -4140], [100, 64, -3960], [100, 56, -3770],
  [100, 55, -3560], [100, 105, -3330], [260, 650, -2900], [600, 1500, -2350],
  [900, 2400, -1200],
];
export function createRail() {
  const curve = new CatmullRomCurve3(ROUTE.map(p => new Vector3(...p).multiplyScalar(WORLD_SCALE)), false, 'catmullrom', 0.38);
  curve.arcLengthDivisions = 4096;
  return curve;
}
const authoredRail = createRail();
const lengths = authoredRail.getLengths(4096);
export function runProgress(time: number, duration = DURATION) {
  const p = MathUtils.clamp(time / duration, 0, 1) * 4096;
  const i = Math.min(4095, Math.floor(p));
  return MathUtils.lerp(lengths[i], lengths[i + 1], p - i) / lengths[4096];
}
export function routePosition(time: number) {
  return authoredRail.getPoint(MathUtils.clamp(time / DURATION, 0, 1));
}
const pacer = createRailPacer({ curve: authoredRail, duration: DURATION, runProgress, spawnAheadUnits: 34, defaultLeadSeconds: 4.6 });

export const FLAGSHIP = new Vector3(100, 10, -3630).multiplyScalar(WORLD_SCALE);
export const SHIELD_SOCKETS = [
  new Vector3(-100, 25, -3475), new Vector3(-100, 24, -3635),
  new Vector3(-100, 25, -3800), new Vector3(-100, 32, -3960),
].map(p => p.multiplyScalar(WORLD_SCALE));
export const CORE_SOCKETS = [
  new Vector3(81, 64, -3550), new Vector3(100, 70, -3535), new Vector3(119, 64, -3550),
].map(p => p.multiplyScalar(WORLD_SCALE));
export const BELLY_BATTERIES = [
  new Vector3(218, 49, -2530), new Vector3(240, 49, -2530), new Vector3(262, 49, -2530),
  new Vector3(222, 49, -2780), new Vector3(257, 49, -2780),
].map(p => p.multiplyScalar(WORLD_SCALE));

function formation(bar: number, kind: Kind, points: number[][], lead = 4.6): Entry[] {
  return points.map(([x, y], i) => {
    const time = TIME.bar(bar, i * 0.25);
    return { time, kind, hitPoints: kind === 'bomber' ? 2 : 1,
      data: { x, y, seed: i * 1.71 + bar, engagement: pacer.resolve(time, lead),
        ...(kind === 'battery' ? { position: BELLY_BATTERIES[(bar < 13 ? 0 : 3) + i] } : {}) } };
  });
}
const fan = [[-22, -10], [-15, 10], [-5, 14], [6, -13], [16, 9], [24, -7]];
function timeline(): Entry[] {
  return [
    ...formation(0.8, 'raptor', [[-18, 7], [-6, 12], [9, -10], [22, 5]]),
    ...formation(2.6, 'raptor', [[-23, -9], [-13, 9], [12, -11], [23, 10]]),
    ...formation(4.1, 'helix', [[-17, -5], [15, 7], [-3, 13], [8, -13]]),
    ...formation(5.8, 'bomber', [[-19, 9], [19, -8]]),
    ...formation(6.5, 'raptor', [[-21, -11], [-7, 12], [13, 10], [23, -8]]),
    ...formation(8.1, 'raptor', fan),
    ...formation(9.8, 'helix', [[-21, 8], [-9, -10], [9, 12], [23, -7]]),
    ...formation(11, 'bomber', [[-19, -9], [20, 10]]),
    ...formation(12.2, 'battery', [[-22, 13], [0, 15], [22, 13]], 4.2),
    ...formation(13.4, 'raptor', [[-20, -11], [-8, 9], [9, -12], [22, 8]]),
    ...formation(13.5, 'battery', [[-18, 15], [17, 15]], 3.8),
    ...formation(15, 'helix', [[-19, -9], [19, 9]], 3.8),
    ...SHIELD_SOCKETS.map((position, socket): Entry => ({
      time: TIME.bar(18 + socket * 0.85), kind: 'generator', hitStages: [1, 2],
      data: { x: 0, y: 0, seed: socket, socket, position },
    })),
    ...formation(18.4, 'raptor', [[-18, 10], [17, -10]], 4.2),
    ...formation(20, 'bomber', [[-19, -11]], 4.2),
    ...formation(21.8, 'raptor', [[-24, 8], [-18, -12], [-10, 10], [-2, -8]], 4.2),
    ...formation(23.1, 'helix', fan, 4.2),
    ...formation(24.7, 'raptor', [[-21, 12], [-10, -10], [12, 11], [24, -9]], 4),
    ...CORE_SOCKETS.map((position, socket): Entry => ({
      time: TIME.bar(25.7 + socket * 0.18), kind: 'reactor', hitStages: [1, 2],
      data: { x: 0, y: 0, seed: socket, socket, position },
    })),
  ].sort((a, b) => a.time - b.time);
}

export type BattleState = {
  shieldKills: number; coreKills: number; victoryTime: number; clock: number;
  intercepted: number; hullHits: number; shieldsDown: boolean;
};
export function createBroadsideGameplay(bus: EventBus) { return createBattle(bus).level; }

export function createBattle(bus: EventBus) {
  const state: BattleState = { shieldKills: 0, coreKills: 0, victoryTime: -1, clock: 0, intercepted: 0, hullHits: 0, shieldsDown: false };
  const kinds = new Map<number, string>();
  const cleanup = [
    bus.on('runstart', () => {
      Object.assign(state, { shieldKills: 0, coreKills: 0, victoryTime: -1, clock: 0, intercepted: 0, hullHits: 0, shieldsDown: false });
      kinds.clear();
    }),
    bus.on('spawn', e => { kinds.set(e.enemyId, e.kind); }),
    bus.on('kill', e => {
      const kind = kinds.get(e.enemyId);
      kinds.delete(e.enemyId);
      if (kind === 'shell') state.intercepted++;
      if (kind === 'generator' && ++state.shieldKills === 4) {
        state.shieldsDown = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
      if (kind === 'reactor' && ++state.coreKills === 3) {
        state.victoryTime = state.clock;
        bus.emit('bossphase', { phase: 'destroyed' });
      }
    }),
    bus.on('miss', e => kinds.delete(e.enemyId)),
    bus.on('playerhit', () => state.hullHits++),
  ];

  function launch(context: Update) {
    if (shotBehindCamera(context.camera, context.enemy.mesh.position, 0)) return;
    const direction = context.camera.position.clone().sub(context.enemy.mesh.position).normalize();
    context.spawnEnemy({ time: context.runTime, kind: 'shell', countsTowardTotal: false,
      data: { x: 0, y: 0, seed: 0, position: context.enemy.mesh.position.clone(), velocity: direction.multiplyScalar(15) } });
  }
  function updateEnemy(context: Update) {
    const { enemy, age, runTime, camera, curve, enemyState } = context;
    const data = enemy.entry.data;
    state.clock = runTime;
    if (enemy.kind === 'shell') {
      if (runTime >= TIME.bar(28.8) || state.victoryTime >= 0) return true;
      const shot = enemyState(() => ({ position: data.position!.clone(), velocity: data.velocity!.clone(), lastAge: 0, camera: camera.position.clone(), impact: {} as HostileShotImpactState }));
      const dt = Math.max(0, age - shot.lastAge);
      shot.lastAge = age;
      shot.position.add(camera.position.clone().sub(shot.camera).multiplyScalar(0.97));
      shot.camera.copy(camera.position);
      if (shotBehindCamera(camera, shot.position, 2)) return true;
      steerHomingShot(shot.position, shot.velocity, hostileShotAimPoint(camera, shot.position), age, dt,
        { baseSpeed: 15, maxSpeed: 28, accel: 4, turnRate: 4 });
      const impact = updateHostileShotImpact({ age, camera, position: shot.position, velocity: shot.velocity, state: shot.impact, config: { hitDistance: 4, impactBrake: 0.6, damageDistance: 0.9 } });
      enemy.mesh.position.copy(shot.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 2.8);
      if (impact.phase === 'braking' && impact.damaged) { context.damagePlayer(); return true; }
      return age > 6;
    }
    if (enemy.kind === 'generator' || enemy.kind === 'reactor') {
      enemy.mesh.position.copy(data.position!);
      enemy.mesh.quaternion.copy(camera.quaternion);
      const reactor = enemy.kind === 'reactor';
      enemy.entry.lockable = reactor ? state.shieldsDown : true;
      enemy.mesh.userData.shielded = !enemy.entry.lockable;
      enemy.mesh.userData.damage = 1 - enemy.hitPointsRemaining / 3;
      const fireState = enemyState(() => ({ next: reactor ? 2.2 : 1.7 }));
      if (age > fireState.next && runTime < TIME.bar(28.7)) {
        fireState.next += reactor ? 2.4 : 3.1;
        launch(context);
      }
      if (runTime > TIME.bar(29) && state.coreKills < 3) {
        context.damagePlayer(4);
        return true;
      }
      return false;
    }
    const engagement = data.engagement!;
    const sample = pacer.sample(enemy.spawnTime, runTime, engagement);
    let x = data.x, y = data.y;
    if (enemy.kind === 'raptor') {
      x += Math.sin(age * 1.9 + data.seed) * 5;
      y += Math.sin(age * 1.4 + data.seed) * 1.6;
    } else if (enemy.kind === 'helix') {
      x += Math.cos(age * 2.2 + data.seed) * 5;
      y += Math.sin(age * 2.2 + data.seed) * 4.5;
    } else if (enemy.kind === 'bomber') {
      x += Math.sin(age * 0.7 + data.seed) * 2;
      y += Math.sin(age * 0.9) * 0.8;
    } else {
      y += Math.min(age * 2, 2.2);
    }
    enemy.mesh.position.copy(enemy.kind === 'battery' ? data.position! : offsetFromRail(curve, sample.anchorU, new Vector3(x * 0.65, y * 0.65, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(enemy.kind === 'helix' ? age * 2.2 + data.seed : Math.sin(age * 1.9 + data.seed) * 0.3);
    if (enemy.kind === 'battery') enemy.mesh.rotateZ(Math.PI);
    if (enemy.kind === 'bomber' || enemy.kind === 'battery') {
      const fireState = enemyState(() => ({ fired: false }));
      if (age >= 1.8 && !fireState.fired) { fireState.fired = true; launch(context); }
    }
    return runTime > engagement.passTime + 0.25;
  }

  const level: LockOnRunnerLevel<Kind, SpawnData> = {
    bpm: BPM, duration: DURATION, createRail, easeRunProgress: runProgress, spawnTimeline: timeline(), updateEnemy,
    playerHealth: 4, lockRadiusNdc: 0.115,
    timing: { shotDelay: { pattern: 'linear', gapThirtyseconds: 2, releaseShare: 0.35, maxGridSeconds: 0.09 }, actionSfx: { enabled: true, gridThirtyseconds: 1 } },
    scoreForKill: (size, enemy) => (enemy.kind === 'reactor' ? 1500 : enemy.kind === 'generator' ? 850 : enemy.kind === 'shell' ? 70 : 140) * (1 + (size - 1) * 0.3),
    scoreForHit: size => 60 + size * 15,
    scoreForVolley: results => results.length === 6 && results.every(r => r.killed && r.enemy.hitPointsRemaining === 0) ? 1200 : 0,
    rankForRun: (_score, kills, total) => state.coreKills < 3 ? 'RETREAT' : kills / total > 0.92 ? 'ADMIRAL' : kills / total > 0.75 ? 'ACE' : 'VICTOR',
    detailsForRun: () => [state.coreKills === 3 ? 'ENEMY FLAGSHIP DESTROYED' : 'FLAGSHIP REMAINS OPERATIONAL', `Shield generators ${state.shieldKills}/4 · Power systems ${state.coreKills}/3`, `Point-defense interceptions ${state.intercepted} · Hull hits ${state.hullHits}`],
    updateAttractCamera({ camera, modeTime }) {
      camera.position.set(Math.sin(modeTime * 0.2) * 2, 11, 140).multiplyScalar(WORLD_SCALE);
      camera.up.set(0, 1, 0);
      camera.lookAt(new Vector3(-8, 22, -210).multiplyScalar(WORLD_SCALE));
      camera.fov = 64;
      camera.updateProjectionMatrix();
    },
    updateCameraEffects({ camera, runTime }) {
      state.clock = runTime;
      const bank = runTime > 7.5 && runTime < 15 ? Math.sin((runTime - 7.5) / 7.5 * Math.PI * 2) * 0.74 : Math.sin(runTime * 0.8) * 0.12;
      const corkscrew = runTime > 9.8 && runTime < 13.7 ? MathUtils.smoothstep(runTime, 9.8, 13.7) * Math.PI * 2 : 0;
      camera.rotateZ(bank + corkscrew);
      if (state.victoryTime >= 0) {
        const age = runTime - state.victoryTime;
        const finish = MathUtils.clamp(age / (DURATION - state.victoryTime), 0, 1);
        const escapeTime = MathUtils.lerp(TIME.bar(29), DURATION, finish);
        camera.position.lerp(routePosition(escapeTime), MathUtils.smoothstep(age, 0, 1.35));
        const target = new Vector3(60, 0, -2800).multiplyScalar(WORLD_SCALE);
        const currentLook = camera.position.clone().addScaledVector(camera.getWorldDirection(new Vector3()), 40);
        const battleLook = FLAGSHIP.clone().lerp(target, MathUtils.smoothstep(finish, 0.2, 0.8));
        camera.lookAt(currentLook.lerp(battleLook, MathUtils.smoothstep(age, 0.25, 1.5)));
      } else if (runTime >= TIME.bar(29)) {
        camera.lookAt(new Vector3(60, 0, -2800).multiplyScalar(WORLD_SCALE));
      }
      camera.fov = 64 + Math.sin(MathUtils.smoothstep(runTime, 0, 4) * Math.PI / 2) * 4
        + (runTime > 15 && runTime < 22.5 ? Math.sin((runTime - 15) / 7.5 * Math.PI) * 10 : 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },
  };
  return { level, state, dispose: () => cleanup.forEach(off => off()) };
}
