import {
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { BIO_GOLD, BIO_GREEN, LUMEN, MID_WATER, PARASITE_HOT, PARASITE_VIOLET, hdr } from './palette';

// REVIVE and RETURN are written the way the animal writes: a colony of
// photophores lit on a dark membrane disc, ringed by the same margin light
// that runs round the bell. Locking one drives the pods gold; a rejected
// release floods the whole colony violet, the level's one wrong colour.

const CELL = 0.32;
const podGeometry = new OctahedronGeometry(0.15, 0);

type LetterMaterials = {
  pods: MeshBasicMaterial;
  membrane: MeshBasicMaterial;
  ring: MeshBasicMaterial;
};

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const shardSpecs: ShardSpec[] = [];
  const pods: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.1);
    pods.push(podGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: BIO_GOLD.clone(), size: 0.22 });
  }

  const podMaterial = createAdditiveBasicMaterial({ color: hdr(BIO_GOLD, 1.4) });
  group.add(new Mesh(mergeGeometries(pods), podMaterial));
  for (const geometry of pods) geometry.dispose();

  // A dark membrane so the pods stay legible with bloom turned all the way off.
  const membraneMaterial = new MeshBasicMaterial({
    color: MID_WATER.clone().multiplyScalar(0.85),
    transparent: true,
    opacity: 0.82,
  });
  const membrane = new Mesh(new CircleGeometry(0.98, 26), membraneMaterial);
  group.add(membrane);

  const ringMaterial = createAdditiveBasicMaterial({ color: hdr(BIO_GREEN, 0.9), opacity: 0.85 });
  const ring = new Mesh(new RingGeometry(0.98, 1.06, 30), ringMaterial);
  ring.position.z = 0.02;
  group.add(ring);

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = BIO_GOLD.clone();
  group.userData.lockRingScale = 1.15;
  group.userData.letterMaterials = { pods: podMaterial, membrane: membraneMaterial, ring: ringMaterial } satisfies LetterMaterials;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.pods.color.copy(locked ? hdr(LUMEN, 2.1) : hdr(BIO_GOLD, 1.4));
  materials.ring.color.copy(locked ? hdr(BIO_GOLD, 1.7) : hdr(BIO_GREEN, 0.9));
  materials.membrane.color.copy(locked ? new Color(0.05, 0.16, 0.13) : MID_WATER.clone().multiplyScalar(0.85));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.pods.color.copy(hdr(PARASITE_HOT, 1.5));
  materials.ring.color.copy(hdr(PARASITE_VIOLET, 1.4));
  materials.membrane.color.copy(new Color(0.09, 0.02, 0.13));
}
