import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
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
import { CLEAN_WHITE, JELLY_GOLD, JELLY_GREEN, JELLY_MEMBRANE, PARASITE_VIOLET, hdr } from './palette';

// Letters are colonies of bioluminescent nodules: 5×7 glyphs of small glowing
// beads on a translucent membrane disc, the animal's own light spelling the
// word. Locking a letter warms the beads to gold; a denied release sours the
// whole colony violet for a breath.

const CELL = 0.36;
const beadGeometry = new SphereGeometry(0.15, 8, 6);
const membraneGeometry = new CircleGeometry(1.45, 28);
const rimGeometry = new CircleGeometry(1.5, 28);
const colonyGeometries = new Map<string, BufferGeometry>();

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const shardSpecs: ShardSpec[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.08);
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: JELLY_GREEN.clone(), size: 0.28 });
  }

  // One merged colony geometry per character, shared across every letter instance.
  const key = char.toUpperCase();
  let colony = colonyGeometries.get(key);
  if (!colony) {
    const beads: BufferGeometry[] = [];
    for (const cell of cells) {
      const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.08);
      beads.push(beadGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    }
    colony = mergeGeometries(beads);
    for (const geometry of beads) geometry.dispose();
    colonyGeometries.set(key, colony);
  }

  // Solid bead cores carry legibility with bloom off; an additive halo layer
  // makes them read as light when it is on.
  const beadMaterial = new MeshBasicMaterial({ color: hdr(JELLY_GREEN, 1.15) });
  group.add(new Mesh(colony, beadMaterial));
  const haloMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.35) });
  const halo = new Mesh(colony, haloMaterial);
  halo.scale.setScalar(1.6);
  group.add(halo);

  // The membrane: a faint disc behind the colony, rim-lit.
  const membraneMaterial = new MeshBasicMaterial({
    color: JELLY_MEMBRANE.clone().multiplyScalar(0.28),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: DoubleSide,
  });
  const membrane = new Mesh(membraneGeometry, membraneMaterial);
  membrane.position.z = -0.12;
  group.add(membrane);
  const rimMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_MEMBRANE, 0.7), side: DoubleSide });
  const rim = new Mesh(rimGeometry, rimMaterial);
  rim.position.z = -0.16;
  rim.scale.set(1, 1, 1);
  group.add(rim);

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = JELLY_GREEN.clone();
  group.userData.letterMaterials = { beadMaterial, haloMaterial, membraneMaterial, rimMaterial };
  return group;
}

type LetterMaterials = {
  beadMaterial: MeshBasicMaterial;
  haloMaterial: MeshBasicMaterial;
  membraneMaterial: MeshBasicMaterial;
  rimMaterial: MeshBasicMaterial;
};

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.beadMaterial.color.copy(locked ? hdr(JELLY_GOLD, 1.5) : hdr(JELLY_GREEN, 1.15));
  materials.haloMaterial.color.copy(locked ? hdr(CLEAN_WHITE, 0.6) : hdr(JELLY_GREEN, 0.35));
  materials.membraneMaterial.color.copy(locked ? JELLY_GOLD.clone().multiplyScalar(0.22) : JELLY_MEMBRANE.clone().multiplyScalar(0.28));
  materials.rimMaterial.color.copy(locked ? hdr(JELLY_GOLD, 1.1) : hdr(JELLY_MEMBRANE, 0.7));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.beadMaterial.color.copy(hdr(PARASITE_VIOLET, 1.2));
    materials.haloMaterial.color.copy(hdr(PARASITE_VIOLET, 0.5));
    materials.membraneMaterial.color.copy(new Color(0.12, 0.03, 0.16));
    materials.rimMaterial.color.copy(hdr(PARASITE_VIOLET, 0.9));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
