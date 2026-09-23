import { BoxGeometry, Color, Group, Mesh } from 'three';
import type { Material } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { glowMaterial, litMaterial } from './materials';

// START/REPLAY glyphs as station signage: a graphite placard with a hazard
// frame and a 5×7 grid of white panel cells. Locking lights the frame and the
// cells hazard orange; a denied release flashes them red.

export type LetterPalette = { plate: Color; cell: Color; frame: Color; lockedCell: Color; lockedFrame: Color; denied: Color };

type LetterKit = {
  plate: Material;
  cell: Material;
  frame: Material;
  lockedCell: Material;
  lockedFrame: Material;
  denied: Material;
  cellGeometry: BoxGeometry;
  plateGeometry: BoxGeometry;
  frameH: BoxGeometry;
  frameV: BoxGeometry;
};

let kit: LetterKit | null = null;

export function initLetterKit(p: LetterPalette) {
  kit ??= {
    plate: litMaterial(p.plate),
    cell: glowMaterial(p.cell),
    frame: glowMaterial(p.frame),
    lockedCell: glowMaterial(p.lockedCell),
    lockedFrame: glowMaterial(p.lockedFrame),
    denied: glowMaterial(p.denied),
    cellGeometry: new BoxGeometry(0.25, 0.25, 0.1),
    plateGeometry: new BoxGeometry(2.05, 2.62, 0.12),
    frameH: new BoxGeometry(2.25, 0.1, 0.16),
    frameV: new BoxGeometry(0.1, 2.82, 0.16),
  };
  return kit;
}

export function createLetterMesh(character: string) {
  if (!kit) throw new Error('initLetterKit must run first');
  const group = new Group();
  const plate = new Mesh(kit.plateGeometry, kit.plate);
  plate.position.z = -0.08;
  group.add(plate);
  const frame: Mesh[] = [];
  for (const y of [-1.36, 1.36]) {
    const bar = new Mesh(kit.frameH, kit.frame);
    bar.position.y = y;
    group.add(bar);
    frame.push(bar);
  }
  for (const x of [-1.08, 1.08]) {
    const bar = new Mesh(kit.frameV, kit.frame);
    bar.position.x = x;
    group.add(bar);
    frame.push(bar);
  }
  const cells: Mesh[] = [];
  for (const cell of glyphOnCells(character)) {
    const block = new Mesh(kit.cellGeometry, kit.cell);
    block.position.set((cell.x - 2) * 0.32, (3 - cell.y) * 0.32, 0.02);
    group.add(block);
    cells.push(block);
  }
  group.userData.isLetter = true;
  group.userData.letterParts = { frame, cells };
  return group;
}

export function setLetterState(group: Group, state: 'idle' | 'locked' | 'denied') {
  if (!kit) return;
  const { frame, cells } = group.userData.letterParts as { frame: Mesh[]; cells: Mesh[] };
  const frameMaterial = state === 'denied' ? kit.denied : state === 'locked' ? kit.lockedFrame : kit.frame;
  const cellMaterial = state === 'denied' ? kit.denied : state === 'locked' ? kit.lockedCell : kit.cell;
  for (const bar of frame) bar.material = frameMaterial;
  for (const cell of cells) cell.material = cellMaterial;
}
