import { BoxGeometry, BufferGeometry, Group, Mesh, PlaneGeometry } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { PartBin, glowMesh, solidMesh } from './build';
import { AMBER, CHROME, HEADLIGHT, NIGHT, STEEL, hdr } from './palette';

/**
 * FLOOR! and AGAIN! are overhead gantry signs: a dark backing plate in a chrome
 * channel, with the glyph punched out of it as a grid of sodium lamp cells. The
 * lamps carry the read with bloom off because the plate behind them is nearly
 * black and the chrome channel outlines the whole sign.
 */

const CELL = 0.32;
const LAMP = 0.235;
const PLATE_WIDTH = 5 * CELL + 0.42;
const PLATE_HEIGHT = 7 * CELL + 0.42;

const plateCache = new Map<string, BufferGeometry>();
const lampCache = new Map<string, BufferGeometry>();

export function createSignMesh(character: string): Group {
  const key = character.toUpperCase();
  const group = new Group();
  const plate = solidMesh(cachedPlate(key));
  const lamps = glowMesh(cachedLamps(key));
  group.add(plate, lamps);
  group.userData.kind = 'letter';
  group.userData.isSign = true;
  group.userData.bodyMaterial = plate.material;
  group.userData.glowMaterial = lamps.material;
  return group;
}

function cachedPlate(key: string) {
  const cached = plateCache.get(key);
  if (cached) return cached;
  const bin = new PartBin();
  bin.add(new BoxGeometry(PLATE_WIDTH, PLATE_HEIGHT, 0.12), NIGHT.clone().addScalar(0.02));
  // Chrome channel around the plate: four rails, mitred by eye.
  bin.add(new BoxGeometry(PLATE_WIDTH + 0.16, 0.11, 0.2), hdr(CHROME, 0.85), { at: [0, PLATE_HEIGHT * 0.5, 0] });
  bin.add(new BoxGeometry(PLATE_WIDTH + 0.16, 0.11, 0.2), hdr(CHROME, 0.85), { at: [0, -PLATE_HEIGHT * 0.5, 0] });
  bin.add(new BoxGeometry(0.11, PLATE_HEIGHT + 0.16, 0.2), hdr(CHROME, 0.85), { at: [PLATE_WIDTH * 0.5, 0, 0] });
  bin.add(new BoxGeometry(0.11, PLATE_HEIGHT + 0.16, 0.2), hdr(CHROME, 0.85), { at: [-PLATE_WIDTH * 0.5, 0, 0] });
  // Two mounting lugs, so it reads as bolted to something.
  for (const side of [-1, 1]) {
    bin.add(new BoxGeometry(0.16, 0.5, 0.16), hdr(STEEL, 1.1), {
      at: [side * PLATE_WIDTH * 0.28, PLATE_HEIGHT * 0.5 + 0.28, 0],
    });
  }
  const merged = bin.merge();
  plateCache.set(key, merged);
  return merged;
}

function cachedLamps(key: string) {
  const cached = lampCache.get(key);
  if (cached) return cached;
  const bin = new PartBin();
  for (const cell of glyphOnCells(key)) {
    const x = (cell.x - 2) * CELL;
    const y = (3 - cell.y) * CELL;
    bin.add(new PlaneGeometry(LAMP, LAMP), hdr(AMBER, 1.9), { at: [x, y, 0.08] });
    bin.add(new PlaneGeometry(LAMP * 0.42, LAMP * 0.42), hdr(HEADLIGHT, 2.4), { at: [x, y, 0.1] });
  }
  const merged = bin.merge();
  lampCache.set(key, merged);
  return merged;
}

/** A blown-out sign lamp, thrown when a letter is shot. */
export function createSignShard(): Mesh {
  const bin = new PartBin();
  bin.add(new BoxGeometry(0.3, 0.3, 0.06), hdr(AMBER, 1.4));
  bin.add(new BoxGeometry(0.34, 0.05, 0.08), hdr(CHROME, 1.1), { at: [0, 0.16, 0] });
  return solidMesh(bin.merge());
}
