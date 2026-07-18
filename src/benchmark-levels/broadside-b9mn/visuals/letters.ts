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
import { CRIMSON, CYAN, COLD_WHITE, ICE_SHADOW, ICE_WHITE, hdr } from './palette';

// Flight-deck signage: 5×7 glyphs of lit ice-white blocks on a dark naval
// plate, framed by a thin cyan light strip — the launch bay's own projection.
// Locking a plate charges the blocks cyan; a denied release drops the whole
// plate to crimson, the enemy's color, for one beat.

const CELL = 0.34;
const blockGeometry = new BoxGeometry(0.27, 0.27, 0.1);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ShardSpec[] = [];
  const blocks: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.07);
    blocks.push(blockGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: ICE_WHITE.clone(), size: 0.3 });
  }

  const blockMaterial = new MeshBasicMaterial({ color: hdr(ICE_WHITE, 1.1) });
  group.add(new Mesh(mergeGeometries(blocks), blockMaterial));
  for (const geometry of blocks) geometry.dispose();

  const plateMaterial = new MeshBasicMaterial({ color: ICE_SHADOW.clone().multiplyScalar(0.5) });
  const plate = new Mesh(new BoxGeometry(width + 0.62, height + 0.62, 0.08), plateMaterial);
  group.add(plate);

  // Cyan light strip around the plate rim.
  const frameMaterial = createAdditiveBasicMaterial({ color: hdr(CYAN, 0.9) });
  const frames: BufferGeometry[] = [];
  const fw = width + 0.78;
  const fh = height + 0.78;
  for (const [w, h, x, y] of [
    [fw, 0.08, 0, fh / 2],
    [fw, 0.08, 0, -fh / 2],
    [0.08, fh, fw / 2, 0],
    [0.08, fh, -fw / 2, 0],
  ] as const) {
    frames.push(new BoxGeometry(w, h, 0.06).applyMatrix4(new Matrix4().makeTranslation(x, y, 0.05)));
  }
  group.add(new Mesh(mergeGeometries(frames), frameMaterial));
  for (const geometry of frames) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = CYAN.clone();
  group.userData.letterMaterials = { blockMaterial, plateMaterial, frameMaterial };
  return group;
}

type LetterMaterials = { blockMaterial: MeshBasicMaterial; plateMaterial: MeshBasicMaterial; frameMaterial: MeshBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.blockMaterial.color.copy(locked ? hdr(CYAN, 1.7) : hdr(ICE_WHITE, 1.1));
  materials.frameMaterial.color.copy(locked ? hdr(COLD_WHITE, 1.3) : hdr(CYAN, 0.9));
  materials.plateMaterial.color.copy(locked ? new Color(0.03, 0.1, 0.13) : ICE_SHADOW.clone().multiplyScalar(0.5));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.blockMaterial.color.copy(hdr(CRIMSON, 1.4));
    materials.frameMaterial.color.copy(hdr(CRIMSON, 1.1));
    materials.plateMaterial.color.copy(new Color(0.12, 0.015, 0.01));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
