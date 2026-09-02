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
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { DENIED_RED, hdr, JELLY_EMERALD, JELLY_GOLD, JELLY_MINT, LOCK_CYAN, PEARL_WHITE } from './palette';

const CELL_SIZE = 0.36;
const cellGeometry = new BoxGeometry(0.32, 0.32, 0.16);

export type LetterMeshUserData = {
  fillMaterial: MeshBasicMaterial;
  edgeMaterial: LineBasicMaterial;
  ringMaterial: LineBasicMaterial;
  baseColor: Color;
};

export function createLetterMesh(char: string): Group {
  const group = new Group();
  const cells = glyphOnCells(char);
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];

  const width = 4 * CELL_SIZE;
  const height = 6 * CELL_SIZE;

  for (const cell of cells) {
    const offset = new Vector3(
      (cell.x - 2) * CELL_SIZE,
      (3 - cell.y) * CELL_SIZE,
      0,
    );
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
  }

  // Base bioluminescent styling: emerald-mint cell body with gold filament outlines
  const fillMat = new MeshBasicMaterial({
    color: JELLY_EMERALD.clone().multiplyScalar(0.75),
    transparent: true,
    opacity: 0.85,
  });
  const edgeMat = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(JELLY_MINT, 1.4) }),
  );

  const fillMesh = new Mesh(mergeGeometries(fills), fillMat);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMat);
  group.add(fillMesh, edgeLines);

  // Outer aquatic halo ring
  const ringGeom = new TorusGeometry(1.45, 0.025, 8, 36);
  const ringMat = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(JELLY_GOLD, 1.2) }),
  );
  const ringMesh = new Mesh(ringGeom, ringMat);
  group.add(ringMesh);

  for (const g of fills) g.dispose();
  for (const g of edges) g.dispose();

  const data: LetterMeshUserData = {
    fillMaterial: fillMat,
    edgeMaterial: edgeMat,
    ringMaterial: ringMat,
    baseColor: JELLY_EMERALD.clone(),
  };
  group.userData = data;

  return group;
}

export function setLetterLocked(mesh: Group, locked: boolean) {
  const data = mesh.userData as LetterMeshUserData;
  if (!data.fillMaterial) return;
  if (locked) {
    data.fillMaterial.color.copy(PEARL_WHITE);
    data.edgeMaterial.color.copy(hdr(LOCK_CYAN, 2.0));
    data.ringMaterial.color.copy(hdr(LOCK_CYAN, 2.2));
    mesh.scale.setScalar(1.22);
  } else {
    data.fillMaterial.color.copy(data.baseColor).multiplyScalar(0.75);
    data.edgeMaterial.color.copy(hdr(JELLY_MINT, 1.4));
    data.ringMaterial.color.copy(hdr(JELLY_GOLD, 1.2));
    mesh.scale.setScalar(1.0);
  }
}

export function setLetterDenied(mesh: Group) {
  const data = mesh.userData as LetterMeshUserData;
  if (!data.fillMaterial) return;
  data.fillMaterial.color.copy(DENIED_RED);
  data.edgeMaterial.color.copy(hdr(DENIED_RED, 2.0));
  data.ringMaterial.color.copy(hdr(DENIED_RED, 2.0));
  mesh.scale.setScalar(0.85);
}
