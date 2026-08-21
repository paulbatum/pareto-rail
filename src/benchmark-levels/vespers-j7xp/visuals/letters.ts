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
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { COBALT, CRIMSON, GOLD, hdr, LEAD_CAME, PURE_LIGHT, STONE_DARK } from './palette';

const CELL_SIZE = 0.32;
const CELL_GEOMETRY = new BoxGeometry(0.28, 0.28, 0.12);

export function createLetterMesh(char: string): Group {
  const group = new Group();
  const cells = glyphOnCells(char.toUpperCase());
  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL_SIZE;
  const height = 6 * CELL_SIZE;

  for (const cell of cells) {
    const offset = new Vector3(
      cell.x * CELL_SIZE - width / 2,
      (6 - cell.y) * CELL_SIZE - height / 2,
      0,
    );
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(CELL_GEOMETRY.clone().applyMatrix4(matrix));
    edges.push(new EdgesGeometry(CELL_GEOMETRY).applyMatrix4(matrix));
  }

  // Base jewel color for this letter (Gold for START / REPLAY letters)
  const baseColor = GOLD.clone();
  const fillMaterial = createAdditiveBasicMaterial({ color: baseColor.clone().multiplyScalar(0.4) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(baseColor, 1.4) }));

  const mergedFills = fills.length > 0 ? mergeGeometries(fills) : new BoxGeometry(0.1, 0.1, 0.1);
  const mergedEdges = edges.length > 0 ? mergeGeometries(edges) : new EdgesGeometry(new BoxGeometry(0.1, 0.1, 0.1));

  const fillMesh = new Mesh(mergedFills, fillMaterial);
  const edgeLines = new LineSegments(mergedEdges, edgeMaterial);
  group.add(fillMesh, edgeLines);

  // Gothic lancet / rosette frame surrounding the letter
  const frameRing = new TorusGeometry(1.4, 0.04, 8, 32);
  const frameMaterial = new MeshBasicMaterial({ color: LEAD_CAME });
  const frameMesh = new Mesh(frameRing, frameMaterial);
  group.add(frameMesh);

  // Outer glowing halo
  const haloRing = new RingGeometry(1.36, 1.44, 32);
  const haloMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 0.3) });
  const haloMesh = new Mesh(haloRing, haloMaterial);
  group.add(haloMesh);

  for (const g of fills) g.dispose();
  for (const g of edges) g.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.accent = baseColor.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, haloMaterial, frameMesh };
  group.userData.raildIgnoreOcclusion = true;

  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; haloMaterial: MeshBasicMaterial }
    | undefined;
  if (!materials) return;

  if (locked) {
    materials.edgeMaterial.color.copy(hdr(PURE_LIGHT, 2.2));
    materials.fillMaterial.color.copy(hdr(GOLD, 1.2));
    materials.haloMaterial.color.copy(hdr(PURE_LIGHT, 1.0));
    group.scale.setScalar(1.18);
  } else {
    materials.edgeMaterial.color.copy(hdr(GOLD, 1.4));
    materials.fillMaterial.color.copy(GOLD.clone().multiplyScalar(0.4));
    materials.haloMaterial.color.copy(hdr(GOLD, 0.3));
    group.scale.setScalar(1.0);
  }
}

export function setLetterDenied(group: Group) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; haloMaterial: MeshBasicMaterial }
    | undefined;
  if (!materials) return;

  materials.edgeMaterial.color.copy(hdr(CRIMSON, 1.8));
  materials.fillMaterial.color.copy(CRIMSON.clone().multiplyScalar(0.3));
  materials.haloMaterial.color.copy(hdr(CRIMSON, 0.8));
  group.scale.setScalar(0.85);
}
