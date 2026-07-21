import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, hdr, INTERLOCK_WARN, VIOLET, WHITE_ARC } from './palette';

// LOAD / RELOAD are spelled in the gun's own hardware: each lit cell is a
// capacitor plate on a dark breech panel, inside a hex coil rim. Locking a
// letter charges its plates from arc blue to white; a rejected release drops
// the whole panel to a dead fault red.

const CELL = 0.34;
const CELL_SIZE = 0.27;
const COLUMNS = 5;
const ROWS = 7;

const CELL_IDLE = hdr(ARC_BLUE, 1.5);
const CELL_LOCKED = hdr(WHITE_ARC, 2.4);
const CELL_DENIED = hdr(INTERLOCK_WARN, 1.6);
const RIM_IDLE = hdr(VIOLET, 0.5);
const RIM_LOCKED = hdr(WHITE_ARC, 1.4);
const RIM_DENIED = hdr(INTERLOCK_WARN, 0.9);
const PANEL = new Color(0.015, 0.022, 0.045);
const PANEL_DENIED = new Color(0.08, 0.012, 0.008);

// Shared across every letter panel: the start and replay words rebuild these
// six to eight times a session and none of the shapes ever differ.
const CELL_GEOMETRY = new BoxGeometry(CELL_SIZE, CELL_SIZE, 0.09);
const PANEL_GEOMETRY = new PlaneGeometry(COLUMNS * CELL + 0.34, ROWS * CELL + 0.34);
const RIM_GEOMETRY = new RingGeometry(1.5, 1.58, 6);
const BAR_GEOMETRY = new PlaneGeometry(2.5, 0.06);

type LetterParts = {
  cells: MeshBasicMaterial[];
  rims: MeshBasicMaterial[];
  panel: MeshBasicMaterial;
};

// The default only exists so the model snapshot tool can render a panel; the
// runner always passes the letter it wants.
export function createLetterMesh(character = 'R') {
  const group = new Group();
  const cells: MeshBasicMaterial[] = [];
  const rims: MeshBasicMaterial[] = [];

  // Opaque breech panel behind the plates: the letters stay readable with the
  // bloom slider at zero because the contrast is geometric, not additive.
  const panelMaterial = new MeshBasicMaterial({ color: PANEL, side: DoubleSide, toneMapped: false });
  const panel = new Mesh(PANEL_GEOMETRY, panelMaterial);
  panel.position.z = -0.09;
  group.add(panel);

  for (const cell of glyphOnCells(character)) {
    const material = createAdditiveBasicMaterial({ color: CELL_IDLE, side: DoubleSide });
    material.toneMapped = false;
    const plate = new Mesh(CELL_GEOMETRY, material);
    plate.position.set((cell.x - (COLUMNS - 1) / 2) * CELL, ((ROWS - 1) / 2 - cell.y) * CELL, 0);
    group.add(plate);
    cells.push(material);
  }

  // Hex rim: the same six-fold coil the whole barrel is built from.
  const rimMaterial = createAdditiveBasicMaterial({ color: RIM_IDLE, side: DoubleSide });
  rimMaterial.toneMapped = false;
  const rim = new Mesh(RIM_GEOMETRY, rimMaterial);
  rim.rotation.z = Math.PI / 6;
  group.add(rim);
  rims.push(rimMaterial);

  // Conductor rails top and bottom — the letters are riding the gun too.
  for (const sign of [-1, 1]) {
    const railMaterial = createAdditiveBasicMaterial({ color: RIM_IDLE, side: DoubleSide });
    railMaterial.toneMapped = false;
    const bar = new Mesh(BAR_GEOMETRY, railMaterial);
    bar.position.set(0, sign * 1.42, -0.02);
    group.add(bar);
    rims.push(railMaterial);
  }

  group.userData.isLetter = true;
  group.userData.letterParts = { cells, rims, panel: panelMaterial } satisfies LetterParts;
  return group;
}

export function setLetterLocked(mesh: Group, locked: boolean) {
  const parts = mesh.userData.letterParts as LetterParts | undefined;
  if (!parts) return;
  for (const cell of parts.cells) cell.color.copy(locked ? CELL_LOCKED : CELL_IDLE);
  for (const rim of parts.rims) rim.color.copy(locked ? RIM_LOCKED : RIM_IDLE);
  parts.panel.color.copy(PANEL);
}

export function setLetterDenied(mesh: Group, denied: boolean) {
  const parts = mesh.userData.letterParts as LetterParts | undefined;
  if (!parts) return;
  if (!denied) {
    setLetterLocked(mesh, false);
    return;
  }
  for (const cell of parts.cells) cell.color.copy(CELL_DENIED);
  for (const rim of parts.rims) rim.color.copy(RIM_DENIED);
  parts.panel.color.copy(PANEL_DENIED);
}
