import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createRailPacer } from '../../engine/rail-pacer';
import { steerHomingShot, updateHostileShotImpact, hostileShotAimPoint, shotBehindCamera } from '../../engine/hostile-shot';
import { VESPERS_C8VR_BPM, VESPERS_C8VR_RUN_DURATION, VESPERS_C8VR_TIME } from './timing';

export type VespersEnemyKind = 'gargoyle' | 'triforium' | 'panestealer' | 'rose-boss' | 'boss-shot' | 'letter';

export interface VespersEnemyData {
  kind: VespersEnemyKind;
  offset: [number, number]; // [x, y] viewport offset relative to rail anchor
  leadSeconds: number;
}

export function createVespersRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 1.5, -60),
      new Vector3(0, -1.0, -120),
      new Vector3(0, 2.0, -180),
      new Vector3(0, 0, -240),
      new Vector3(0, 1.0, -300),
      new Vector3(0, 4.0, -360),
    ],
    false,
    'catmullrom',
    0.5,
  );
}

const rail = createVespersRail();
const pacer = createRailPacer({
  curve: rail,
  duration: VESPERS_C8VR_RUN_DURATION,
  runProgress: (t, d) => Math.min(1, Math.max(0, t / d)),
  spawnAheadUnits: 65,
  defaultLeadSeconds: 4.5,
});

export const VESPERS_C8VR_SPAWN_TIMELINE: Array<LockOnSpawnEntry<VespersEnemyKind, VespersEnemyData>> = [
  // --- Wave 1: The Dark Arcade (Bars 4 - 13) ---
  { time: VESPERS_C8VR_TIME.bar(4), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [-9, 7], leadSeconds: 4.5 } },
  { time: VESPERS_C8VR_TIME.bar(5), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [9, -6], leadSeconds: 4.5 } },
  { time: VESPERS_C8VR_TIME.bar(6), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [-8, -6], leadSeconds: 4.5 } },
  { time: VESPERS_C8VR_TIME.bar(6, 8), kind: 'triforium', data: { kind: 'triforium', offset: [8, 7], leadSeconds: 4.8 } },

  { time: VESPERS_C8VR_TIME.bar(7), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [-9, 5], leadSeconds: 4.5 } },
  { time: VESPERS_C8VR_TIME.bar(8), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [9, -5], leadSeconds: 4.5 } },
  { time: VESPERS_C8VR_TIME.bar(8, 8), kind: 'triforium', data: { kind: 'triforium', offset: [-8, -5], leadSeconds: 4.8 } },

  {
    time: VESPERS_C8VR_TIME.bar(9, 8),
    kind: 'panestealer',
    hitPoints: 2,
    hitStages: [1, 2],
    data: { kind: 'panestealer', offset: [8, 6], leadSeconds: 5.2 },
  },

  { time: VESPERS_C8VR_TIME.bar(10), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [-9, -6], leadSeconds: 4.5 } },
  { time: VESPERS_C8VR_TIME.bar(10, 8), kind: 'triforium', data: { kind: 'triforium', offset: [9, 5], leadSeconds: 4.8 } },
  { time: VESPERS_C8VR_TIME.bar(11), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [-7, -5], leadSeconds: 4.5 } },

  {
    time: VESPERS_C8VR_TIME.bar(12),
    kind: 'panestealer',
    hitPoints: 2,
    hitStages: [1, 2],
    data: { kind: 'panestealer', offset: [8, -5], leadSeconds: 5.2 },
  },
  { time: VESPERS_C8VR_TIME.bar(12, 8), kind: 'triforium', data: { kind: 'triforium', offset: [-8, 6], leadSeconds: 4.8 } },

  // --- Mid-Run Quiet Span (Bars 14 - 18) ---
  // "Past the middle, the nave goes quiet: a long dark empty span, one voice, almost nothing on screen"
  { time: VESPERS_C8VR_TIME.bar(16), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [-6, 4], leadSeconds: 5.0 } },

  // --- Boss Phase: Rose Archon (Bars 20 - 26) ---
  {
    time: VESPERS_C8VR_TIME.bar(20),
    kind: 'rose-boss',
    hitPoints: 6,
    hitStages: [2, 4, 6],
    data: { kind: 'rose-boss', offset: [0, 4], leadSeconds: 12.0 },
  },
  { time: VESPERS_C8VR_TIME.bar(22), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [-9, 6], leadSeconds: 4.5 } },
  { time: VESPERS_C8VR_TIME.bar(22, 8), kind: 'triforium', data: { kind: 'triforium', offset: [9, 5], leadSeconds: 4.8 } },
  { time: VESPERS_C8VR_TIME.bar(24), kind: 'gargoyle', data: { kind: 'gargoyle', offset: [8, -6], leadSeconds: 4.5 } },
  { time: VESPERS_C8VR_TIME.bar(24, 8), kind: 'triforium', data: { kind: 'triforium', offset: [-8, 6], leadSeconds: 4.8 } },
];

