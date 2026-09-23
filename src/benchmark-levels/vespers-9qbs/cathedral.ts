import { CatmullRomCurve3, Vector3 } from 'three';
import { createSpeedProfile } from '../../engine/speed-profile';
import { mulberry32 } from '../../engine/rng';
import { VESPERS_DURATION, VESPERS_MARKERS } from './timing';

// The building itself: one layout shared by gameplay (creatures peel off
// specific windows) and visuals (which window goes dark, which relights).
// The nave runs along -Z from the choir at the east end to the dead rose in
// the west wall. The rail flies the nave high above a floor of candles,
// climbs into the crossing on the swell, sinks toward the candles for the
// quiet span, and slows to a hover in front of the rose.

export const NAVE_HALF_WIDTH = 22.5;
export const FLOOR_Y = -34;
export const SPRING_Y = 31; // where the vault ribs leave the piers
export const VAULT_Y = 46; // crown of the nave vault
export const BAY = 16;
export const AISLE_WALL_X = 38;
export const RAIL_LENGTH = 362;

// Piecewise speed over run time (1.0 ≈ 7.6 units/s). The swell pushes, the
// quiet span drags, and the fight at the rose is almost a hover.
const SPEED_KEYS: Array<[number, number]> = [
  [0, 0.55],
  [2.5, 0.95],
  [VESPERS_MARKERS.swell - 1, 1.0],
  [VESPERS_MARKERS.swell + 0.8, 1.28],
  [VESPERS_MARKERS.quiet - 1.2, 1.18],
  [VESPERS_MARKERS.quiet + 0.8, 0.82],
  [VESPERS_MARKERS.rose, 0.72],
  [VESPERS_MARKERS.rose + 4, 0.26],
  [VESPERS_MARKERS.deadline, 0.2],
  [VESPERS_DURATION, 0.16],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, VESPERS_DURATION);
