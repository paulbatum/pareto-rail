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
  RingGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { glyphOnCells } from '../../../engine/glyphs';
import { DENY_VIOLET_RED, hdr, JELLY_EMERALD, JELLY_GOLD, JELLY_MINT, PARASITE_VIOLET } from './palette';

const CELL_SIZE = 0.32;
const cellGeometry = new BoxGeometry(0.26, 0.26, 0.12);

export type LetterShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

// Procedural 5x7 glyphs in Strandline's bioluminescent language:
// translucent cellular cushions with hot luminous membrane edges.
// Unlocked: serene emerald/mint.
// Locked: radiant amber/gold.
// Denied: sharp toxic violet shock.
export function createLetterMesh(char: string): Group {
  const upper = char.toUpperCase();
  const cells = glyphOnCells(upper);
  const group = new Group();
  const shardSpecs: LetterShardSpec[] = [];
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];

  const width = 4 * CELL_SIZE;
  const height = 6 * CELL_SIZE;

  for (const cell of cells) {
    const offset = new Vector3(
      cell.x * CELL_SIZE - width / 2,
      height / 2 - cell.y * CELL_SIZE,
      0,
    );
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));

    const direction = offset.lengthSq() > 0.001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: JELLY_MINT.clone(), size: 0.28 });
  }

  const fillMaterial = createAdditiveBasicMaterial({
    color: JELLY_EMERALD.clone().multiplyScalar(0.4),
    opacity: 0.85,
  });
  const edgeMaterial = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(JELLY_MINT, 1.4) }),
  );

  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(fillMesh, edgeLines);

  // Outer organic halo ring
  const haloGeo = new RingGeometry(1.05, 1.12, 32);
  const haloMat = createAdditiveBasicMaterial({
    color: hdr(JELLY_EMERALD, 0.6),
    opacity: 0.6,
  });
  const haloMesh = new Mesh(haloGeo, haloMat);
  group.add(haloMesh);

  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = upper;
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = JELLY_EMERALD.clone();
  group.userData.materials = { fillMaterial, edgeMaterial, haloMat };

  return group;
}

export function setLetterLocked(group: Group, locked: boolean): void {
  const materials = group.userData.materials as {
    fillMaterial: MeshBasicMaterial;
    edgeMaterial: LineBasicMaterial;
    haloMat: MeshBasicMaterial;
  } | undefined;
  if (!materials) return;

  if (locked) {
    materials.edgeMaterial.color.copy(hdr(JELLY_GOLD, 1.8));
    materials.fillMaterial.color.copy(JELLY_GOLD.clone().multiplyScalar(0.6));
    materials.haloMat.color.copy(hdr(JELLY_GOLD, 1.2));
    group.scale.setScalar(1.15);
  } else {
    materials.edgeMaterial.color.copy(hdr(JELLY_MINT, 1.4));
    materials.fillMaterial.color.copy(JELLY_EMERALD.clone().multiplyScalar(0.4));
    materials.haloMat.color.copy(hdr(JELLY_EMERALD, 0.6));
    group.scale.setScalar(1.0);
  }
}

export function setLetterDenied(group: Group): void {
  const materials = group.userData.materials as {
    fillMaterial: MeshBasicMaterial;
    edgeMaterial: LineBasicMaterial;
    haloMat: MeshBasicMaterial;
  } | undefined;
  if (!materials) return;

  materials.edgeMaterial.color.copy(hdr(DENY_VIOLET_RED, 2.0));
  materials.fillMaterial.color.copy(PARASITE_VIOLET.clone().multiplyScalar(0.7));
  materials.haloMat.color.copy(hdr(DENY_VIOLET_RED, 1.5));
  group.scale.setScalar(0.85);

  setTimeout(() => {
    setLetterLocked(group, false);
  }, 350);
}
