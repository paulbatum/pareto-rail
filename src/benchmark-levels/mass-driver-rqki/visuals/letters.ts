import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphRows } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { ARC_CYAN, FAULT_RED, hdr, STEEL, VIOLET, WHITE_HOT } from './palette';
import type { ShardSpec } from './drones';

// LAUNCH / REPLAY are rendered as breech-console readouts: a 5x7 indicator
// panel per character, dark cells always present and lit cells driven hot. The
// unlit grid is the trick — it gives every glyph a fixed rectangular frame, so
// the letters stay sharply legible with the bloom slider at zero and never
// dissolve into a blob when it is turned up.

const CELL = 0.33;
const LIT = new BoxGeometry(0.27, 0.27, 0.13);
const UNLIT = new BoxGeometry(0.25, 0.25, 0.06);
const COLUMNS = 5;
const ROWS = 7;

type LetterMaterials = {
  lit: MeshBasicMaterial;
  litEdge: LineBasicMaterial;
  unlit: MeshBasicMaterial;
  bezel: LineBasicMaterial;
};

export function createLetterMesh(character: string) {
  const rows = glyphRows(character) ?? glyphRows('L')!;
  const group = new Group();
  const litCells: BufferGeometry[] = [];
  const unlitCells: BufferGeometry[] = [];
  const shards: ShardSpec[] = [];

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLUMNS; x += 1) {
      const offsetX = (x - (COLUMNS - 1) / 2) * CELL;
      const offsetY = ((ROWS - 1) / 2 - y) * CELL;
      const matrix = new Matrix4().makeTranslation(offsetX, offsetY, 0);
      if (rows[y][x] === '1') {
        litCells.push(LIT.clone().applyMatrix4(matrix));
        const direction = new Vector3(offsetX, offsetY, 0.35);
        shards.push({ direction: direction.normalize(), color: ARC_CYAN.clone(), size: 0.26 });
      } else {
        unlitCells.push(UNLIT.clone().applyMatrix4(matrix.clone().setPosition(offsetX, offsetY, -0.05)));
      }
    }
  }

  const materials: LetterMaterials = {
    lit: new MeshBasicMaterial({ color: hdr(ARC_CYAN, 1.25) }),
    litEdge: new LineBasicMaterial(additiveMaterialParameters({ color: hdr(WHITE_HOT, 0.9) })),
    unlit: new MeshBasicMaterial({ color: STEEL.clone().multiplyScalar(0.32) }),
    bezel: new LineBasicMaterial(additiveMaterialParameters({ color: hdr(VIOLET, 0.85) })),
  };

  const litGeometry = mergeGeometries(litCells);
  group.add(new Mesh(litGeometry, materials.lit));
  group.add(new LineSegments(new EdgesGeometry(litGeometry), materials.litEdge));
  if (unlitCells.length > 0) {
    group.add(new Mesh(mergeGeometries(unlitCells), materials.unlit));
  }

  // The panel bezel: a fixed frame around every glyph, lit or not.
  const bezel = new BoxGeometry(COLUMNS * CELL + 0.2, ROWS * CELL + 0.2, 0.16);
  group.add(new LineSegments(new EdgesGeometry(bezel), materials.bezel));
  bezel.dispose();

  for (const geometry of [...litCells, ...unlitCells]) geometry.dispose();

  group.userData.isLetter = true;
  group.userData.letter = character.toUpperCase();
  group.userData.letterMaterials = materials;
  group.userData.shardSpecs = shards;
  group.userData.accent = ARC_CYAN.clone();
  group.userData.lockRingScale = 1.15;
  return group;
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.lit.color.copy(locked ? hdr(WHITE_HOT, 1.9) : hdr(ARC_CYAN, 1.25));
  materials.litEdge.color.copy(locked ? hdr(WHITE_HOT, 1.6) : hdr(WHITE_HOT, 0.9));
  materials.bezel.color.copy(locked ? hdr(WHITE_HOT, 1.3) : hdr(VIOLET, 0.85));
  materials.unlit.color.copy(STEEL.clone().multiplyScalar(locked ? 0.5 : 0.32));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (!denied) {
    setLetterLocked(group, group.userData.locked === true);
    return;
  }
  materials.lit.color.copy(hdr(FAULT_RED, 1.2));
  materials.litEdge.color.copy(hdr(FAULT_RED, 1.6));
  materials.bezel.color.copy(hdr(FAULT_RED, 1.1));
  materials.unlit.color.copy(new Color(0.16, 0.02, 0.01));
}
