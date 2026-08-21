import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import type { Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { glyphOnCells } from '../../../engine/glyphs';
import { CRIMSON, GOLD, hdr } from './palette';

// START/REPLAY letters in the stained-glass language: gold light through
// leaded cells. Locked, the pane floods; denied, it goes sour crimson.

const CELL = 0.34;
const cellGeometry = new PlaneGeometry(0.3, 0.3);

const GOLD_DIM = 0.34;

export function createLetterMesh(character: string) {
  const cells = glyphOnCells(character);
  const group = new Group();
  const width = 4 * CELL;
  const height = 6 * CELL;

  const fillGeometries: BufferGeometry[] = [];
  const leadPositions: number[] = [];

  for (const cell of cells) {
    const x = cell.x * CELL - width / 2;
    const y = height / 2 - cell.y * CELL;
    fillGeometries.push(cellGeometry.clone().translate(x, y, 0));
    // Lead outline around each cell: the came that holds the pane.
    const e = 0.15;
    leadPositions.push(
      x - e, y - e, 0.01, x + e, y - e, 0.01,
      x + e, y - e, 0.01, x + e, y + e, 0.01,
      x + e, y + e, 0.01, x - e, y + e, 0.01,
      x - e, y + e, 0.01, x - e, y - e, 0.01,
    );
  }

  const fillMaterial = createAdditiveBasicMaterial({ color: GOLD.clone().multiplyScalar(GOLD_DIM), side: DoubleSide });
  const fillMesh = new Mesh(mergeGeometries(fillGeometries), fillMaterial);
  group.add(fillMesh);
  for (const geometry of fillGeometries) geometry.dispose();

  const leadGeometry = new BufferGeometry();
  leadGeometry.setAttribute('position', new Float32BufferAttribute(leadPositions, 3));
  const leadMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: new (GOLD.constructor as typeof Color)(0.1, 0.09, 0.14) as Color,
    opacity: 0.9,
  }));
  const leadLines = new LineSegments(leadGeometry, leadMaterial);
  group.add(leadLines);

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.accent = GOLD.clone();
  group.userData.shardColor = GOLD.clone();
  group.userData.lockRingScale = 0.85;
  group.userData.letterMaterials = { fillMaterial, leadMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; leadMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.fillMaterial.color.copy(locked ? hdr(GOLD, 1.5) : GOLD.clone().multiplyScalar(GOLD_DIM));
  materials.leadMaterial.color.setRGB(locked ? 0.35 : 0.1, locked ? 0.32 : 0.09, locked ? 0.2 : 0.14);
}

export function setLetterDenied(group: Group) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; leadMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  materials.fillMaterial.color.copy(hdr(CRIMSON, 0.9));
  materials.leadMaterial.color.setRGB(0.5, 0.1, 0.12);
}
