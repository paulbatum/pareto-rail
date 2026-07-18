import {
  BoxGeometry,
  BufferGeometry,
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
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { glyphOnCells } from '../../../engine/glyphs';
import { ARC_BLUE, GUNMETAL, HAZARD_FILL, HAZARD_RED, hdr, ION_WHITE } from './palette';
import type { SparkSpec } from './effects';

// CHARGE / RELOAD read as stencil plates machined off the gun housing: shallow
// gunmetal cell grids with a crisp arc-blue routed edge, so the outline carries
// the shape and the words stay legible at gameplay distance with bloom fully
// off. A locked plate quenches ion white (the player claimed it); a denied
// release trips it hazard red. The 5×7 grid keeps C, H, A, R, G, E, L, O, D
// unambiguous.

const CELL = 0.32;
// A shallow plate — wide face-on, thin in depth — so the routed edge reads as a
// clean rectangle rather than a diamond.
const cellGeometry = new BoxGeometry(CELL * 0.92, CELL * 0.92, CELL * 0.32);

type LetterMaterials = {
  fillMaterial: MeshBasicMaterial;
  edgeMaterial: LineBasicMaterial;
};

export function createLetterMesh(char = 'C') {
  const cells = glyphOnCells(char);
  const group = new Group();
  const sparkSpecs: SparkSpec[] = [];
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    sparkSpecs.push({ direction, color: ARC_BLUE.clone(), size: 0.34 });
  }

  const fillMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.85) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 1.35) }));
  group.add(new Mesh(mergeGeometries(fills), fillMaterial), new LineSegments(mergeGeometries(edges), edgeMaterial));

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.accent = ARC_BLUE.clone();
  group.userData.lockRingScale = 1.15;
  group.userData.letterMaterials = { fillMaterial, edgeMaterial } satisfies LetterMaterials;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(ION_WHITE, 1.7) : hdr(ARC_BLUE, 1.35));
  materials.fillMaterial.color.copy(
    locked ? ION_WHITE.clone().multiplyScalar(0.4) : GUNMETAL.clone().multiplyScalar(0.85),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(HAZARD_RED.clone());
    materials.fillMaterial.color.copy(HAZARD_FILL.clone());
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}

export type { LetterMaterials };
