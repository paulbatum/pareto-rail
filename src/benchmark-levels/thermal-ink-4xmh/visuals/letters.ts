import {
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
} from 'three';
import type { Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { modalLine, modalMesh } from './materials';

// Harbour stencils: 5×7 letters cut as riveted steel plates with a painted
// stencil edge, the way a hull number is marked. Locking floods the plate with
// lamp light; the imager turns it into a cold outline with a hot rim.

const CELL = 0.42;
const PLATE = new BoxGeometry(0.38, 0.38, 0.16);

export type LetterSkin = {
  plateMurk: Color;
  plateThermal: Color;
  edgeMurk: Color;
  edgeThermal: Color;
  lockedPlateMurk: Color;
  lockedPlateThermal: Color;
  lockedEdgeMurk: Color;
  lockedEdgeThermal: Color;
};

const glyphCache = new Map<string, { plate: BufferGeometry; edge: BufferGeometry }>();

function glyphGeometry(character: string) {
  const cached = glyphCache.get(character);
  if (cached) return cached;
  const cells = glyphOnCells(character);
  const plates: BufferGeometry[] = [];
  const edges: BufferGeometry[] = [];
  const width = 4 * CELL;
  const height = 6 * CELL;
  for (const cell of cells) {
    const transform = new Matrix4().makeTranslation(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    plates.push(PLATE.clone().toNonIndexed().applyMatrix4(transform));
    edges.push(new EdgesGeometry(PLATE).applyMatrix4(transform));
  }
  const merged = {
    plate: mergeGeometries(plates) ?? PLATE.clone(),
    edge: mergeGeometries(edges) ?? new EdgesGeometry(PLATE),
  };
  for (const geometry of [...plates, ...edges]) geometry.dispose();
  glyphCache.set(character, merged);
  return merged;
}

export function createLetterMesh(character: string, skin: LetterSkin): Group {
  const glyph = glyphGeometry((character || '?').toUpperCase());
  const group = new Group();
  const plateMaterial = modalMesh(skin.plateMurk, skin.plateThermal, { swallow: 0.35, shade: 0.55, rim: 0.3 });
  const edgeMaterial = modalLine(skin.edgeMurk, skin.edgeThermal, { swallow: 0.3 });
  group.add(new Mesh(glyph.plate, plateMaterial), new LineSegments(glyph.edge, edgeMaterial));
  group.userData.isLetter = true;
  group.userData.letter = character;
  group.userData.letterMaterials = { plate: plateMaterial, edge: edgeMaterial };
  group.userData.letterSkin = skin;
  return group;
}

type ModalHandles = { murk: { value: Color }; thermal: { value: Color } };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as
    | { plate: { userData: { modal?: ModalHandles } }; edge: { userData: { modal?: ModalHandles } } }
    | undefined;
  const skin = group.userData.letterSkin as LetterSkin | undefined;
  if (!materials || !skin) return;
  const plate = materials.plate.userData.modal;
  const edge = materials.edge.userData.modal;
  if (plate) {
    plate.murk.value.copy(locked ? skin.lockedPlateMurk : skin.plateMurk);
    plate.thermal.value.copy(locked ? skin.lockedPlateThermal : skin.plateThermal);
  }
  if (edge) {
    edge.murk.value.copy(locked ? skin.lockedEdgeMurk : skin.edgeMurk);
    edge.thermal.value.copy(locked ? skin.lockedEdgeThermal : skin.edgeThermal);
  }
}

export function setLetterFlash(group: Group, murk: Color, thermal: Color) {
  const materials = group.userData.letterMaterials as
    | { plate: { userData: { modal?: ModalHandles } }; edge: { userData: { modal?: ModalHandles } } }
    | undefined;
  if (!materials) return;
  for (const material of [materials.plate, materials.edge]) {
    const modal = material.userData.modal;
    if (!modal) continue;
    modal.murk.value.copy(murk);
    modal.thermal.value.copy(thermal);
  }
}
