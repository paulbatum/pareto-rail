import {
  BoxGeometry,
  BufferGeometry,
  Color,
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

const CELL = 0.32;
const cellGeometry = new BoxGeometry(0.24, 0.24, 0.12);

export function createLetterMesh(char: string) {
  const glyph = GLYPHS[char.toUpperCase()] ?? GLYPHS['!'];
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

  const fillMaterial = new MeshBasicMaterial({ color: new Color(0.12, 0.08, 0.06) });
  const edgeMaterial = new LineBasicMaterial({ color: new Color(1.8, 0.9, 0.2) });
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const g of fills) g.dispose();
  for (const g of edges) g.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.materials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.materials as { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial } | undefined;
  if (!materials) return;
  if (locked) {
    materials.edgeMaterial.color.setRGB(2.5, 2.5, 2.5); // White-hot thermal lock
    materials.fillMaterial.color.setRGB(0.6, 0.1, 0.05); // Red heat core
  } else {
    materials.edgeMaterial.color.setRGB(1.8, 0.9, 0.2); // Sodium orange
    materials.fillMaterial.color.setRGB(0.12, 0.08, 0.06);
  }
}

export function setLetterDenied(group: Group) {
  const materials = group.userData.materials as { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial } | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.setRGB(2.0, 0.1, 0.1);
  materials.fillMaterial.color.setRGB(0.2, 0.02, 0.02);
}
