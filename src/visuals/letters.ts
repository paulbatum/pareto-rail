import {
  AdditiveBlending,
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
  OctahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CORE_WHITE, CYAN, hdr, MAGENTA } from './palette';

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.3, 0.3, 0.14);
const coreGeometry = new OctahedronGeometry(0.12, 0);

export type LetterShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

// Letters in the crystal language: translucent cell fills, hot wireframe
// edges, a small core at the heart of the glyph. Lock turns the whole glyph
// magenta, matching the crystals' lock flare.
export function createLetterMesh(char: string) {
  const glyph = GLYPHS[char.toUpperCase()] ?? GLYPHS.A;
  const group = new Group();
  const shardSpecs: LetterShardSpec[] = [];
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
      shardSpecs.push({ direction, color: CYAN.clone(), size: 0.3 });
    }
  }

  const fillMaterial = new MeshBasicMaterial({
    color: CYAN.clone().multiplyScalar(0.12),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const edgeMaterial = new LineBasicMaterial({
    color: hdr(CYAN, 1.1),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const coreMaterial = new MeshBasicMaterial({ color: hdr(CORE_WHITE, 0.9) });

  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  const core = new Mesh(coreGeometry, coreMaterial);
  core.position.set(0, -0.1, 0.12);
  group.add(fillMesh, edgeLines, core);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = CYAN.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, coreMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; coreMaterial: MeshBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(MAGENTA, 1.6) : hdr(CYAN, 1.1));
  materials.fillMaterial.color.copy(locked ? MAGENTA.clone().multiplyScalar(0.2) : CYAN.clone().multiplyScalar(0.12));
  materials.coreMaterial.color.copy(locked ? hdr(MAGENTA, 1.5) : hdr(CORE_WHITE, 0.9));
}
