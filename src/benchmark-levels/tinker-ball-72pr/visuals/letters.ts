import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BRASS, BUTTON_RED, CREAM, hdr, WOOD_DARK } from './palette';

// Workshop letters: every glyph cell is a tiny cream button (a squat
// cylinder) with a dark pin-hole, mounted on a brass spool ring. Locking
// heats the buttons red, matching the projectile color.
const CELL_R = 0.15;
const CELL_H = 0.12;
const STEP = 0.5;
const LETTER_FILL = new Color(0.5, 0.42, 0.3);
const cellGeometry = new CylinderGeometry(CELL_R, CELL_R * 1.06, CELL_H, 12);

const holeGeometry = new CylinderGeometry(0.035, 0.035, CELL_H + 0.02, 6);

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character.toUpperCase() || '?');

  const buttons: BufferGeometry[] = [];
  const rims: BufferGeometry[] = [];
  const holes: BufferGeometry[] = [];
  for (const cell of cells) {
    const matrix = new Matrix4().makeTranslation((cell.x - 2) * STEP, (3 - cell.y) * STEP, 0);
    buttons.push(cellGeometry.clone().applyMatrix4(matrix));
    rims.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    holes.push(holeGeometry.clone().applyMatrix4(matrix));
  }

  // Dim amber-cream cells stay under the bloom threshold so glyphs read
  // as separate buttons instead of one white blob; lock heats them red.
  const fillMaterial = new MeshBasicMaterial({ color: LETTER_FILL.clone() });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(BRASS, 0.5) }));
  // Cylinder cells stand on Y; lay them flat so the buttons face the camera.
  const face = new Group();
  face.rotation.x = Math.PI / 2;
  if (buttons.length) {
    face.add(new Mesh(mergeGeometries(buttons), fillMaterial));
    face.add(new LineSegments(mergeGeometries(rims), edgeMaterial));
    face.add(new Mesh(mergeGeometries(holes), new MeshBasicMaterial({ color: WOOD_DARK.clone() })));
  }
  group.add(face);
  for (const geometry of [...buttons, ...rims, ...holes]) geometry.dispose();

  // Spool ring backing, like a button card.
  const ringMaterial = createAdditiveBasicMaterial({ color: hdr(BRASS, 0.55) });
  group.add(new Mesh(new TorusGeometry(1.8, 0.07, 8, 40), ringMaterial));

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  const shardSpecs = cells.map((cell) => {
    const offset = new Vector3((cell.x - 2) * STEP, (3 - cell.y) * STEP, 0);
    return {
      direction: offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1),
      color: CREAM.clone(),
      size: 0.24,
    };
  });

  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = CREAM.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, ringMaterial };
  group.userData.lockRingScale = 1.4;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; ringMaterial: MeshBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.fillMaterial.color.copy(locked ? BUTTON_RED.clone() : LETTER_FILL.clone());
  materials.edgeMaterial.color.copy(locked ? hdr(BUTTON_RED, 1.8) : hdr(BRASS, 0.5));
  materials.ringMaterial.color.copy(locked ? hdr(BUTTON_RED, 1.6) : hdr(BRASS, 0.55));
}

export function letterPlaceholderGeometry() {
  return new BoxGeometry(0.3, 0.3, 0.14);
}
