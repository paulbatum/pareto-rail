import {
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CYAN_GLOW, GOLD, hdr, ICE } from './palette';

// Broadside lettering: ice-white cell fills with hot cyan wireframe edges,
// cut like signal plates bolted to a flagship hull. A locked letter flares
// gold — the fleet's "weapons free" read.
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
};

const CELL = 0.36;
const cellGeometry = new BoxGeometry(0.32, 0.32, 0.16);

export type LetterShardSpec = {
  direction: Vector3;
  color: ColorLike;
  size: number;
};

type ColorLike = { clone(): ColorLike };

export function createLetterMesh(char: string) {
  const glyph = GLYPHS[char.toUpperCase()] ?? GLYPHS.A;
  const group = new Group();
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (let y = 0; y < glyph.length; y += 1) {
    for (let x = 0; x < glyph[y].length; x += 1) {
      if (glyph[y][x] !== '1') continue;
      const offset = new Vector3(x * CELL - width / 2, height / 2 - y * CELL, 0);
      const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
      fills.push(cellGeometry.clone().applyMatrix4(matrix));
      edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    }
  }

  const fillMaterial = new MeshBasicMaterial({ color: ICE.clone().multiplyScalar(0.35) });
  const edgeMaterial = new LineBasicMaterial({ color: hdr(CYAN_GLOW, 1.2) });
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.accent = CYAN_GLOW.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(GOLD, 1.7) : hdr(CYAN_GLOW, 1.2));
  materials.fillMaterial.color.copy(
    locked ? GOLD.clone().multiplyScalar(0.3) : ICE.clone().multiplyScalar(0.35),
  );
}
