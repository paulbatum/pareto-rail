import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { once } from './merge';
import { CHARCOAL, HAZARD, ICE, KEYLINE, PANEL_WHITE, SIGNAL_WHITE, hdr } from './palette';

// Launch-gantry signage: each letter is a 5×7 board of white paneling with a
// dark keyline behind every plate (so it survives a storm-grey or sunlit-blue
// sky) and a hazard-orange rivet in each, over a striped kick-plate. Locking a
// letter lights the panels ice-white; a denied release turns them warning red.
// Any A–Z, 0–9 or ! works: the shape comes from the shared 5×7 grids.

const CELL = 0.44;
const PLATE = 0.36;

const plateGeometry = new BoxGeometry(PLATE, PLATE, 0.14);
const backGeometry = new BoxGeometry(CELL * 0.98, CELL * 0.98, 0.1);
const rivetGeometry = new BoxGeometry(0.1, 0.1, 0.05);
const stripeGeometry = new BoxGeometry(CELL * 0.98, 0.15, 0.1);

export function letterGeometry(char: string) {
  return once(`letter:${char.toUpperCase()}`, () => {
    const cells = glyphOnCells(char.toUpperCase());
    const faces: BufferGeometry[] = [];
    const backs: BufferGeometry[] = [];
    const rivets: BufferGeometry[] = [];
    const kickplate: BufferGeometry[] = [];
    const width = 4 * CELL;
    const height = 6 * CELL;
    for (const cell of cells) {
      const x = cell.x * CELL - width / 2;
      const y = height / 2 - cell.y * CELL;
      faces.push(plateGeometry.clone().translate(x, y, 0.02));
      backs.push(backGeometry.clone().translate(x, y, -0.06));
      rivets.push(rivetGeometry.clone().translate(x, y, 0.1));
    }
    for (let i = 0; i < 5; i += 1) {
      kickplate.push(stripeGeometry.clone().translate(i * CELL - width / 2, -height / 2 - CELL * 0.85, -0.02));
    }
    const result = {
      face: mergeGeometries(faces) as BufferGeometry,
      back: mergeGeometries(backs) as BufferGeometry,
      rivet: mergeGeometries(rivets) as BufferGeometry,
      stripeA: mergeGeometries(kickplate.filter((_, i) => i % 2 === 0)) as BufferGeometry,
      stripeB: mergeGeometries(kickplate.filter((_, i) => i % 2 === 1)) as BufferGeometry,
    };
    for (const geometry of [...faces, ...backs, ...rivets, ...kickplate]) geometry.dispose();
    return result;
  });
}

export function createLetterMesh(char: string) {
  const geometry = letterGeometry(char);
  const group = new Group();
  const faceMaterial = new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(1.05) });
  const backMaterial = new MeshBasicMaterial({ color: KEYLINE.clone().multiplyScalar(1.2) });
  const rivetMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 1.5) });
  const stripeMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 1.0) });
  const darkStripe = new MeshBasicMaterial({ color: CHARCOAL.clone().multiplyScalar(2.5) });
  group.add(
    new Mesh(geometry.back, backMaterial),
    new Mesh(geometry.face, faceMaterial),
    new Mesh(geometry.rivet, rivetMaterial),
    new Mesh(geometry.stripeA, stripeMaterial),
    new Mesh(geometry.stripeB, darkStripe),
  );
  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.letterMaterials = { faceMaterial, backMaterial, rivetMaterial };
  return group;
}

type LetterMaterials = { faceMaterial: MeshBasicMaterial; backMaterial: MeshBasicMaterial; rivetMaterial: MeshBasicMaterial };

const FACE = PANEL_WHITE.clone().multiplyScalar(1.05);
const BACK = KEYLINE.clone().multiplyScalar(1.2);
const RIVET = hdr(HAZARD, 1.5);

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.faceMaterial.color.copy(locked ? hdr(SIGNAL_WHITE, 1.5) : FACE);
  materials.backMaterial.color.copy(locked ? hdr(ICE, 1.1) : BACK);
  materials.rivetMaterial.color.copy(locked ? hdr(ICE, 2.0) : RIVET);
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.faceMaterial.color.set(new Color(0.85, 0.16, 0.08));
    materials.backMaterial.color.set(new Color(0.16, 0.01, 0.005));
    materials.rivetMaterial.color.set(new Color(1.8, 0.4, 0.1));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
