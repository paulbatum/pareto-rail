import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells, glyphRows } from '../../../engine/glyphs';
import { HOT_WHITE, MACHINE_DARK, MACHINE_WHITE, solveColor } from './palette';

// Letters in the cube's own language: a 5x7 grid of candy cubies pressed into a
// dark machined tile with a pale bezel. The tile is deliberately the darkest thing
// in a pale frame, so the glyph reads by contrast rather than by glow — it is
// exactly as legible with the bloom slider at zero.

const CELL = 0.4;
const CAP_DEPTH = 0.16;
const capGeometry = new BoxGeometry(CELL * 0.82, CELL * 0.82, CAP_DEPTH);

export type LetterRecord = {
  capMaterial: MeshLambertMaterial;
  bezelMaterial: MeshLambertMaterial;
  baseColor: Color;
};

export function createLetterMesh(character: string, index = 0) {
  const group = new Group();
  const rows = glyphRows(character) ?? glyphRows('A');
  const cells = glyphOnCells(character);
  const width = (rows?.[0].length ?? 5) * CELL;
  const height = (rows?.length ?? 7) * CELL;

  const baseColor = solveColor(index).clone();
  const capMaterial = new MeshLambertMaterial({
    color: baseColor,
    emissive: baseColor.clone().multiplyScalar(0.34),
    flatShading: true,
  });
  const plateMaterial = new MeshLambertMaterial({
    color: MACHINE_DARK,
    emissive: MACHINE_DARK.clone().multiplyScalar(0.25),
    flatShading: true,
  });
  const bezelMaterial = new MeshLambertMaterial({
    color: MACHINE_WHITE,
    emissive: MACHINE_WHITE.clone().multiplyScalar(0.12),
    flatShading: true,
  });

  const capParts = cells.map((cell) => capGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(
    (cell.x - 2) * CELL,
    (3 - cell.y) * CELL,
    CAP_DEPTH,
  )));
  const caps = new Mesh(mergeGeometries(capParts), capMaterial);
  for (const part of capParts) part.dispose();

  const plateWidth = width + CELL * 0.7;
  const plateHeight = height + CELL * 0.7;
  const plate = new Mesh(new BoxGeometry(plateWidth, plateHeight, 0.26), plateMaterial);
  plate.position.z = -0.05;

  // Four bezel rails. They give the tile a machined edge and, when locked, they
  // are what flashes — the glyph itself never changes shape.
  const bezelParts: BufferGeometry[] = [];
  const rail = 0.14;
  for (const [x, y] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    bezelParts.push(new BoxGeometry(
      x === 0 ? plateWidth + rail * 2 : rail,
      y === 0 ? plateHeight + rail * 2 : rail,
      0.3,
    ).translate(x * (plateWidth / 2 + rail / 2), y * (plateHeight / 2 + rail / 2), 0));
  }
  const bezel = new Mesh(mergeGeometries(bezelParts), bezelMaterial);
  for (const part of bezelParts) part.dispose();

  group.add(plate, bezel, caps);
  group.userData.isLetter = true;
  group.userData.letter = character;
  group.userData.letterRecord = { capMaterial, bezelMaterial, baseColor } satisfies LetterRecord;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const record = group.userData.letterRecord as LetterRecord | undefined;
  if (!record) return;
  const target = locked ? HOT_WHITE : record.baseColor;
  record.capMaterial.color.copy(target);
  record.capMaterial.emissive.copy(target).multiplyScalar(locked ? 0.85 : 0.34);
  record.bezelMaterial.emissive.copy(locked ? HOT_WHITE : MACHINE_WHITE).multiplyScalar(locked ? 1.5 : 0.12);
  group.scale.setScalar(locked ? 1.08 : 1);
}

export function setLetterDenied(group: Group, denied: boolean) {
  const record = group.userData.letterRecord as LetterRecord | undefined;
  if (!record) return;
  record.bezelMaterial.color.copy(denied ? MACHINE_DARK : MACHINE_WHITE);
  record.bezelMaterial.emissive.copy(MACHINE_WHITE).multiplyScalar(denied ? 0.02 : 0.12);
}
