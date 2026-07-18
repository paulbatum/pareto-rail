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
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { CRIMSON, CYAN, hdr, ICE, OBSIDIAN } from './palette';
import type { WreckSpec } from './effects';

// Deck signal plaques: 5×7 glyphs of armored hull cells, ice-faced with a
// cyan rim — flight-deck status boards floated into space. Locking one
// floods it with your own engine light; a rejected release runs them crimson.
const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.27, 0.27, 0.1);

export function createLetterMesh(char: string) {
  const cells = glyphOnCells(char);
  const group = new Group();
  const shardSpecs: WreckSpec[] = [];
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: CYAN.clone(), size: 0.3 });
  }

  const fillMaterial = new MeshBasicMaterial({ color: ICE.clone().multiplyScalar(0.16) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(CYAN, 1.2),
  }));
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = CYAN.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(ICE, 1.7) : hdr(CYAN, 1.2));
  materials.fillMaterial.color.copy(
    locked ? CYAN.clone().multiplyScalar(0.4) : ICE.clone().multiplyScalar(0.16),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(new Color(1.5, 0.12, 0.08));
    materials.fillMaterial.color.copy(CRIMSON.clone().multiplyScalar(0.22));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}

export { OBSIDIAN };
