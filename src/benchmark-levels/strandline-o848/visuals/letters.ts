import {
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { glyphOnCells } from '../../../engine/glyphs';
import { PEARL, STRAND_GREEN, VIOLET_HOT, hdr } from './palette';

// Letter glyphs as chains of bioluminescent cells: pale pearl pods with
// green-gold rims, the way the jelly's own light spells things in the water.
// START and REPLAY both read from the same 5×7 grid as the rest of the game.

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

const CELL = 0.36;
const cellGeometry = new SphereGeometry(0.19, 8, 6);
cellGeometry.scale(1, 1, 0.5);

export function createLetterMesh(character: string) {
  const rows = GLYPHS[character.toUpperCase()] ?? GLYPHS.I;
  const group = new Group();
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] !== '1') continue;
      const offset = new Vector3(x * CELL - width / 2, height / 2 - y * CELL, 0);
      const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
      fills.push(cellGeometry.clone().applyMatrix4(matrix));
      edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    }
  }

  const fillMaterial = new MeshBasicMaterial({ color: PEARL.clone().multiplyScalar(0.85) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(STRAND_GREEN, 1.15),
  }));
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(PEARL, 1.7) : hdr(STRAND_GREEN, 1.15));
  materials.fillMaterial.color.copy(
    locked ? hdr(PEARL, 1.5) : PEARL.clone().multiplyScalar(0.85),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(hdr(VIOLET_HOT, 1.4));
    materials.fillMaterial.color.copy(new Color(0.3, 0.08, 0.3));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
