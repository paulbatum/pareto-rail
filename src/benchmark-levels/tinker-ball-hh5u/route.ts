import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import { bar, TINKER_BARS, TINKER_RUN_DURATION } from './timing';

// The ball's route across the worktable. The rail IS the ball's baseline path
// on the table (y = 0); the chase camera is derived from the ball, not the
// other way round. Everything here is authored in world units of roughly one
// centimetre: a marble is ~2 units across, the table is several metres.
//
// The route is built by a turtle so that turns are smooth and segment lengths
// are exact, then the spill orbit is generated parametrically as a
// constant-pitch spiral around the spill centre, and the finale cuts straight
// through the spill's heart onto the spotless patch.

// Rolling speed in units per second at run times (seconds). Tiny and careful as
// a marble, rolling harder at each size-up, circling the spill, then coasting.
const SPEED_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, 4],
  [1.0, 8],
  [bar(1), 9.5],
  [bar(8.5), 11],
  [bar(9.25), 17],
  [bar(18.5), 20],
  [bar(19.25), 26],
  [bar(TINKER_BARS.spill), 24],
  [bar(29), 22],
  [bar(TINKER_BARS.heartCut), 20],
  [bar(31), 13],
  [TINKER_RUN_DURATION, 8],
];

// Pre-spill route in turtle segments: [relative length, total turn in degrees,
// positive = right]. Lengths are rescaled so the ball meets the spill orbit
// exactly on the bar-22 downbeat.
const APPROACH_SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  // marble: a nervous little S between the buttons
  [26, 0],
  [34, 22],
  [36, -38],
  [34, 18],
  [22, 0],
  // tennis: the long sweeping right-hander round the thread spools
  [44, -24],
  [90, 104],
  [56, -34],
  [60, 26],
  [36, 0],
  // melon: straightening up, then leaning left into the spill orbit
  [60, -18],
  [70, -30],
];

const SPILL_ORBIT = {
  startRadius: 82,
  endRadius: 30,
  approachFraction: 0.62,
} as const;

export const SPILL_GLUE_RADIUS = 24;

const STEP = 3;

export type Route = ReturnType<typeof createRoute>;