export const speedFactorAt = speedProfile.speedAt;
export function vespersRunProgress(time: number, duration = VESPERS_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// Height and weave over run time. Z comes from the speed integral so every
// set piece (the crossing, the dark span, the rose) lands on its bar.
const RAIL_KEYS: Array<[time: number, x: number, y: number]> = [
  [0, 0, 0],
  [5, 2.2, 0.6],
  [10, -2.2, -0.4],
  [15, 2, 1],
  [19, 0.5, 4],
  [22.5, -1, 9.5],
  [25, 0, 12.5],
  [27.5, 1, 10.5],
  [30, 0, 3],
  [32.5, -1.5, -6],
  [35, 0.5, -9],
  [37.5, 0, -6],
  [42, 0, -1],
  [48, 0, 1.5],
  [60, 0, 2],
];

export function railZAt(time: number) {
  return -RAIL_LENGTH * vespersRunProgress(time);
}

export function createVespersRail() {
  return new CatmullRomCurve3(
    RAIL_KEYS.map(([time, x, y]) => new Vector3(x, y, railZAt(time))),
    false,
    'catmullrom',
    0.5,
  );
}

const rail = createVespersRail();
export function cameraPointAt(time: number) {
  return rail.getPointAt(Math.min(1, Math.max(0, vespersRunProgress(time))));
}

// ---- landmarks --------------------------------------------------------------

export const CROSSING_Z = Math.round(railZAt(25) / BAY) * BAY;
export const CROSSING_HALF = BAY; // two bays square, no piers inside
export const TRANSEPT_END_X = 50;
export const LANTERN_BASE_Y = VAULT_Y;
export const LANTERN_RADIUS = 14.5;

const END_POINT = rail.getPointAt(1);
export const WEST_WALL_Z = END_POINT.z - 34;
export const ROSE_CENTER = new Vector3(0, 6, WEST_WALL_Z + 0.4);
export const ROSE_RADIUS = 17;
export const EAST_END_Z = 40;

// Pier stations along the nave. The crossing replaces two bays with a
// square of four giant piers and opens the transepts.
export const PIER_ZS: number[] = [];
for (let z = EAST_END_Z - 12; z > WEST_WALL_Z + 4; z -= BAY) PIER_ZS.push(z);

export function inCrossing(z: number) {
  return z < CROSSING_Z + CROSSING_HALF - 0.5 && z > CROSSING_Z - CROSSING_HALF + 0.5;
}

// ---- windows --------------------------------------------------------------------

export type WindowTier = 'clerestory' | 'oculus' | 'aisle' | 'lantern' | 'transept' | 'west-lancet';
export type WindowShape = 'lancet' | 'round';
// Jewel hues: 0 cobalt, 1 blood red, 2 bottle green, 3 gold.
export type WindowHue = 0 | 1 | 2 | 3;

export type WindowSlot = {
  index: number;
  tier: WindowTier;
  shape: WindowShape;
  hue: WindowHue;
  position: Vector3;
  /** Unit normal pointing from the glass into the building. */
  inward: Vector3;
  width: number;
  height: number;
  side: -1 | 0 | 1;
};

function buildWindows(): WindowSlot[] {
  const rng = mulberry32(91017);
  const slots: WindowSlot[] = [];
  let previousHue = -1;
  const pickHue = (bias?: WindowHue): WindowHue => {
    let hue = (bias ?? Math.floor(rng() * 4)) as WindowHue;
    if (hue === previousHue && bias === undefined) hue = ((hue + 1 + Math.floor(rng() * 3)) % 4) as WindowHue;
    previousHue = hue;
    return hue;
  };
  const add = (slot: Omit<WindowSlot, 'index'>) => {
    slots.push({ ...slot, index: slots.length });
  };

  for (let i = 0; i < PIER_ZS.length - 1; i += 1) {
    const zMid = (PIER_ZS[i] + PIER_ZS[i + 1]) / 2;
    if (inCrossing(zMid)) continue;
    for (const side of [-1, 1] as const) {
      const inward = new Vector3(-side, 0, 0);
      const pairHue = pickHue();
      for (const dz of [-3.3, 3.3]) {
        add({ tier: 'clerestory', shape: 'lancet', hue: pairHue, position: new Vector3(side * NAVE_HALF_WIDTH, 19, zMid + dz), inward, width: 3.3, height: 12.5, side });
      }
      add({ tier: 'oculus', shape: 'round', hue: pickHue(), position: new Vector3(side * NAVE_HALF_WIDTH, 28.2, zMid), inward, width: 4.6, height: 4.6, side });
      const aisleHue = pickHue();
      for (const dz of [-3.1, 3.1]) {
        add({ tier: 'aisle', shape: 'lancet', hue: aisleHue, position: new Vector3(side * AISLE_WALL_X, -17, zMid + dz), inward, width: 3.1, height: 12, side });
      }
    }
  }

  // Lantern over the crossing: eight tall lights looking down into the swell.
  for (let k = 0; k < 8; k += 1) {
    const angle = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const position = new Vector3(Math.sin(angle) * LANTERN_RADIUS, LANTERN_BASE_Y + 17, CROSSING_Z + Math.cos(angle) * LANTERN_RADIUS);
    const inward = new Vector3(-Math.sin(angle), 0, -Math.cos(angle));
    add({ tier: 'lantern', shape: 'lancet', hue: pickHue(), position, inward, width: 4.4, height: 15, side: Math.sign(position.x) as -1 | 0 | 1 });
  }

  // Transept roses: a ring of round petals at each arm's end.
  for (const side of [-1, 1] as const) {
    const center = new Vector3(side * TRANSEPT_END_X, 12, CROSSING_Z);
    const inward = new Vector3(-side, 0, 0);
    for (let k = 0; k < 8; k += 1) {
      const angle = (k / 8) * Math.PI * 2;
      add({
        tier: 'transept',
        shape: 'round',
        hue: (k % 4) as WindowHue,
        position: center.clone().add(new Vector3(0, Math.sin(angle) * 6.8, Math.cos(angle) * 6.8)),
        inward,
        width: 4.2,
        height: 4.2,
        side,
      });
    }
    add({ tier: 'transept', shape: 'round', hue: 3, position: center.clone(), inward, width: 5.4, height: 5.4, side });
  }

  return slots;
}

export const WINDOWS: readonly WindowSlot[] = buildWindows();

// The last two bays before the west wall: the eight lights the Thing's claws
// have stripped. Killing a claw relights one; they frame the rose.
export const WEST_BAY_WINDOWS: readonly number[] = WINDOWS
  .filter((slot) => slot.tier === 'clerestory')
  .sort((a, b) => a.position.z - b.position.z)
  .slice(0, 8)
  .sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z)
  .map((slot) => slot.index);

/**
 * Deterministic window claims for the spawn timeline: every creature takes
 * the light of one window, and no window is stripped twice.
 */
export function createWindowClaims() {
  const used = new Set<number>(WEST_BAY_WINDOWS);
  return {
    claim(spawnTime: number, anchorZ: number, side: number, tiers: readonly WindowTier[]) {
      const cameraZ = railZAt(spawnTime);
      let best: WindowSlot | undefined;
      let bestScore = Infinity;
      for (const slot of WINDOWS) {
        if (used.has(slot.index) || !tiers.includes(slot.tier)) continue;
        if (side !== 0 && slot.side !== 0 && slot.side !== Math.sign(side)) continue;
        const ahead = cameraZ - slot.position.z;
        if (ahead < 14) continue;
        const score = Math.abs(slot.position.z - (anchorZ - 5)) + (ahead > 70 ? (ahead - 70) * 2 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = slot;
        }
      }
      if (!best) return -1;
      used.add(best.index);
      return best.index;
    },
  };
}
