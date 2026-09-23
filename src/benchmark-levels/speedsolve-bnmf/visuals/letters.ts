import { BoxGeometry, Color, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';

// Leaf: START / REPLAY letters as cube faces — a graphite tile with the 5×7
// glyph set in raised candy cubelets, the same language as the puzzle's
// stickers. Colors come from the caller.

const CELL = 0.34;
const CUBELET = 0.29;
const cubeletGeometry = new BoxGeometry(CUBELET, CUBELET, CUBELET * 0.8);
const plateGeometry = roundedPlate(2.25, 2.95, 0.3, 0.16);

export function createLetterMesh(character: string, color: Color, plateColor: Color, rimColor: Color) {
  const group = new Group();
  const plateMaterial = new MeshStandardMaterial({ color: plateColor, roughness: 0.5, metalness: 0.1 });
  const plate = new Mesh(plateGeometry, plateMaterial);
  plate.position.z = -0.24;
  group.add(plate);
  const rimMaterial = new MeshStandardMaterial({ color: rimColor, roughness: 0.4 });
  const rim = new Mesh(roundedPlate(2.45, 3.15, 0.36, 0.08), rimMaterial);
  rim.position.z = -0.3;
  group.add(rim);
  const cellMaterial = new MeshStandardMaterial({ color, roughness: 0.3, emissive: color.clone().multiplyScalar(0.18) });
  const cells: Mesh[] = [];
  for (const cell of glyphOnCells(character)) {
    const cube = new Mesh(cubeletGeometry, cellMaterial);
    cube.position.set((cell.x - 2) * CELL, (3 - cell.y) * CELL, 0);
    group.add(cube);
    cells.push(cube);
  }
  group.userData.isLetter = true;
  group.userData.letterPlate = plateMaterial;
  group.userData.letterRim = rimMaterial;
  group.userData.letterCells = cellMaterial;
  group.userData.letterColor = color.clone();
  group.userData.letterCubes = cells;
  group.userData.lockScale = 1.9;
  return group;
}

function roundedPlate(width: number, height: number, radius: number, depth: number) {
  const w = width / 2;
  const h = height / 2;
  const shape = new Shape();
  shape.moveTo(-w + radius, -h);
  shape.lineTo(w - radius, -h);
  shape.quadraticCurveTo(w, -h, w, -h + radius);
  shape.lineTo(w, h - radius);
  shape.quadraticCurveTo(w, h, w - radius, h);
  shape.lineTo(-w + radius, h);
  shape.quadraticCurveTo(-w, h, -w, h - radius);
  shape.lineTo(-w, -h + radius);
  shape.quadraticCurveTo(-w, -h, -w + radius, -h);
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
}
