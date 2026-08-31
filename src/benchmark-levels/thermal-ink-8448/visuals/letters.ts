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
import { createThermalRoot, registerThermalPart } from './enemies';
import { CREAM, IR_WHITE_EDGE, IR_WHITE_HOT, OCHRE, RUST_DARK, hdr } from './palette';
import { glyphOnCells } from '../../../engine/glyphs';

const CELL = 0.42;
const cellGeometry = new BoxGeometry(0.34, 0.34, 0.14);

// A 5×7 grid of dirty cream plates: the shared START!/REPLAY flow reads as a
// harbour warning board rather than a generic neon font.
export function createLetterMesh(character: string) {
  const group = createThermalRoot();
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const cells = glyphOnCells(character);
  const shardDirections: Vector3[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const x = cell.x * CELL - width / 2;
    const y = height / 2 - cell.y * CELL;
    const geometry = cellGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(x, y, 0));
    fills.push(geometry);
    edges.push(new EdgesGeometry(geometry));
    shardDirections.push(new Vector3(x, y, 0.15).normalize());
  }

  const fillMaterial = new MeshBasicMaterial({ color: hdr(CREAM, 0.72) });
  registerThermalPart(group, fillMaterial, hdr(CREAM, 0.72), IR_WHITE_HOT, 1, 1);
  const edgeMaterial = new LineBasicMaterial({ color: hdr(OCHRE, 1.2) });
  registerThermalPart(group, edgeMaterial, hdr(OCHRE, 1.2), IR_WHITE_EDGE, 1, 1);
  group.add(new Mesh(mergeGeometries(fills), fillMaterial));
  group.add(new LineSegments(mergeGeometries(edges), edgeMaterial));
  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  // A thin plate backing makes the glyph read against the moving harbour.
  const backingMaterial = new MeshBasicMaterial({ color: hdr(RUST_DARK, 1.3), transparent: true, opacity: 0.72 });
  registerThermalPart(group, backingMaterial, hdr(RUST_DARK, 1.3), new Color(0.02, 0.025, 0.03), 0.72, 0.52);
  const backing = new Mesh(new BoxGeometry(2.4, 3.15, 0.06), backingMaterial);
  backing.position.z = -0.12;
  group.add(backing);

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.shardDirections = shardDirections;
  group.userData.accent = OCHRE.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, backingMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as {
    fillMaterial: MeshBasicMaterial;
    edgeMaterial: LineBasicMaterial;
    backingMaterial: MeshBasicMaterial;
  } | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(IR_WHITE_EDGE, 1) : hdr(OCHRE, 1.2));
  materials.fillMaterial.color.copy(locked ? hdr(IR_WHITE_HOT, 0.6) : hdr(CREAM, 0.72));
  materials.backingMaterial.color.copy(locked ? hdr(RUST_DARK, 0.75) : hdr(RUST_DARK, 1.3));
}

export function setLetterDenied(group: Group) {
  const materials = group.userData.letterMaterials as {
    fillMaterial: MeshBasicMaterial;
    edgeMaterial: LineBasicMaterial;
    backingMaterial: MeshBasicMaterial;
  } | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(new Color(1.65, 0.04, 0.015));
  materials.fillMaterial.color.copy(new Color(0.36, 0.02, 0.01));
  materials.backingMaterial.color.copy(new Color(0.12, 0.01, 0.008));
}
