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
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  DENIED_FILL,
  DENIED_RED,
  FRIENDLY_CYAN,
  FRIENDLY_CYAN_HOT,
  FRIENDLY_WHITE,
  hdr,
  LOCK_COLOR,
  VOID_BLACK,
} from './palette';

// START / REPLAY words: LAUNCH / ENGAGE
// Stenciled military armor plaques with cyan backlighting and razor-sharp borders.
// High contrast ensures clear legibility at distance with bloom slider at zero.

const CELL = 0.36;
const cellGeometry = new BoxGeometry(CELL * 0.9, CELL * 0.9, CELL * 0.28);

export type LetterMaterials = {
  fillMaterial: MeshBasicMaterial;
  edgeMaterial: LineBasicMaterial;
};

export function createLetterMesh(char = 'L') {
  const cells = glyphOnCells(char);
  const group = new Group();
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
  }

  const mergedFills = mergeGeometries(fills);
  const mergedEdges = mergeGeometries(edges);

  const fillMaterial = new MeshBasicMaterial({ color: FRIENDLY_WHITE.clone().multiplyScalar(0.7) });
  const edgeMaterial = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(FRIENDLY_CYAN, 1.4) }),
  );

  const fillMesh = new Mesh(mergedFills, fillMaterial);
  const edgeLines = new LineSegments(mergedEdges, edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const g of fills) g.dispose();
  for (const g of edges) g.dispose();

  group.userData.raildRole = 'target';
  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial } satisfies LetterMaterials;

  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (locked) {
    materials.edgeMaterial.color.copy(hdr(LOCK_COLOR, 1.8));
    materials.fillMaterial.color.copy(hdr(FRIENDLY_CYAN_HOT, 1.2));
  } else {
    materials.edgeMaterial.color.copy(hdr(FRIENDLY_CYAN, 1.4));
    materials.fillMaterial.color.copy(FRIENDLY_WHITE.clone().multiplyScalar(0.7));
  }
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(hdr(DENIED_RED, 1.8));
    materials.fillMaterial.color.copy(DENIED_FILL.clone());
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
