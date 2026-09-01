import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { sampleRailFrame, type RailFrame } from '../../engine/rail';
import { BROADSIDE_DURATION, bar } from './timing';

// The rail is authored as knots with musical times. The camera is at knot k
// exactly on knot k's bar, so every set piece — deck edge, cruiser flank,
// warship belly, flagship flank, trench — is placed against a position the
// camera is guaranteed to occupy on the beat. Progress between timed knots
// is a monotone cubic over arc length, so speed changes are smooth: the
// catapult launch, the fast flank run, the near-stall in the eye, and the
// pull-out are all just knot spacing.
//
// Frame: the rail heads -z. x is starboard, y is up.

type Knot = { at?: number; p: [number, number, number] };

const KNOTS: Knot[] = [
  // Flight deck of our flagship: catapult run, bow lip at bar 1.5.
  { at: 0, p: [0, 5, 30] },
  { at: 0.75, p: [0, 5, -60] },
  { at: 1.5, p: [0, 7, -165] },
  // The gaps: hard banks through the crossfire, then a straight for the barrel roll.
  { at: 2.2, p: [6, 11, -215] },
  { at: 3, p: [26, 20, -275] },
  { at: 4, p: [8, 8, -345] },
  { at: 4.8, p: [-30, -2, -410] },
  { at: 5.6, p: [-10, 12, -470] },
  { at: 6, p: [0, 18, -505] },
  { at: 7, p: [0, 18, -585] },
  { at: 7.5, p: [-5, 9, -625] },
  // Flank run: straight and fast down the friendly cruiser's starboard side.
  { at: 8, p: [-12, 0, -665] },
  { at: 11.5, p: [-12, 0, -1065] },
  // The eye: slow drift through the quiet.
  { at: 12, p: [0, 6, -1100] },
  { at: 13.5, p: [14, 10, -1165] },
  // Belly run: straight under the enemy warship.
  { at: 14, p: [6, -8, -1205] },
  { at: 17, p: [14, -8, -1455] },
  { at: 17.5, p: [42, -8, -1505] },
  // Flagship: pass one along its starboard flank, held tight to the hull.
  { at: 18, p: [64, -10, -1575] },
  { at: 19, p: [66, -10, -1650] },
  { at: 20, p: [66, -10, -1725] },
  { at: 21, p: [64, -10, -1810] },
  // Around the bow, climbing, into the trench on the spine heading back +z.
  { at: 21.5, p: [52, -2, -1865] },
  { p: [14, 8, -1900] },
  { at: 22.2, p: [-28, 16, -1890] },
  { p: [-40, 30, -1852] },
  { at: 22.7, p: [-10, 41, -1826] },
  { at: 23, p: [0, 31, -1798] },
  { p: [0, 27, -1770] },
  { at: 25.2, p: [0, 27, -1600] },
  // Pull-out: climb away over the battle, swing around, settle looking back.
  { at: 25.6, p: [10, 50, -1505] },
  { at: 26.1, p: [45, 100, -1360] },
  { at: 26.6, p: [115, 160, -1180] },
  { at: 27.05, p: [190, 205, -970] },
  { p: [250, 228, -800] },
  { at: 27.5, p: [290, 238, -670] },
  { p: [275, 238, -630] },
  { at: 27.82, p: [245, 235, -630] },
  { at: 28, p: [226, 231, -668] },
];

export const BROADSIDE_RAIL_POINTS = KNOTS.map((knot) => new Vector3(...knot.p));

export function createBroadsideRail() {
  return new CatmullRomCurve3(BROADSIDE_RAIL_POINTS.map((point) => point.clone()), false, 'centripetal', 0.5);
}

// ---- time → arc-length progress ----------------------------------------------

const curve = createBroadsideRail();
const DIVISIONS = 4000;
const lengths = curve.getLengths(DIVISIONS);
const totalLength = lengths[DIVISIONS];
export const BROADSIDE_RAIL_LENGTH = totalLength;

function uAtParameter(t: number) {
  const scaled = MathUtils.clamp(t, 0, 1) * DIVISIONS;
  const index = Math.min(DIVISIONS - 1, Math.floor(scaled));
  const frac = scaled - index;
  return MathUtils.lerp(lengths[index], lengths[index + 1], frac) / totalLength;
}

// Arc-length progress of each knot (knot k sits at parameter k/(N-1)).
const knotU = KNOTS.map((_knot, index) => uAtParameter(index / (KNOTS.length - 1)));

