import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  TorusGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, BARREL, CHARGE_WHITE, COIL_VIOLET, DENIED, ION_CYAN, hdr } from './palette';

type LetterMaterials = {
  cells: MeshBasicMaterial;
  frame: MeshBasicMaterial;
  rails: MeshBasicMaterial;
};

const instanceMatrix = new Matrix4();

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const materials: LetterMaterials = {
    cells: new MeshBasicMaterial({ color: hdr(ION_CYAN, 1.05) }),
    frame: createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.05), opacity: 0.9, side: DoubleSide }),
    rails: new MeshBasicMaterial({ color: hdr(COIL_VIOLET, 0.75) }),
  };

  const cellMesh = new InstancedMesh(new BoxGeometry(0.26, 0.26, 0.11), materials.cells, cells.length);
  cells.forEach((cell, index) => {
    instanceMatrix.makeTranslation((cell.x - 2) * 0.34, (3 - cell.y) * 0.34, 0);
    cellMesh.setMatrixAt(index, instanceMatrix);
  });
  cellMesh.instanceMatrix.needsUpdate = true;

  const frame = new Mesh(new TorusGeometry(1.42, 0.045, 5, 42), materials.frame);
  const inner = new Mesh(new RingGeometry(1.16, 1.19, 24), materials.rails);
  inner.position.z = -0.04;

  for (const side of [-1, 1]) {
    const rail = new Mesh(new BoxGeometry(0.08, 2.35, 0.07), materials.rails);
    rail.position.x = side * 1.03;
    rail.rotation.z = side * 0.08;
    group.add(rail);
  }

  group.add(frame, inner, cellMesh);
  group.userData.isLetter = true;
  group.userData.letterMaterials = materials;
  group.userData.letterCharacter = character;
  group.userData.targetRadius = 1.55;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials;
  if (locked) {
    materials.cells.color.copy(hdr(CHARGE_WHITE, 1.25));
    materials.frame.color.copy(hdr(COIL_VIOLET, 1.35));
    materials.rails.color.copy(hdr(ION_CYAN, 1.0));
  } else {
    materials.cells.color.copy(hdr(ION_CYAN, 1.05));
    materials.frame.color.copy(hdr(ARC_BLUE, 1.05));
    materials.rails.color.copy(hdr(COIL_VIOLET, 0.75));
  }
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.cells.color.copy(hdr(DENIED, 0.9));
  materials.frame.color.copy(hdr(DENIED, 1.25));
  materials.rails.color.copy(new Color(BARREL).lerp(DENIED, 0.4));
}

