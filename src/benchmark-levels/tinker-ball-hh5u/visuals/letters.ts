import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { glyphRows } from '../../../engine/glyphs';

// Leaf: START/REPLAY letters as pegboard tiles — a pine board drilled on a
// 5×7 grid with fat coloured pegs pushed into the glyph's holes. The spine
// supplies the colours and the idle/locked/denied materials.

export const LETTER_CELL = 0.36;

export type LetterPeg = { position: Vector3; color: Color };

const cache = new Map<string, { geometry: BufferGeometry; pegs: LetterPeg[] }>();

function colored(geometry: BufferGeometry, color: Color, matrix: Matrix4) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.deleteAttribute('uv');
  g.applyMatrix4(matrix);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

export function letterGeometry(character: string, colors: { board: Color; hole: Color; peg: Color; pegCap: Color }) {
  const key = character.toUpperCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const rows = glyphRows(key) ?? glyphRows('A')!;
  const parts: BufferGeometry[] = [];
  const pegs: LetterPeg[] = [];
  const width = 5 * LETTER_CELL + 0.38;
  const height = 7 * LETTER_CELL + 0.38;
  const m = new Matrix4();
  parts.push(colored(new BoxGeometry(width, height, 0.22), colors.board, m.identity()));
  const hole = new CylinderGeometry(0.05, 0.05, 0.02, 8);
  const peg = new CylinderGeometry(0.165, 0.165, 0.3, 14);
  const cap = new SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const rotate = new Matrix4().makeRotationX(Math.PI / 2);
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const px = (x - 2) * LETTER_CELL;
      const py = (3 - y) * LETTER_CELL;
      if (rows[y][x] === '1') {
        parts.push(colored(peg, colors.peg, new Matrix4().makeTranslation(px, py, 0.26).multiply(rotate)));
        parts.push(colored(cap, colors.pegCap, new Matrix4().makeTranslation(px, py, 0.41).multiply(rotate)));
        pegs.push({ position: new Vector3(px, py, 0.3), color: colors.peg.clone() });
      } else {
        parts.push(colored(hole, colors.hole, new Matrix4().makeTranslation(px, py, 0.111).multiply(rotate)));
      }
    }
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  const result = { geometry, pegs };
  cache.set(key, result);
  return result;
}

export function createLetterMesh(character: string, colors: { board: Color; hole: Color; peg: Color; pegCap: Color }, material: MeshStandardNodeMaterial) {
  const { geometry, pegs } = letterGeometry(character, colors);
  const group = new Group();
  const mesh = new Mesh(geometry, material);
  group.add(mesh);
  group.userData.isLetter = true;
  group.userData.letterMesh = mesh;
  group.userData.pegs = pegs;
  return group;
}
