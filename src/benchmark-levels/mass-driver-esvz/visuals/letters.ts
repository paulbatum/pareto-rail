import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { ARC_BLUE, ARC_WHITE, COIL_DARK, hdr, PLAYER_CYAN, WARNING_RED } from './palette';
import { Vector3 } from 'three';

// Status-readout letters: 5×7 grids of charge-gauge segments on a dark
// instrument plate, like the breech console spelling out LAUNCH. The plate
// carries legibility with bloom at zero; the segments carry the glow.
const CELL = 0.32;
const cellGeometry = new BoxGeometry(0.26, 0.26, 0.09);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ShardSpec[] = [];
  const merged: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const x = cell.x * CELL - width / 2;
    const y = height / 2 - cell.y * CELL;
    merged.push(cellGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(x, y, 0)));
    const direction = Math.abs(x) + Math.abs(y) > 0.001 ? new Vector3(x, y, 0).normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: ARC_BLUE.clone(), size: 0.28 });
  }

  const cellMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.25) });
  const cellMesh = new Mesh(mergeGeometries(merged), cellMaterial);
  for (const geometry of merged) geometry.dispose();

  const plateMaterial = new MeshBasicMaterial({ color: COIL_DARK.clone().multiplyScalar(1.6) });
  const plate = new Mesh(new PlaneGeometry(width + CELL * 1.6, height + CELL * 1.6), plateMaterial);
  plate.position.z = -0.12;

  // Thin gauge rails top and bottom tie the plate into the readout language.
  const railMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.5) });
  for (const sign of [1, -1]) {
    const rail = new Mesh(new PlaneGeometry(width + CELL * 1.6, 0.05), railMaterial);
    rail.position.set(0, sign * (height / 2 + CELL * 0.9), -0.05);
    group.add(rail);
  }

  group.add(plate, cellMesh);
  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = ARC_BLUE.clone();
  group.userData.letterMaterials = { cellMaterial, plateMaterial, railMaterial };
  return group;
}

type LetterMaterials = { cellMaterial: MeshBasicMaterial; plateMaterial: MeshBasicMaterial; railMaterial: MeshBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.cellMaterial.color.copy(locked ? hdr(ARC_WHITE, 1.9) : hdr(ARC_BLUE, 1.25));
  materials.plateMaterial.color.copy(locked ? PLAYER_CYAN.clone().multiplyScalar(0.22) : COIL_DARK.clone().multiplyScalar(1.6));
  materials.railMaterial.color.copy(locked ? hdr(PLAYER_CYAN, 1.0) : hdr(ARC_BLUE, 0.5));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.cellMaterial.color.copy(hdr(WARNING_RED, 1.4));
    materials.plateMaterial.color.copy(new Color(0.16, 0.02, 0.01));
    materials.railMaterial.color.copy(hdr(WARNING_RED, 0.7));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
