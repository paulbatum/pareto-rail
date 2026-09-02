// Pure puzzle-cube math: 27 cubies on a {-1,0,1}^3 lattice, 54 sticker slots
// keyed by (cubie, face), quarter-turn layer moves that permute slots exactly
// the way a real cube would. No rendering, no timing — the fight state machine
// and the visuals both consume this.

export type Vec3i = readonly [number, number, number];
export type Axis = 0 | 1 | 2;
export type LayerMove = { axis: Axis; depth: -1 | 0 | 1; dir: 1 | -1 };

/** Face ids: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. */
export const FACE_NORMALS: readonly Vec3i[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const CUBIE_COUNT = 27;
export const SLOT_COUNT = CUBIE_COUNT * 6;
export const NO_COLOR = 255;

export function faceAxis(face: number): Axis {
  return Math.floor(face / 2) as Axis;
}

export function faceSign(face: number): 1 | -1 {
  return face % 2 === 0 ? 1 : -1;
}

export function faceOfNormal(n: Vec3i) {
  for (let face = 0; face < 6; face += 1) {
    const normal = FACE_NORMALS[face];
    if (normal[0] === n[0] && normal[1] === n[1] && normal[2] === n[2]) return face;
  }
  throw new Error(`Not a face normal: ${n.join(',')}`);
}

export function cubieIndex(x: number, y: number, z: number) {
  return (x + 1) * 9 + (y + 1) * 3 + (z + 1);
}

export function cubieCoords(index: number): Vec3i {
  return [Math.floor(index / 9) - 1, Math.floor((index % 9) / 3) - 1, (index % 3) - 1];
}

export function slotIndex(cubie: number, face: number) {
  return cubie * 6 + face;
}

export function hasSticker(p: Vec3i, face: number) {
  return p[faceAxis(face)] === faceSign(face);
}

export function faceCenterCubie(face: number) {
  const n = FACE_NORMALS[face];
  return cubieIndex(n[0], n[1], n[2]);
}

/** Quarter turn of an integer vector about an axis (right-handed for dir 1). */
export function rotateVec(v: Vec3i, axis: Axis, dir: 1 | -1): Vec3i {
  const [x, y, z] = v;
  if (axis === 0) return dir === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return dir === 1 ? [z, y, -x] : [-z, y, x];
  return dir === 1 ? [-y, x, z] : [y, -x, z];
}

export function moveCubie(index: number, move: LayerMove) {
  const p = cubieCoords(index);
  if (p[move.axis] !== move.depth) return index;
  const q = rotateVec(p, move.axis, move.dir);
  return cubieIndex(q[0], q[1], q[2]);
}

export function cubiesInLayer(move: Pick<LayerMove, 'axis' | 'depth'>) {
  const result: number[] = [];
  for (let index = 0; index < CUBIE_COUNT; index += 1) {
    if (cubieCoords(index)[move.axis] === move.depth) result.push(index);
  }
  return result;
}

export function createSolvedState(): Uint8Array {
  const state = new Uint8Array(SLOT_COUNT).fill(NO_COLOR);
  for (let index = 0; index < CUBIE_COUNT; index += 1) {
    const p = cubieCoords(index);
    for (let face = 0; face < 6; face += 1) if (hasSticker(p, face)) state[slotIndex(index, face)] = face;
  }
  return state;
}

/** Applies a layer move, returning the permuted sticker state. */
export function applyMove(state: Uint8Array, move: LayerMove): Uint8Array {
  const next = state.slice();
  for (const index of cubiesInLayer(move)) {
    const p = cubieCoords(index);
    const q = rotateVec(p, move.axis, move.dir);
    const target = cubieIndex(q[0], q[1], q[2]);
    for (let face = 0; face < 6; face += 1) {
      if (!hasSticker(p, face)) continue;
      const movedFace = faceOfNormal(rotateVec(FACE_NORMALS[face], move.axis, move.dir));
      next[slotIndex(target, movedFace)] = state[slotIndex(index, face)];
    }
  }
  return next;
}

/** The outer layer that carries a face's own stickers, turned in-plane. */
export function faceLayerMove(face: number, dir: 1 | -1): LayerMove {
  return { axis: faceAxis(face), depth: faceSign(face), dir };
}

/** The opposite outer layer along the same axis. */
export function backLayerMove(face: number, dir: 1 | -1): LayerMove {
  return { axis: faceAxis(face), depth: faceSign(face) === 1 ? -1 : 1, dir };
}

/** The nine cubies on a face as a row-major 3x3 grid; index 4 is the centre. */
export function faceCubies(face: number) {
  const axis = faceAxis(face);
  const sign = faceSign(face);
  const uAxis = ((axis + 1) % 3) as Axis;
  const vAxis = ((axis + 2) % 3) as Axis;
  const cubies: number[] = [];
  for (let v = -1; v <= 1; v += 1) {
    for (let u = -1; u <= 1; u += 1) {
      const p: [number, number, number] = [0, 0, 0];
      p[axis] = sign;
      p[uAxis] = u;
      p[vAxis] = v;
      cubies.push(cubieIndex(p[0], p[1], p[2]));
    }
  }
  return cubies;
}

/** Outer-layer scramble from a seeded RNG; the centre cubies never move. */
export function scrambleState(state: Uint8Array, moves: number, rng: () => number): Uint8Array {
  let current = state;
  let lastAxis = -1;
  for (let i = 0; i < moves; i += 1) {
    let axis = Math.floor(rng() * 3) as Axis;
    if (axis === lastAxis) axis = ((axis + 1) % 3) as Axis;
    lastAxis = axis;
    const depth = rng() < 0.5 ? -1 : 1;
    const dir = rng() < 0.5 ? -1 : 1;
    current = applyMove(current, { axis, depth, dir });
  }
  return current;
}

/** Paints a face fully in its own colour (all nine stickers). */
export function paintFaceSolved(state: Uint8Array, face: number, color = face): Uint8Array {
  const next = state.slice();
  for (const cubie of faceCubies(face)) next[slotIndex(cubie, face)] = color;
  return next;
}

export function faceColorCounts(state: Uint8Array, face: number) {
  const counts = new Array<number>(6).fill(0);
  for (const cubie of faceCubies(face)) {
    const color = state[slotIndex(cubie, face)];
    if (color < 6) counts[color] += 1;
  }
  return counts;
}
