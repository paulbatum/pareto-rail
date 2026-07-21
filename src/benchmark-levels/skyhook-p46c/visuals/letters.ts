import {
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  BoxGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphRows } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { DANGER_RED, HAZARD_ORANGE, hdr, PANEL_SHADOW, SIGNAL_GREEN, SIGNAL_WHITE } from './palette';
import type { ShardSpec } from './effects';

// Mission signage: 5×7 glyphs built from little white service panels with
// hazard-orange rims — stencilled hardware lettering, not neon. Locking a
// letter lights it signal green like a go-board annunciator.

const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.27, 0.27, 0.1);

// Merged glyph geometry is cached per character and shared across every
// letter mesh — words respawn each attract loop, so instances must not leak.
const glyphGeometryCache = new Map<string, { fill: BufferGeometry; edges: BufferGeometry; shards: ShardSpec[] }>();

function glyphGeometry(char: string) {
  const key = char.toUpperCase();
  let cached = glyphGeometryCache.get(key);
  if (cached) return cached;
  const rows = glyphRows(key) ?? glyphRows('I')!;
  const shards: ShardSpec[] = [];
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
      shards.push({ direction, color: HAZARD_ORANGE.clone(), size: 0.3 });
    }
  }
  cached = { fill: mergeGeometries(fills), edges: mergeGeometries(edges), shards };
  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();
  glyphGeometryCache.set(key, cached);
  return cached;
}

export function createLetterMesh(char: string) {
  const group = new Group();
  const { fill, edges, shards } = glyphGeometry(char);
  const shardSpecs = shards;

  const fillMaterial = new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(2.4) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(HAZARD_ORANGE, 1.1),
  }));
  group.add(new Mesh(fill, fillMaterial));
  group.add(new LineSegments(edges, edgeMaterial));

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = HAZARD_ORANGE.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(SIGNAL_WHITE, 1.5) : hdr(HAZARD_ORANGE, 1.1));
  materials.fillMaterial.color.copy(
    locked ? SIGNAL_GREEN.clone().multiplyScalar(0.35) : PANEL_SHADOW.clone().multiplyScalar(2.4),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(hdr(DANGER_RED, 1.4));
    materials.fillMaterial.color.copy(new Color(0.28, 0.03, 0.02));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
