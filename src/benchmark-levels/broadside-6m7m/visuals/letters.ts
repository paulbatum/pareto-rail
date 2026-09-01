import { BoxGeometry, BufferGeometry, Color, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { CRIMSON, CYAN, hdr, ICE, OBSIDIAN } from './palette';
import type { ShardSpec } from './effects';

// Signal plaques: 5×7 glyphs of ice-white armour cells on a dark hull plate,
// rimmed in cyan like a friendly running light. Locking one charges the
// cells cyan; a rejected release burns them crimson.
const CELL = 0.33;
const cellGeometry = new BoxGeometry(0.26, 0.26, 0.16);

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells: BufferGeometry[] = [];
  const shardSpecs: ShardSpec[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;
  for (const cell of glyphOnCells(character)) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.12);
    cells.push(cellGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: ICE.clone(), size: 0.25 });
  }
  const cellMaterial = new MeshBasicMaterial({ color: ICE.clone().multiplyScalar(1.15) });
  const cellMesh = new Mesh(mergeGeometries(cells), cellMaterial);
  for (const geometry of cells) geometry.dispose();

  const plateGeometry = new BoxGeometry(width + 0.7, height + 0.7, 0.12);
  const plateMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(1.4) });
  const plate = new Mesh(plateGeometry, plateMaterial);
  const rimMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(CYAN, 1.2) }));
  const rim = new LineSegments(new EdgesGeometry(plateGeometry), rimMaterial);

  group.add(plate, rim, cellMesh);
  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = CYAN.clone();
  group.userData.letterMaterials = { cellMaterial, plateMaterial, rimMaterial };
  return group;
}

type LetterMaterials = { cellMaterial: MeshBasicMaterial; plateMaterial: MeshBasicMaterial; rimMaterial: LineBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.cellMaterial.color.copy(locked ? hdr(CYAN, 1.9) : ICE.clone().multiplyScalar(1.15));
  materials.plateMaterial.color.copy(locked ? CYAN.clone().multiplyScalar(0.18) : OBSIDIAN.clone().multiplyScalar(1.4));
  materials.rimMaterial.color.copy(locked ? hdr(ICE, 1.8) : hdr(CYAN, 1.2));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.cellMaterial.color.copy(hdr(CRIMSON, 1.6));
    materials.plateMaterial.color.copy(new Color(0.25, 0.02, 0.02));
    materials.rimMaterial.color.copy(hdr(CRIMSON, 1.4));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
