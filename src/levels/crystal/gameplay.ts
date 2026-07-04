import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';

export const CRYSTAL_RUN_DURATION = 30;

export type CrystalEnemyKind = 'node' | 'drifter' | 'orbiter';
export type CrystalTargetKind = CrystalEnemyKind | 'letter';
export type CrystalMovementPattern = 'hold' | 'drift' | 'orbit';

export type CrystalSpawnData = {
  lead: number;
  pattern: CrystalMovementPattern;
  offset: Vector3;
};

export function createCrystalRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 2, -24),
      new Vector3(14, -1, -54),
      new Vector3(-10, 5, -86),
      new Vector3(-22, -2, -118),
      new Vector3(6, 3, -152),
      new Vector3(24, 8, -184),
      new Vector3(-4, 0, -220),
      new Vector3(0, 4, -250),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

type CrystalSpawnEntry = {
  time: number;
  kind: CrystalEnemyKind;
  data: CrystalSpawnData;
};

const wave = (
  time: number,
  lead: number,
  pattern: CrystalMovementPattern,
  kind: CrystalEnemyKind,
  offsets: Array<[number, number, number]>,
): CrystalSpawnEntry[] => offsets.map((offset, index) => ({
  time: time + index * 0.18,
  kind,
  data: { lead, pattern, offset: new Vector3(...offset) },
}));

export const CRYSTAL_TIMELINE: CrystalSpawnEntry[] = [
  ...wave(1.2, 4.0, 'hold', 'node', [
    [-5, 1, 0], [-2, 3, 0], [2, 3, 0], [5, 1, 0],
  ]),
  ...wave(4.2, 4.6, 'drift', 'drifter', [
    [-8, -1, 0], [-4, 2, 0], [0, 3, 0], [4, 2, 0], [8, -1, 0],
  ]),
  ...wave(7.4, 4.8, 'orbit', 'orbiter', [
    [-6, 4, 0], [-3, 0, 0], [3, 0, 0], [6, 4, 0],
  ]),
  ...wave(10.8, 4.3, 'drift', 'drifter', [
    [-7, 2, 0], [-3, -2, 0], [2, 1, 0], [7, -1, 0],
  ]),
  ...wave(14.0, 4.8, 'hold', 'node', [
    [-6, -2, 0], [-2, 1.5, 0], [2, 1.5, 0], [6, -2, 0],
  ]),
  ...wave(17.5, 5.0, 'orbit', 'orbiter', [
    [-8, 2, 0], [-4, 5, 0], [0, 2, 0], [4, 5, 0], [8, 2, 0],
  ]),
  ...wave(22.0, 4.2, 'drift', 'drifter', [
    [-7, 0, 0], [-3, 3, 0], [0, -1, 0], [3, 3, 0], [7, 0, 0],
  ]),
  ...wave(26.0, 3.0, 'hold', 'node', [
    [-5, 2, 0], [0, 4, 0], [5, 2, 0],
  ]),
].sort((a, b) => a.time - b.time);

export const crystalGameplay: LockOnRunnerLevel<CrystalEnemyKind, CrystalSpawnData> = {
  duration: CRYSTAL_RUN_DURATION,
  createRail: createCrystalRail,
  spawnTimeline: CRYSTAL_TIMELINE,
  easeRunProgress: smoothRunProgress,
  updateEnemy({ enemy, runTime, runProgress, age, curve, camera }) {
    const anchorU = smoothRunProgress(Math.min(CRYSTAL_RUN_DURATION, enemy.entry.time + enemy.entry.data.lead), CRYSTAL_RUN_DURATION);
    const offset = enemy.entry.data.offset.clone();
    if (enemy.entry.data.pattern === 'drift') {
      offset.x += Math.sin(age * 0.85 + enemy.id) * 1.3 + age * 0.55;
      offset.y += Math.cos(age * 0.65 + enemy.id * 0.5) * 0.55;
    } else if (enemy.entry.data.pattern === 'orbit') {
      offset.x += Math.cos(age * 2.2 + enemy.id) * 2.1;
      offset.y += Math.sin(age * 2.2 + enemy.id) * 2.1;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * (0.3 + (enemy.id % 5) * 0.09) + enemy.id * 1.7);
    enemy.mesh.rotateY(Math.sin(runTime * 0.8 + enemy.id * 1.3) * 0.4);
    enemy.mesh.rotateX(Math.cos(runTime * 0.65 + enemy.id * 2.1) * 0.3);

    return runProgress > anchorU + 0.018;
  },
};
