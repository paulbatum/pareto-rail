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
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { AMBER, FAULT, HAZARD, hdr, PANEL, SLATE, STEEL } from './palette';
import type { ShardSpec } from './effects';

// Hull stencils. Each letter is a service placard bolted to the tether: a dark
// backing plate, the glyph cut out of it in raised white panel blocks, and a
// hazard-orange frame around the edge. Locking one paints the blocks orange —
// the same paint the player's guns put on everything else.

const CELL = 0.3;
const BLOCK = new BoxGeometry(CELL * 0.86, CELL * 0.86, 0.13);
const PLATE_DEPTH = 0.06;

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const blocks: BufferGeometry[] = [];
  const shardSpecs: ShardSpec[] = [];
  const matrix = new Matrix4();

  for (const cell of cells) {
    const x = (cell.x - 2) * CELL;
    const y = (3 - cell.y) * CELL;
    matrix.makeTranslation(x, y, 0.06);
    blocks.push(BLOCK.clone().applyMatrix4(matrix));
    const direction = new Vector3(x, y, 0.4);
    shardSpecs.push({ direction: direction.normalize(), color: PANEL.clone(), size: 0.28 });
  }

  const blockGeometry = mergeGeometries(blocks);
  const blockMaterial = new MeshBasicMaterial({ color: hdr(PANEL, 1.6) });
  group.add(new Mesh(blockGeometry, blockMaterial));
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(STEEL, 0.6), fog: false }));
  group.add(new LineSegments(new EdgesGeometry(blockGeometry), edgeMaterial));
  for (const geometry of blocks) geometry.dispose();

  const plateWidth = 5 * CELL + 0.26;
  const plateHeight = 7 * CELL + 0.26;
  const plateMaterial = new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(1.6) });
  const plate = new Mesh(new BoxGeometry(plateWidth, plateHeight, PLATE_DEPTH), plateMaterial);
  plate.position.set(0, 0, -0.02);
  group.add(plate);

  // Hazard frame: four thin bars, the placard's painted border.
  const frames: BufferGeometry[] = [];
  for (const [w, h, x, y] of [
    [plateWidth + 0.16, 0.09, 0, plateHeight / 2 + 0.04],
    [plateWidth + 0.16, 0.09, 0, -plateHeight / 2 - 0.04],
    [0.09, plateHeight + 0.16, plateWidth / 2 + 0.04, 0],
    [0.09, plateHeight + 0.16, -plateWidth / 2 - 0.04, 0],
  ] as const) {
    matrix.makeTranslation(x, y, 0.02);
    frames.push(new BoxGeometry(w, h, 0.07).applyMatrix4(matrix));
  }
  const frameMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 1.35) });
  group.add(new Mesh(mergeGeometries(frames), frameMaterial));
  for (const geometry of frames) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.accent = HAZARD.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.letterMaterials = { blockMaterial, plateMaterial, frameMaterial, edgeMaterial };
  return group;
}

type LetterMaterials = {
  blockMaterial: MeshBasicMaterial;
  plateMaterial: MeshBasicMaterial;
  frameMaterial: MeshBasicMaterial;
  edgeMaterial: LineBasicMaterial;
};

function materialsOf(group: Group) {
  return group.userData.letterMaterials as LetterMaterials | undefined;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = materialsOf(group);
  if (!materials) return;
  materials.blockMaterial.color.copy(locked ? hdr(HAZARD, 2.1) : hdr(PANEL, 1.6));
  materials.frameMaterial.color.copy(locked ? hdr(AMBER, 1.9) : hdr(HAZARD, 1.35));
  materials.plateMaterial.color.copy(
    locked ? new Color(0.2, 0.08, 0.02) : SLATE.clone().multiplyScalar(1.6),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = materialsOf(group);
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.blockMaterial.color.copy(FAULT);
  materials.frameMaterial.color.copy(hdr(FAULT, 0.7));
  materials.plateMaterial.color.copy(new Color(0.22, 0.02, 0.01));
}
