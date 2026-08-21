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
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { GLYPH_GRIDS, type GlyphRows } from '../../../engine/glyphs';
import { BRASS_METAL, BUTTON_YELLOW, hdr, LOCK_COLOR, WOOD_BASE, WOOD_PLANK } from './palette';

const CELL_SIZE = 0.32;
const CELL_DEPTH = 0.22;
const cellGeometry = new BoxGeometry(CELL_SIZE * 0.92, CELL_SIZE * 0.92, CELL_DEPTH);
const blockBackdropGeometry = new BoxGeometry(CELL_SIZE * 5.6, CELL_SIZE * 7.6, CELL_DEPTH * 0.8);

export function createLetterMesh(char: string) {
  const upper = char.toUpperCase();
  const glyph = (GLYPH_GRIDS as Record<string, GlyphRows>)[upper] ?? GLYPH_GRIDS.A;
  const group = new Group();

  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL_SIZE;
  const height = 6 * CELL_SIZE;

  // Wood block backplate
  const blockMat = new MeshBasicMaterial({ color: WOOD_PLANK.clone().multiplyScalar(0.7) });
  const blockMesh = new Mesh(blockBackdropGeometry, blockMat);
  blockMesh.position.set(0, 0, -CELL_DEPTH * 0.45);
  group.add(blockMesh);

  // Painted letter cells on top
  for (let y = 0; y < glyph.length; y += 1) {
    for (let x = 0; x < glyph[y].length; x += 1) {
      if (glyph[y][x] !== '1') continue;
      const offset = new Vector3(x * CELL_SIZE - width / 2, height / 2 - y * CELL_SIZE, CELL_DEPTH * 0.1);
      const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
      fills.push(cellGeometry.clone().applyMatrix4(matrix));
      edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    }
  }

  const fillMaterial = createAdditiveBasicMaterial({ color: BUTTON_YELLOW.clone().multiplyScalar(0.7) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(BRASS_METAL, 1.4) }));

  if (fills.length > 0) {
    const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
    const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
    group.add(fillMesh, edgeLines);

    for (const g of fills) g.dispose();
    for (const g of edges) g.dispose();
  }

  group.userData.isLetter = true;
  group.userData.letter = upper;
  group.userData.letterMaterials = { blockMat, fillMaterial, edgeMaterial };

  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { blockMat: MeshBasicMaterial; fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;

  if (locked) {
    materials.edgeMaterial.color.copy(hdr(LOCK_COLOR, 1.8));
    materials.fillMaterial.color.copy(hdr(BUTTON_YELLOW, 1.4));
    materials.blockMat.color.copy(WOOD_BASE.clone().multiplyScalar(1.2));
  } else {
    materials.edgeMaterial.color.copy(hdr(BRASS_METAL, 1.4));
    materials.fillMaterial.color.copy(BUTTON_YELLOW.clone().multiplyScalar(0.7));
    materials.blockMat.color.copy(WOOD_PLANK.clone().multiplyScalar(0.7));
  }
}
