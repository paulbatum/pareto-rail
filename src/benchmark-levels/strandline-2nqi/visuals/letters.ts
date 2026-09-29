import {
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphRows } from '../../../engine/glyphs';
import { hdr, DENY, STRAND_GOLD, STRAND_GREEN, SUN_WHITE, WATER_DEEP } from './palette';

// Letters are beads on a strand: each lit cell of the 5×7 glyph is a glowing
// bead, joined to its neighbours by a bright thread, floating in a dark bubble
// so the word reads against sunlit water even with bloom off. Locking turns
// the beads sun-white; the kill pops the string into sparks.

const CELL = 0.4;
const beadGeometry = new SphereGeometry(0.19, 10, 8);
const linkGeometry = new CylinderGeometry(0.04, 0.04, 1, 5, 1, true);
// Tall bubbles: a 5×7 glyph is taller than wide, and neighbours are 2.55–2.75 m apart.
const discGeometry = new CircleGeometry(1.6, 40).scale(0.72, 1, 1);
const rimGeometry = new RingGeometry(1.55, 1.62, 48).scale(0.72, 1, 1);

const BEAD_REST = hdr(STRAND_GOLD, 1.25);
const LINK_REST = hdr(STRAND_GREEN, 1.1);
const BEAD_LOCKED = hdr(SUN_WHITE, 2.1);
const BEAD_DENIED = hdr(DENY, 1.6);
const RIM_REST = STRAND_GREEN.clone().multiplyScalar(0.9);

type LetterMaterials = { bead: MeshBasicMaterial; link: MeshBasicMaterial; rim: MeshBasicMaterial };

type GlyphGeometry = { beads: BufferGeometry; links: BufferGeometry; offsets: Vector3[] };
const glyphCache = new Map<string, GlyphGeometry>();

function buildGlyphGeometry(char: string): GlyphGeometry {
  const cached = glyphCache.get(char);
  if (cached) return cached;
  const rows = glyphRows(char) ?? glyphRows('I')!;
  const width = 4 * CELL;
  const height = 6 * CELL;
  const beadGeometries: BufferGeometry[] = [];
  const linkGeometries: BufferGeometry[] = [];
  const offsets: Vector3[] = [];
  const lit = (x: number, y: number) => rows[y]?.[x] === '1';
  const pointFor = (x: number, y: number) => new Vector3(x * CELL - width / 2, height / 2 - y * CELL, 0);

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (!lit(x, y)) continue;
      const point = pointFor(x, y);
      offsets.push(point);
      beadGeometries.push(beadGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(point.x, point.y, point.z)));
      // Threads to the right, down, and both down-diagonals: each pair once.
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
        if (!lit(x + dx, y + dy)) continue;
        // Skip the diagonal when the orthogonal path already connects the pair.
        if (dx !== 0 && dy !== 0 && (lit(x + dx, y) || lit(x, y + dy))) continue;
        const other = pointFor(x + dx, y + dy);
        const mid = point.clone().add(other).multiplyScalar(0.5);
        const length = point.distanceTo(other);
        const direction = other.clone().sub(point).normalize();
        const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
        const matrix = new Matrix4().compose(mid, quaternion, new Vector3(1, length, 1));
        linkGeometries.push(linkGeometry.clone().applyMatrix4(matrix));
      }
    }
  }

  const built: GlyphGeometry = {
    beads: mergeGeometries(beadGeometries),
    links: mergeGeometries(linkGeometries.length > 0 ? linkGeometries : [linkGeometry.clone().scale(0.001, 0.001, 0.001)]),
    offsets,
  };
  for (const geometry of [...beadGeometries, ...linkGeometries]) geometry.dispose();
  glyphCache.set(char, built);
  return built;
}

const backingMaterial = new MeshBasicMaterial({ color: WATER_DEEP.clone().multiplyScalar(0.7), transparent: true, opacity: 0.6, depthWrite: false });

export function createLetterMesh(char: string) {
  const glyph = buildGlyphGeometry(char.toUpperCase());
  const group = new Group();
  const materials: LetterMaterials = {
    bead: new MeshBasicMaterial({ color: BEAD_REST.clone() }),
    link: new MeshBasicMaterial({ color: LINK_REST.clone() }),
    rim: new MeshBasicMaterial({ color: RIM_REST.clone(), side: DoubleSide }),
  };
  const backing = new Mesh(discGeometry, backingMaterial);
  backing.position.z = -0.25;
  backing.userData.raildIgnoreOcclusion = true;
  const rim = new Mesh(rimGeometry, materials.rim);
  rim.position.z = -0.24;
  group.add(backing, rim, new Mesh(glyph.links, materials.link), new Mesh(glyph.beads, materials.bead));

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.letterMaterials = materials;
  group.userData.beadOffsets = glyph.offsets;
  return group;
}

const scratch = new Color();

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.bead.color.copy(locked ? BEAD_LOCKED : BEAD_REST);
  materials.link.color.copy(locked ? hdr(SUN_WHITE, 1.4) : LINK_REST);
  materials.rim.color.copy(locked ? SUN_WHITE : RIM_REST);
}

/** Refused: the string flashes bruise-violet, then relaxes. `t` runs 0→1. */
export function setLetterDenied(group: Group, t: number) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  const k = Math.max(0, 1 - t);
  materials.bead.color.copy(scratch.copy(BEAD_REST).lerp(BEAD_DENIED, k));
  materials.link.color.copy(scratch.copy(LINK_REST).lerp(BEAD_DENIED, k));
  materials.rim.color.copy(scratch.copy(RIM_REST).lerp(DENY, k));
}
