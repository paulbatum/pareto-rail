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
import { CRIMSON_FIRE, CYAN_WINDOW, ICE_HULL, LOCK_GOLD, OBSIDIAN, PLAYER_WHITE, hdr } from './palette';

// Signal-flag stencils: 5×7 glyphs raised as pale ice studs on an obsidian
// plaque, framed by a cyan running-light border — the home fleet's own
// paint. A lock gilds the studs; a denied release drops the plaque to
// battle-stations red.

const CELL = 0.34;
const studGeometry = new BoxGeometry(0.27, 0.27, 0.14);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ShardSpec[] = [];
  const studs: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const x = cell.x * CELL - width / 2;
    const y = height / 2 - cell.y * CELL;
    studs.push(studGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(x, y, 0.08)));
    const length = Math.hypot(x, y, 1);
    shardSpecs.push({
      direction: new Vector3(x / length, y / length, 1 / length),
      color: ICE_HULL.clone(),
      size: 0.3,
    });
  }

  const studMaterial = new MeshBasicMaterial({ color: hdr(ICE_HULL, 1.0) });
  group.add(new Mesh(mergeGeometries(studs), studMaterial));
  for (const geometry of studs) geometry.dispose();

  const plateMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(1.5) });
  const plate = new Mesh(new BoxGeometry(width + 0.62, height + 0.62, 0.08), plateMaterial);
  group.add(plate);

  // Cyan border: four thin bars around the rim.
  const frameMaterial = createAdditiveBasicMaterial({ color: hdr(CYAN_WINDOW, 0.95) });
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
  group.userData.accent = CYAN_WINDOW.clone();
  group.userData.letterMaterials = { studMaterial, plateMaterial, frameMaterial };
  return group;
}

type LetterMaterials = { studMaterial: MeshBasicMaterial; plateMaterial: MeshBasicMaterial; frameMaterial: MeshBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.studMaterial.color.copy(locked ? hdr(LOCK_GOLD, 1.55) : hdr(ICE_HULL, 1.0));
  materials.frameMaterial.color.copy(locked ? hdr(PLAYER_WHITE, 1.25) : hdr(CYAN_WINDOW, 0.95));
  materials.plateMaterial.color.copy(locked ? new Color(0.16, 0.12, 0.03) : OBSIDIAN.clone().multiplyScalar(1.5));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.studMaterial.color.copy(hdr(CRIMSON_FIRE, 1.3));
    materials.frameMaterial.color.copy(hdr(CRIMSON_FIRE, 1.1));
    materials.plateMaterial.color.copy(new Color(0.15, 0.02, 0.02));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
