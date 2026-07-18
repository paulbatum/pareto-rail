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
import { ARC_BLUE, GUNMETAL, GUNMETAL_EDGE, HAZARD_RED, ION_WHITE, hdr } from './palette';
import type { Facet } from './enemies';

// CHARGE and RELOAD are stencil plates lifted off the gun housing: shallow
// gunmetal cells routed into a backing plate, with a crisp arc-blue edge cut
// around every cell. The outline is what carries the shape, so the words stay
// legible at distance with the player's bloom slider at zero.

const CELL = 0.34;
const CELL_DEPTH = 0.13;
const cellGeometry = new BoxGeometry(0.3, 0.3, CELL_DEPTH);

export type LetterVisual = {
  fill: MeshBasicMaterial;
  edge: LineBasicMaterial;
  plate: MeshBasicMaterial;
  facets: Facet[];
};

export function createLetterMesh(character: string): Group {
  const group = new Group();
  const cells = glyphOnCells(character);
  const fills: BufferGeometry[] = [];
  const facets: Facet[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    fills.push(cellGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    facets.push({
      direction: offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1),
      size: 0.34,
    });
  }

  const merged = mergeGeometries(fills, false);
  const fill = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.5) });
  const edge = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 1.35) }));
  group.add(new Mesh(merged, fill));
  group.add(new LineSegments(new EdgesGeometry(merged, 24), edge));
  for (const geometry of fills) geometry.dispose();

  // The housing plate the stencil is cut from: dark, so the routed edge reads
  // as a cut rather than a floating outline.
  const plate = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.55) });
  const plateMesh = new Mesh(new PlaneGeometry(width + CELL * 1.5, height + CELL * 1.5), plate);
  plateMesh.position.z = -CELL_DEPTH * 0.6;
  group.add(plateMesh);
  const frame = new LineSegments(
    new EdgesGeometry(new PlaneGeometry(width + CELL * 1.5, height + CELL * 1.5)),
    new LineBasicMaterial(additiveMaterialParameters({ color: hdr(GUNMETAL_EDGE, 1.6) })),
  );
  frame.position.z = -CELL_DEPTH * 0.55;
  group.add(frame);

  const visual: LetterVisual = { fill, edge, plate, facets };
  group.userData.mdLetter = visual;
  group.userData.mdKind = 'letter';
  return group;
}

const EDGE_IDLE = hdr(ARC_BLUE, 1.35);
const EDGE_LOCKED = hdr(ION_WHITE, 2.4);
const EDGE_DENIED = hdr(HAZARD_RED, 2.2);
const FILL_IDLE = GUNMETAL.clone().multiplyScalar(1.5);
const FILL_LOCKED = ION_WHITE.clone().multiplyScalar(0.75);
const FILL_DENIED = HAZARD_RED.clone().multiplyScalar(0.4);

export function setLetterState(group: Group, state: 'idle' | 'locked' | 'denied', flash = 0) {
  const visual = group.userData.mdLetter as LetterVisual | undefined;
  if (!visual) return;
  const edge = state === 'denied' ? EDGE_DENIED : state === 'locked' ? EDGE_LOCKED : EDGE_IDLE;
  const fill = state === 'denied' ? FILL_DENIED : state === 'locked' ? FILL_LOCKED : FILL_IDLE;
  visual.edge.color.copy(edge).multiplyScalar(1 + flash * 1.6);
  visual.fill.color.copy(fill).multiplyScalar(1 + flash * 1.2);
}

export function letterFacetColor(): Color {
  return ARC_BLUE.clone();
}
