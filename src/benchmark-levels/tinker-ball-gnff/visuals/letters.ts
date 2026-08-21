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
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BRASS, CREAM, hdr, WOOD_DARK } from './palette';

// START/REPLAY letters as wooden toy blocks: cream cell blocks with dark
// walnut edges, each cell tilted a hair like a hand-stamped tray of blocks.
// Locking turns the glyph hot brass.

const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.3, 0.3, 0.14);

export type LetterShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

export function createLetterMesh(char: string) {
  const cells = glyphOnCells(char);
  const group = new Group();
  const shardSpecs: LetterShardSpec[] = [];
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const jitter = ((index * 37) % 7 - 3) * 0.012;
    const matrix = new Matrix4()
      .makeRotationZ(jitter)
      .setPosition(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: CREAM.clone(), size: 0.3 });
  }

  const fillMaterial = createAdditiveBasicMaterial({ color: CREAM.clone().multiplyScalar(0.14) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(BRASS, 1.15) }));
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = BRASS.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, baseEdge: WOOD_DARK };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(BRASS, 2.0) : hdr(BRASS, 1.15));
  materials.fillMaterial.color.copy(locked ? BRASS.clone().multiplyScalar(0.3) : CREAM.clone().multiplyScalar(0.14));
}
