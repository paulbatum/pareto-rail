import {
  BoxGeometry,
  Color,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';

// The shared runner uses START! and REPLAY. These are deliberately chunky
// panel cells, not seven-segment numerals, so R, T, and Y stay unmistakable at
// the 20m attract/replay distance.
const PANEL = new Color(0.74, 0.81, 0.8);
const PANEL_DARK = new Color(0.08, 0.13, 0.16);
const ORANGE = new Color(1.0, 0.28, 0.045);
const ORANGE_HOT = new Color(1.7, 0.42, 0.055);
const COLD = new Color(0.42, 0.62, 0.68);

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const cellGeometry = new BoxGeometry(0.31, 0.31, 0.12);
  const fillMaterial = new MeshBasicMaterial({ color: PANEL.clone() });
  const edgeMaterial = new LineBasicMaterial({ color: ORANGE_HOT.clone() });
  const cellSpacing = 0.36;
  const width = 4 * cellSpacing;
  const height = 6 * cellSpacing;

  for (const cell of cells) {
    const block = new Mesh(cellGeometry, fillMaterial);
    block.position.set(cell.x * cellSpacing - width / 2, height / 2 - cell.y * cellSpacing, 0);
    group.add(block);
  }

  const frame = new Mesh(new RingGeometry(1.55, 1.59, 32), edgeMaterial);
  group.add(frame);
  group.userData.isLetter = true;
  group.userData.letterMaterials = { fillMaterial, edgeMaterial };
  group.userData.accent = ORANGE.clone();
  group.userData.letter = character.toUpperCase();
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial } | undefined;
  if (!materials) return;
  materials.fillMaterial.color.copy(locked ? COLD : PANEL);
  materials.edgeMaterial.color.copy(locked ? ORANGE_HOT.clone().lerp(PANEL, 0.62) : ORANGE_HOT);
  group.userData.locked = locked;
  group.userData.denied = false;
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial } | undefined;
  if (!materials) return;
  if (denied) {
    materials.fillMaterial.color.copy(PANEL_DARK);
    materials.edgeMaterial.color.copy(new Color(1.5, 0.08, 0.025));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
  group.userData.denied = denied;
}
