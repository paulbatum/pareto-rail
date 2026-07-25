import {
  BoxGeometry,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { mulberry32 } from '../../../engine/rng';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { GOLD, hdr, LEAD_LIT, WINDOW_JEWELS } from './palette';

const CELL = 0.34;
const cellGeometry = new BoxGeometry(0.3, 0.3, 0.1);

// Letters in the level's language: each glyph is a little stained-glass
// window. Cells are jewel-coloured panes (seeded per letter, so a word reads
// as one banded window), held in dark lead cames; a lancet arch frames the
// glyph. Lock floods the whole pane with candle gold.
export function createLetterMesh(char: string) {
  const group = new Group();
  const cells = glyphOnCells(char);
  const rng = mulberry32(char.toUpperCase().charCodeAt(0) * 131 + 7);
  const width = 4 * CELL;
  const height = 6 * CELL;

  const fills: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    const matrix = new Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    const fill = cellGeometry.clone().applyMatrix4(matrix);
    // Per-cell pane colour via vertex colours; the material colour is a
    // multiplier so lock/deny states can tint the whole glyph at once.
    const jewel = WINDOW_JEWELS[Math.floor(rng() * WINDOW_JEWELS.length)].clone().multiplyScalar(0.75 + rng() * 0.45);
    const colors = new Float32Array(fill.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = jewel.r;
      colors[i + 1] = jewel.g;
      colors[i + 2] = jewel.b;
    }
    fill.setAttribute('color', new Float32BufferAttribute(colors, 3));
    fills.push(fill);
    edges.push(new EdgesGeometry(cellGeometry).applyMatrix4(matrix));
  }

  const fillMaterial = new MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: LEAD_LIT.clone() }));
  group.add(new Mesh(mergeGeometries(fills), fillMaterial));
  group.add(new LineSegments(mergeGeometries(edges), edgeMaterial));
  for (const geometry of fills) geometry.dispose();
  for (const geometry of edges) geometry.dispose();

  // The lancet arch around the glyph.
  const arch = makeLancetOutline(width * 0.78 + 0.42, height * 0.62, 0.6);
  const archMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(GOLD, 0.35) }));
  group.add(new LineSegments(arch, archMaterial));

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.accent = GOLD.clone();
  group.userData.letterMaterials = { fillMaterial, edgeMaterial, archMaterial };
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; archMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  if (locked) {
    materials.fillMaterial.color.copy(hdr(GOLD, 1.5));
    materials.edgeMaterial.color.copy(hdr(GOLD, 1.2));
    materials.archMaterial.color.copy(hdr(GOLD, 1.4));
  } else {
    materials.fillMaterial.color.set(0xffffff);
    materials.edgeMaterial.color.copy(LEAD_LIT);
    materials.archMaterial.color.copy(hdr(GOLD, 0.35));
  }
}

export function setLetterDeniedTint(group: Group, flash: number) {
  const materials = group.userData.letterMaterials as
    | { fillMaterial: MeshBasicMaterial; edgeMaterial: LineBasicMaterial; archMaterial: LineBasicMaterial }
    | undefined;
  if (!materials) return;
  const dark = new Color(0.35 + flash * 0.8, 0.12, 0.1);
  materials.fillMaterial.color.copy(dark);
  materials.edgeMaterial.color.copy(dark);
}

// A pointed arch: two mirrored arcs meeting above the glyph, with jamb lines
// down the sides — enough to read "window" at gameplay distance.
function makeLancetOutline(halfWidth: number, jambHeight: number, rise: number): BufferGeometry {
  const positions: number[] = [];
  const push = (a: Vector3, b: Vector3) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const base = -jambHeight;
  const spring = jambHeight * 0.55;
  const apex = new Vector3(0, spring + halfWidth * 0.9 + rise, 0);

  push(new Vector3(-halfWidth, base, 0), new Vector3(-halfWidth, spring, 0));
  push(new Vector3(halfWidth, base, 0), new Vector3(halfWidth, spring, 0));
  push(new Vector3(-halfWidth, base, 0), new Vector3(halfWidth, base, 0));

  const segments = 7;
  for (const side of [-1, 1]) {
    let previous = new Vector3(side * halfWidth, spring, 0);
    for (let i = 1; i <= segments; i += 1) {
      const t = i / segments;
      const x = side * halfWidth * (1 - t);
      const y = spring + (apex.y - spring) * Math.sin((t * Math.PI) / 2);
      const point = new Vector3(x, y, 0);
      push(previous, point);
      previous = point;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
