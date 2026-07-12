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
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { glyphRows } from '../../../engine/glyphs';
import { CYAN, DENY_RED, hdr, MOON, SLATE } from './palette';
import type { DebrisSpec } from './effects';

// Neon signage letters: each lit cell is a thin plate of dark wet glass with a
// merged additive cyan edge tube, like a rain-slick sign board. Locking floods
// the tubes to moonlight; denial burns them red.
const CELL = 0.34;
// A thin box plate reads as a rounded glass tile face-on.
const cellGeometry = new BoxGeometry(0.26, 0.26, 0.08);

export function createLetterMesh(char: string) {
  const glyph = glyphRows(char) ?? glyphRows('I')!;
  const group = new Group();
  const debrisSpecs: DebrisSpec[] = [];
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (let y = 0; y < glyph.length; y += 1) {
    for (let x = 0; x < glyph[y].length; x += 1) {
      if (glyph[y][x] !== '1') continue;
      const offset = new Vector3(x * CELL - width / 2, height / 2 - y * CELL, 0);
      const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
      fills.push(cellGeometry.clone().applyMatrix4(matrix));
      edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
      const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
      debrisSpecs.push({ direction, color: CYAN.clone(), size: 0.3 });
    }
  }

  const fillMaterial = new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(0.5) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(CYAN, 1.25),
  }));
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.debrisSpecs = debrisSpecs;
  group.userData.accent = CYAN.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  group.userData.locked = locked;
  materials.edgeMaterial.color.copy(locked ? hdr(MOON, 1.6) : hdr(CYAN, 1.25));
  materials.fillMaterial.color.copy(
    locked ? CYAN.clone().multiplyScalar(0.3) : SLATE.clone().multiplyScalar(0.5),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(hdr(DENY_RED, 1.5));
    materials.fillMaterial.color.copy(new Color(0.3, 0.02, 0.01));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
