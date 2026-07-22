import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { BONE, GRAPHITE, HOT_WHITE, INK, MACHINE_GREY, SOLVE_COLORS, hdr } from './palette';

// SOLVE / AGAIN are set as cube stickers: a graphite tile with a 5x7 grid of
// raised bone studs and a solve-colored rim, one color per letter so the word
// itself spells out the palette. Locking lights the studs white; a refused
// release drains the whole tile to dead graphite — the machine going dark is
// this level's "no", because every warning color is already spoken for.

const CELL = 0.46;
const STUD = new BoxGeometry(0.38, 0.38, 0.2);

type LetterMaterials = {
  stud: MeshBasicMaterial;
  tile: MeshBasicMaterial;
  rim: MeshBasicMaterial;
  hue: number;
};

export function createLetterMesh(character: string, index: number) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const width = 4 * CELL;
  const height = 6 * CELL;
  const hue = index % SOLVE_COLORS.length;

  const studs: BufferGeometry[] = [];
  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.16);
    studs.push(STUD.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
  }
  const stud = new MeshBasicMaterial({ color: hdr(BONE, 1.15) });
  const merged = mergeGeometries(studs);
  if (merged) group.add(new Mesh(merged, stud));
  for (const geometry of studs) geometry.dispose();

  const tile = new MeshBasicMaterial({ color: GRAPHITE.clone().multiplyScalar(1.5) });
  group.add(new Mesh(new BoxGeometry(width + 0.72, height + 0.72, 0.22), tile));

  const rim = new MeshBasicMaterial({ color: hdr(SOLVE_COLORS[hue], 1.25) });
  const frames: BufferGeometry[] = [];
  const fw = width + 0.94;
  const fh = height + 0.94;
  for (const [w, h, x, y] of [
    [fw, 0.13, 0, fh / 2],
    [fw, 0.13, 0, -fh / 2],
    [0.13, fh, fw / 2, 0],
    [0.13, fh, -fw / 2, 0],
  ] as const) {
    frames.push(new BoxGeometry(w, h, 0.24).applyMatrix4(new Matrix4().makeTranslation(x, y, 0.09)));
  }
  const rimMesh = mergeGeometries(frames);
  if (rimMesh) group.add(new Mesh(rimMesh, rim));
  for (const geometry of frames) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.accent = SOLVE_COLORS[hue].clone();
  group.userData.letterMaterials = { stud, tile, rim, hue } satisfies LetterMaterials;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.stud.color.copy(locked ? hdr(HOT_WHITE, 2.1) : hdr(BONE, 1.15));
  materials.tile.color.copy(locked ? INK.clone().multiplyScalar(1.2) : GRAPHITE.clone().multiplyScalar(1.5));
  materials.rim.color.copy(hdr(SOLVE_COLORS[materials.hue], locked ? 2.4 : 1.25));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.stud.color.copy(MACHINE_GREY.clone().multiplyScalar(0.35));
  materials.tile.color.copy(INK.clone().multiplyScalar(0.6));
  materials.rim.color.copy(MACHINE_GREY.clone().multiplyScalar(0.4));
}
