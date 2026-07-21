import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { ALERT, HAZARD, PANEL_DARK, PANEL_WHITE, hdr } from './palette';
import type { DebrisSpec } from './effects';

// The words are placards, not signage: a white panel plate bolted to the
// tether with the character stencilled through it in hazard orange, four bolt
// heads and a black border stripe. Locking one lights the plate like a
// retroreflector — the stencil goes white on orange.

const CELL = 0.38;
const COLUMNS = 5;
const ROWS = 7;

const cellGeometry = new BoxGeometry(CELL * 0.92, CELL * 0.92, 0.1);
cellGeometry.translate(0, 0, 0.07);

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character.toUpperCase());
  const debris: DebrisSpec[] = [];
  const stencils: BufferGeometry[] = [];

  const width = (COLUMNS - 1) * CELL;
  const height = (ROWS - 1) * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    stencils.push(cellGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    debris.push({
      direction: offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1),
      color: PANEL_WHITE.clone(),
      size: 0.3,
    });
  }

  const plateMaterial = new MeshBasicMaterial({ color: PANEL_WHITE, side: DoubleSide });
  const plate = new Mesh(new BoxGeometry(width + CELL * 1.9, height + CELL * 1.5, 0.12), plateMaterial);

  const borderMaterial = new MeshBasicMaterial({ color: PANEL_DARK, side: DoubleSide });
  const border = new Mesh(new PlaneGeometry(width + CELL * 2.4, height + CELL * 2.0), borderMaterial);
  border.position.z = -0.09;

  const stencilMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 0.25), side: DoubleSide });
  const stencil = new Mesh(mergeGeometries(stencils), stencilMaterial);
  for (const geometry of stencils) geometry.dispose();

  // Four bolt heads: the plate is fastened to something.
  const boltMaterial = new MeshBasicMaterial({ color: PANEL_DARK });
  const boltGeometry = new BoxGeometry(0.14, 0.14, 0.16);
  const bolts = new Group();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const bolt = new Mesh(boltGeometry, boltMaterial);
      bolt.position.set(sx * (width / 2 + CELL * 0.7), sy * (height / 2 + CELL * 0.5), 0.1);
      bolts.add(bolt);
    }
  }

  // Rejection hatch: two red bars struck across the plate, hidden until denied.
  const hatchMaterial = new MeshBasicMaterial({ color: hdr(ALERT, 0.9), side: DoubleSide, transparent: true, opacity: 0 });
  const hatch = new Group();
  for (const angle of [0.62, -0.62]) {
    const bar = new Mesh(new PlaneGeometry(width + CELL * 2.6, 0.22), hatchMaterial);
    bar.rotation.z = angle;
    bar.position.z = 0.2;
    hatch.add(bar);
  }
  hatch.visible = false;

  group.add(border, plate, stencil, bolts, hatch);
  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.debrisSpecs = debris;
  group.userData.accent = HAZARD.clone();
  group.userData.lockRingScale = 1.6;
  group.userData.letterMaterials = { plateMaterial, stencilMaterial, borderMaterial, hatchMaterial, hatch };
  return group;
}

type LetterMaterials = {
  plateMaterial: MeshBasicMaterial;
  stencilMaterial: MeshBasicMaterial;
  borderMaterial: MeshBasicMaterial;
  hatchMaterial: MeshBasicMaterial;
  hatch: Group;
};

function materialsOf(group: Group) {
  return group.userData.letterMaterials as LetterMaterials | undefined;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = materialsOf(group);
  if (!materials) return;
  materials.hatch.visible = false;
  materials.hatchMaterial.opacity = 0;
  materials.plateMaterial.color.copy(locked ? hdr(HAZARD, 0.85) : PANEL_WHITE);
  materials.stencilMaterial.color.copy(locked ? hdr(PANEL_WHITE, 1.2) : hdr(HAZARD, 0.25));
  materials.borderMaterial.color.copy(locked ? new Color(0.24, 0.10, 0.02) : PANEL_DARK);
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = materialsOf(group);
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.hatch.visible = true;
  materials.hatchMaterial.opacity = 1;
  materials.plateMaterial.color.copy(new Color(0.34, 0.10, 0.08));
  materials.stencilMaterial.color.copy(hdr(ALERT, 0.6));
  materials.borderMaterial.color.copy(new Color(0.16, 0.02, 0.02));
}
