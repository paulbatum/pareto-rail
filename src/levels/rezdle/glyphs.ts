import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BONE, hdr, VERMILLION } from './palette';

export const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

const CELL = 0.28;
const CELL_GEOMETRY = new BoxGeometry(0.24, 0.24, 0.1);

export type GlyphStyle = 'solid' | 'print';

// A raised letter face, merged into a single mesh. 'solid' is the readable
// bone face used on live type; 'print' is an additive ink impression used
// for stamped afterimages.
export function createGlyphMesh(letter: string, style: GlyphStyle = 'solid'): Group {
  const char = letter.toUpperCase()[0] ?? 'A';
  const glyph = GLYPHS[char] ?? GLYPHS.A;
  const group = new Group();
  const material =
    style === 'solid'
      ? new MeshBasicMaterial({ color: BONE.clone() })
      : new MeshBasicMaterial({
          color: hdr(VERMILLION, 1.6),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        });

  const width = (glyph[0].length - 1) * CELL;
  const height = (glyph.length - 1) * CELL;
  const cells: BufferGeometry[] = [];

  for (let y = 0; y < glyph.length; y += 1) {
    for (let x = 0; x < glyph[y].length; x += 1) {
      if (glyph[y][x] !== '1') continue;
      const matrix = new Matrix4().makeTranslation(x * CELL - width / 2, height / 2 - y * CELL, 0);
      cells.push(CELL_GEOMETRY.clone().applyMatrix4(matrix));
    }
  }

  const merged = mergeGeometries(cells);
  for (const cell of cells) cell.dispose();
  group.add(new Mesh(merged, material));

  group.userData.letter = char;
  group.userData.glyphMaterial = material;
  return group;
}

// Rubrication: a locked letter is inked vermillion like a rubric initial.
export function setGlyphLocked(mesh: Object3D, locked: boolean) {
  const material = mesh.userData.glyphMaterial as MeshBasicMaterial | undefined;
  if (material) material.color.copy(locked ? hdr(VERMILLION, 2.4) : BONE);
  for (const child of mesh.children) setGlyphLocked(child, locked);
}
