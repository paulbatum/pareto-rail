import { BoxGeometry, Color, Group, Mesh, SphereGeometry } from 'three';
import { glyphRows } from '../../../engine/glyphs';
import { bindTint, createTintState, surfaceMaterial, type TintState } from './materials';
import { MURK, THERMAL, hdr } from './palette';

// START/REPLAY letters are hull plates: a rusted steel sign with the letter
// stenciled in dirty cream paint on a 5×7 grid, four rivets, and a work lamp
// clamped on top that burns mercury-white when the plate is locked.

const CELL = 0.3;
const cellGeometry = new BoxGeometry(CELL * 0.86, CELL * 0.86, 0.08);
const plateGeometry = new BoxGeometry(2.1, 2.75, 0.16);
const rivetGeometry = new SphereGeometry(0.07, 6, 4);
const lampGeometry = new SphereGeometry(0.14, 8, 6);

let materials: {
  plate: ReturnType<typeof surfaceMaterial>;
  stencil: ReturnType<typeof surfaceMaterial>;
  iron: ReturnType<typeof surfaceMaterial>;
  lamp: ReturnType<typeof surfaceMaterial>;
} | null = null;

function letterMaterials() {
  materials ??= {
    plate: surfaceMaterial({ color: MURK.rust.clone().multiplyScalar(0.8), heat: THERMAL.steel, roughness: 0.9, metalness: 0.4, tint: true, chargeMurk: new Color(0.25, 0.12, 0.05) }),
    stencil: surfaceMaterial({
      color: MURK.cream,
      heat: THERMAL.steelWarm,
      emissive: hdr(MURK.cream, 0.28),
      lit: false,
      tint: true,
      chargeMurk: new Color(0.5, 0.95, 1.25),
    }),
    iron: surfaceMaterial({ color: MURK.iron, heat: THERMAL.steel, roughness: 0.5, metalness: 0.8 }),
    lamp: surfaceMaterial({ color: new Color(0.05, 0.04, 0.03), heat: THERMAL.lampDull, emissive: hdr(MURK.sodiumHot, 0.6), lit: false, tint: true, chargeMurk: new Color(0.6, 1.4, 2.2) }),
  };
  return materials;
}

export type LetterParts = { tint: TintState };

export function createLetterMesh(character: string) {
  const shared = letterMaterials();
  const tint = createTintState();
  const group = new Group();
  group.add(new Mesh(plateGeometry, shared.plate));
  const rows = glyphRows(character) ?? [];
  rows.forEach((row, y) => {
    [...row].forEach((bit, x) => {
      if (bit !== '1') return;
      const cell = new Mesh(cellGeometry, shared.stencil);
      cell.position.set((x - 2) * CELL, (3 - y) * CELL, 0.1);
      group.add(cell);
    });
  });
  for (const [x, y] of [[-0.88, 1.2], [0.88, 1.2], [-0.88, -1.2], [0.88, -1.2]]) {
    const rivet = new Mesh(rivetGeometry, shared.iron);
    rivet.position.set(x, y, 0.09);
    group.add(rivet);
  }
  const lamp = new Mesh(lampGeometry, shared.lamp);
  lamp.position.set(0, 1.52, 0.05);
  group.add(lamp);
  bindTint(group, tint);
  group.userData.isLetter = true;
  group.userData.letterParts = { tint } satisfies LetterParts;
  return group;
}
