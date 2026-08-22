import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { glyphRows } from '../../../engine/glyphs';
import { GOLD, hdr, ICE } from './palette';

// START/REPLAY as hull stencils: an armored plaque with a gold frame and
// ice-white cell fills, the way fleet markings read on armor.
const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.29, 0.29, 0.13);

export type LetterShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

export function createLetterMesh(character: string) {
  const glyph = glyphRows(character) ?? [
    '01110', '10001', '10001', '11111', '10001', '10001', '10001',
  ] as const;
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
      const matrix = new Matrix4().makeTranslation(offset.x, offset.y, 0);
      fills.push(cellGeometry.clone().applyMatrix4(matrix));
      edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
      const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
      shardSpecs.push({ direction, color: ICE.clone(), size: 0.3 });
    }
  }

  const fillMaterial = createAdditiveBasicMaterial({ color: ICE.clone().multiplyScalar(0.16) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ICE, 1.2) }));
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  const plateMaterial = new MeshBasicMaterial({ color: 0x0b0f16, side: DoubleSide });
  const plate = new Mesh(new PlaneGeometry(width + 0.55, height + 0.55), plateMaterial);
  plate.position.z = -0.09;
  group.add(plate);

  const frameMaterial = createAdditiveBasicMaterial({ color: hdr(GOLD, 0.9), side: DoubleSide });
  const frame = new Mesh(new PlaneGeometry(width + 0.42, height + 0.42), frameMaterial);
  frame.position.z = -0.075;
  const inner = new Mesh(new PlaneGeometry(width + 0.18, height + 0.18), new MeshBasicMaterial({
    color: 0x0b0f16,
    side: DoubleSide,
  }));
  inner.position.z = -0.06;
  group.add(frame, inner);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = ICE.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, frameMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; frameMaterial: MeshBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(GOLD, 1.9) : hdr(ICE, 1.2));
  materials.fillMaterial.color.copy(locked ? GOLD.clone().multiplyScalar(0.24) : ICE.clone().multiplyScalar(0.16));
  materials.frameMaterial.color.copy(hdr(locked ? ICE : GOLD, locked ? 1.6 : 0.9));
}