export const vespersC8vrGameplay: LockOnRunnerLevel<VespersEnemyKind, VespersEnemyData> = {
  duration: VESPERS_C8VR_RUN_DURATION,
  bpm: VESPERS_C8VR_BPM,
  playerHealth: 6,
  createRail: createVespersRail,
  spawnTimeline: VESPERS_C8VR_SPAWN_TIMELINE,

  updateEnemy(ctx) {
    const { enemy, runTime, camera, spawnEnemy, damagePlayer, enemyState } = ctx;
    const data = enemy.entry.data;
    const mesh = enemy.mesh;
    const dt = 1 / 60;

    // 1. Hostile Boss Shard Shots
    if (data.kind === 'boss-shot') {
      const state = enemyState(() => ({ age: 0, velocity: new Vector3(), impactState: {} }));

      state.age += dt;
      const aim = hostileShotAimPoint(camera, mesh.position);
      steerHomingShot(mesh.position, state.velocity, aim, state.age, dt, {
        baseSpeed: 18,
        maxSpeed: 32,
        accel: 8,
        turnRate: 4,
      });

      const impact = updateHostileShotImpact({
        age: state.age,
        camera,
        position: mesh.position,
        velocity: state.velocity,
        state: state.impactState,
      });

      if (impact.phase === 'braking' && impact.damaged) {
        damagePlayer(1);
        return true; // Despawn after hit
      }

      return shotBehindCamera(camera, mesh.position);
    }

    // 2. Boss & Standard Enemies Rail Motion
    const lead = data.leadSeconds ?? 4.5;
    const pace = pacer.sample(enemy.entry.time, runTime, lead);

    const anchorPos = rail.getPointAt(pace.anchorU);
    const tangent = rail.getTangentAt(pace.anchorU);

    // Compute normal & binormal vectors for camera-aligned offset
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(tangent, up).normalize();
    const normalUp = new Vector3().crossVectors(right, tangent).normalize();

    const bobX = Math.sin(runTime * 2.0 + enemy.id) * 0.4;
    const bobY = Math.cos(runTime * 2.5 + enemy.id) * 0.4;

    const posX = data.offset[0] + bobX;
    const posY = data.offset[1] + bobY;

    mesh.position.copy(anchorPos).addScaledVector(right, posX).addScaledVector(normalUp, posY);
    mesh.lookAt(anchorPos.clone().add(tangent));

    // Boss Shard Attack logic
    if (data.kind === 'rose-boss') {
      const bossState = enemyState(() => ({ lastShot: 0 }));
      if (runTime - bossState.lastShot > 3.2 && pace.distanceAheadUnits > 15) {
        bossState.lastShot = runTime;
        spawnEnemy({
          time: runTime,
          kind: 'boss-shot',
          countsTowardTotal: false,
          lockable: true,
          data: { kind: 'boss-shot', offset: [0, 0], leadSeconds: 3.0 },
        });
      }
    }

    // Despawn once camera overtakes target
    return runTime >= pace.passTime + 0.8;
  },
};
