import {
  BoxGeometry,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { GUNMETAL, HAZARD_ORANGE, hdr, INSTRUMENT, INSTRUMENT_HOT, WARNING_RED } from './palette';
import type { ShardSpec } from './effects';

// Station signage: 5×7 stencil glyphs cut from white panel cells, riveted to a
// dark placard with a hazard-orange border. Locking a placard lights the cells
// instrument-white; a denied release flashes them warning red.
const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.26, 0.26, 0.08);
const PLACARD_FILL = new Color(0.8, 0.82, 0.86);

const WIDTH = 4 * CELL;
const HEIGHT = 6 * CELL;
const glyphCache = new Map<string, { geometry: BufferGeometry; shardSpecs: ShardSpec[] }>();
let plateGeometry: BoxGeometry | null = null;
let rimGeometry: EdgesGeometry | null = null;

function glyphGeometry(char: string) {
  const key = char.toUpperCase();
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const fills: BufferGeometry[] = [];
  const shardSpecs: ShardSpec[] = [];
  for (const cell of glyphOnCells(key)) {
    const offset = new Vector3(cell.x * CELL - WIDTH / 2, HEIGHT / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    fills.push(cellGeometry.clone().applyMatrix4(matrix));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: PLACARD_FILL.clone(), size: 0.3 });
  }
  const geometry = fills.length ? mergeGeometries(fills) : cellGeometry.clone();
  for (const piece of fills) piece.dispose();
  const entry = { geometry, shardSpecs };
  glyphCache.set(key, entry);
  return entry;
}

export function createLetterMesh(char: string) {
  const group = new Group();
  const glyph = glyphGeometry(char);
  const shardSpecs = glyph.shardSpecs.map((spec) => ({ ...spec, direction: spec.direction.clone(), color: spec.color.clone() }));

  const fillMaterial = new MeshBasicMaterial({ color: PLACARD_FILL.clone() });
  group.add(new Mesh(glyph.geometry, fillMaterial));

  // Placard: dark plate with an orange rim line.
  plateGeometry ??= new BoxGeometry(WIDTH + 0.62, HEIGHT + 0.62, 0.05);
  rimGeometry ??= new EdgesGeometry(new PlaneGeometry(WIDTH + 0.62, HEIGHT + 0.62));
  const plate = new Mesh(plateGeometry, new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.4) }));
  plate.position.z = -0.08;
  group.add(plate);
  const rimMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(HAZARD_ORANGE, 0.9) }));
  const rim = new LineSegments(rimGeometry, rimMaterial);
  rim.position.z = -0.04;
  group.add(rim);

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = HAZARD_ORANGE.clone();
  group.userData.letterMaterials = { fillMaterial, rimMaterial };
  group.userData.lockRingScale = 1.2;
  return group;
}

type LetterMaterials = { fillMaterial: MeshBasicMaterial; rimMaterial: LineBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.fillMaterial.color.copy(locked ? hdr(INSTRUMENT_HOT, 1.5) : PLACARD_FILL);
  materials.rimMaterial.color.copy(locked ? hdr(INSTRUMENT, 1.6) : hdr(HAZARD_ORANGE, 0.9));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.fillMaterial.color.copy(hdr(WARNING_RED, 1.3));
    materials.rimMaterial.color.copy(hdr(WARNING_RED, 1.5));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
