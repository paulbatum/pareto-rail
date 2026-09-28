import { CatmullRomCurve3, Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { BARS, BROADSIDE_TLLU_RUN_DURATION, BROADSIDE_TLLU_TIME } from './timing';

// World frame: the battle runs toward -Z. Every capital ship is a static piece
// of the world; the rail threads the gaps between them, and every set piece
// (flank run, belly run, flagship hull, trench) is authored in the frame of the
// ship it belongs to so clearances are true by construction.

export type ShipClass = 'aegis' | 'cruiser' | 'frigate' | 'carrier' | 'wreck' | 'flagship';
export type ShipSpec = {
  id: string;
  side: 'friendly' | 'enemy';
  cls: ShipClass;
  /** World-space center. */
  center: readonly [number, number, number];
  /** Degrees. Yaw 0 points the bow at -Z; yaw 180 points it at the player. */
  yaw: number;
  pitch?: number;
  roll?: number;
  length: number;
  beam: number;
  height: number;
  seed: number;
};

export const SHIPS: readonly ShipSpec[] = [
  // --- friendly fleet (ice white, cyan engines) ---
  { id: 'aegis', side: 'friendly', cls: 'aegis', center: [0, -70, 240], yaw: 0, length: 900, beam: 230, height: 140, seed: 11 },
  { id: 'halcyon', side: 'friendly', cls: 'cruiser', center: [-215, 8, -470], yaw: 4, roll: 3, length: 540, beam: 96, height: 64, seed: 21 },
  { id: 'lark', side: 'friendly', cls: 'frigate', center: [-360, 96, -330], yaw: -14, roll: -6, length: 170, beam: 40, height: 30, seed: 22 },
  { id: 'meridian', side: 'friendly', cls: 'cruiser', center: [-250, -50, -960], yaw: -7, roll: -4, length: 480, beam: 90, height: 60, seed: 23 },
  { id: 'resolute', side: 'friendly', cls: 'cruiser', center: [-92, 4, -1592], yaw: 0, length: 1250, beam: 120, height: 84, seed: 24 },
  { id: 'tern', side: 'friendly', cls: 'frigate', center: [150, -70, -290], yaw: 8, roll: 10, length: 140, beam: 34, height: 26, seed: 25 },
  { id: 'vanguard', side: 'friendly', cls: 'cruiser', center: [-420, 22, -2480], yaw: -5, length: 500, beam: 96, height: 62, seed: 26 },
  { id: 'sable', side: 'friendly', cls: 'cruiser', center: [300, 96, -3050], yaw: 6, roll: 5, length: 520, beam: 100, height: 66, seed: 27 },
  { id: 'kestrel', side: 'friendly', cls: 'frigate', center: [120, 150, -2050], yaw: 12, length: 150, beam: 36, height: 28, seed: 28 },
  // --- enemy fleet (obsidian, molten seams) ---
  { id: 'vorax', side: 'enemy', cls: 'cruiser', center: [235, 38, -560], yaw: 188, roll: -5, length: 600, beam: 110, height: 78, seed: 31 },
  { id: 'maw', side: 'enemy', cls: 'carrier', center: [150, 180, -960], yaw: 162, roll: 6, length: 720, beam: 260, height: 60, seed: 32 },
  { id: 'gorge', side: 'enemy', cls: 'cruiser', center: [340, 20, -1450], yaw: 172, length: 700, beam: 120, height: 90, seed: 33 },
  { id: 'talon', side: 'enemy', cls: 'cruiser', center: [310, 92, -1900], yaw: 202, roll: 4, length: 640, beam: 110, height: 80, seed: 34 },
  { id: 'husk', side: 'enemy', cls: 'wreck', center: [190, -30, -2350], yaw: 210, pitch: 14, roll: 22, length: 230, beam: 70, height: 56, seed: 35 },
  { id: 'belly', side: 'enemy', cls: 'cruiser', center: [30, 45, -2720], yaw: 180, length: 620, beam: 120, height: 90, seed: 36 },
  { id: 'anvil', side: 'enemy', cls: 'carrier', center: [400, 30, -3560], yaw: 188, roll: -3, length: 700, beam: 250, height: 62, seed: 37 },
  { id: 'scourge', side: 'enemy', cls: 'cruiser', center: [520, -70, -2350], yaw: 158, length: 600, beam: 110, height: 76, seed: 38 },
  { id: 'lament', side: 'enemy', cls: 'cruiser', center: [30, -20, -4380], yaw: 176, length: 560, beam: 104, height: 72, seed: 39 },
  { id: 'obsidian', side: 'enemy', cls: 'flagship', center: [-250, 40, -3570], yaw: 180, length: 1100, beam: 260, height: 140, seed: 40 },
];

/** Flagship geometry shared by the model, the boss parts, and the rail. */
export const FLAGSHIP = {
  spec: SHIPS.find((ship) => ship.id === 'obsidian')!,
  trenchHalfWidth: 34,
  trenchFloorY: 52,
  deckTopY: 110,
  /** Port hull wall as seen from the rail (world x). */
  wallX: -120,
} as const;

export function shipMatrix(spec: ShipSpec) {
  const quaternion = new Quaternion().setFromEuler(new Euler(
    MathUtils.degToRad(spec.pitch ?? 0),
    MathUtils.degToRad(spec.yaw),
    MathUtils.degToRad(spec.roll ?? 0),
    'YXZ',
  ));
  return new Matrix4().compose(new Vector3(...spec.center), quaternion, new Vector3(1, 1, 1));
}

export function shipToWorld(spec: ShipSpec, local: Vector3) {
  return local.clone().applyMatrix4(shipMatrix(spec));
}

// ---- the rail --------------------------------------------------------------------

type Waypoint = readonly [x: number, y: number, z: number, tag?: string];

const HELIX_CENTER: readonly [number, number] = [55, 25];
const HELIX_RADIUS = 21;
const HELIX_Z: readonly [number, number] = [-700, -905];
const HELIX_POINTS = 9;

function helixWaypoints(): Waypoint[] {
  const points: Waypoint[] = [];
  const turns = 1.5;
  for (let i = 0; i < HELIX_POINTS; i += 1) {
    const s = i / (HELIX_POINTS - 1);
    const angle = s * turns * Math.PI * 2;
    points.push([
      HELIX_CENTER[0] + Math.cos(angle) * HELIX_RADIUS,
      HELIX_CENTER[1] + Math.sin(angle) * HELIX_RADIUS,
      HELIX_Z[0] + (HELIX_Z[1] - HELIX_Z[0]) * s,
    ]);
  }
  return points;
}

const WAYPOINTS: readonly Waypoint[] = [
  // launch: down the flagship deck and off the bow
  [0, 6.5, 10, 'launch'],
  [0, 7, -100],
  [0, 9, -200],
  [-4, 10, -245, 'crossfire'],
  // crossfire: hard banks through the gap, then the corkscrew
  [-42, 2, -335],
  [-92, -12, -425],
  [-20, 12, -515],
  [45, 30, -600],
  ...helixWaypoints(),
  [20, 14, -965],
  // broadside: the long high-speed run down the friendly cruiser's flank
  [-2, 5, -1030, 'flank'],
  [2, 6, -1200],
  [-3, 4, -1390],
  [3, 8, -1590],
  [-1, 6, -1800],
  [1, 8, -2010],
  [4, 9, -2200],
  [10, 9, -2262, 'eye'],
  // eye: a slow glide through the wreck field
  [44, 4, -2310],
  [38, -6, -2385],
  [26, -18, -2450, 'belly'],
  // belly: under the enemy warship
  [30, -17, -2560],
  [28, -14, -2730],
  [22, -14, -2880],
  [-10, -12, -2955],
  [-60, -8, -3010, 'flagship'],
  // flagship pass: close along the port hull
  [-72, 8, -3110],
  [-74, 32, -3240],
  [-70, 44, -3390],
  [-66, 50, -3535, 'escorts'],
  // the rail comes around: up the hull, over the shoulder, back down the spine
  [-72, 74, -3600],
  [-100, 112, -3652],
  [-150, 148, -3682],
  [-215, 158, -3672],
  [-262, 138, -3622],
  [-262, 108, -3565, 'trench'],
  // trench dive: fast at the lip, easing to a stop a few dozen meters before the reactor
  [-258, 90, -3510],
  [-256, 88, -3440, 'trenchMid'],
  [-256, 86, -3370, 'trenchLate'],
  [-256, 86, -3292, 'victory'],
  // tail: runs on down the trench past the reactor (so the runner's look-ahead keeps facing it through the
  // hold), then hooks back to end looking down -Z. The camera pull-out replaces this from the reactor's death on.
  [-256, 86, -3210],
  [-256, 88, -3130],
  [-256, 92, -3060],
  [-250, 100, -3030],
  [-238, 110, -3024],
  [-224, 116, -3044],
  [-216, 118, -3090, 'end'],
];

export function createBroadsideRail() {
  return new CatmullRomCurve3(
    WAYPOINTS.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'centripetal',
    0.5,
  );
}

// ---- progress / speed -----------------------------------------------------------

const RAIL = createBroadsideRail();
const RAIL_LENGTH = RAIL.getLength();

/** Fractional rail position (0..1) of each tagged waypoint, measured by arc length. */
function measureTagU() {
  const samples = 6000;
  const cumulative: number[] = [0];
  let previous = RAIL.getPoint(0);
  for (let i = 1; i <= samples; i += 1) {
    const point = RAIL.getPoint(i / samples);
    cumulative.push(cumulative[i - 1] + point.distanceTo(previous));
    previous = point;
  }
  const total = cumulative[samples];
  const tagged: Record<string, number> = {};
  const lastIndex = WAYPOINTS.length - 1;
  WAYPOINTS.forEach((waypoint, index) => {
    const tag = waypoint[3];
    if (!tag) return;
    // Waypoint i sits at curve parameter i/(n-1) for CatmullRomCurve3.
    const t = index / lastIndex;
    const position = t * samples;
    const lo = Math.floor(position);
    const hi = Math.min(samples, lo + 1);
    tagged[tag] = MathUtils.lerp(cumulative[lo], cumulative[hi], position - lo) / total;
  });
  return tagged;
}

export const RAIL_TAG_U = measureTagU();

// Progress knots: run time (bars) -> rail fraction. Speeds fall out of the
// spacing: fast on the flank and the trench dive, a held breath in the eye.
const bar = (value: number) => BROADSIDE_TLLU_TIME.bar(value);
const KNOTS: ReadonlyArray<readonly [time: number, u: number]> = [
  [0, 0],
  [bar(BARS.crossfire), RAIL_TAG_U.crossfire],
  [bar(BARS.flank), RAIL_TAG_U.flank],
  [bar(BARS.eye), RAIL_TAG_U.eye],
  [bar(BARS.belly), RAIL_TAG_U.belly],
  [bar(BARS.flagship), RAIL_TAG_U.flagship],
  [bar(BARS.escorts), RAIL_TAG_U.escorts],
  [bar(BARS.trench), RAIL_TAG_U.trench],
  [bar(BARS.trench + 0.6), RAIL_TAG_U.trenchMid],
  [bar(BARS.trench + 1.2), RAIL_TAG_U.trenchLate],
  [bar(BARS.trench + 1.9), RAIL_TAG_U.victory],
  [bar(BARS.victory), MathUtils.lerp(RAIL_TAG_U.victory, RAIL_TAG_U.end, 0.05)],
  [bar(BARS.victory + 0.75), MathUtils.lerp(RAIL_TAG_U.victory, RAIL_TAG_U.end, 0.2)],
  [BROADSIDE_TLLU_RUN_DURATION, 1],
];

/** Monotone cubic (Fritsch–Carlson) through the knots: continuous speed, never backwards. */
function createMonotoneProgress(knots: ReadonlyArray<readonly [number, number]>) {
  const n = knots.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    h.push(knots[i + 1][0] - knots[i][0]);
    delta.push((knots[i + 1][1] - knots[i][1]) / h[i]);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = delta[0] * 0.3;
  m[n - 1] = delta[n - 2] * 0.15;
  for (let i = 1; i < n - 1; i += 1) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (2 * delta[i - 1] * delta[i]) / (delta[i - 1] + delta[i]);
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * delta[i];
      m[i + 1] = tau * b * delta[i];
    }
  }
  return (time: number) => {
    if (time <= knots[0][0]) return knots[0][1];
    if (time >= knots[n - 1][0]) return knots[n - 1][1];
    let i = 0;
    while (i < n - 2 && time > knots[i + 1][0]) i += 1;
    const t = (time - knots[i][0]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * knots[i][1]
      + (t3 - 2 * t2 + t) * h[i] * m[i]
      + (-2 * t3 + 3 * t2) * knots[i + 1][1]
      + (t3 - t2) * h[i] * m[i + 1]
    );
  };
}

