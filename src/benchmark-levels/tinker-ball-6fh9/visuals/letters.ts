import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { bakeShaded } from './bake';
import { CRAFT_CYCLE, DENY_RED, hdr, LOCK_AMBER, WARM_WHITE } from './palette';

// Letter glyphs in the level's language: toy building blocks. Each 5×7 cell
// is a small painted block; the whole letter leans on one craft color with
// per-cell variation, merged into a single vertex-colored mesh. Lock and
// deny states tint the material (vertex colors multiply through it).

const CELL = 0.34;
const BLOCK = new BoxGeometry(0.31, 0.31, 0.2);

export function createLetterMesh(char: string): Group {
  const group = new Group();
  const cells = glyphOnCells(char);
  const baseColor = CRAFT_CYCLE[(char.toUpperCase().charCodeAt(0) + 2) % CRAFT_CYCLE.length];
  const parts: BufferGeometry[] = [];
  const rotation = new Quaternion();

  for (const [index, cell] of cells.entries()) {
    const jitter = ((index * 7919) % 13) / 13;
    const color = baseColor.clone().multiplyScalar(0.85 + jitter * 0.4);
    rotation.setFromAxisAngle(AXIS_Z, (jitter - 0.5) * 0.14);
    const matrix = new Matrix4().compose(
      new Vector3((cell.x - 2) * CELL, (3 - cell.y) * CELL, (jitter - 0.5) * 0.05),
      rotation,
      new Vector3(1, 1, 1),
    );
    bakeShaded(parts, BLOCK, matrix, color, { topBoost: 1.45, sideDim: 0.85, bottomDim: 0.55 });
  }

  const material = new MeshBasicMaterial({ vertexColors: true, color: WARM_WHITE });
  const mesh = new Mesh(mergeGeometries(parts), material);
  for (const part of parts) part.dispose();
  group.add(mesh);

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.letterMaterial = material;
  group.userData.accent = baseColor.clone();
  group.userData.pieces = cells.slice(0, 6).map(() => ({
    shape: 'box' as const,
    color: baseColor.clone(),
    size: 0.3,
    direction: new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize(),
  }));
  return group;
}

const AXIS_Z = new Vector3(0, 0, 1);

export function setLetterLocked(group: Group, locked: boolean) {
  const material = group.userData.letterMaterial as MeshBasicMaterial | undefined;
  if (!material) return;
  material.color.copy(locked ? hdr(LOCK_AMBER, 1.7) : WARM_WHITE);
  group.scale.setScalar(locked ? 1.12 : 1);
}

export function setLetterDenied(group: Group) {
  const material = group.userData.letterMaterial as MeshBasicMaterial | undefined;
  if (material) material.color.copy(hdr(DENY_RED, 1.5));
}
