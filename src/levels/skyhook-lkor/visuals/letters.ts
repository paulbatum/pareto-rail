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
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { glyphOnCells } from '../../../engine/glyphs';
import { DENY_RED, HAZARD_ORANGE, hdr, MARK_HOT, PANEL_SHADE, PANEL_WHITE } from './palette';
import type { ShardSpec } from './effects';

// Cargo stenciling: each glyph cell is a small white panel tile with thin dark
// seams, mounted on a floating hazard-orange-edged plate — the same stencils the
// climber wears on its hull. Locking flips the tiles orange and drops corner
// brackets; a denied release flickers them red. Legible at distance, bloom 0.

const CELL = 0.34;
const TILE = 0.28; // sub-cell so the dark backing plate reads as seams
const COLS = 5;
const ROWS = 7;

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const width = (COLS - 1) * CELL;
  const height = (ROWS - 1) * CELL;

  const tileGeometry = new BoxGeometry(TILE, TILE, 0.1);
  const tiles: BufferGeometry[] = [];
  const shardSpecs: ShardSpec[] = [];
  for (const cell of cells) {
    const x = cell.x * CELL - width / 2;
    const y = height / 2 - cell.y * CELL;
    tiles.push(tileGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(x, y, 0.06)));
    const direction = new Vector3(x, y, 0.3);
    shardSpecs.push({ direction: direction.lengthSq() > 0.0001 ? direction.normalize() : new Vector3(0, 0, 1), color: PANEL_WHITE.clone(), size: 0.3 });
  }
  tileGeometry.dispose();

  const tileMaterial = new MeshBasicMaterial({ color: PANEL_WHITE.clone() });
  const tileMesh = new Mesh(tiles.length > 0 ? mergeGeometries(tiles) : new BoxGeometry(0.01, 0.01, 0.01), tileMaterial);
  for (const geometry of tiles) geometry.dispose();
  group.add(tileMesh);

  // Backing plate — dark, so the gaps between tiles read as seams.
  const plateMaterial = new MeshBasicMaterial({ color: PANEL_SHADE.clone().multiplyScalar(0.5) });
  const plateGeometry = new BoxGeometry(width + CELL * 1.4, height + CELL * 1.4, 0.08);
  const plate = new Mesh(plateGeometry, plateMaterial);
  group.add(plate);

  // Glowing hazard-orange edge frame around the plate.
  const plateEdgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(HAZARD_ORANGE, 1.6) }));
  group.add(new LineSegments(new EdgesGeometry(plateGeometry), plateEdgeMaterial));

  // Corner brackets, revealed on lock.
  const brackets = new Group();
  const bracketMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(HAZARD_ORANGE, 1.8) }));
  const bx = width / 2 + CELL * 0.9;
  const by = height / 2 + CELL * 0.9;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const horizontal = new Mesh(new BoxGeometry(CELL * 0.7, 0.06, 0.06), bracketMaterial);
      horizontal.position.set(sx * (bx - CELL * 0.35), sy * by, 0.1);
      const vertical = new Mesh(new BoxGeometry(0.06, CELL * 0.7, 0.06), bracketMaterial);
      vertical.position.set(sx * bx, sy * (by - CELL * 0.35), 0.1);
      brackets.add(horizontal, vertical);
    }
  }
  brackets.visible = false;
  group.add(brackets);

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = HAZARD_ORANGE.clone();
  group.userData.letterMaterials = { tileMaterial, plateEdgeMaterial, bracketMaterial, brackets };
  group.userData.lockRingScale = 1.4;
  return group;
}

type LetterMaterials = {
  tileMaterial: MeshBasicMaterial;
  plateEdgeMaterial: LineBasicMaterial;
  bracketMaterial: MeshBasicMaterial;
  brackets: Group;
};

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.tileMaterial.color.copy(locked ? hdr(MARK_HOT, 1.5) : PANEL_WHITE);
  materials.plateEdgeMaterial.color.copy(hdr(HAZARD_ORANGE, locked ? 2.2 : 1.6));
  materials.brackets.visible = locked;
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.tileMaterial.color.copy(DENY_RED);
    materials.plateEdgeMaterial.color.copy(DENY_RED);
    materials.brackets.visible = false;
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
