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
import { glyphRows } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  CYAN_FIRE,
  CYAN_GLOW,
  DENY_CRIMSON,
  ICE_WHITE,
  OBSIDIAN_ARMOR,
  OBSIDIAN_HULL,
  RETICLE_LOCKED,
} from './palette';

const CELL = 0.32;
const cellGeometry = new BoxGeometry(0.24, 0.24, 0.12);

export function createLetterMesh(char: string): Group {
  const upperChar = char.toUpperCase()[0] ?? 'A';
  const rows = glyphRows(upperChar) ?? ['11111', '10001', '10001', '10001', '10001', '10001', '11111'];
  const group = new Group();

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
    }
  }

  // Tactical beacon bezel ring surrounding the letter
  const bezelGeom = new RingGeometry(1.4, 1.48, 8);
  const bezelMesh = new Mesh(
    bezelGeom,
    new MeshBasicMaterial(additiveMaterialParameters({ color: CYAN_GLOW, depthWrite: false })),
  );
  bezelMesh.position.z = -0.05;
  group.add(bezelMesh);

  const fillMaterial = new MeshBasicMaterial({
    color: ICE_WHITE.clone(),
    depthWrite: true,
  });
  const edgeMaterial = new LineBasicMaterial(
    additiveMaterialParameters({
      color: CYAN_FIRE.clone(),
      depthWrite: false,
    }),
  );

  const mergedFills = mergeGeometries(fills);
  const mergedEdges = mergeGeometries(edges);

  const fillMesh = new Mesh(mergedFills, fillMaterial);
  const edgeLines = new LineSegments(mergedEdges, edgeMaterial);
  group.add(fillMesh, edgeLines);

  for (const g of fills) g.dispose();
  for (const g of edges) g.dispose();

  group.userData.isLetter = true;
  group.userData.letter = upperChar;
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, bezelMesh };

  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; bezelMesh: Mesh }
    | undefined;
  if (!materials) return;
  if (locked) {
    materials.fillMaterial.color.copy(RETICLE_LOCKED);
    materials.edgeMaterial.color.copy(RETICLE_LOCKED);
    materials.bezelMesh.scale.setScalar(1.2);
  } else {
    materials.fillMaterial.color.copy(ICE_WHITE);
    materials.edgeMaterial.color.copy(CYAN_FIRE);
    materials.bezelMesh.scale.setScalar(1.0);
  }
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; bezelMesh: Mesh }
    | undefined;
  if (!materials) return;
  if (denied) {
    materials.fillMaterial.color.copy(DENY_CRIMSON);
    materials.edgeMaterial.color.copy(DENY_CRIMSON);
    materials.bezelMesh.scale.setScalar(0.9);
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
