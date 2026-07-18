import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { GOLD, JADE, MARK_WHITE, VIOLET_HOT, hdr } from './palette';

// STRANDLINE letters: 5×7 glyph cells rendered as beads of living light (the
// same jade-gold bioluminescence as the strands), wrapped in a thin membrane
// ring — a message the animal itself is spelling. Denial flushes violet.

export type LetterParts = {
  cellMaterials: MeshBasicMaterial[];
  ring: Mesh;
  ringMaterial: MeshBasicMaterial;
  baseRingRadius: number;
};

export function createLetterMesh(character: string): Group {
  const group = new Group();
  const cellMaterials: MeshBasicMaterial[] = [];
  const cells = glyphOnCells(character);
  for (const cell of cells) {
    const material = new MeshBasicMaterial({ color: hdr(JADE, 1.25) });
    const bead = new Mesh(new SphereGeometry(0.105, 8, 6), material);
    bead.position.set((cell.x - 2) * 0.27, (3 - cell.y) * 0.27, 0);
    group.add(bead);
    cellMaterials.push(material);
  }

  const ringMaterial = new MeshBasicMaterial({
    color: hdr(GOLD, 1.1),
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const ring = new Mesh(new TorusGeometry(1.02, 0.02, 6, 40), ringMaterial);
  group.add(ring);

  group.userData.isLetter = true;
  group.userData.letterParts = { cellMaterials, ring, ringMaterial, baseRingRadius: 1.02 } satisfies LetterParts;
  return group;
}

export function setLetterLocked(mesh: Group, locked: boolean) {
  const parts = mesh.userData.letterParts as LetterParts;
  for (const material of parts.cellMaterials) {
    material.color.copy(locked ? hdr(GOLD, 1.9) : hdr(JADE, 1.25));
  }
  parts.ringMaterial.color.copy(locked ? hdr(MARK_WHITE, 1.8) : hdr(GOLD, 1.1));
  parts.ring.scale.setScalar(locked ? 0.86 : 1);
}

export function setLetterDenied(mesh: Group, denied: boolean) {
  const parts = mesh.userData.letterParts as LetterParts;
  if (!denied) {
    setLetterLocked(mesh, false);
    return;
  }
  for (const material of parts.cellMaterials) material.color.copy(hdr(VIOLET_HOT, 1.5));
  parts.ringMaterial.color.copy(new Color(1.3, 0.2, 0.7));
}
