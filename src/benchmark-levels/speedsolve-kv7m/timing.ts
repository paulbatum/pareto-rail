import { Matrix4, Quaternion, Vector3 } from 'three';
import { createMusicTime } from '../../engine/music-time';

export const BPM = 128;
export const TIME = createMusicTime(BPM);
export const DURATION = TIME.bar(32);
export const BEAT = TIME.beatSeconds;
export const FACE_STARTS = Array.from({ length: 6 }, (_, i) => TIME.bar(i * 4, 2));
export const CORE_START = TIME.bar(26);
export const CORE_STAGES = [CORE_START, TIME.bar(27, 2), TIME.bar(29)];
export const MARKERS = {
  scramble: 0, firstTurn: TIME.bar(1), orange: FACE_STARTS[1], yellow: FACE_STARTS[2],
  green: FACE_STARTS[3], blue: FACE_STARTS[4], violet: FACE_STARTS[5], nakedCore: CORE_START,
  lastBarrage: CORE_STAGES[2], resolve: TIME.bar(31),
};

const axes: Array<[number[], number[], number[]]> = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
];
export const FACES = axes.map(([r, u, n]) => {
  const right = new Vector3(...r), up = new Vector3(...u), normal = new Vector3(...n);
  return { right, up, normal, quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal)) };
});
export const TILE_PITCH = 5.12;
export const FACE_DEPTH = 7.77;
export const ACTIVE_CELLS = [0, 2, 6, 8, 3, 5];
export const SOLVE_ORDER = [4, 0, 2, 6, 8, 1, 7, 3, 5];
export function tilePosition(face: number, cell: number, depth = FACE_DEPTH) {
  const frame = FACES[face];
  return frame.normal.clone().multiplyScalar(depth)
    .addScaledVector(frame.right, (cell % 3 - 1) * TILE_PITCH)
    .addScaledVector(frame.up, (1 - Math.floor(cell / 3)) * TILE_PITCH);
}
