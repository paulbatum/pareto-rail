import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { glyphOnCells } from '../../../engine/glyphs';
import { ARC_BLUE, ARC_VIOLET, BORE_PLATE, DANGER, WHITE_HOT, hdr } from './palette';

// Letters are built the way the barrel is: every lit cell of the 5×7 grid is a
// capacitor tab — a dark plate slug with an arc filament burning across its
// face — held inside a hexagonal containment frame. Reading them is the same
// skill as reading the accelerator: dark metal, bright electrical line.

const CELL = 0.36;
const COLUMNS = 5;
const ROWS = 7;

const slugGeometry = new BoxGeometry(CELL * 0.86, CELL * 0.86, CELL * 0.3);
const filamentGeometry = new BoxGeometry(CELL * 0.62, CELL * 0.13, CELL * 0.06);

export type LetterMaterials = {
  slug: MeshBasicMaterial;
  filament: MeshBasicMaterial;
  frame: MeshBasicMaterial;
};

export function createLetterMesh(character: string) {
  const cells = glyphOnCells(character);
  const group = new Group();
  const slugs: BufferGeometry[] = [];
  const filaments: BufferGeometry[] = [];

  for (const cell of cells) {
    const x = (cell.x - (COLUMNS - 1) / 2) * CELL;
    const y = ((ROWS - 1) / 2 - cell.y) * CELL;
    slugs.push(slugGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(x, y, 0)));
    filaments.push(filamentGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(x, y, CELL * 0.19)));
  }

  const slugMaterial = new MeshBasicMaterial({ color: BORE_PLATE.clone().multiplyScalar(3.4) });
  const filamentMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 2.1) });
  const frameMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.9), side: DoubleSide, opacity: 0.85 });

  if (slugs.length > 0) {
    group.add(new Mesh(mergeGeometries(slugs), slugMaterial));
    group.add(new Mesh(mergeGeometries(filaments), filamentMaterial));
    for (const geometry of [...slugs, ...filaments]) geometry.dispose();
  }

  // Containment frame: a hex, because every aperture in this barrel is a hex.
  const frame = new Mesh(new RingGeometry(1.44, 1.53, 6, 1), frameMaterial);
  frame.rotation.z = Math.PI / 6;
  group.add(frame);

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.accent = ARC_BLUE.clone();
  group.userData.letterMaterials = { slug: slugMaterial, filament: filamentMaterial, frame: frameMaterial } satisfies LetterMaterials;
  return group;
}

const LOCKED_SLUG = new Color(0.1, 0.06, 0.2);
const DENIED_SLUG = new Color(0.24, 0.02, 0.015);

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.slug.color.copy(locked ? LOCKED_SLUG : BORE_PLATE.clone().multiplyScalar(3.4));
  materials.filament.color.copy(locked ? hdr(WHITE_HOT, 2.6) : hdr(ARC_BLUE, 2.1));
  materials.frame.color.copy(locked ? hdr(ARC_VIOLET, 1.8) : hdr(ARC_BLUE, 0.9));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  // A tripped breaker: the filament dies and only the fault lamp is left.
  materials.slug.color.copy(DENIED_SLUG);
  materials.filament.color.copy(hdr(DANGER, 1.4));
  materials.frame.color.copy(hdr(DANGER, 1.1));
}