// Untimed knots take a time by arc-length proportion between their timed neighbours.
const knotTime: number[] = KNOTS.map((knot) => (knot.at === undefined ? Number.NaN : bar(knot.at)));
for (let i = 0; i < KNOTS.length; i += 1) {
  if (!Number.isNaN(knotTime[i])) continue;
  let previous = i - 1;
  while (Number.isNaN(knotTime[previous])) previous -= 1;
  let next = i + 1;
  while (Number.isNaN(knotTime[next])) next += 1;
  const span = knotU[next] - knotU[previous];
  const t = span <= 0 ? 0 : (knotU[i] - knotU[previous]) / span;
  knotTime[i] = MathUtils.lerp(knotTime[previous], knotTime[next], t);
}

// Fritsch–Carlson monotone cubic through (time, u): smooth, never runs
// backwards, and eases into the final knot so the pull-out settles.
const slopes: number[] = [];
{
  const n = KNOTS.length;
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i += 1) secant.push((knotU[i + 1] - knotU[i]) / Math.max(1e-6, knotTime[i + 1] - knotTime[i]));
  slopes.push(secant[0] * 0.6);
  for (let i = 1; i < n - 1; i += 1) {
    const a = secant[i - 1];
    const b = secant[i];
    slopes.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b));
  }
  slopes.push(secant[n - 2] * 0.35);
  for (let i = 0; i < n - 1; i += 1) {
    if (secant[i] === 0) { slopes[i] = 0; slopes[i + 1] = 0; continue; }
    const alpha = slopes[i] / secant[i];
    const beta = slopes[i + 1] / secant[i];
    const norm = alpha * alpha + beta * beta;
    if (norm > 9) {
      const tau = 3 / Math.sqrt(norm);
      slopes[i] = tau * alpha * secant[i];
      slopes[i + 1] = tau * beta * secant[i];
    }
  }
}

function progressAt(time: number) {
  const n = KNOTS.length;
  const t = MathUtils.clamp(time, knotTime[0], knotTime[n - 1]);
  let i = 0;
  while (i < n - 2 && t > knotTime[i + 1]) i += 1;
  const h = knotTime[i + 1] - knotTime[i];
  const s = h <= 0 ? 0 : (t - knotTime[i]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * knotU[i] + h10 * h * slopes[i] + h01 * knotU[i + 1] + h11 * h * slopes[i + 1];
}

/**
 * Rail progress for the runner. Capped just under 1 so the final frame keeps a
 * real look-ahead: the run ends with the camera settled on the last knot
 * looking back down the last segment, at the whole battle.
 */
export function broadsideRunProgress(time: number, duration = BROADSIDE_DURATION) {
  const t = MathUtils.clamp(time / duration, 0, 1) * BROADSIDE_DURATION;
  return MathUtils.clamp(progressAt(t), 0, 0.9995);
}

/** Rail parameter the camera occupies at run time `t`. */
export const railU = (time: number) => broadsideRunProgress(time);

/** Rail frame the camera occupies at run time `t`, for placing set pieces. */
export function railFrameAt(time: number): RailFrame {
  return sampleRailFrame(curve, railU(time));
}

/** Approximate camera speed in units per second at run time `t`. */
export function railSpeedAt(time: number) {
  const dt = 0.05;
  const a = broadsideRunProgress(Math.max(0, time - dt));
  const b = broadsideRunProgress(Math.min(BROADSIDE_DURATION, time + dt));
  return ((b - a) * totalLength) / (2 * dt);
}

// ---- world layout ------------------------------------------------------------------
// Capital ship placements the gameplay, environment, and boss all agree on.

export const OUR_FLAGSHIP = { center: new Vector3(0, -32, 20), length: 440, width: 130, height: 64 };
export const FLANK_CRUISER = { center: new Vector3(-70, -6, -865), length: 430, width: 52, height: 36 };
export const BELLY_WARSHIP = { center: new Vector3(0, 26, -1352), length: 310, width: 80, height: 44 };
export const ENEMY_FLAGSHIP = { center: new Vector3(0, -10, -1700), length: 300, width: 90, height: 60, bowZ: -1859 };
export const TRENCH = { x: 0, floorY: 20, wallY: 32, halfWidth: 14, fromZ: -1812, toZ: -1598 };
export const BATTLE_CENTER = new Vector3(0, 0, -1000);

// Fraction of a capital ship's height below centre where its keel bottoms out,
// and where its spine tops out; the ship factory builds to these.
export const KEEL_FRACTION = 0.45;
export const SPINE_TOP_FRACTION = 0.5;

/** First run time (searching from `from`) at which the rail's z crosses `z`. */
export function timeWhenRailZ(z: number, from: number, to: number) {
  const direction = Math.sign(railFrameAt(to).position.z - railFrameAt(from).position.z) || 1;
  let lo = from;
  let hi = to;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if ((railFrameAt(mid).position.z - z) * direction < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
