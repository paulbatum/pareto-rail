import { BoxGeometry, Color, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { GRAPHITE, HOT_WHITE, MACHINE_WHITE, hdr } from './palette';

// Letters are words spelled in loose cubies: 5x7 grids of small graphite
// blocks with pale seams. Locking floods the seams hot white. Graphite keeps
// them legible over both the pale void and the cube's colours, and stays out
// of the six solve colours.
const CELL = 0.44;
const cellGeometry = new BoxGeometry(0.42, 0.42, 0.42);

export type LetterDebrisSpec = { direction: Vector3; size: number };

export function createLetterMesh(char: string) {
  const cells = glyphOnCells(char);
  const group = new Group();
  const fills = [];
  const edges = [];
  const debris: LetterDebrisSpec[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;
  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    debris.push({ direction: offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1), size: 0.3 });
  }
  const fillMaterial = new MeshStandardMaterial({ color: GRAPHITE.clone(), roughness: 0.55, metalness: 0.1 });
  const edgeMaterial = new LineBasicMaterial({ color: MACHINE_WHITE.clone().multiplyScalar(0.7) });
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);
  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  group.userData.debrisSpecs = debris;
  group.userData.accent = GRAPHITE.clone();
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as { fillMaterial: MeshStandardMaterial; edgeMaterial: LineBasicMaterial } | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(HOT_WHITE, 2.2) : MACHINE_WHITE.clone().multiplyScalar(0.7));
  materials.fillMaterial.color.copy(locked ? new Color(0.28, 0.29, 0.32) : GRAPHITE);
  materials.fillMaterial.emissive.copy(locked ? hdr(HOT_WHITE, 0.35) : new Color(0, 0, 0));
}

export function flashLetterDenied(group: Group, color: Color, amount: number) {
  const materials = group.userData.letterMaterials as { fillMaterial: MeshStandardMaterial; edgeMaterial: LineBasicMaterial } | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(hdr(color, 1.2 + amount * 1.4));
  materials.fillMaterial.emissive.copy(color.clone().multiplyScalar(0.25 * amount));
}
