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
import { COLD_WHITE, CRIMSON, CYAN, ICE_SHADOW, ICE_WHITE, MOLTEN, hdr } from './palette';

// LAUNCH / AGAIN are painted the way your own flagship paints its deck: 5×7
// grids of recessed cyan runway lamps set into ice-white armor plate, with a
// launch-lane chevron down each side. Locking a plate runs the lamps up to
// gold; a blocked release drops the whole plate to crimson — the enemy color,
// which is the point.

const CELL = 0.36;
const lampGeometry = new BoxGeometry(0.27, 0.27, 0.14);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ShardSpec[] = [];
  const lamps: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.09);
    lamps.push(lampGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: CYAN.clone(), size: 0.3 });
  }

  const lampMaterial = new MeshBasicMaterial({ color: hdr(CYAN, 1.5) });
  group.add(new Mesh(mergeGeometries(lamps), lampMaterial));
  for (const geometry of lamps) geometry.dispose();

  const plateMaterial = new MeshBasicMaterial({ color: ICE_SHADOW.clone().multiplyScalar(0.55) });
  group.add(new Mesh(new BoxGeometry(width + 0.7, height + 0.7, 0.1), plateMaterial));

  // Launch-lane chevrons: two thick bars down the sides, two thin caps.
  const trimMaterial = new MeshBasicMaterial({ color: hdr(ICE_WHITE, 0.95) });
  const trim: BufferGeometry[] = [];
  const fw = width + 0.88;
  const fh = height + 0.88;
  for (const [w, h, x, y] of [
    [0.16, fh, fw / 2, 0],
    [0.16, fh, -fw / 2, 0],
    [fw, 0.07, 0, fh / 2],
    [fw, 0.07, 0, -fh / 2],
  ] as const) {
    trim.push(new BoxGeometry(w, h, 0.08).applyMatrix4(new Matrix4().makeTranslation(x, y, 0.06)));
  }
  group.add(new Mesh(mergeGeometries(trim), trimMaterial));
  for (const geometry of trim) geometry.dispose();

  // A soft glow slab behind the lamps so the glyph still reads with bloom off
  // is deliberately NOT used — the lamps carry their own base color. This thin
  // additive rim only sweetens the frame when bloom is on.
  const rimMaterial = createAdditiveBasicMaterial({ color: hdr(CYAN, 0.5), opacity: 0.5 });
  const rim = new Mesh(new BoxGeometry(fw + 0.14, fh + 0.14, 0.02), rimMaterial);
  rim.position.z = -0.06;
  group.add(rim);

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = CYAN.clone();
  group.userData.letterMaterials = { lampMaterial, plateMaterial, trimMaterial, rimMaterial };
  return group;
}

type LetterMaterials = {
  lampMaterial: MeshBasicMaterial;
  plateMaterial: MeshBasicMaterial;
  trimMaterial: MeshBasicMaterial;
  rimMaterial: MeshBasicMaterial;
};

const LOCK_GOLD = new Color(1.0, 0.78, 0.3);

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.lampMaterial.color.copy(locked ? hdr(LOCK_GOLD, 1.9) : hdr(CYAN, 1.5));
  materials.trimMaterial.color.copy(locked ? hdr(COLD_WHITE, 1.4) : hdr(ICE_WHITE, 0.95));
  materials.plateMaterial.color.copy(locked ? new Color(0.2, 0.15, 0.06) : ICE_SHADOW.clone().multiplyScalar(0.55));
  materials.rimMaterial.color.copy(locked ? hdr(MOLTEN, 0.4) : hdr(CYAN, 0.5));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.lampMaterial.color.copy(hdr(CRIMSON, 1.6));
  materials.trimMaterial.color.copy(hdr(CRIMSON, 0.9));
  materials.plateMaterial.color.copy(new Color(0.16, 0.02, 0.03));
  materials.rimMaterial.color.copy(hdr(CRIMSON, 0.6));
}
