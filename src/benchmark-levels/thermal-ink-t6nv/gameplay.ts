import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sampleRailFrame } from '../../engine/rail';
import {
  THERMAL_INK_T6NV_BPM,
  THERMAL_INK_T6NV_RUN_BARS,
  THERMAL_INK_T6NV_RUN_DURATION,
  THERMAL_INK_T6NV_TIME,
} from './timing';

export type ThermalInkT6nvEnemyKind =
  | 'letter'
  | 'arm_outer'
  | 'arm_inner'
  | 'scavenger'
  | 'harbor_mine'
  | 'boss_core';

export interface ThermalInkT6nvSpawnData {
  lead?: number;
  offset?: { x: number; y: number };
  hp?: number;
}

export function createThermalInkT6nvRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(-18, 6, -45),
      new Vector3(22, -4, -95),
      new Vector3(-14, 8, -145),
      new Vector3(12, -2, -195),
      new Vector3(-10, 5, -245),
      new Vector3(0, 2, -295),
      new Vector3(0, 0, -355),
    ],
    false,
    'catmullrom',
    0.5,
  );
}

// 60-second choreographed spawn timeline with zero occlusion and wide spatial spread
export const THERMAL_INK_T6NV_SPAWN_TIMELINE: Array<
  LockOnSpawnEntry<ThermalInkT6nvEnemyKind, ThermalInkT6nvSpawnData>
