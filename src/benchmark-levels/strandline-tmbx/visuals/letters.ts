import { BufferGeometry, CircleGeometry, Color, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Leaf: START/REPLAY letters as clusters of bioluminescent beads — the same
// knots that bead the jellyfish's strands — strung in a 5×7 grid on a dark
// water-lens, hanging from a thread of strand overhead.

export type LetterLook = {
  bead: Color;
  halo: Color;
  lens: Color;
  thread: Color;
};

const CELL = 0.34;
const beadGeometry = new SphereGeometry(0.135, 10, 8);
const haloGeometry = new SphereGeometry(0.21, 8, 6);

const WIDTH = 4 * CELL;
const HEIGHT = 6 * CELL;
const glyphCache = new Map<string, { beads: BufferGeometry; halos: BufferGeometry }>();
const lensGeometry = new CircleGeometry(1.55, 32);
const threadGeometry = new CylinderGeometry(0.02, 0.04, 40, 5, 1, true);

function glyphGeometry(character: string) {
  let cached = glyphCache.get(character);
  if (!cached) {
    const beads: BufferGeometry[] = [];
    const halos: BufferGeometry[] = [];
    for (const cell of glyphOnCells(character)) {
      const matrix = new Matrix4().makeTranslation(cell.x * CELL - WIDTH / 2, HEIGHT / 2 - cell.y * CELL, 0.08);
      beads.push(beadGeometry.clone().applyMatrix4(matrix));
      halos.push(haloGeometry.clone().applyMatrix4(matrix));
    }
    cached = { beads: mergeGeometries(beads), halos: mergeGeometries(halos) };
    for (const geometry of [...beads, ...halos]) geometry.dispose();
    glyphCache.set(character, cached);
  }
  return cached;
}

export function createLetterMesh(character: string, look: LetterLook) {
  const group = new Group();
  const glyph = glyphGeometry(character);
  const beadMaterial = new MeshBasicMaterial({ color: look.bead.clone() });
  const haloMaterial = createAdditiveBasicMaterial({ color: look.halo.clone(), opacity: 0.55 });
  group.add(new Mesh(glyph.beads, beadMaterial));
  group.add(new Mesh(glyph.halos, haloMaterial));

  // A dark lens behind the beads keeps them legible against bright water.
  const lensMaterial = new MeshBasicMaterial({ color: look.lens.clone(), transparent: true, opacity: 0.55, depthWrite: false });
  const lens = new Mesh(lensGeometry, lensMaterial);
  lens.scale.set(0.95, 1.12, 1);
  lens.position.z = -0.06;
  group.add(lens);

  const threadMaterial = createAdditiveBasicMaterial({ color: look.thread.clone(), opacity: 0.7 });
  const thread = new Mesh(threadGeometry, threadMaterial);
  thread.position.y = HEIGHT / 2 + 20.2;
  group.add(thread);

  group.userData.isLetter = true;
  group.userData.letterParts = { beadMaterial, haloMaterial, lensMaterial, threadMaterial, look };
  return group;
}

export function tintLetter(group: Group, bead: Color, halo: Color, lens: Color) {
  const parts = group.userData.letterParts as {
    beadMaterial: MeshBasicMaterial;
    haloMaterial: MeshBasicMaterial;
    lensMaterial: MeshBasicMaterial;
  } | undefined;
  if (!parts) return;
  parts.beadMaterial.color.copy(bead);
  parts.haloMaterial.color.copy(halo);
  parts.lensMaterial.color.copy(lens);
}

export function restLetter(group: Group) {
  const parts = group.userData.letterParts as { look: LetterLook } | undefined;
  if (!parts) return;
  tintLetter(group, parts.look.bead, parts.look.halo, parts.look.lens);
}