export function createRoute() {
  const distanceTable = buildDistanceTable();
  const totalDistance = distanceTable[distanceTable.length - 1];
  const distanceAtTime = (time: number) => sampleTable(distanceTable, time);
  const spillStartDistance = distanceAtTime(bar(TINKER_BARS.spill));
  const heartDistance = distanceAtTime(bar(TINKER_BARS.heartCut));

  const points: Vector3[] = [];
  const position = new Vector3();
  let heading = 0;
  points.push(position.clone());

  // 1. Approach turtle, scaled to reach the orbit on the bar-22 downbeat.
  const rawLength = APPROACH_SEGMENTS.reduce((sum, [length]) => sum + length, 0);
  const scale = spillStartDistance / rawLength;
  for (const [length, turn] of APPROACH_SEGMENTS) {
    const worldLength = length * scale;
    const steps = Math.max(1, Math.round(worldLength / STEP));
    const turnPerStep = MathUtils.degToRad(turn) / steps;
    const stepLength = worldLength / steps;
    for (let i = 0; i < steps; i += 1) {
      heading += turnPerStep * 0.5;
      position.add(dir(heading).multiplyScalar(stepLength));
      heading += turnPerStep * 0.5;
      points.push(position.clone());
    }
  }
  const orbitStartIndex = points.length - 1;

  // 2. The spill orbit: a constant-pitch spiral turning left, tightening
  // from startRadius to endRadius. Solve the pitch so the orbit plus the
  // final cut lands in the spill's heart on the bar-30 downbeat.
  const orbitBudget = heartDistance - spillStartDistance;
  const approachLength = SPILL_ORBIT.endRadius * (1 + SPILL_ORBIT.approachFraction);
  const spiralLength = Math.max(40, orbitBudget - approachLength);
  const pitch = Math.asin(MathUtils.clamp((SPILL_ORBIT.startRadius - SPILL_ORBIT.endRadius) / spiralLength, 0.02, 0.9));
  // The centre sits left of the heading, rotated in by (90° - pitch).
  const centerAngle = heading - (Math.PI / 2 - pitch);
  const spillCenter = position.clone().add(dir(centerAngle).multiplyScalar(SPILL_ORBIT.startRadius));
  const toCenter = new Vector3();
  while (true) {
    toCenter.copy(spillCenter).sub(position);
    toCenter.y = 0;
    const radius = toCenter.length();
    if (radius <= SPILL_ORBIT.endRadius) break;
    const angleToCenter = Math.atan2(toCenter.x, -toCenter.z);
    heading = angleToCenter + (Math.PI / 2 - pitch);
    position.add(dir(heading).multiplyScalar(STEP));
    points.push(position.clone());
  }
  const orbitEndIndex = points.length - 1;

  // 3. The cut: a Bézier from the orbit into the heart, then straight on
  // across the cleaned table.
  const exitDirection = spillCenter.clone().sub(position).setY(0).normalize();
  const orbitDirection = dir(heading);
  const cutStart = position.clone();
  const reach = cutStart.distanceTo(spillCenter);
  const c1 = cutStart.clone().addScaledVector(orbitDirection, reach * 0.55);
  const c2 = spillCenter.clone().addScaledVector(exitDirection, -reach * 0.5);
  const cutSteps = Math.max(8, Math.round((reach * 1.35) / STEP));
  for (let i = 1; i <= cutSteps; i += 1) {
    const t = i / cutSteps;
    points.push(cubic(cutStart, c1, c2, spillCenter, t));
  }
  const heartIndex = points.length - 1;
  const coast = Math.max(40, totalDistance - heartDistance) + 60;
  const coastSteps = Math.round(coast / STEP);
  for (let i = 1; i <= coastSteps; i += 1) {
    points.push(spillCenter.clone().addScaledVector(exitDirection, i * STEP));
  }

  const curve = new CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const curveLength = curve.getLength();

  const lengths = curve.getLengths(points.length * 2);
  const distanceOfIndex = (index: number) => lengths[Math.round((index / (points.length - 1)) * (lengths.length - 1))];
  const orbitStartDistance = distanceOfIndex(orbitStartIndex);
  const heartPassDistance = distanceOfIndex(heartIndex);

  // The speed table is authored in turtle lengths; the smoothed curve comes
  // out a little longer through the orbit. Remap piecewise so the ball still
  // meets the orbit on bar 22 and the heart on bar 30.
  const curveDistanceAt = (time: number) => {
    const d = distanceAtTime(time);
    if (d <= spillStartDistance) return (d / spillStartDistance) * orbitStartDistance;
    if (d <= heartDistance) {
      return MathUtils.lerp(orbitStartDistance, heartPassDistance, (d - spillStartDistance) / (heartDistance - spillStartDistance));
    }
    return heartPassDistance + (d - heartDistance);
  };

  // The rail runs past the end of the run (the coast continues after the
  // summary appears), so progress is distance over curve length rather than
  // a normalized 0→1 over the run.
  const runProgress = (time: number) => MathUtils.clamp(curveDistanceAt(time) / curveLength, 0, 1);

  /** Rail frame at a route distance. */
  const frameAt = (s: number) => sampleRailFrame(curve, MathUtils.clamp(s / curveLength, 0, 1));

  return {
    curve,
    curveLength,
    frameAt,
    totalDistance,
    runProgress,
    distanceAtTime: curveDistanceAt,
    speedAt,
    spillCenter,
    orbitPitch: pitch,
    orbitStartDistance,
    orbitEndDistance: distanceOfIndex(orbitEndIndex),
    heartPassDistance,
    exitDirection,
  };
}

export function speedAt(time: number) {
  const t = MathUtils.clamp(time, 0, TINKER_RUN_DURATION);
  for (let i = 1; i < SPEED_KEYS.length; i += 1) {
    const [t1, v1] = SPEED_KEYS[i];
    if (t <= t1) {
      const [t0, v0] = SPEED_KEYS[i - 1];
      const k = (t - t0) / Math.max(1e-4, t1 - t0);
      // Smoothstep between keys so speed changes ease rather than kink.
      return MathUtils.lerp(v0, v1, k * k * (3 - 2 * k));
    }
  }
  return SPEED_KEYS[SPEED_KEYS.length - 1][1];
}

const TABLE_SAMPLES = 1200;

function buildDistanceTable() {
  const table = [0];
  const dt = TINKER_RUN_DURATION / TABLE_SAMPLES;
  let sum = 0;
  for (let i = 1; i <= TABLE_SAMPLES; i += 1) {
    sum += speedAt((i - 0.5) * dt) * dt;
    table.push(sum);
  }
  return table;
}

function sampleTable(table: number[], time: number) {
  const x = MathUtils.clamp(time / TINKER_RUN_DURATION, 0, 1) * TABLE_SAMPLES;
  const index = Math.min(TABLE_SAMPLES - 1, Math.floor(x));
  return MathUtils.lerp(table[index], table[index + 1], x - index);
}

function dir(heading: number) {
  return new Vector3(Math.sin(heading), 0, -Math.cos(heading));
}

function cubic(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number) {
  const u = 1 - t;
  return new Vector3()
    .addScaledVector(a, u * u * u)
    .addScaledVector(b, 3 * u * u * t)
    .addScaledVector(c, 3 * u * t * t)
    .addScaledVector(d, t * t * t);
}
