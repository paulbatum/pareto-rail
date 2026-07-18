import {
  BoxGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { cachedGeometry } from './geometry-cache';
import { ARC_BLUE, GUNMETAL, HAZARD_RED, ION_WHITE, hdr } from './palette';

// CHARGE / RELOAD are stencil plates lifted off the gun housing: a shallow
// gunmetal cell grid with a crisp arc-blue routed edge. The outline carries the
// shape, so the words stay legible at distance with the bloom slider at zero.

const CELL = 0.34;
const CELL_DEPTH = 0.14;

export type LetterParts = {
  cellFill: MeshBasicMaterial;
  routedEdge: LineBasicMaterial;
  plate: MeshBasicMaterial;
};

export function createLetterMesh(character: string): Group {
  const group = new Group();
  const cells = glyphOnCells(character);

  const plateMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.55), side: DoubleSide });
  const plate = new Mesh(cachedGeometry('letter:plate', () => new PlaneGeometry(CELL * 6.4, CELL * 8.4)), plateMaterial);
  plate.position.z = -0.09;
  group.add(plate);

  const cellFill = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.6) });
  const routedEdge = new LineBasicMaterial({ color: hdr(ARC_BLUE, 1.9) });
  const cellGeometry = cachedGeometry('letter:cell', () => new BoxGeometry(CELL * 0.94, CELL * 0.94, CELL_DEPTH));
  const cellEdges = cachedGeometry('letter:cell:edges', () => new EdgesGeometry(cellGeometry));
  for (const cell of cells) {
    const block = new Mesh(cellGeometry, cellFill);
    block.position.set((cell.x - 2) * CELL, (3 - cell.y) * CELL, 0);
    block.add(new LineSegments(cellEdges, routedEdge));
    group.add(block);
  }

  // The housing frame: four routed rails around the plate.
  const frame = new LineSegments(
    cachedGeometry('letter:frame', () => new EdgesGeometry(new BoxGeometry(CELL * 6.4, CELL * 8.4, 0.05))),
    routedEdge,
  );
  frame.position.z = -0.08;
  group.add(frame);

  const parts: LetterParts = { cellFill, routedEdge, plate: plateMaterial };
  group.userData.letterParts = parts;
  group.userData.isLetter = true;
  return group;
}

export function setLetterState(mesh: Group, state: 'idle' | 'locked' | 'denied') {
  const parts = mesh.userData.letterParts as LetterParts | undefined;
  if (!parts) return;
  if (state === 'locked') {
    parts.cellFill.color.copy(hdr(ION_WHITE, 1.15));
    parts.routedEdge.color.copy(hdr(ION_WHITE, 2.6));
    parts.plate.color.copy(ARC_BLUE.clone().multiplyScalar(0.22));
    return;
  }
  if (state === 'denied') {
    parts.cellFill.color.copy(hdr(HAZARD_RED, 0.8));
    parts.routedEdge.color.copy(hdr(HAZARD_RED, 2.4));
    parts.plate.color.copy(HAZARD_RED.clone().multiplyScalar(0.18));
    return;
  }
  parts.cellFill.color.copy(GUNMETAL).multiplyScalar(1.6);
  parts.routedEdge.color.copy(hdr(ARC_BLUE, 1.9));
  parts.plate.color.copy(GUNMETAL).multiplyScalar(0.55);
}
