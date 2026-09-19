import { BufferGeometry, Color, Group, Mesh } from 'three';
import { mix, uniform, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { glyphOnCells } from '../../../engine/glyphs';
import { chamferBox, createMachineMaterial, createPartBuilder, drum, objectFx } from './machine-kit';

// START and REPLAY: stencilled hazard plates on marker buoys. Each letter is a
// 5×7 grid of black stencil cells on a worn yellow plate, framed in steel, on
// a post down to a striped float. A lock paints the stencil signal red.

export type LetterColors = { paint: Color; steel: Color; darkSteel: Color; hazard: Color; lamp: Color; stencil: Color; locked: Color };

const CELL = 0.32;
const PLATE_WIDTH = 2.05;
const PLATE_HEIGHT = 2.7;

type LetterKit = { plate: BufferGeometry; plateMaterial: MeshStandardNodeMaterial; cellMaterial: MeshStandardNodeMaterial; cells: Map<string, BufferGeometry> };

let kit: LetterKit | null = null;

function letterKit(colors: LetterColors): LetterKit {
  if (kit) return kit;
  const b = createPartBuilder();
  const paint = { color: colors.paint, metal: 0.2, rough: 0.6, paint: true };
  const steel = { color: colors.steel, metal: 0.8, rough: 0.4 };
  const dark = { color: colors.darkSteel, metal: 0.6, rough: 0.55 };
  b.add(chamferBox(PLATE_WIDTH, PLATE_HEIGHT, 0.12, 0.05), paint);
  for (const y of [-1, 1]) b.add(chamferBox(PLATE_WIDTH + 0.16, 0.12, 0.2), steel, { at: [0, (y * (PLATE_HEIGHT + 0.04)) / 2, 0] });
  for (const x of [-1, 1]) b.add(chamferBox(0.12, PLATE_HEIGHT + 0.16, 0.2), steel, { at: [(x * (PLATE_WIDTH + 0.04)) / 2, 0, 0] });
  b.add(chamferBox(0.16, 2.2, 0.16), dark, { at: [0, -PLATE_HEIGHT / 2 - 1.1, -0.1] });
  b.add(drum(0.55, 0.7, 0.1, 16), { ...paint, hazard: true }, { at: [0, -PLATE_HEIGHT / 2 - 2.35, -0.1] }, 'lathe');
  b.add(drum(0.09, 0.14, 0.02, 8), { color: colors.lamp, glow: 3 }, { at: [0, PLATE_HEIGHT / 2 + 0.14, 0] }, 'none');

  const locked = uniform(0).onObjectUpdate(({ object }) => (object?.userData.fx?.locked as number | undefined) ?? 0);
  const cellMaterial = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 });
  const stencil = vec3(colors.stencil.r, colors.stencil.g, colors.stencil.b);
  const red = vec3(colors.locked.r, colors.locked.g, colors.locked.b);
  cellMaterial.colorNode = mix(stencil, red, locked);
  cellMaterial.emissiveNode = red.mul(locked).mul(0.8);

  kit = {
    plate: b.build(),
    plateMaterial: createMachineMaterial(objectFx(), { bare: colors.steel, hazard: colors.hazard, wearScale: 1.6 }),
    cellMaterial,
    cells: new Map(),
  };
  return kit;
}

function cellsGeometry(character: string) {
  const b = createPartBuilder();
  const black = { color: new Color(1, 1, 1), rough: 0.7 };
  for (const cell of glyphOnCells(character)) {
    b.add(chamferBox(CELL * 0.9, CELL * 0.9, 0.05, 0.02), black, { at: [(cell.x - 2) * CELL, (3 - cell.y) * CELL, 0.075] }, 'none');
  }
  return b.build();
}

export function createLetterMesh(character: string, colors: LetterColors) {
  const k = letterKit(colors);
  const key = character.toUpperCase();
  let cells = k.cells.get(key);
  if (!cells) {
    cells = cellsGeometry(key);
    k.cells.set(key, cells);
  }
  const fx = { flash: 0, lamp: 1, deny: 0, locked: 0 };
  const group = new Group();
  const body = new Group();
  const plate = new Mesh(k.plate, k.plateMaterial);
  const stencil = new Mesh(cells, k.cellMaterial);
  plate.userData.fx = fx;
  stencil.userData.fx = fx;
  body.add(plate, stencil);
  group.add(body);
  group.userData.fx = fx;
  group.userData.body = body;
  group.userData.isLetter = true;
  group.userData.lockSize = 2.9;
  return group;
}
