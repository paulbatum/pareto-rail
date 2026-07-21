import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { HAZARD, hdr, ICE, PANEL, STEEL } from './palette';

// The START / REPLAY words are stencilled signage: white panel cells on a dark
// steel plate, rimmed in hazard orange — the same paint scheme as the hardware.
// Locking a letter quenches its rim to the player's ice-white.
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

const CELL = 0.32;

export function createLetterMesh(char: string) {
  const glyph = GLYPHS[char.toUpperCase()] ?? GLYPHS.A;
  const group = new Group();
  const cellGeometry = new BoxGeometry(CELL * 0.86, CELL * 0.86, 0.14);
  const fills: Parameters<typeof mergeGeometries>[0] = [];
  const edges: Parameters<typeof mergeGeometries>[0] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (let y = 0; y < glyph.length; y += 1) {
    for (let x = 0; x < glyph[y].length; x += 1) {
      if (glyph[y][x] !== '1') continue;
      const matrix = new Matrix4().makeTranslation(x * CELL - width / 2, height / 2 - y * CELL, 0);
      fills.push(cellGeometry.clone().applyMatrix4(matrix));
      edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
    }
  }

  const fillMaterial = new MeshBasicMaterial({ color: PANEL.clone().multiplyScalar(0.85) });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(HAZARD, 1.2) }));
  // A dark backing plate so the stencil reads even with bloom off.
  const plate = new Mesh(
    new BoxGeometry(width + CELL * 1.4, height + CELL * 1.4, 0.08),
    new MeshBasicMaterial({ color: STEEL.clone().multiplyScalar(0.7) }),
  );
  plate.position.z = -0.12;
  const fillMesh = new Mesh(mergeGeometries(fills), fillMaterial);
  const edgeLines = new LineSegments(mergeGeometries(edges), edgeMaterial);
  group.add(plate, fillMesh, edgeLines);

  cellGeometry.dispose();
  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.accent = HAZARD.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial } | undefined;
  if (!materials) return;
  materials.edgeMaterial.color.copy(locked ? hdr(ICE, 1.7) : hdr(HAZARD, 1.2));
  materials.fillMaterial.color.copy(locked ? ICE.clone().multiplyScalar(0.9) : PANEL.clone().multiplyScalar(0.85));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial } | undefined;
  if (!materials) return;
  if (denied) {
    materials.edgeMaterial.color.copy(new Color(1.5, 0.12, 0.06));
    materials.fillMaterial.color.copy(new Color(0.35, 0.04, 0.02));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
