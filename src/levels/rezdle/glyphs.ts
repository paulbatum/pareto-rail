import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from 'three';

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
const CELL_GEOMETRY = new BoxGeometry(0.22, 0.22, 0.08);
const BASE = new Color(0.72, 0.95, 1.0);
const LOCKED = new Color(1.0, 0.55, 0.18);

type GlyphMaterialSet = {
  materials: MeshBasicMaterial[];
};

export function createGlyphMesh(letter: string): Group {
  const char = letter.toUpperCase()[0] ?? 'A';
  const glyph = GLYPHS[char] ?? GLYPHS.A;
  const group = new Group();
  const material = new MeshBasicMaterial({
    color: BASE.clone().multiplyScalar(1.2),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const width = (glyph[0].length - 1) * CELL;
  const height = (glyph.length - 1) * CELL;

  for (let y = 0; y < glyph.length; y += 1) {
    for (let x = 0; x < glyph[y].length; x += 1) {
      if (glyph[y][x] !== '1') continue;
      const cell = new Mesh(CELL_GEOMETRY, material);
      cell.position.set(x * CELL - width / 2, height / 2 - y * CELL, 0);
      group.add(cell);
    }
  }

  group.userData.letter = char;
  group.userData.glyphMaterials = { materials: [material] } satisfies GlyphMaterialSet;
  return group;
}

export function setGlyphLocked(mesh: Object3D, locked: boolean) {
  const data = mesh.userData.glyphMaterials as GlyphMaterialSet | undefined;
  if (data) {
    for (const material of data.materials) {
      material.color.copy(locked ? LOCKED.clone().multiplyScalar(1.8) : BASE.clone().multiplyScalar(1.2));
    }
  }
  for (const child of mesh.children) setGlyphLocked(child, locked);
}
