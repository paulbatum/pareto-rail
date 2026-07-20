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
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { FacetSpec } from './enemies';
import { ARC_BLUE, GUNMETAL, HAZARD_RED, ION_WHITE, hdr } from './palette';

// CHARGE / RELOAD letters are stencil plates off the gun housing: a shallow
// gunmetal cell grid with a crisp arc-blue routed edge. The outline carries
// the shape, so the glyph stays legible at distance with the glow off.
// Locked plates go ion-white; denied plates flush hazard red.

const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.3, 0.3, 0.16);
const plateGeometry = new BoxGeometry(5 * CELL + 0.5, 7 * CELL + 0.5, 0.08);
const plateEdgeGeometry = new EdgesGeometry(plateGeometry);

// Merged glyph geometries are cached per character — letters respawn every
// attract/replay cycle and must not grow the geometry count.
const glyphGeometryCache = new Map<string, { fill: BufferGeometry; edges: BufferGeometry; facetSpecs: FacetSpec[] }>();

export type LetterMaterials = {
  fillMaterial: MeshBasicMaterial;
  edgeMaterial: LineBasicMaterial;
  plateMaterial: MeshBasicMaterial;
};

function glyphGeometry(char: string) {
  const key = char.toUpperCase();
  const cached = glyphGeometryCache.get(key);
  if (cached) return cached;

  const cells = glyphOnCells(key);
  const facetSpecs: FacetSpec[] = [];
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;
  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.08);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    facetSpecs.push({ direction, color: ARC_BLUE.clone(), size: 0.3 });
  }
  const entry = { fill: mergeGeometries(fills), edges: mergeGeometries(edges), facetSpecs };
  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();
  glyphGeometryCache.set(key, entry);
  return entry;
}

export function createLetterMesh(char: string) {
  const group = new Group();
  const glyph = glyphGeometry(char);
  const facetSpecs = glyph.facetSpecs;

  const plateMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.8) });
  const fillMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.7) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 1.25) }));

  const plate = new Mesh(plateGeometry, plateMaterial);
  const plateEdge = new LineSegments(
    plateEdgeGeometry,
    new LineBasicMaterial(additiveMaterialParameters({ color: ARC_BLUE.clone().multiplyScalar(0.3) })),
  );
  const fillMesh = new Mesh(glyph.fill, fillMaterial);
  const edgeLines = new LineSegments(glyph.edges, edgeMaterial);
  group.add(plate, plateEdge, fillMesh, edgeLines);

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.facetSpecs = facetSpecs;
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, plateMaterial } satisfies LetterMaterials;
  group.userData.lockRingScale = 1.1;
  return group;
}

export function setLetterState(group: Group, state: 'idle' | 'locked' | 'denied', flash = 0) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (state === 'locked') {
    materials.edgeMaterial.color.copy(hdr(ION_WHITE, 1.7));
    materials.fillMaterial.color.copy(ARC_BLUE.clone().multiplyScalar(0.4));
  } else if (state === 'denied') {
    materials.edgeMaterial.color.copy(hdr(HAZARD_RED, 1.5 + flash));
    materials.fillMaterial.color.copy(HAZARD_RED.clone().multiplyScalar(0.22 + flash * 0.2));
  } else {
    materials.edgeMaterial.color.copy(hdr(ARC_BLUE, 1.25));
    materials.fillMaterial.color.copy(GUNMETAL.clone().multiplyScalar(1.7));
  }
}

export function letterAccent(): Color {
  return ARC_BLUE.clone();
}
