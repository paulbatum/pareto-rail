import { BoxGeometry, Color, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { CYAN, hdr, MAGENTA, SLATE } from './palette';

// Signage-panel glyphs: dark glass tiles lit from within, cyan fill with a
// magenta neon edge — the same light language the city's own signs use.
const CELL = 0.32;
const cellGeometry = new BoxGeometry(CELL * 0.86, CELL * 0.86, 0.1);

export function createLetterMesh(character: string) {
  const cells = glyphOnCells(character);
  const group = new Group();
  const shardSpecs: ShardSpec[] = [];
  const fills = [];
  const edges = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: CYAN.clone(), size: 0.3 });
  }

  const fillMaterial = new MeshBasicMaterial({ color: hdr(CYAN, 0.55) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(MAGENTA, 1.3) }));
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = MAGENTA.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(CYAN, 1.7) : hdr(MAGENTA, 1.3));
  materials.fillMaterial.color.copy(locked ? SLATE.clone().multiplyScalar(0.4).lerp(hdr(CYAN, 1), 0.55) : hdr(CYAN, 0.55));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(new Color(1.5, 0.12, 0.06));
    materials.fillMaterial.color.copy(new Color(0.3, 0.02, 0.01));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
