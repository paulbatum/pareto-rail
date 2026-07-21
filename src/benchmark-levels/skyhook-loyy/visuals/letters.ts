import {
  BoxGeometry,
  Color,
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
import { HAZARD_DARK, ORANGE, PANEL, PANEL_SHADE } from './palette';

type LetterMaterials = {
  faces: MeshBasicMaterial[];
  edges: LineBasicMaterial[];
  stripe: MeshBasicMaterial;
};

const CELL_GEOMETRY = new BoxGeometry(0.27, 0.27, 0.1);
const CELL_EDGES = new EdgesGeometry(CELL_GEOMETRY);
const BACK_GEOMETRY = new PlaneGeometry(1.82, 2.5);
const STRIPE_GEOMETRY = new PlaneGeometry(1.82, 0.09);

// Stamped maintenance-panel letters: every pixel is a small white enamel
// tile, with a graphite edge and a single hazard-orange datum stripe.
export function createLetterMesh(character: string) {
  const group = new Group();
  const faces: MeshBasicMaterial[] = [];
  const edges: LineBasicMaterial[] = [];
  const cells = glyphOnCells(character);

  for (const cell of cells) {
    const faceMaterial = new MeshBasicMaterial({ color: PANEL.clone(), side: DoubleSide });
    const tile = new Mesh(CELL_GEOMETRY, faceMaterial);
    tile.position.set((cell.x - 2) * 0.32, (3 - cell.y) * 0.32, 0);
    const edgeMaterial = new LineBasicMaterial({ color: GRAPHITE_COLOR });
    tile.add(new LineSegments(CELL_EDGES, edgeMaterial));
    group.add(tile);
    faces.push(faceMaterial);
    edges.push(edgeMaterial);
  }

  const back = new Mesh(
    BACK_GEOMETRY,
    new MeshBasicMaterial({ color: PANEL_SHADE.clone().multiplyScalar(0.28), side: DoubleSide }),
  );
  back.position.z = -0.09;
  group.add(back);

  const stripeMaterial = new MeshBasicMaterial({ color: ORANGE.clone(), side: DoubleSide });
  const stripe = new Mesh(STRIPE_GEOMETRY, stripeMaterial);
  stripe.position.set(0, -1.18, 0.07);
  group.add(stripe);

  group.userData.isLetter = true;
  group.userData.letterMaterials = { faces, edges, stripe: stripeMaterial } satisfies LetterMaterials;
  group.userData.accent = ORANGE.clone();
  return group;
}

const GRAPHITE_COLOR = new Color(0x22282c);

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  for (const face of materials.faces) face.color.copy(locked ? ORANGE : PANEL);
  for (const edge of materials.edges) edge.color.copy(locked ? HAZARD_DARK : GRAPHITE_COLOR);
  materials.stripe.color.copy(locked ? PANEL : ORANGE);
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) return setLetterLocked(group, group.userData.locked === true);
  for (const face of materials.faces) face.color.set(0x852818);
  for (const edge of materials.edges) edge.color.set(0xffb39a);
  materials.stripe.color.set(0x2a0502);
}
