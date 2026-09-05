import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { BLOOD, BOTTLE, COBALT, GOLD, VIOLET, VOID } from './palette';

// Letters are small stained-glass windows: 5×7 grids of coloured panes set
// in black lead, on a black stone plate. Locking a letter floods every pane
// gold-white; a denied release drains it to dead red glass.

const CELL = 0.34;
const PANE = 0.29;
const paneGeometry = new PlaneGeometry(PANE, PANE);
const PANE_CYCLE = [COBALT, GOLD, BLOOD, BOTTLE, VIOLET, GOLD];

export type LetterMaterials = { fill: MeshBasicMaterial; lead: MeshBasicMaterial };

export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const panes: BufferGeometry[] = [];
  const shardDirections: Vector3[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;

  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0.03);
    const geometry = paneGeometry.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z));
    const colour = PANE_CYCLE[(cell.x + cell.y * 2) % PANE_CYCLE.length];
    const tint = 0.85 + ((cell.x * 7 + cell.y * 3) % 5) * 0.06;
    const colours: number[] = [];
    for (let i = 0; i < 4; i += 1) colours.push(colour.r * tint, colour.g * tint, colour.b * tint);
    geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
    panes.push(geometry);
    shardDirections.push(offset.lengthSq() > 0.0001 ? offset.clone().setZ(0).normalize() : new Vector3(0, 1, 0));
  }

  const fill = new MeshBasicMaterial({ vertexColors: true, color: new Color(1, 1, 1) });
  const fillMesh = new Mesh(mergeGeometries(panes), fill);
  for (const geometry of panes) geometry.dispose();

  // The lead: a black plate the panes sit in, slightly larger than the grid.
  const lead = new MeshBasicMaterial({ color: VOID.clone().multiplyScalar(2) });
  const plate = new Mesh(new BoxGeometry(width + CELL * 1.2, height + CELL * 1.2, 0.05), lead);
  plate.position.z = -0.01;

  group.add(plate, fillMesh);
  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.accent = GOLD.clone();
  group.userData.shardDirections = shardDirections;
  group.userData.letterMaterials = { fill, lead } satisfies LetterMaterials;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.fill.color.set(locked ? new Color(2.3, 2.1, 1.7) : new Color(1, 1, 1));
  materials.lead.color.copy(locked ? GOLD.clone().multiplyScalar(0.35) : VOID.clone().multiplyScalar(2));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.fill.color.set(new Color(0.55, 0.06, 0.04));
    materials.lead.color.copy(BLOOD.clone().multiplyScalar(0.25));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
