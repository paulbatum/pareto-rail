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
import { AMBER, COLD_WHITE, GRAPHITE, HAZARD_ORANGE, PANEL_WHITE, SIGNAL_RED, hdr } from './palette';

// Stencilled service signage: 5×7 glyphs of raised white panel studs on a
// dark plate, framed by a hazard-orange border strip — the same paint
// language as the car and the station. Locking a plate lights the studs
// amber; a denied release drops the whole plate to warning red.

const CELL = 0.34;
const studGeometry = new BoxGeometry(0.26, 0.26, 0.12);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ShardSpec[] = [];
  const studs: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.07);
    studs.push(studGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: PANEL_WHITE.clone(), size: 0.3 });
  }

  const studMaterial = new MeshBasicMaterial({ color: hdr(PANEL_WHITE, 1.05) });
  group.add(new Mesh(mergeGeometries(studs), studMaterial));
  for (const geometry of studs) geometry.dispose();

  const plateMaterial = new MeshBasicMaterial({ color: GRAPHITE.clone().multiplyScalar(1.4) });
  const plate = new Mesh(new BoxGeometry(width + 0.62, height + 0.62, 0.08), plateMaterial);
  group.add(plate);

  // Hazard border strip: four thin bars around the plate rim.
  const frameMaterial = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 0.85) });
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
  group.userData.accent = HAZARD_ORANGE.clone();
  group.userData.letterMaterials = { studMaterial, plateMaterial, frameMaterial };
  return group;
}

type LetterMaterials = { studMaterial: MeshBasicMaterial; plateMaterial: MeshBasicMaterial; frameMaterial: MeshBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.studMaterial.color.copy(locked ? hdr(AMBER, 1.6) : hdr(PANEL_WHITE, 1.05));
  materials.frameMaterial.color.copy(locked ? hdr(COLD_WHITE, 1.2) : hdr(HAZARD_ORANGE, 0.85));
  materials.plateMaterial.color.copy(locked ? new Color(0.16, 0.1, 0.04) : GRAPHITE.clone().multiplyScalar(1.4));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.studMaterial.color.copy(hdr(SIGNAL_RED, 1.3));
    materials.frameMaterial.color.copy(hdr(SIGNAL_RED, 1.1));
    materials.plateMaterial.color.copy(new Color(0.14, 0.02, 0.01));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
