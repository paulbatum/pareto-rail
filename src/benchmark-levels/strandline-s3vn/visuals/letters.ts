import {
  BufferGeometry,
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
import { tubeGeometry } from './animal';
import type { ShardSpec } from './effects';
import { JELLY_FLESH, LUME_GOLD, LUME_GREEN, SICK_VIOLET, hdr } from './palette';

// AWAKEN / REVIVE are written the way the animal writes anything: colonies of
// bioluminescent polyps budded on a translucent membrane, with a fringe of
// tendrils hanging underneath. Each letter is a 5×7 grid of polyps, so the
// glyphs stay unambiguous at gameplay distance; locking one calls the light up
// gold, and a refused release curdles the whole colony violet.

const CELL = 0.36;
const POLYP = new SphereGeometry(0.145, 8, 6);

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const shardSpecs: ShardSpec[] = [];
  const polyps: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.09);
    polyps.push(POLYP.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: LUME_GREEN.clone(), size: 0.26 });
  }

  const polypMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GREEN, 1.0) });
  group.add(new Mesh(mergeGeometries(polyps), polypMaterial));
  for (const geometry of polyps) geometry.dispose();

  // The membrane the colony sits on: a lens of jelly you can see straight through.
  const membraneMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_FLESH, 0.2), side: DoubleSide });
  const membrane = new Mesh(new SphereGeometry(1, 18, 12), membraneMaterial);
  membrane.scale.set(width * 0.78, height * 0.66, 0.09);
  group.add(membrane);

  // Tendril fringe hanging off the bottom edge — it is alive, not a sign.
  const fringes: BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const x = (i - 2) * CELL * 1.05;
    const points: Vector3[] = [];
    const radii: number[] = [];
    const colors: Color[] = [];
    const length = 0.55 + ((i * 37) % 11) / 26;
    for (let s = 0; s <= 6; s += 1) {
      const t = s / 6;
      points.push(new Vector3(x + Math.sin(t * 3 + i) * 0.07, -height / 2 - 0.16 - t * length, 0.05));
      radii.push(0.045 * (1 - t * 0.8));
      colors.push(LUME_GREEN.clone().multiplyScalar(0.9 - t * 0.8));
    }
    fringes.push(tubeGeometry(points, radii, colors, 4));
  }
  const fringeMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GREEN, 0.7) });
  fringeMaterial.vertexColors = true;
  group.add(new Mesh(mergeGeometries(fringes), fringeMaterial));
  for (const geometry of fringes) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.letterMaterials = { polypMaterial, membraneMaterial, fringeMaterial };
  return group;
}

type LetterMaterials = {
  polypMaterial: MeshBasicMaterial;
  membraneMaterial: MeshBasicMaterial;
  fringeMaterial: MeshBasicMaterial;
};

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.polypMaterial.color.copy(locked ? hdr(LUME_GOLD, 1.5) : hdr(LUME_GREEN, 1.0));
  materials.membraneMaterial.color.copy(locked ? hdr(LUME_GOLD, 0.5) : hdr(JELLY_FLESH, 0.2));
  materials.fringeMaterial.color.copy(locked ? hdr(LUME_GOLD, 1.0) : hdr(LUME_GREEN, 0.7));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.polypMaterial.color.copy(hdr(SICK_VIOLET, 1.7));
  materials.membraneMaterial.color.copy(hdr(SICK_VIOLET, 0.4));
  materials.fringeMaterial.color.copy(hdr(SICK_VIOLET, 0.9));
}
