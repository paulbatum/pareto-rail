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
import { ARC_BLUE, GUNMETAL, HAZARD_RED, hdr, ION_WHITE } from './palette';
import type { SparkSpec } from './effects';

// CHARGE / RELOAD are stencil plates off the gun housing: a shallow gunmetal
// backing plate with the glyph routed out of it as a cell grid, the crisp
// arc-blue routed edge carrying the shape so letters stay legible at distance
// with the glow off. Locked plates go ion-white; denied plates go hazard red.

const CELL = 0.34;
const cellGeometry = new BoxGeometry(CELL * 0.92, CELL * 0.92, 0.16);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const shardSpecs: SparkSpec[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.06);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: ARC_BLUE.clone(), size: 0.3 });
  }

  const fillMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(3.2) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 1.35) }));
  group.add(new Mesh(mergeGeometries(fills), fillMaterial));
  group.add(new LineSegments(mergeGeometries(edges), edgeMaterial));
  for (const geometry of [...fills, ...edges]) geometry.dispose();

  // The stencil plate behind the glyph.
  const plateMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.85) });
  const plate = new Mesh(new BoxGeometry(width + CELL * 1.6, height + CELL * 1.8, 0.08), plateMaterial);
  plate.position.z = -0.05;
  group.add(plate);
  const plateEdgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 0.5) }));
  plate.add(new LineSegments(new EdgesGeometry(plate.geometry as BoxGeometry), plateEdgeMaterial));

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = ARC_BLUE.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, plateEdgeMaterial };
  return group;
}

type LetterMaterials = {
  fillMaterial: MeshBasicMaterial;
  edgeMaterial: LineBasicMaterial;
  plateEdgeMaterial: LineBasicMaterial;
};

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(ION_WHITE, 1.7) : hdr(ARC_BLUE, 1.35));
  materials.fillMaterial.color.copy(
    locked ? ARC_BLUE.clone().multiplyScalar(0.4) : GUNMETAL.clone().multiplyScalar(3.2),
  );
  materials.plateEdgeMaterial.color.copy(locked ? hdr(ION_WHITE, 0.7) : hdr(ARC_BLUE, 0.5));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(hdr(HAZARD_RED, 1.5));
    materials.fillMaterial.color.copy(new Color(0.28, 0.02, 0.01));
    materials.plateEdgeMaterial.color.copy(hdr(HAZARD_RED, 0.6));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