const progress = createMonotoneProgress(KNOTS);

/** The level's authored variable speed: eased rail fraction at a run time. */
export function broadsideProgress(time: number, duration = BROADSIDE_TLLU_RUN_DURATION) {
  const t = duration === BROADSIDE_TLLU_RUN_DURATION ? time : (time / duration) * BROADSIDE_TLLU_RUN_DURATION;
  return MathUtils.clamp(progress(MathUtils.clamp(t, 0, BROADSIDE_TLLU_RUN_DURATION)), 0, 1);
}

export function railSpeedAt(time: number) {
  const dt = 0.05;
  return ((broadsideProgress(time + dt) - broadsideProgress(time - dt)) / (2 * dt)) * RAIL_LENGTH;
}

/** First run time at which the camera has reached rail fraction `u`. */
export function timeAtRailU(u: number) {
  let lo = 0;
  let hi = BROADSIDE_TLLU_RUN_DURATION;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (broadsideProgress(mid) < u) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Rail fraction closest to a world point, searched over a rail window. */
export function railUNearest(point: Vector3, from = 0, to = 1) {
  let bestU = from;
  let bestDistance = Infinity;
  const steps = 1400;
  for (let i = 0; i <= steps; i += 1) {
    const u = from + ((to - from) * i) / steps;
    const distance = RAIL.getPointAt(u).distanceToSquared(point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestU = u;
    }
  }
  return bestU;
}

export const RAIL_LENGTH_UNITS = RAIL_LENGTH;

// ---- hull-mounted targets ----------------------------------------------------------------
// Positions live here (not in gameplay) so the ship models can seat sockets exactly where
// the deployable guns appear.

/** Belly battery sockets under the enemy cruiser, in ship-local x/z (bow at -z). */
export const BELLY_MOUNTS_LOCAL: ReadonlyArray<readonly [x: number, z: number]> = [
  [-34, -232], [38, -178], [-40, -118], [30, -62], [-32, -4], [40, 52], [-36, 108], [34, 160],
];

/** Shield generators on the flagship's port wall, world space. */
export const FLAGSHIP_GENS_WORLD: readonly Vector3[] = [
  new Vector3(-108, 28, -3132),
  new Vector3(-108, 54, -3256),
  new Vector3(-108, 22, -3376),
  new Vector3(-108, 56, -3498),
];

/** Point-defense guns along the flagship's port wall, world space. */
export const FLAGSHIP_PD_WORLD: readonly Vector3[] = [
  new Vector3(-116, 8, -3092),
  new Vector3(-116, 44, -3182),
  new Vector3(-116, 10, -3206),
  new Vector3(-116, 36, -3312),
  new Vector3(-116, 6, -3330),
  new Vector3(-116, 58, -3432),
  new Vector3(-116, 30, -3446),
  new Vector3(-116, 12, -3520),
];

export const TRENCH_CORES_WORLD: readonly Vector3[] = [new Vector3(-262, 76, -3490), new Vector3(-246, 76, -3400)];
export const TRENCH_HEART_WORLD = new Vector3(-256, 72, -3236);
export const TRENCH_PD_WORLD: readonly Vector3[] = [new Vector3(-279, 88, -3470), new Vector3(-221, 90, -3345)];
