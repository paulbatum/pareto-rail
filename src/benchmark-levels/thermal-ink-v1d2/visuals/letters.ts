import {
  BoxGeometry,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { CREAM, hdr, IR_HOT, OIL, SEA_GLASS, SIGNAL_RED, SODIUM } from './palette';
import type { DebrisSpec } from './effects';

// START/REPLAY as drowned harbor signage: riveted steel plates with sodium
// lamp edges. Locking quenches a brand to the player's sea-glass; rejection
// flares it signal red.

const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.27, 0.27, 0.1);
const cellEdges = new EdgesGeometry(cellGeometry);

export function createLetterMesh(char: string) {
  const cells = glyphOnCells(char);
  const group = new Group();
  const shardSpecs: DebrisSpec[] = [];
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(cellEdges.clone().applyMatrix4(matrix));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: SODIUM.clone(), size: 0.3 });
  }

  const fillMaterial = new MeshBasicMaterial({ color: OIL.clone().multiplyScalar(2.4) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(SODIUM, 1.25),
  }));
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  // Backing plate: dark steel, so the brand reads against any murk.
  const plateMaterial = new MeshBasicMaterial({ color: OIL.clone().multiplyScalar(0.9) });
  const plate = new Mesh(new BoxGeometry(width + 0.7, height + 0.7, 0.06), plateMaterial);
  plate.position.z = -0.12;
  group.add(plate);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = SODIUM.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, plateMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; plateMaterial: MeshBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(SEA_GLASS, 1.6) : hdr(SODIUM, 1.25));
  materials.fillMaterial.color.copy(
    locked ? SEA_GLASS.clone().multiplyScalar(0.32) : OIL.clone().multiplyScalar(2.4),
  );
  materials.plateMaterial.color.copy(locked ? new Color(0.05, 0.1, 0.1) : OIL.clone().multiplyScalar(0.9));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; plateMaterial: MeshBasicMaterial }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(hdr(SIGNAL_RED, 1.1));
    materials.fillMaterial.color.copy(new Color(0.28, 0.02, 0.01));
    materials.plateMaterial.color.copy(new Color(0.1, 0.01, 0.005));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}

// The thermal display keeps letters legible: sodium edges read as white-hot,
// steel goes cold dark. Applied by the per-frame tint pass.
export function setLetterThermal(group: Group, thermal: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; plateMaterial: MeshBasicMaterial }
    | undefined;
  if (!materials) return;
  if (!thermal) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.edgeMaterial.color.copy(hdr(group.userData.locked === true ? SEA_GLASS : CREAM, 1.7));
  materials.fillMaterial.color.copy(IR_HOT.clone().multiplyScalar(0.28));
  materials.plateMaterial.color.copy(new Color(0.02, 0.025, 0.03));
}
