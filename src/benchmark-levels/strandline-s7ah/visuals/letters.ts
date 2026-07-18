import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { CORE_WHITE, DENY_VIOLET, JELLY_GOLD, JELLY_GREEN, PARASITE_BRUISE, hdr } from './palette';

// Bioluminescent signage: each letter is a colony of light — 5×7 glyph cells
// as glowing photophore beads over a dark tissue plate, ringed by a fringe of
// short cilia like the rim of a small jelly. Locking a letter turns its
// colony gold; a denied release floods it with the parasites' violet.

const CELL = 0.34;
const beadGeometry = new SphereGeometry(0.15, 8, 6);

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ShardSpec[] = [];
  const beads: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.1);
    beads.push(beadGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: JELLY_GREEN.clone(), size: 0.28 });
  }

  const beadMaterial = new MeshBasicMaterial({ color: hdr(JELLY_GREEN, 1.25) });
  group.add(new Mesh(mergeGeometries(beads), beadMaterial));
  for (const geometry of beads) geometry.dispose();

  // The tissue plate: dark, slightly green, matte — the beads carry the glyph.
  const plateMaterial = new MeshBasicMaterial({ color: new Color(0.03, 0.09, 0.08) });
  const plate = new Mesh(new BoxGeometry(width + 0.6, height + 0.6, 0.1), plateMaterial);
  group.add(plate);

  // Cilia fringe: short soft filaments radiating off the plate rim.
  const ciliaMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.4) });
  const filaments: BufferGeometry[] = [];
  const rimX = (width + 0.9) / 2;
  const rimY = (height + 0.9) / 2;
  const CILIA = 22;
  for (let i = 0; i < CILIA; i += 1) {
    const angle = (i / CILIA) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const scale = 1 / Math.max(Math.abs(dx) / rimX, Math.abs(dy) / rimY);
    const filament = new BoxGeometry(0.045, 0.42, 0.045);
    filament.applyMatrix4(new Matrix4().makeRotationZ(angle - Math.PI / 2));
    filament.applyMatrix4(new Matrix4().makeTranslation(dx * (scale + 0.16), dy * (scale + 0.16), 0));
    filaments.push(filament);
  }
  group.add(new Mesh(mergeGeometries(filaments), ciliaMaterial));
  for (const geometry of filaments) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = JELLY_GREEN.clone();
  group.userData.letterMaterials = { beadMaterial, plateMaterial, ciliaMaterial };
  return group;
}

type LetterMaterials = { beadMaterial: MeshBasicMaterial; plateMaterial: MeshBasicMaterial; ciliaMaterial: MeshBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.beadMaterial.color.copy(locked ? hdr(JELLY_GOLD, 1.7) : hdr(JELLY_GREEN, 1.25));
  materials.ciliaMaterial.color.copy(locked ? hdr(CORE_WHITE, 0.8) : hdr(JELLY_GREEN, 0.4));
  if (locked) materials.plateMaterial.color.setRGB(0.09, 0.07, 0.03);
  else materials.plateMaterial.color.setRGB(0.03, 0.09, 0.08);
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.beadMaterial.color.copy(hdr(DENY_VIOLET, 1.2));
    materials.ciliaMaterial.color.copy(hdr(DENY_VIOLET, 0.6));
    materials.plateMaterial.color.copy(PARASITE_BRUISE).multiplyScalar(0.3);
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
