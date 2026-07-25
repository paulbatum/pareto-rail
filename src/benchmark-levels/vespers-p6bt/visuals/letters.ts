import {
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShapeGeometry,
  Vector3,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BLOOD, BONE, LEAD, STONE, glassColour, hdr } from './palette';
import { lancetShape, mergeParts } from './shapes';
import type { Splinter } from './effects';

// START and REPLAY are glazed the way everything else in here is: a lancet of
// dark glass, a lead came grid, and the letter picked out in lit panes. The
// 5x7 grid keeps R, T and Y unmistakable at gameplay distance; the arch and
// the came are what make it belong to this building.

const CELL = 0.34;
const PANE = 0.3;

export type LetterVisual = {
  panes: MeshBasicMaterial[];
  frame: LineBasicMaterial;
  accent: Color;
};

const paneGeometry = new PlaneGeometry(PANE, PANE);
const cameGeometry = buildCame();
const lancet = lancetShape(1.12, -1.55, 0.35, 1.95);
const backingGeometry = new ShapeGeometry(lancet, 14);
const frameGeometry = new EdgesGeometry(new ShapeGeometry(lancetShape(1.24, -1.68, 0.35, 2.12), 14), 1);

export function createLetterMesh(character: string) {
  const group = new Group();
  // Each glyph is glazed in its own jewel, keyed off the character itself so a
  // word reads as a row of different windows rather than one repeated pane.
  const code = character.charCodeAt(0);
  const colour = glassColour(code, code % 3);
  const panes: MeshBasicMaterial[] = [];
  const splinters: Splinter[] = [];

  const backing = new Mesh(backingGeometry, new MeshBasicMaterial({ color: STONE.clone().multiplyScalar(1.6), side: DoubleSide }));
  backing.position.z = -0.05;
  group.add(backing);

  const came = new Mesh(cameGeometry, new MeshBasicMaterial({ color: LEAD, side: DoubleSide }));
  group.add(came);

  for (const cell of glyphOnCells(character)) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    const pane = new Mesh(paneGeometry, material);
    const x = (cell.x - 2) * CELL;
    const y = (3 - cell.y) * CELL;
    pane.position.set(x, y, 0.02);
    group.add(pane);
    panes.push(material);
    splinters.push({ direction: new Vector3(x, y, 0.4).normalize(), size: 0.42 });
  }

  const frameMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 }));
  const frame = new LineSegments(frameGeometry, frameMaterial);
  frame.position.z = 0.04;
  group.add(frame);

  group.userData.isLetter = true;
  group.userData.kind = 'letter';
  group.userData.lockRingScale = 1.35;
  group.userData.splinters = splinters;
  group.userData.letterVisual = { panes, frame: frameMaterial, accent: colour.clone() } satisfies LetterVisual;
  setLetterState(group, 'idle');
  return group;
}

export function setLetterState(mesh: Group, state: 'idle' | 'locked' | 'denied') {
  const visual = mesh.userData.letterVisual as LetterVisual | undefined;
  if (!visual) return;
  const paneColour = state === 'locked' ? hdr(BONE, 2.6) : state === 'denied' ? hdr(BLOOD, 1.6) : hdr(visual.accent, 1.55);
  const frameColour = state === 'locked' ? hdr(BONE, 1.6) : state === 'denied' ? hdr(BLOOD, 1.2) : hdr(visual.accent, 0.5);
  for (const material of visual.panes) material.color.copy(paneColour);
  visual.frame.color.copy(frameColour);
}

/** The came grid the panes are set into, drawn once and shared by every letter. */
function buildCame(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let x = 0; x <= 5; x += 1) {
    parts.push(new PlaneGeometry(0.035, 7 * CELL).translate((x - 2.5) * CELL, 0.5 * CELL, 0.01));
  }
  for (let y = 0; y <= 7; y += 1) {
    parts.push(new PlaneGeometry(5 * CELL, 0.035).translate(0, (3.5 - y) * CELL, 0.01));
  }
  return mergeParts(parts);
}
