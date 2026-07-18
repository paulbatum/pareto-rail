import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { CRIMSON, FRIEND_CYAN, ICE_SHADOW, ICE_WHITE, NEBULA_GOLD, hdr } from './palette';

// Letters are your own fleet's signal boards: a dark recessed plate carried on
// an ice-white frame, with the glyph punched through as cyan light-cells and a
// gold rail top and bottom. Same paint as the friendly capital ships behind
// them, so the attract screen already tells you which side you are on. The
// cells are solid emissive geometry, not a bloom trick — they read at bloom
// zero as bright cyan squares against a near-black plate.

const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.27, 0.27, 0.16);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ShardSpec[] = [];
  const lit: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.1);
    lit.push(cellGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: FRIEND_CYAN.clone(), size: 0.28 });
  }

  const cellMaterial = new MeshBasicMaterial({ color: hdr(FRIEND_CYAN, 1.35) });
  group.add(new Mesh(mergeGeometries(lit), cellMaterial));
  for (const geometry of lit) geometry.dispose();

  const plateMaterial = new MeshBasicMaterial({ color: ICE_SHADOW.clone().multiplyScalar(0.34) });
  group.add(new Mesh(new BoxGeometry(width + 0.6, height + 0.6, 0.1), plateMaterial));

  // Ice-white frame with gold deck rails: the fleet's own signage.
  const frameMaterial = new MeshBasicMaterial({ color: hdr(ICE_WHITE, 0.7) });
  const frames: BufferGeometry[] = [];
  const fw = width + 0.82;
  const fh = height + 0.82;
  for (const [w, h, x, y] of [
    [0.1, fh, fw / 2, 0],
    [0.1, fh, -fw / 2, 0],
  ] as const) {
    frames.push(new BoxGeometry(w, h, 0.14).applyMatrix4(new Matrix4().makeTranslation(x, y, 0.04)));
  }
  group.add(new Mesh(mergeGeometries(frames), frameMaterial));
  for (const geometry of frames) geometry.dispose();

  const railMaterial = createAdditiveBasicMaterial({ color: hdr(NEBULA_GOLD, 0.85) });
  const rails: BufferGeometry[] = [];
  for (const y of [fh / 2, -fh / 2]) {
    rails.push(new BoxGeometry(fw, 0.09, 0.12).applyMatrix4(new Matrix4().makeTranslation(0, y, 0.06)));
  }
  group.add(new Mesh(mergeGeometries(rails), railMaterial));
  for (const geometry of rails) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = FRIEND_CYAN.clone();
  group.userData.letterMaterials = { cellMaterial, plateMaterial, frameMaterial, railMaterial };
  return group;
}

type LetterMaterials = {
  cellMaterial: MeshBasicMaterial;
  plateMaterial: MeshBasicMaterial;
  frameMaterial: MeshBasicMaterial;
  railMaterial: MeshBasicMaterial;
};

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  // Locking runs the board hot: cells go gold, the plate warms behind them.
  materials.cellMaterial.color.copy(locked ? hdr(NEBULA_GOLD, 1.9) : hdr(FRIEND_CYAN, 1.35));
  materials.railMaterial.color.copy(locked ? hdr(ICE_WHITE, 1.5) : hdr(NEBULA_GOLD, 0.85));
  materials.plateMaterial.color.copy(locked ? new Color(0.14, 0.09, 0.02) : ICE_SHADOW.clone().multiplyScalar(0.34));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.cellMaterial.color.copy(hdr(CRIMSON, 1.5));
  materials.railMaterial.color.copy(hdr(CRIMSON, 1.1));
  materials.frameMaterial.color.copy(hdr(CRIMSON, 0.5));
  materials.plateMaterial.color.copy(new Color(0.13, 0.012, 0.015));
}

export function clearLetterDenied(group: Group) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.frameMaterial.color.copy(hdr(ICE_WHITE, 0.7));
  setLetterLocked(group, group.userData.locked === true);
}
