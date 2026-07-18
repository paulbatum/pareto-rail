import {
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { BIO_GREEN, DEEP_TEAL, PARASITE_HOT, PARASITE_VIOLET, SUN_GOLD, WARM_WHITE, hdr } from './palette';

// Living signage: each letter is a colony of bioluminescent plankton — 5×7
// grids of glowing beads held on a dim membrane disc, the way lure-light
// patterns sit on deep-sea animals. Locking a letter feeds it sunlight and
// the beads flush gold; a denied release flushes the colony the parasites'
// violet — the only time anything friendly wears that color.

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
    shardSpecs.push({ direction, color: BIO_GREEN.clone(), size: 0.3 });
  }

  const beadMaterial = createAdditiveBasicMaterial({ color: hdr(BIO_GREEN, 1.15) });
  group.add(new Mesh(mergeGeometries(beads), beadMaterial));
  for (const geometry of beads) geometry.dispose();

  // The membrane: a dim translucent disc that keeps the glyph legible with
  // bloom at zero by giving the beads a dark ground to sit on.
  const membraneMaterial = new MeshBasicMaterial({
    color: DEEP_TEAL.clone().multiplyScalar(0.5),
    transparent: true,
    opacity: 0.82,
  });
  const membrane = new Mesh(new CircleGeometry(Math.hypot(width, height) * 0.62, 26), membraneMaterial);
  group.add(membrane);

  // A fine ciliated rim, always faintly lit.
  const rimMaterial = createAdditiveBasicMaterial({ color: hdr(BIO_GREEN, 0.45) });
  const rim = new Mesh(new RingGeometry(Math.hypot(width, height) * 0.62, Math.hypot(width, height) * 0.66, 26), rimMaterial);
  rim.position.z = 0.04;
  group.add(rim);

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = BIO_GREEN.clone();
  group.userData.letterMaterials = { beadMaterial, membraneMaterial, rimMaterial };
  return group;
}

type LetterMaterials = { beadMaterial: MeshBasicMaterial; membraneMaterial: MeshBasicMaterial; rimMaterial: MeshBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.beadMaterial.color.copy(locked ? hdr(SUN_GOLD, 1.7) : hdr(BIO_GREEN, 1.15));
  materials.rimMaterial.color.copy(locked ? hdr(WARM_WHITE, 1.1) : hdr(BIO_GREEN, 0.45));
  materials.membraneMaterial.color.copy(locked ? new Color(0.12, 0.09, 0.03) : DEEP_TEAL.clone().multiplyScalar(0.5));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.beadMaterial.color.copy(hdr(PARASITE_VIOLET, 1.4));
    materials.rimMaterial.color.copy(hdr(PARASITE_HOT, 1.0));
    materials.membraneMaterial.color.copy(new Color(0.09, 0.03, 0.11));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
