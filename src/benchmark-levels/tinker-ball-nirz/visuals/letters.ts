import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three';
import type { BufferGeometry, Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphRows } from '../../../engine/glyphs';
import { BUTTON, CARD, ERASER, LAMP_HOT, PAPER, PENCIL, STEEL, matte } from './palette';

// Words on this table are made the way a tinkerer would make them: paper chips
// pinned to a scrap of cardboard. Cell fills are opaque and light, the backing
// is dark kraft — the contrast, not glow, is what keeps them readable with the
// bloom slider at zero.

const CELL = 0.36;
const CELL_GEOMETRY = new BoxGeometry(0.32, 0.32, 0.2);
const PIN_GEOMETRY = new SphereGeometry(0.09, 8, 6);

type LetterMaterials = { chips: MeshLambertMaterial; backing: MeshLambertMaterial };

function tone(color: Color, emissive: number) {
  return new MeshLambertMaterial({
    color: color.clone(),
    emissive: color.clone().multiplyScalar(emissive),
    flatShading: true,
  });
}

export function createLetterMesh(character: string) {
  const rows = glyphRows(character) ?? glyphRows('A')!;
  const group = new Group();
  const width = 4 * CELL;
  const height = 6 * CELL;

  const cells: BufferGeometry[] = [];
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] !== '1') continue;
      const matrix = new Matrix4().makeTranslation(x * CELL - width / 2, height / 2 - y * CELL, 0.16);
      cells.push(CELL_GEOMETRY.clone().applyMatrix4(matrix));
    }
  }

  const chips = tone(PAPER, 0.42);
  const backing = tone(CARD, 0.16);
  const merged = mergeGeometries(cells);
  if (merged) group.add(new Mesh(merged, chips));
  for (const geometry of cells) geometry.dispose();

  const plate = new Mesh(new BoxGeometry(width + 0.62, height + 0.62, 0.16), backing);
  group.add(plate);
  const shadowPlate = new Mesh(new BoxGeometry(width + 0.9, height + 0.9, 0.1), matte(PENCIL, 0.18));
  shadowPlate.position.z = -0.14;
  group.add(shadowPlate);

  for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const pin = new Mesh(PIN_GEOMETRY, matte(STEEL, 0.3));
    pin.position.set(sx * (width / 2 + 0.2), sy * (height / 2 + 0.2), 0.16);
    group.add(pin);
  }

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.letterMaterials = { chips, backing } satisfies LetterMaterials;
  group.userData.lockFit = 1.5;
  group.userData.pieces = [
    { shape: 'plate', color: PAPER, size: 0.3 },
    { shape: 'plate', color: CARD, size: 0.34 },
    { shape: 'disc', color: PENCIL, size: 0.24 },
  ];
  return group;
}

/** A rejected word: the card goes sticky pink until the flash times out. */
export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.chips.color.copy(PAPER);
  materials.chips.emissive.copy(PAPER.clone().multiplyScalar(0.3));
  materials.backing.color.copy(ERASER);
  materials.backing.emissive.copy(ERASER.clone().multiplyScalar(0.5));
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.chips.color.copy(locked ? LAMP_HOT : PAPER);
  materials.chips.emissive.copy((locked ? LAMP_HOT : PAPER).clone().multiplyScalar(locked ? 0.9 : 0.42));
  materials.backing.color.copy(locked ? BUTTON : CARD);
  materials.backing.emissive.copy((locked ? BUTTON : CARD).clone().multiplyScalar(locked ? 0.4 : 0.16));
}
