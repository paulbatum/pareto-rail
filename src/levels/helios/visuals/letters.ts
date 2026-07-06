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
  OctahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { COLD_BLUE, GOLD, hdr, ICE_WHITE, OBSIDIAN } from './palette';
import type { EmberSpec } from './effects';

// Solar brands: 5×7 glyphs built from flattened diamond plates — obsidian
// hearts with molten gold rims, like letters cooling out of a forge pour.
// Locking a brand quenches it to the player's cold blue.
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

const CELL = 0.34;
// A flattened octahedron reads as a faceted diamond plate face-on.
const cellGeometry = new OctahedronGeometry(0.21, 0);
cellGeometry.scale(1, 1, 0.35);

export function createLetterMesh(char: string) {
  const glyph = GLYPHS[char.toUpperCase()] ?? GLYPHS.I;
  const group = new Group();
  const shardSpecs: EmberSpec[] = [];
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
      const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
      shardSpecs.push({ direction, color: GOLD.clone(), size: 0.3 });
    }
  }

  const fillMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(2.2) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(GOLD, 1.25),
  }));
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = GOLD.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(ICE_WHITE, 1.6) : hdr(GOLD, 1.25));
  materials.fillMaterial.color.copy(
    locked ? COLD_BLUE.clone().multiplyScalar(0.3) : OBSIDIAN.clone().multiplyScalar(2.2),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(new Color(1.5, 0.12, 0.06));
    materials.fillMaterial.color.copy(new Color(0.3, 0.02, 0.01));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
