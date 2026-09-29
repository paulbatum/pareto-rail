import { AdditiveBlending, BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { BufferGeometry } from 'three';
import { glyphRows } from '../../../engine/glyphs';
import { CYAN, CYAN_HOT, hdr, ICE, MOLTEN, WHITE_HOT } from './palette';

// START / REPLAY letters are flight-deck signal plates: a dark armored panel
// with a cyan frame, and a 5x7 matrix of signal lamps. Lit lamps are ice-white
// blocks; unlit ones are dim rivets, so a glyph reads on any background even
// with bloom off.

const CELL = 0.34;
const PLATE_W = 5 * CELL + 0.7;
const PLATE_H = 7 * CELL + 0.7;

let sharedGeometry: { lamp: BoxGeometry; rivet: BoxGeometry; plate: BoxGeometry; frameH: BoxGeometry; frameV: BoxGeometry; ring: RingGeometry } | null = null;

function geometries() {
  sharedGeometry ??= {
    lamp: new BoxGeometry(CELL * 0.82, CELL * 0.82, 0.2),
    rivet: new BoxGeometry(CELL * 0.22, CELL * 0.22, 0.05),
    plate: new BoxGeometry(PLATE_W, PLATE_H, 0.14),
    frameH: new BoxGeometry(PLATE_W + 0.12, 0.09, 0.2),
    frameV: new BoxGeometry(0.09, PLATE_H + 0.12, 0.2),
    ring: new RingGeometry(1.5, 1.58, 4, 1, Math.PI / 4, Math.PI * 2),
  };
  return sharedGeometry;
}

export type LetterParts = {
  lamps: MeshBasicMaterial;
  frame: MeshBasicMaterial;
  plate: MeshBasicMaterial;
  halo: MeshBasicMaterial;
};

export function createLetterObject(character: string) {
  const g = geometries();
  const group = new Group();
  const parts: LetterParts = {
    lamps: new MeshBasicMaterial({ color: hdr(ICE, 1.7) }),
    frame: new MeshBasicMaterial({ color: hdr(CYAN, 2.0) }),
    plate: new MeshBasicMaterial({ color: new Color(0.03, 0.05, 0.09) }),
    halo: new MeshBasicMaterial({ color: hdr(CYAN, 0.8), transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false }),
  };
  const rivets = new MeshBasicMaterial({ color: new Color(0.16, 0.24, 0.34) });
  group.add(new Mesh(g.plate, parts.plate));
  const top = new Mesh(g.frameH, parts.frame);
  top.position.y = PLATE_H / 2;
  const bottom = new Mesh(g.frameH, parts.frame);
  bottom.position.y = -PLATE_H / 2;
  const left = new Mesh(g.frameV, parts.frame);
  left.position.x = -PLATE_W / 2;
  const right = new Mesh(g.frameV, parts.frame);
  right.position.x = PLATE_W / 2;
  group.add(top, bottom, left, right);

  const rows = glyphRows(character) ?? ['00000', '00000', '00000', '00000', '00000', '00000', '00000'];
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const on = rows[y][x] === '1';
      const cell = new Mesh(on ? g.lamp : g.rivet, on ? parts.lamps : rivets);
      cell.position.set((x - 2) * CELL, (3 - y) * CELL, on ? 0.12 : 0.08);
      group.add(cell);
    }
  }
  const halo = new Mesh(g.plate, parts.halo);
  halo.scale.set(1.28, 1.16, 1);
  halo.position.z = -0.12;
  halo.userData.raildIgnoreOcclusion = true;
  group.add(halo);
  group.scale.setScalar(1.05);
  group.userData.letterParts = parts;
  group.userData.letterRivets = rivets;
  group.userData.isLetter = true;
  return group;
}

export function paintLetter(group: Group, state: 'idle' | 'locked' | 'denied') {
  const parts = group.userData.letterParts as LetterParts | undefined;
  if (!parts) return;
  if (state === 'locked') {
    parts.lamps.color.copy(hdr(WHITE_HOT, 2.3));
    parts.frame.color.copy(hdr(CYAN_HOT, 3.0));
    parts.halo.color.copy(hdr(CYAN_HOT, 1.6));
  } else if (state === 'denied') {
    parts.lamps.color.copy(hdr(MOLTEN, 2.0));
    parts.frame.color.copy(hdr(MOLTEN, 2.4));
    parts.halo.color.copy(hdr(MOLTEN, 1.2));
  } else {
    parts.lamps.color.copy(hdr(ICE, 1.7));
    parts.frame.color.copy(hdr(CYAN, 2.0));
    parts.halo.color.copy(hdr(CYAN, 0.8));
  }
}

export function disposeLetterObject(group: Group) {
  const parts = group.userData.letterParts as LetterParts | undefined;
  if (parts) {
    parts.lamps.dispose();
    parts.frame.dispose();
    parts.plate.dispose();
    parts.halo.dispose();
  }
  (group.userData.letterRivets as MeshBasicMaterial | undefined)?.dispose();
}

export function disposeLetterGeometries() {
  if (!sharedGeometry) return;
  for (const geometry of Object.values(sharedGeometry) as BufferGeometry[]) geometry.dispose();
  sharedGeometry = null;
}
