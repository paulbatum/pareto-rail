import {
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
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
import { JELLY_DEEP, JELLY_GOLD, JELLY_GREEN, PARASITE_PALE, PARASITE_VIOLET, PLAYER_WHITE, hdr } from './palette';

// The animal writes with its own light. Each glyph is a 5×7 grid of photophore
// beads suspended in a soft membrane pad, ringed by a thin rim of the same
// green-gold the strands use. Locking a glyph pushes the beads gold; a denied
// release infects the whole pad violet — the level's one wrong colour, used as
// its one refusal.

const CELL = 0.36;
const WIDTH = 4 * CELL;
const HEIGHT = 6 * CELL;
const SPAN = Math.max(WIDTH, HEIGHT);
const beadUnit = new OctahedronGeometry(0.15, 0);

// Glyph geometry is identical every time a character is spawned, so it is
// built once per character and shared; only the materials are per-instance.
const glyphCache = new Map<string, { beads: BufferGeometry; shardSpecs: ShardSpec[] }>();
const padGeometry = new CircleGeometry(SPAN * 0.74, 24);
const rimGeometry = new RingGeometry(SPAN * 0.76, SPAN * 0.79, 32);

function glyphGeometry(character: string) {
  const key = character.toUpperCase();
  const existing = glyphCache.get(key);
  if (existing) return existing;

  const shardSpecs: ShardSpec[] = [];
  const beads: BufferGeometry[] = [];
  for (const cell of glyphOnCells(key)) {
    const offset = new Vector3(cell.x * CELL - WIDTH / 2, HEIGHT / 2 - cell.y * CELL, 0.1);
    beads.push(beadUnit.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: JELLY_GREEN.clone(), size: 0.26 });
  }
  const entry = { beads: mergeGeometries(beads), shardSpecs };
  for (const geometry of beads) geometry.dispose();
  glyphCache.set(key, entry);
  return entry;
}

export function createLetterMesh(character: string) {
  const group = new Group();
  const glyph = glyphGeometry(character);
  const shardSpecs = glyph.shardSpecs.map((spec) => ({ ...spec, color: spec.color.clone() }));

  // Beads carry the reading even with bloom at zero: solid, opaque, bright.
  const beadMaterial = new MeshBasicMaterial({ color: hdr(JELLY_GREEN, 1.35) });
  group.add(new Mesh(glyph.beads, beadMaterial));

  // Membrane pad behind the beads. Additive and dim so it reads as tissue, not
  // as a plate — and so it never occludes anything behind it.
  const padMaterial = createAdditiveBasicMaterial({
    color: hdr(JELLY_DEEP, 0.55),
    opacity: 0.9,
    side: DoubleSide,
  });
  group.add(new Mesh(padGeometry, padMaterial));

  const rimMaterial = createAdditiveBasicMaterial({
    color: hdr(JELLY_GOLD, 0.7),
    opacity: 0.85,
    side: DoubleSide,
  });
  group.add(new Mesh(rimGeometry, rimMaterial));

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = JELLY_GREEN.clone();
  group.userData.lockRingScale = 1.15;
  group.userData.letterMaterials = { beadMaterial, padMaterial, rimMaterial };
  return group;
}

type LetterMaterials = {
  beadMaterial: MeshBasicMaterial;
  padMaterial: MeshBasicMaterial;
  rimMaterial: MeshBasicMaterial;
};

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.beadMaterial.color.copy(locked ? hdr(JELLY_GOLD, 1.7) : hdr(JELLY_GREEN, 1.35));
  materials.padMaterial.color.copy(locked ? hdr(JELLY_GREEN, 0.5) : hdr(JELLY_DEEP, 0.55));
  materials.rimMaterial.color.copy(locked ? hdr(PLAYER_WHITE, 1.1) : hdr(JELLY_GOLD, 0.7));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.beadMaterial.color.copy(hdr(PARASITE_PALE, 1.2));
  materials.padMaterial.color.copy(hdr(PARASITE_VIOLET, 0.5));
  materials.rimMaterial.color.copy(hdr(PARASITE_VIOLET, 1.0));
}

/** Idle shimmer so the attract word breathes with the rest of the animal. */
export function pulseLetter(group: Group, elapsed: number, index: number) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials || group.userData.locked === true) return;
  const glow = 1.25 + Math.sin(elapsed * 1.9 + index * 0.8) * 0.22;
  materials.beadMaterial.color.copy(hdr(JELLY_GREEN, glow));
}

