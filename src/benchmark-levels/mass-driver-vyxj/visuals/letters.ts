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
import { glyphRows } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { ARC_BLUE, ARC_WHITE, GUNMETAL, hdr, TRACER_AMBER, WARNING_RED } from './palette';
import type { SparkSpec } from './effects';

// Munitions stencils: 5×7 glyphs built from beveled gunmetal plates with
// live arc-blue edge light, like lettering cut into the breech housing and
// backlit by the coils. Locking a letter quenches it to the player's amber.
const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.27, 0.27, 0.1);

export function createLetterMesh(char: string) {
  const rows = glyphRows(char) ?? glyphRows('I')!;
  const group = new Group();
  const sparkSpecs: SparkSpec[] = [];
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] !== '1') continue;
      const offset = new Vector3(x * CELL - width / 2, height / 2 - y * CELL, 0);
      const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
      fills.push(cellGeometry.clone().applyMatrix4(matrix));
      edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
      const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
      sparkSpecs.push({ direction, color: ARC_BLUE.clone(), size: 0.3 });
    }
  }

  const fillMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(2.4) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(ARC_BLUE, 1.3),
  }));
  group.add(new Mesh(mergeGeometries(fills), fillMaterial));
  group.add(new LineSegments(mergeGeometries(edges), edgeMaterial));

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.sparkSpecs = sparkSpecs;
  group.userData.accent = ARC_BLUE.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(ARC_WHITE, 1.7) : hdr(ARC_BLUE, 1.3));
  materials.fillMaterial.color.copy(
    locked ? TRACER_AMBER.clone().multiplyScalar(0.4) : GUNMETAL.clone().multiplyScalar(2.4),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(hdr(WARNING_RED, 1.5));
    materials.fillMaterial.color.copy(new Color(0.28, 0.02, 0.015));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
