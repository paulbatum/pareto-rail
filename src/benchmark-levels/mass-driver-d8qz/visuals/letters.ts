import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_WHITE, FAULT, hdr, PLASMA } from './palette';
import type { ShardSpec } from './enemies';

// CHARGE / RELOAD are spelled in the barrel's own alphabet: every lit cell of
// the 5x7 grid is a miniature accelerator ring — an opaque plasma core inside an
// additive halo. The core carries legibility with bloom at zero; the halo is the
// only part that glows.

const CELL = 0.36;
const CORE_RADIUS = 0.135;
const HALO_INNER = 0.15;
const HALO_OUTER = 0.215;

type LetterMaterials = {
  core: MeshBasicMaterial;
  halo: MeshBasicMaterial;
  bracket: MeshBasicMaterial;
};

type GlyphGeometry = { core: BufferGeometry; halo: BufferGeometry; bracket: BufferGeometry; shards: ShardSpec[] };

// START/REPLAY words respawn on every attract and end screen; the glyph meshes
// are merged once per character and shared from then on.
const glyphCache = new Map<string, GlyphGeometry>();

function glyphGeometry(character: string): GlyphGeometry {
  const key = character.toUpperCase();
  const cached = glyphCache.get(key);
  if (cached) return cached;

  const cells = glyphOnCells(key);
  const cores: BufferGeometry[] = [];
  const halos: BufferGeometry[] = [];
  const shards: ShardSpec[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  const coreGeometry = new CircleGeometry(CORE_RADIUS, 14);
  const haloGeometry = new RingGeometry(HALO_INNER, HALO_OUTER, 16);
  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    cores.push(coreGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z + 0.01)));
    halos.push(haloGeometry.clone().applyMatrix4(matrix));
    shards.push({
      direction: offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1),
      color: PLASMA.clone(),
      size: 0.24,
    });
  }
  coreGeometry.dispose();
  haloGeometry.dispose();

  // Corner brackets: the cell frame the barrel stamps on everything it built.
  const brackets: BufferGeometry[] = [];
  const armX = new BoxGeometry(0.42, 0.05, 0.02);
  const armY = new BoxGeometry(0.05, 0.42, 0.02);
  for (const [sx, sy] of [[-1, 1], [1, -1]] as const) {
    const x = sx * (width / 2 + 0.34);
    const y = sy * (height / 2 + 0.3);
    brackets.push(armX.clone().applyMatrix4(new Matrix4().makeTranslation(x - sx * 0.19, y, 0)));
    brackets.push(armY.clone().applyMatrix4(new Matrix4().makeTranslation(x, y - sy * 0.19, 0)));
  }
  armX.dispose();
  armY.dispose();

  const merged: GlyphGeometry = {
    core: mergeGeometries(cores),
    halo: mergeGeometries(halos),
    bracket: mergeGeometries(brackets),
    shards,
  };
  for (const geometry of [...cores, ...halos, ...brackets]) geometry.dispose();
  glyphCache.set(key, merged);
  return merged;
}

export function createLetterMesh(character: string) {
  const group = new Group();
  const glyph = glyphGeometry(character);

  const materials: LetterMaterials = {
    core: new MeshBasicMaterial({ color: hdr(PLASMA, 1.35), side: DoubleSide }),
    halo: createAdditiveBasicMaterial({ color: hdr(PLASMA, 1.0), side: DoubleSide }),
    bracket: createAdditiveBasicMaterial({ color: hdr(PLASMA, 0.75), side: DoubleSide }),
  };

  const haloMesh = new Mesh(glyph.halo, materials.halo);
  group.add(new Mesh(glyph.core, materials.core), haloMesh, new Mesh(glyph.bracket, materials.bracket));

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.letterMaterials = materials;
  group.userData.shardSpecs = glyph.shards;
  group.userData.accent = PLASMA.clone();
  group.userData.lockRingScale = 1.1;
  group.userData.halo = haloMesh;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.core.color.copy(locked ? hdr(ARC_WHITE, 2.0) : hdr(PLASMA, 1.35));
  materials.halo.color.copy(locked ? hdr(ARC_WHITE, 1.8) : hdr(PLASMA, 1.0));
  materials.bracket.color.copy(locked ? hdr(ARC_WHITE, 1.4) : hdr(PLASMA, 0.75));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  const dead = new Color(0.4, 0.05, 0.03);
  materials.core.color.copy(dead);
  materials.halo.color.copy(hdr(FAULT, 1.4));
  materials.bracket.color.copy(hdr(FAULT, 1.0));
}