> = [
  // Bar 1: Intro / Start Word Targets ("START!")
  { time: THERMAL_INK_T6NV_TIME.bar(1), kind: 'letter', letter: 'S', data: { lead: 4.5, offset: { x: -4.0, y: 2.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(1) + 0.2, kind: 'letter', letter: 'T', data: { lead: 4.5, offset: { x: -2.4, y: 2.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(1) + 0.4, kind: 'letter', letter: 'A', data: { lead: 4.5, offset: { x: -0.8, y: 2.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(1) + 0.6, kind: 'letter', letter: 'R', data: { lead: 4.5, offset: { x: 0.8, y: 2.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(1) + 0.8, kind: 'letter', letter: 'T', data: { lead: 4.5, offset: { x: 2.4, y: 2.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(1) + 1.0, kind: 'letter', letter: '!', data: { lead: 4.5, offset: { x: 4.0, y: 2.2 } } },

  // Bar 5: Phase 1 — Outer Arms & Scavenger Spawn Waves
  { time: THERMAL_INK_T6NV_TIME.bar(5), kind: 'arm_outer', hitPoints: 2, hitStages: [2], data: { lead: 4.8, offset: { x: -6.5, y: 4.5 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(5) + 0.5, kind: 'arm_outer', hitPoints: 2, hitStages: [2], data: { lead: 4.8, offset: { x: 6.5, y: 4.5 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(6), kind: 'scavenger', data: { lead: 3.8, offset: { x: -7.2, y: -3.8 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(6) + 0.5, kind: 'scavenger', data: { lead: 3.8, offset: { x: 7.2, y: -3.8 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(7), kind: 'scavenger', data: { lead: 3.8, offset: { x: -5.5, y: 5.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(7) + 0.5, kind: 'scavenger', data: { lead: 3.8, offset: { x: 5.5, y: 5.2 } } },

  // Bar 9: Phase 2 — 1st Ink Blackout & Infrared Search
  { time: THERMAL_INK_T6NV_TIME.bar(9), kind: 'arm_outer', hitPoints: 2, hitStages: [2], data: { lead: 4.6, offset: { x: -6.0, y: 3.8 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(9) + 0.5, kind: 'arm_outer', hitPoints: 2, hitStages: [2], data: { lead: 4.6, offset: { x: 6.0, y: 3.8 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(10), kind: 'harbor_mine', hitPoints: 1, countsTowardTotal: false, data: { lead: 3.6, offset: { x: 2.5, y: 2.5 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(11), kind: 'scavenger', data: { lead: 3.6, offset: { x: -6.8, y: -3.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(11) + 0.4, kind: 'scavenger', data: { lead: 3.6, offset: { x: 6.8, y: -3.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(12), kind: 'scavenger', data: { lead: 3.6, offset: { x: 0.0, y: 5.8 } } },

  // Bar 14: Phase 3 — Skimming Steel & Inner Arm Attack
  { time: THERMAL_INK_T6NV_TIME.bar(14), kind: 'arm_inner', hitPoints: 3, hitStages: [3], data: { lead: 4.6, offset: { x: -5.5, y: -2.8 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(14) + 0.5, kind: 'arm_inner', hitPoints: 3, hitStages: [3], data: { lead: 4.2, offset: { x: 4.5, y: 4.5 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(15) + 0.2, kind: 'harbor_mine', countsTowardTotal: false, data: { lead: 3.8, offset: { x: -5.5, y: 4.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(15) + 0.6, kind: 'harbor_mine', countsTowardTotal: false, data: { lead: 3.8, offset: { x: 5.5, y: 4.2 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(16) + 0.3, kind: 'scavenger', data: { lead: 3.5, offset: { x: -7.5, y: 1.8 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(17), kind: 'scavenger', data: { lead: 3.5, offset: { x: 7.5, y: 1.8 } } },

  // Bar 19: Phase 4 — Deep Ink Storm & Severing All Arms
  { time: THERMAL_INK_T6NV_TIME.bar(19), kind: 'arm_inner', hitPoints: 3, hitStages: [3], data: { lead: 4.5, offset: { x: -4.8, y: 4.5 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(19) + 0.4, kind: 'arm_inner', hitPoints: 3, hitStages: [3], data: { lead: 4.8, offset: { x: 4.8, y: 4.5 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(20) + 0.3, kind: 'scavenger', data: { lead: 3.5, offset: { x: -6.5, y: -4.5 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(21), kind: 'scavenger', data: { lead: 3.5, offset: { x: 6.5, y: -4.5 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(22), kind: 'scavenger', data: { lead: 3.5, offset: { x: 0.0, y: 6.0 } } },

  // Bar 24: Phase 5 — Exposed Core & Final Blackout Strike
  { time: THERMAL_INK_T6NV_TIME.bar(24), kind: 'boss_core', hitPoints: 4, hitStages: [4], data: { lead: 5.5, offset: { x: 0.0, y: 1.8 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(25) + 0.5, kind: 'harbor_mine', countsTowardTotal: false, data: { lead: 3.5, offset: { x: -5.8, y: -1.8 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(26), kind: 'harbor_mine', countsTowardTotal: false, data: { lead: 3.8, offset: { x: 5.8, y: -1.8 } } },

  // Replay Word Targets
  { time: THERMAL_INK_T6NV_TIME.bar(28), kind: 'letter', letter: 'R', data: { lead: 3.5, offset: { x: -4.0, y: 0.0 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(28) + 0.2, kind: 'letter', letter: 'E', data: { lead: 3.5, offset: { x: -2.4, y: 0.0 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(28) + 0.4, kind: 'letter', letter: 'P', data: { lead: 3.5, offset: { x: -0.8, y: 0.0 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(28) + 0.6, kind: 'letter', letter: 'L', data: { lead: 3.5, offset: { x: 0.8, y: 0.0 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(28) + 0.8, kind: 'letter', letter: 'A', data: { lead: 3.5, offset: { x: 2.4, y: 0.0 } } },
  { time: THERMAL_INK_T6NV_TIME.bar(28) + 1.0, kind: 'letter', letter: 'Y', data: { lead: 3.5, offset: { x: 4.0, y: 0.0 } } },
];

export const thermalInkT6nvGameplay: LockOnRunnerLevel<
  ThermalInkT6nvEnemyKind,
  ThermalInkT6nvSpawnData
> = {
  duration: THERMAL_INK_T6NV_RUN_DURATION,
  bpm: THERMAL_INK_T6NV_BPM,
  createRail: createThermalInkT6nvRail,
  spawnTimeline: THERMAL_INK_T6NV_SPAWN_TIMELINE,

  updateEnemy(context) {
    const { enemy, curve, railAnchor, runTime } = context;
    const data = enemy.entry.data;

    // Eased rail motion
    const lead = data?.lead ?? 4.0;
    const offset = data?.offset ?? { x: 0, y: 0 };
    const anchorU = railAnchor(lead);
    const frame = sampleRailFrame(curve, anchorU);

    enemy.mesh.position.copy(frame.position)
      .addScaledVector(frame.right, offset.x)
      .addScaledVector(frame.up, offset.y);

    // Scavenger twitchy bobbing
    if (enemy.kind === 'scavenger') {
      enemy.mesh.position.x += Math.sin(runTime * 8.0 + enemy.id) * 0.2;
      enemy.mesh.position.y += Math.cos(runTime * 6.0 + enemy.id) * 0.2;
    }

    // Despawn if passed
    if (runTime > enemy.spawnTime + lead + 1.5) {
      return true;
    }
    return false;
  },

  rankForRun(_score, kills, totalEnemies) {
    const accuracy = totalEnemies > 0 ? kills / totalEnemies : 0;
    if (accuracy >= 0.9) return 'S';
    if (accuracy >= 0.75) return 'A';
    if (accuracy >= 0.6) return 'B';
    if (accuracy >= 0.4) return 'C';
    return 'D';
  },
};
