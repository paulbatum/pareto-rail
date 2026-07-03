import { Vector3 } from 'three';
import type { EnemyKind } from '../events';

export type MovementPattern = 'hold' | 'drift' | 'orbit';

export type SpawnEntry = {
  time: number;
  lead: number;
  kind: EnemyKind;
  pattern: MovementPattern;
  offset: Vector3;
};

const wave = (
  time: number,
  lead: number,
  pattern: MovementPattern,
  kind: EnemyKind,
  offsets: Array<[number, number, number]>,
): SpawnEntry[] => offsets.map((offset, index) => ({
  time: time + index * 0.18,
  lead,
  pattern,
  kind,
  offset: new Vector3(...offset),
}));

export const SPAWN_TIMELINE: SpawnEntry[] = [
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
