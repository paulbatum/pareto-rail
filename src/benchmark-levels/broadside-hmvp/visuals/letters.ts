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
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphRows } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';

// Leaf: hull-plate stencils. Each 5×7 glyph cell is a gunmetal armor plate
// with a cyan running-light edge — the letters are painted in our fleet's
// livery. The spine picks every color and state.

const CELL = 0.36;
const plate = new BoxGeometry(0.3, 0.3, 0.12);
const plateEdges = new EdgesGeometry(plate);

export type LetterColors = {
  plate: Color;
  edge: Color;
  lockedPlate: Color;
  lockedEdge: Color;
  deniedPlate: Color;
  deniedEdge: Color;
};

const WIDTH = 4 * CELL;
const HEIGHT = 6 * CELL;
const glyphCache = new Map<string, { plates: BufferGeometry; edges: BufferGeometry }>();
const barGeometry = new BoxGeometry(WIDTH + 0.7, 0.08, 0.06);

function glyphGeometry(character: string) {
  const cached = glyphCache.get(character);
  if (cached) return cached;
  const rows = glyphRows(character) ?? glyphRows('I')!;
  const plates: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = WIDTH;
  const height = HEIGHT;
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] !== '1') continue;
      const matrix = new Matrix4().makeTranslation(x * CELL - width / 2, height / 2 - y * CELL, 0);
      plates.push(plate.clone().applyMatrix4(matrix));
      edges.push(plateEdges.clone().applyMatrix4(matrix));
    }
  }
  const merged = { plates: mergeGeometries(plates), edges: mergeGeometries(edges) };
  for (const geometry of plates) geometry.dispose();
  for (const geometry of edges) geometry.dispose();
  glyphCache.set(character, merged);
  return merged;
}

export function createLetterMesh(character: string, colors: LetterColors) {
  const group = new Group();
  const glyph = glyphGeometry(character.toUpperCase());
  const plateMaterial = new MeshBasicMaterial({ color: colors.plate });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: colors.edge }));
  const plateMesh = new Mesh(glyph.plates, plateMaterial);
  const edgeLines = new LineSegments(glyph.edges, edgeMaterial);
  edgeLines.position.z = 0.02;
  // A backing bar under the glyph, like a hull registry plaque.
  const bar = new Mesh(barGeometry, new MeshBasicMaterial({ color: colors.edge.clone().multiplyScalar(0.8) }));
  bar.position.set(0, -HEIGHT / 2 - 0.36, 0);
  group.add(plateMesh, edgeLines, bar);
  group.userData.isLetter = true;
  group.userData.letterMaterials = { plateMaterial, edgeMaterial, barMaterial: bar.material };
  group.userData.letterColors = colors;
  group.userData.lockScale = 1.5;
  return group;
}

export function setLetterState(group: Group, state: 'idle' | 'locked' | 'denied', pulse = 0) {
  const materials = group.userData.letterMaterials as { plateMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; barMaterial: MeshBasicMaterial } | undefined;
  const colors = group.userData.letterColors as LetterColors | undefined;
  if (!materials || !colors) return;
  if (state === 'denied') {
    materials.plateMaterial.color.copy(colors.deniedPlate);
    materials.edgeMaterial.color.copy(colors.deniedEdge);
    materials.barMaterial.color.copy(colors.deniedEdge);
  } else if (state === 'locked') {
    materials.plateMaterial.color.copy(colors.lockedPlate);
    materials.edgeMaterial.color.copy(colors.lockedEdge);
    materials.barMaterial.color.copy(colors.lockedEdge);
  } else {
    materials.plateMaterial.color.copy(colors.plate);
    materials.edgeMaterial.color.copy(colors.edge).multiplyScalar(0.8 + pulse * 0.4);
    materials.barMaterial.color.copy(colors.edge).multiplyScalar(0.6 + pulse * 0.4);
  }
}
