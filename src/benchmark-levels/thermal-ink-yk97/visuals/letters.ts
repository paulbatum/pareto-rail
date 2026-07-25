import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { modeMaterial, type ModedSpec } from './moded';
import { CREAM, hdr, IR_COLD, IR_HOT, LAMP, RUST_DARK, SIGNAL_RED } from './palette';

// Harbor signage: dirty cream stencil plates bolted to a rust backing sheet,
// the way berth numbers are painted on dock gates. Lock catches the plate in
// lamplight; denial flickers it hazard-red.
//
// State changes mutate the moded specs (not material colors) so they compose
// with the per-frame infrared mode driver.

const CELL = 0.32;
const plateGeometry = new BoxGeometry(0.285, 0.285, 0.07);
const boltGeometry = new CircleGeometry(0.045, 8);

type LetterSpecs = { plates: ModedSpec; backing: ModedSpec };

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const width = 4 * CELL;
  const height = 6 * CELL;

  const plates: BufferGeometry[] = [];
  for (const cell of cells) {
    const matrix = new Matrix4().makeTranslation(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    plates.push(plateGeometry.clone().applyMatrix4(matrix));
  }

  const plateMaterial = modeMaterial(new MeshBasicMaterial({ color: CREAM.clone() }), {
    murk: CREAM.clone(),
    ir: hdr(IR_HOT, 1.1),
    blindDim: 0.6,
  });
  const plateMesh = new Mesh(mergeGeometries(plates), plateMaterial);
  plateMesh.userData.ownsGeometry = true;
  for (const geometry of plates) geometry.dispose();

  const backingMaterial = modeMaterial(new MeshBasicMaterial({ color: RUST_DARK.clone() }), {
    murk: RUST_DARK.clone(),
    ir: IR_COLD.clone(),
    blindDim: 0.6,
  });
  const backing = new Mesh(new PlaneGeometry(width + 0.72, height + 0.92), backingMaterial);
  backing.userData.ownsGeometry = true;
  backing.position.z = -0.09;

  const boltMaterial = modeMaterial(new MeshBasicMaterial({ color: CREAM.clone().multiplyScalar(0.45) }), {
    murk: CREAM.clone().multiplyScalar(0.45),
    ir: IR_COLD.clone(),
    blindDim: 0.6,
  });
  const bolts = new Group();
  for (const [bx, by] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const bolt = new Mesh(boltGeometry, boltMaterial);
    bolt.position.set(bx * (width / 2 + 0.24), by * (height / 2 + 0.32), -0.04);
    bolts.add(bolt);
  }

  group.add(backing, plateMesh, bolts);
  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.letterSpecs = {
    plates: plateMaterial.userData.moded as ModedSpec,
    backing: backingMaterial.userData.moded as ModedSpec,
  } satisfies LetterSpecs;
  group.userData.letterMaterials = { plates: plateMaterial, backing: backingMaterial };
  group.userData.accent = LAMP.clone();
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const specs = group.userData.letterSpecs as LetterSpecs | undefined;
  if (!specs) return;
  specs.plates.murk.copy(locked ? hdr(LAMP, 1.5) : CREAM);
  specs.plates.ir.copy(locked ? hdr(IR_HOT, 1.6) : hdr(IR_HOT, 1.1));
  specs.backing.murk.copy(locked ? RUST_DARK.clone().multiplyScalar(1.8) : RUST_DARK);
}

/** Direct flicker override, applied after the mode driver each frame while a denial is fresh. */
export function flashLetterDenied(group: Group, t: number) {
  const materials = group.userData.letterMaterials as { plates: MeshBasicMaterial; backing: MeshBasicMaterial } | undefined;
  if (!materials) return;
  const flicker = 0.55 + 0.45 * Math.sin(t * 46);
  materials.plates.color.copy(hdr(SIGNAL_RED, 0.6 + flicker * 0.8));
  materials.backing.color.copy(RUST_DARK.clone().lerp(SIGNAL_RED, 0.35 * flicker));
}
