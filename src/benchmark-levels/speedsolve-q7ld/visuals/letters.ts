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
import type { ChipSpec } from './effects';
import { CHAR_COLORS, CHASSIS_LIGHT, DENY_RED, HOT_WHITE, INK, SOLVE_COLORS, hdr } from './palette';

// Letters are miniature faces of the cube itself: a pale chassis plate
// carrying a 5×7 grid of raised sticker-cubies, each word colored one glyph
// per solve color. Locking a plate lights its cubies white-hot; a denied
// release drops the whole plate to warning red — an unsolvable state.

const CELL = 0.35;
const cubieGeometry = new BoxGeometry(0.28, 0.28, 0.26);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ChipSpec[] = [];
  const cubies: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;
  const solveColor = SOLVE_COLORS[CHAR_COLORS[char.toUpperCase()] ?? 0];

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.16);
    cubies.push(cubieGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: solveColor.clone(), size: 0.28 });
  }

  const cubieMaterial = new MeshBasicMaterial({ color: solveColor.clone() });
  group.add(new Mesh(mergeGeometries(cubies), cubieMaterial));
  for (const geometry of cubies) geometry.dispose();

  const plateMaterial = new MeshBasicMaterial({ color: CHASSIS_LIGHT.clone() });
  const plate = new Mesh(new BoxGeometry(width + 0.6, height + 0.6, 0.14), plateMaterial);
  group.add(plate);

  // Ink frame: four thin bars around the plate rim, drafting-mark precise.
  const frameMaterial = new MeshBasicMaterial({ color: INK.clone() });
  const frames: BufferGeometry[] = [];
  const fw = width + 0.74;
  const fh = height + 0.74;
  for (const [w, h, x, y] of [
    [fw, 0.09, 0, fh / 2],
    [fw, 0.09, 0, -fh / 2],
    [0.09, fh, fw / 2, 0],
    [0.09, fh, -fw / 2, 0],
  ] as const) {
    frames.push(new BoxGeometry(w, h, 0.1).applyMatrix4(new Matrix4().makeTranslation(x, y, 0.08)));
  }
  group.add(new Mesh(mergeGeometries(frames), frameMaterial));
  for (const geometry of frames) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = solveColor.clone();
  group.userData.letterMaterials = { cubieMaterial, plateMaterial, frameMaterial, solveColor };
  return group;
}

type LetterMaterials = {
  cubieMaterial: MeshBasicMaterial;
  plateMaterial: MeshBasicMaterial;
  frameMaterial: MeshBasicMaterial;
  solveColor: Color;
};

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.cubieMaterial.color.copy(locked ? hdr(HOT_WHITE, 1.5) : materials.solveColor);
  materials.frameMaterial.color.copy(locked ? materials.solveColor : INK);
  materials.plateMaterial.color.copy(locked ? CHASSIS_LIGHT.clone().multiplyScalar(1.12) : CHASSIS_LIGHT);
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.cubieMaterial.color.copy(hdr(DENY_RED, 1.3));
    materials.frameMaterial.color.copy(DENY_RED);
    materials.plateMaterial.color.copy(new Color(0.5, 0.3, 0.28));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
