import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';

export const BELL = new Vector3(0, 57, -80);
export const PARENT = new Vector3(0, 53, -77);
export const ANIMAL_CENTER = new Vector3(0, -24, -80);
export const STRAND_COUNT = 52;
export const BELL_RADIUS = 51;
export const BELL_HEIGHT = 31;

const WAYPOINTS: Array<[number, number, number, number]> = [
  [0, 16, -109, -39], [3.75, -3, -92, -53],
  [7.5, -21, -72, -72], [11.25, -4, -52, -101],
  [14.5, 27, -35, -91], [17.5, 68, -12, -51],
  [20, 77, 6, -21], [22.5, 41, -1, -33],
  [26.25, 15, -16, -67], [30, -18, -1, -91],
  [33.75, -17, 15, -56], [37.5, 0, 29, -44],
  [42.5, 0, 31, -44], [47.5, 0, 32, -44],
  [52.5, 0, 33, -44], [60, 0, 34, -44],
];

export function createRail() {
  const curve = new CatmullRomCurve3(WAYPOINTS.map(([, x, y, z]) => new Vector3(x, y, z)), false, 'centripetal');
  curve.arcLengthDivisions = 1600;
  return curve;
}
const referenceRail = createRail();
const lengths = referenceRail.getLengths(1600);
const totalLength = lengths[lengths.length - 1];
const waypointU = WAYPOINTS.map((_, i) => {
  const p = i / (WAYPOINTS.length - 1) * 1600;
  const a = Math.floor(p);
  return MathUtils.lerp(lengths[a], lengths[Math.min(1600, a + 1)], p - a) / totalLength;
});

export function railProgress(time: number) {
  const t = MathUtils.clamp(time, 0, 60);
  let i = 0;
  while (i < WAYPOINTS.length - 2 && t > WAYPOINTS[i + 1][0]) i++;
  const f = (t - WAYPOINTS[i][0]) / (WAYPOINTS[i + 1][0] - WAYPOINTS[i][0]);
  return MathUtils.lerp(waypointU[i], waypointU[i + 1], f);
}

export function railPosition(time: number, target = new Vector3()) {
  return referenceRail.getPointAt(railProgress(time), target);
}

export function cameraFocus(time: number) {
  const look = railPosition(Math.min(60, time + 1.25));
  const reveal = smooth(14.5, 17.2, time) * (1 - smooth(20.5, 23.5, time));
  look.lerp(new Vector3(0, 69, -80), reveal);
  look.lerp(PARENT, smooth(33.5, 37.5, time));
  return look;
}

export function smooth(a: number, b: number, x: number) {
  const p = MathUtils.clamp((x - a) / (b - a), 0, 1);
  return p * p * (3 - 2 * p);
}

export function strandRoot(i: number) {
  const angle = i * 2.3999632297;
  const radius = 9 + Math.sqrt((i + 0.5) / STRAND_COUNT) * 39;
  return new Vector3(Math.cos(angle) * radius, BELL.y - 1.8, BELL.z + Math.sin(angle) * radius);
}

export function strandPoint(i: number, t: number, target = new Vector3()) {
  const root = strandRoot(i);
  const length = 154 + (i % 7) * 8.3;
  const a = i * 2.3999632297;
  const curl = t * t;
  return target.set(
    root.x + Math.sin(t * 7.2 + a) * (3 + t * 12) * t + Math.sin(a) * curl * 12,
    root.y - t * length,
    root.z + Math.cos(t * 6.3 + a) * (4 + t * 10) * t + Math.cos(a * 2) * curl * 9,
  );
}

export function nearestStrand(point: Vector3) {
  let best = 0;
  let distance = Infinity;
  const p = new Vector3();
  for (let i = 0; i < STRAND_COUNT; i++) {
    const t = MathUtils.clamp((BELL.y - point.y) / (154 + (i % 7) * 8.3), 0, 1);
    strandPoint(i, t, p);
    const d = p.distanceToSquared(point);
    if (d < distance) { distance = d; best = i; }
  }
  return best;
}

export type RescueState = {
  time: number;
  kills: number;
  freedAt: number;
  exposed: boolean;
  ended: boolean;
  broodKills: number[];
  cleansed: Set<number>;
  pullPosition: Vector3;
};

export function createRescueState(): RescueState {
  return { time: 0, kills: 0, freedAt: -1, exposed: false, ended: false, broodKills: [0, 0, 0],
    cleansed: new Set(), pullPosition: new Vector3() };
}
