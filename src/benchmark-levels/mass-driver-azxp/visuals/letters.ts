import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';

// Leaf: START/REPLAY glyphs as coil-cell panels — a 5×7 matrix where lit
// cells are charged capacitor blocks and unlit cells are dim contact points,
// framed like a breech control plate. Colours come from the spine.

export type LetterPalette = {
  lit: Color;
  dim: Color;
  frame: Color;
  plate: Color;
};

const CELL = 0.34;

function framePoints() {
  const w = 1.1;
  const h = 1.42;
  const c = 0.28;
  // A chamfered plate outline with a notch top and bottom.
  const corners = [
    [-w + c, h], [-0.25, h], [-0.15, h - 0.1], [0.15, h - 0.1], [0.25, h], [w - c, h],
    [w, h - c], [w, -h + c], [w - c, -h], [0.25, -h], [0.15, -h + 0.1], [-0.15, -h + 0.1], [-0.25, -h], [-w + c, -h],
    [-w, -h + c], [-w, h - c],
  ];
  const points: number[] = [];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    points.push(a[0], a[1], 0, b[0], b[1], 0);
  }
  return new Float32Array(points);
}

export function createLetterMesh(character: string, palette: LetterPalette) {
  const group = new Group();
  const lit = glyphOnCells(character);
  const litKeys = new Set(lit.map((cell) => `${cell.x},${cell.y}`));
  const litParts: BufferGeometry[] = [];
  const dimParts: BufferGeometry[] = [];
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const px = (x - 2) * CELL;
      const py = (3 - y) * CELL;
      if (litKeys.has(`${x},${y}`)) litParts.push(new BoxGeometry(CELL * 0.84, CELL * 0.84, 0.14).translate(px, py, 0.05));
      else dimParts.push(new BoxGeometry(CELL * 0.22, CELL * 0.22, 0.04).translate(px, py, 0));
    }
  }
  const litMaterial = new MeshBasicMaterial({ color: palette.lit, toneMapped: false });
  const dimMaterial = new MeshBasicMaterial({ color: palette.dim, toneMapped: false });
  if (litParts.length) group.add(new Mesh(mergeGeometries(litParts), litMaterial));
  if (dimParts.length) group.add(new Mesh(mergeGeometries(dimParts), dimMaterial));

  const plateMaterial = new MeshBasicMaterial({ color: palette.plate, transparent: true, opacity: 0.72, depthWrite: false });
  const plate = new Mesh(new PlaneGeometry(2.2, 2.84), plateMaterial);
  plate.position.z = -0.12;
  const frameGeometry = new BufferGeometry();
  frameGeometry.setAttribute('position', new BufferAttribute(framePoints(), 3));
  const frameMaterial = new LineBasicMaterial({ color: palette.frame, toneMapped: false });
  group.add(plate, new LineSegments(frameGeometry, frameMaterial));

  group.userData.isLetter = true;
  group.userData.letterParts = { litMaterial, dimMaterial, frameMaterial, plateMaterial };
  group.userData.letterBase = { lit: palette.lit.clone(), dim: palette.dim.clone(), frame: palette.frame.clone() };
  return group;
}

export type LetterParts = {
  litMaterial: MeshBasicMaterial;
  dimMaterial: MeshBasicMaterial;
  frameMaterial: LineBasicMaterial;
  plateMaterial: MeshBasicMaterial;
};
