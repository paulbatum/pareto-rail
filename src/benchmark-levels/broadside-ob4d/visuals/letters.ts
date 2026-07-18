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
import { ALLY_CYAN, ALLY_HULL, ALLY_SHADOW, FOE_CRIMSON, NEBULA_GOLD, NEBULA_MAGENTA, WHITE_HOT, hdr } from './palette';

// LAUNCH and REARM are hangar-door signage off your own flagship: 5×7 grids of
// deck lamps recessed into an armour plate, and the plate wears the same two
// rim strips every hull in the level wears — magenta along the top edge, gold
// along the bottom. That is the whole reason the letters belong here: they are
// not a font, they are a piece of your ship.
//
// Unlit, the lamps are still ice-white geometry on a dark plate, so the words
// stay readable with bloom at zero. Locking runs them to cyan; a rejected
// release drops the whole plate to crimson — the enemy's colour, on your gear.

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
    shardSpecs.push({ direction, color: ALLY_HULL.clone(), size: 0.3 });
  }

  const lampMaterial = new MeshBasicMaterial({ color: hdr(ALLY_HULL, 1.35) });
  group.add(new Mesh(mergeGeometries(lamps), lampMaterial));
  for (const geometry of lamps) geometry.dispose();

  const plateMaterial = new MeshBasicMaterial({ color: ALLY_SHADOW.clone().multiplyScalar(0.55) });
  group.add(new Mesh(new BoxGeometry(width + 0.66, height + 0.66, 0.1), plateMaterial));

  // The level's rim grammar, at letter scale.
  const keyMaterial = createAdditiveBasicMaterial({ color: hdr(NEBULA_MAGENTA, 1.3) });
  const fillMaterial = createAdditiveBasicMaterial({ color: hdr(NEBULA_GOLD, 1.0) });
  const rimWidth = width + 0.84;
  const rimHeight = height + 0.84;
  const strip = (w: number, h: number, x: number, y: number) =>
    new BoxGeometry(w, h, 0.07).applyMatrix4(new Matrix4().makeTranslation(x, y, 0.06));
  group.add(new Mesh(
    mergeGeometries([strip(rimWidth, 0.09, 0, rimHeight / 2), strip(0.09, rimHeight * 0.5, -rimWidth / 2, rimHeight * 0.24)]),
    keyMaterial,
  ));
  group.add(new Mesh(
    mergeGeometries([strip(rimWidth, 0.09, 0, -rimHeight / 2), strip(0.09, rimHeight * 0.5, rimWidth / 2, -rimHeight * 0.24)]),
    fillMaterial,
  ));

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = ALLY_CYAN.clone();
  group.userData.lockRingScale = 1.5;
  group.userData.letterMaterials = { lampMaterial, plateMaterial, keyMaterial, fillMaterial };
  return group;
}

type LetterMaterials = {
  lampMaterial: MeshBasicMaterial;
  plateMaterial: MeshBasicMaterial;
  keyMaterial: MeshBasicMaterial;
  fillMaterial: MeshBasicMaterial;
};

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.lampMaterial.color.copy(locked ? hdr(ALLY_CYAN, 2.2) : hdr(ALLY_HULL, 1.35));
  materials.keyMaterial.color.copy(locked ? hdr(WHITE_HOT, 1.5) : hdr(NEBULA_MAGENTA, 1.3));
  materials.fillMaterial.color.copy(locked ? hdr(ALLY_CYAN, 1.3) : hdr(NEBULA_GOLD, 1.0));
  materials.plateMaterial.color.copy(locked ? new Color(0.04, 0.14, 0.2) : ALLY_SHADOW.clone().multiplyScalar(0.55));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.lampMaterial.color.copy(hdr(FOE_CRIMSON, 1.6));
  materials.keyMaterial.color.copy(hdr(FOE_CRIMSON, 1.3));
  materials.fillMaterial.color.copy(hdr(FOE_CRIMSON, 0.9));
  materials.plateMaterial.color.copy(new Color(0.16, 0.02, 0.02));
}
