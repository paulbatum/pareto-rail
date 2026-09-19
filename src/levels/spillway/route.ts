import { MathUtils, Vector3 } from 'three';

// The geography of the run, authored as data: the river's course through the
// gorge, the reservoir, the dam, the spillway chute and the valley below it.
// The rail (rail.ts), the world queries (world.ts) and every environment leaf
// build from these numbers, so a change here moves the river, its walls, the
// rail and the dam together.
//
// World frame: the river leaves the upper pool heading -Z. Headings are
// degrees clockwise from -Z seen from above, so +90 is +X. The sun is high on
// the right-hand side of the gorge, ahead and to the right off the ski-jump lip.

/** Rail speed in world units per second at speed factor 1. Leg lengths are authored from it. */
export const BASE_SPEED = 30;
export const WATER_LEVEL = -68;
export const TAILWATER = WATER_LEVEL - 108;

/** Spacing of spine samples along the river, in world units. */
export const SPINE_STEP = 1.5;

export type RiverCharacter = {
  /** Water half-width. */
  halfWidth: number;
  /** Wall height above the water, before rim notches. */
  wall: number;
  /** 0 calm to 1 full whitewater: foam, standing waves, spray. */
  rapids: number;
  /** Rail height above the water. */
  ride: number;
};

type Leg = {
  length: number;
  /** Heading change over the leg, degrees; positive turns right. */
  turn?: number;
  /** Rail bank at the middle of the leg, degrees; its sign follows the turn. */
  bank?: number;
  drop?: number;
  cascade?: boolean;
  /** Bar at which the camera reaches the end of this leg. */
  bar?: number;
  end: Partial<RiverCharacter>;
};

const START: RiverCharacter = { halfWidth: 62, wall: 11, rapids: 0, ride: 3.2 };

// Leg lengths are the design's speed factor × BASE_SPEED × section duration.
const LEGS: Leg[] = [
  // Behind the start: the pool continues upstream so the attract camera sees water behind it.
  { length: 150, bar: 0, end: {} },
  // upper — wide calm pool, low granite banks (0.7)
  { length: 90, end: { halfWidth: 60, wall: 12 } },
  { length: 115, turn: -10, bank: 4, end: { halfWidth: 52, wall: 16 } },
  { length: 110, turn: 12, bank: 5, bar: 8, end: { halfWidth: 40, wall: 34, rapids: 0.1, ride: 2.8 } },
  // narrows — the walls close in, first rapids (1.0)
  { length: 150, turn: -18, bank: 10, drop: 3, end: { halfWidth: 29, wall: 62, rapids: 0.3, ride: 2.4 } },
  { length: 170, turn: 24, bank: 12, drop: 3, end: { halfWidth: 24, wall: 82, rapids: 0.45 } },
  { length: 165, turn: -20, bank: 11, drop: 3, end: { halfWidth: 22, wall: 96, rapids: 0.5 } },
  { length: 170, turn: 12, bank: 7, drop: 3, bar: 20, end: { halfWidth: 19, wall: 102, rapids: 0.6, ride: 2.2 } },
  // chute — the cascade drop (1.8)
  { length: 40, end: { halfWidth: 16, wall: 106, rapids: 0.85 } },
  { length: 64, drop: 26, cascade: true, end: { halfWidth: 17, wall: 112, rapids: 1 } },
  { length: 92, turn: 8, bank: 4, bar: 22, end: { halfWidth: 18, wall: 116, rapids: 0.9, ride: 2 } },
  // whitewater — hard banking S-bends (1.3); the fourth leg is the straight for the walker under-pass
  // The water gets rougher and whiter from bend to bend.
  { length: 150, turn: -30, bank: 24, drop: 5, end: { halfWidth: 17, wall: 118, rapids: 0.75 } },
  { length: 160, turn: 34, bank: 25, drop: 5, end: { halfWidth: 20, wall: 120, rapids: 0.82 } },
  { length: 140, turn: -24, bank: 20, drop: 4, end: { halfWidth: 23, wall: 110, rapids: 0.88 } },
  { length: 250, turn: 4, drop: 6, end: { halfWidth: 25, wall: 104, rapids: 0.94 } },
  { length: 150, turn: 24, bank: 22, drop: 5, end: { halfWidth: 22, wall: 100, rapids: 1 } },
  { length: 143, turn: -12, bank: 12, drop: 5, bar: 36, end: { halfWidth: 46, wall: 58, rapids: 0.25, ride: 2.8 } },
  // reservoir — the gorge opens onto the lake and turns toward the dam (1.1)
  // Short and slow, so the dam is close by bar 40 and fills the frame.
  { length: 140, turn: 40, bank: 8, end: { halfWidth: 150, wall: -14, rapids: 0, ride: 3 } },
  { length: 90, bar: 42, end: { halfWidth: 220, wall: -20 } },
];

/** Distance from the end of the last river leg to the dam's crest centre, along the lake axis. */
const LAKE_RUN_TO_DAM = 120;

export type SpineKind = 'river' | 'lake' | 'chute' | 'valley';

export type SpineSample = RiverCharacter & {
  s: number;
  x: number;
  z: number;
  /** Water surface height. */
  y: number;
  /** Radians, clockwise from -Z. */
  heading: number;
  kind: SpineKind;
};

export type RailTag = { knot: number; bar: number };

export function headingVector(heading: number, out = new Vector3()) {
  return out.set(Math.sin(heading), 0, -Math.cos(heading));
}

export function rightVector(heading: number, out = new Vector3()) {
  return out.set(Math.cos(heading), 0, Math.sin(heading));
}

const smooth = (t: number) => {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

function lerpCharacter(from: RiverCharacter, to: RiverCharacter, t: number): RiverCharacter {
  const k = smooth(t);
  return {
    halfWidth: MathUtils.lerp(from.halfWidth, to.halfWidth, k),
    wall: MathUtils.lerp(from.wall, to.wall, k),
    rapids: MathUtils.lerp(from.rapids, to.rapids, k),
    ride: MathUtils.lerp(from.ride, to.ride, k),
  };
}

// ---- river spine -------------------------------------------------------------

const riverSamples: SpineSample[] = [];
const legEnds: number[] = [];
const bankKeys: Array<{ s: number; degrees: number }> = [];
const barAtS: Array<{ s: number; bar: number }> = [];
{
  let x = 0;
  let z = 150;
  let y = 0;
  let heading = 0;
  let s = -150;
  let character = START;
  riverSamples.push({ s, x, z, y, heading, kind: 'river', ...character });
  for (const leg of LEGS) {
    const end: RiverCharacter = { ...character, ...leg.end };
    const turn = MathUtils.degToRad(leg.turn ?? 0);
    const drop = leg.drop ?? 0;
    const steps = Math.round(leg.length / SPINE_STEP);
    const startHeading = heading;
    const startY = y;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const mid = (i - 0.5) / steps;
      heading = startHeading + turn * smooth(mid);
      x += Math.sin(heading) * SPINE_STEP;
      z -= Math.cos(heading) * SPINE_STEP;
      s += SPINE_STEP;
      // A cascade pours over a lip: flat, then a steep face, then its plunge pool.
      const dropShape = leg.cascade ? smooth((t - 0.22) / 0.5) : t;
      y = startY - drop * dropShape;
      riverSamples.push({ s, x, z, y, heading, kind: 'river', ...lerpCharacter(character, end, t) });
    }
    heading = startHeading + turn;
    if (leg.bank && leg.turn) bankKeys.push({ s: s - leg.length / 2, degrees: Math.sign(leg.turn) * leg.bank });
    else bankKeys.push({ s: s - leg.length / 2, degrees: 0 });
    legEnds.push(s);
    if (leg.bar !== undefined) barAtS.push({ s, bar: leg.bar });
    character = end;
  }
}

/** Spine arc length where the gorge ends and the lake begins (end of the whitewater). */
export const GORGE_MOUTH_S = legEnds[LEGS.findIndex((leg) => leg.bar === 36)];

const lakeEnd = riverSamples[riverSamples.length - 1];
for (const sample of riverSamples) if (sample.s > GORGE_MOUTH_S) sample.kind = 'lake';

// ---- dam frame -----------------------------------------------------------------

export const DAM_HEADING = lakeEnd.heading;
const damAxis = headingVector(DAM_HEADING);
const damRight = rightVector(DAM_HEADING);
const damCenter = new Vector3(lakeEnd.x, WATER_LEVEL, lakeEnd.z).addScaledVector(damAxis, LAKE_RUN_TO_DAM);

/** Dam layout. Local coordinates: `a` along the axis (downstream positive), `l` to the right, heights relative to the lake. */
export const DAM = {
  /** Upstream face of the crest at the centre of the spillway, at lake level. */
  center: damCenter,
  axis: damAxis,
  right: damRight,
  heading: DAM_HEADING,
  waterLevel: WATER_LEVEL,
  tailwater: TAILWATER,
  /** Arch crest centreline radius; the arch centre sits this far downstream of `center`. */
  archRadius: 220,
  /** Half of the crest span between the abutments. */
  halfSpan: 150,
  crestHeight: 30,
  crestWidth: 10,
  sillHeight: -10,
  gateCount: 5,
  gateWidth: 16,
  pierWidth: 6,
  gateTop: 8,
  /** Radial gate trunnion, downstream of the sill, and the skin plate radius. */
  trunnion: { a: 16, y: -2 },
  gateRadius: 18,
  /** The spillway section is this wide either side of the axis. */
  spillwayHalfWidth: 60,
  chuteHalfWidth: 44,
  lip: 158,
} as const;

/** Toward the sun: mid-morning, high on the gorge's right so the left wall is in sun and the right in shade; ahead and right off the ski-jump lip. */
export const SUN_DIRECTION = (() => {
  const elevation = MathUtils.degToRad(38);
  return headingVector(MathUtils.degToRad(70)).multiplyScalar(Math.cos(elevation)).setY(Math.sin(elevation)).normalize();
})();

export function damPoint(a: number, l: number, height: number, out = new Vector3()) {
  return out.copy(damCenter).addScaledVector(damAxis, a).addScaledVector(damRight, l).setY(WATER_LEVEL + height);
}

export function damLocal(x: number, z: number) {
  const dx = x - damCenter.x;
  const dz = z - damCenter.z;
  return { a: dx * damAxis.x + dz * damAxis.z, l: dx * damRight.x + dz * damRight.z };
}

/** Axial position of the arch's upstream face at lateral offset `l`. */
export function archFaceA(l: number) {
  const r = DAM.archRadius;
  const clamped = Math.min(Math.abs(l), r * 0.95);
  return r - Math.sqrt(r * r - clamped * clamped);
}

// Chute floor: ogee from the sill, a straight 35° slope, then a flip bucket
// that throws the flow up at 25° off the lip.
const OGEE_K = 0.02;
const CHUTE_SLOPE = 0.7;
const OGEE_END = CHUTE_SLOPE / (2 * OGEE_K);
const BUCKET_RADIUS = 30;
const BUCKET_ENTRY = Math.atan(CHUTE_SLOPE);
const LIP_ANGLE = MathUtils.degToRad(25);
const BUCKET_BOTTOM = -98;
const CHUTE_END_Y = BUCKET_BOTTOM + BUCKET_RADIUS * (1 - Math.cos(BUCKET_ENTRY));
const OGEE_END_Y = DAM.sillHeight - OGEE_K * OGEE_END * OGEE_END;
const CHUTE_END = OGEE_END + (OGEE_END_Y - CHUTE_END_Y) / CHUTE_SLOPE;
const BUCKET_CENTER_A = CHUTE_END + BUCKET_RADIUS * Math.sin(BUCKET_ENTRY);
export const LIP_A = BUCKET_CENTER_A + BUCKET_RADIUS * Math.sin(LIP_ANGLE);
export const LIP_HEIGHT = BUCKET_BOTTOM + BUCKET_RADIUS * (1 - Math.cos(LIP_ANGLE));
export const LIP_ANGLE_RADIANS = LIP_ANGLE;

/** Chute floor height (relative to the lake) at axial position `a`. */
export function chuteFloor(a: number) {
  if (a <= 0) return DAM.sillHeight;
  if (a <= OGEE_END) return DAM.sillHeight - OGEE_K * a * a;
  if (a <= CHUTE_END) return OGEE_END_Y - (a - OGEE_END) * CHUTE_SLOPE;
  const dx = Math.min(a, LIP_A) - BUCKET_CENTER_A;
  return BUCKET_BOTTOM + BUCKET_RADIUS - Math.sqrt(Math.max(0, BUCKET_RADIUS * BUCKET_RADIUS - dx * dx));
}

/** Depth of the flood running down the chute after the breach. */
export function floodDepth(a: number) {
  if (a < -30) return 0;
  if (a < 0) return MathUtils.lerp(-DAM.sillHeight, 6, smooth((a + 30) / 30));
  return MathUtils.lerp(6, 3.5, smooth(a / 60));
}

// ---- lake, chute and valley spine (dam frame) -----------------------------------

const VALLEY_END_A = 1300;
const downstreamSamples: SpineSample[] = [];
{
  let s = lakeEnd.s;
  const character: RiverCharacter = { halfWidth: 220, wall: 0, rapids: 0, ride: 3 };
  const point = new Vector3();
  for (let a = -LAKE_RUN_TO_DAM + SPINE_STEP; a <= VALLEY_END_A; a += SPINE_STEP) {
    s += SPINE_STEP;
    let kind: SpineKind = 'lake';
    let y = WATER_LEVEL;
    let halfWidth = character.halfWidth;
    let rapids = 0;
    if (a > 0 && a <= LIP_A) {
      kind = 'chute';
      y = WATER_LEVEL + chuteFloor(a) + floodDepth(a);
      halfWidth = DAM.chuteHalfWidth;
      rapids = 1;
    } else if (a > LIP_A) {
      kind = 'valley';
      y = TAILWATER;
      halfWidth = valleyRiverHalfWidth(a);
      rapids = a < 320 ? 1 - smooth((a - 200) / 120) : 0;
    }
    damPoint(a, 0, 0, point);
    downstreamSamples.push({ s, x: point.x, z: point.z, y, heading: DAM_HEADING, kind, halfWidth, wall: 0, rapids, ride: 3 });
  }
}

export function valleyRiverHalfWidth(a: number) {
  return MathUtils.lerp(26, 60, smooth((a - 150) / 450));
}

export const SPINE: readonly SpineSample[] = [...riverSamples, ...downstreamSamples];
export const SPINE_START_S = SPINE[0].s;
export const DAM_S = lakeEnd.s + LAKE_RUN_TO_DAM;

/** Spine sample nearest to arc length `s` (clamped). */
export function spineAt(s: number): SpineSample {
  const index = MathUtils.clamp(Math.round((s - SPINE_START_S) / SPINE_STEP), 0, SPINE.length - 1);
  return SPINE[index];
}

/** Interpolated spine position at arc length `s`: water surface point and heading. */
export function spinePoint(s: number, out = new Vector3()) {
  const f = MathUtils.clamp((s - SPINE_START_S) / SPINE_STEP, 0, SPINE.length - 1);
  const i = Math.min(SPINE.length - 2, Math.floor(f));
  const a = SPINE[i];
  const b = SPINE[i + 1];
  const t = f - i;
  out.set(MathUtils.lerp(a.x, b.x, t), MathUtils.lerp(a.y, b.y, t), MathUtils.lerp(a.z, b.z, t));
  return { point: out, heading: MathUtils.lerp(a.heading, b.heading, t), sample: t < 0.5 ? a : b };
}

// ---- rail knots ----------------------------------------------------------------

type DamKnot = { a: number; l: number; h: number; bar?: number; bank?: number };

// After the reservoir the rail leaves the river: it swings left and flies one
// climbing clockwise loop in front of the dam (past the walker's left side, its
// face, its right side, then out across the lake), comes back down the left
// side for the breach, and rides the flood through the centre gate, down the
// chute and off the lip. `h` is height above the lake.
// The lake end falls just past the loop's left point.
const LOOP_CENTER_A = -LAKE_RUN_TO_DAM - 10;
const LOOP_RADIUS = 58;
/** The boss loop's centre and radius in the dam frame. */
export const BOSS_LOOP = { a: LOOP_CENTER_A, l: 0, radius: LOOP_RADIUS };
const loop = (degrees: number, h: number, extra: Partial<DamKnot> = {}): DamKnot => {
  // 0° is the loop's left point heading downstream; angles run clockwise seen from above.
  const angle = MathUtils.degToRad(degrees);
  return { a: LOOP_CENTER_A + LOOP_RADIUS * Math.sin(angle), l: -LOOP_RADIUS * Math.cos(angle), h, bank: 15, ...extra };
};

const flightHeight = (a: number) => {
  // Launch off the lip at 25°, peak, then settle onto the valley river.
  const start = LIP_HEIGHT + 7;
  const apexA = LIP_A + 42;
  const apex = start + 42 * Math.tan(LIP_ANGLE) * 0.5;
  const land = TAILWATER - WATER_LEVEL + 3.2;
  if (a <= apexA) return start + (apex - start) * (1 - ((apexA - a) / 42) ** 2);
  return MathUtils.lerp(apex, land, smooth((a - apexA) / 220));
};

// The lake approach bears left onto the loop's left point, so the loop starts where the lake ends (bar 42).
const DAM_KNOTS: DamKnot[] = [
  loop(35, 8, { bank: 8 }),
  // The fight: arcs 70–95 units in front of the walker (astride the gates at a = 10, l = 33), at about its
  // hip height, so it fills half the frame with the crest and the water below it: left to right past the
  // rear legs and round the front right, back across a little wider, then down to the centre gate.
  { a: -26, l: -44, h: 26, bar: 44, bank: 8 },
  { a: -46, l: -18, h: 34, bank: 8 },
  { a: -57, l: 11, h: 40, bank: 8 },
  { a: -57, l: 42, h: 43, bank: 8 },
  { a: -49, l: 70, h: 45, bank: 8 },
  { a: -36, l: 91, h: 45, bank: 12 },
  { a: -58, l: 106, h: 44, bank: 14 },
  { a: -84, l: 84, h: 41, bank: 10 },
  { a: -80, l: 25, h: 38, bank: 8 },
  { a: -66, l: -4, h: 31, bank: 6 },
  { a: -58, l: -17, h: 18, bank: -4 },
  { a: -45, l: -24, h: 6.5, bar: 58, bank: -10 },
  { a: -28, l: -6, h: 4.5, bank: 4 },
  { a: -14, l: 0, h: 5, bar: 60, bank: 0 },
  // High over the brink (the drawn-down water is about 7 below the lake here), so the camera sees down the chute as it crosses the sill.
  { a: 0, l: 0, h: 6 },
  { a: 12, l: 0, h: chuteFloor(12) + floodDepth(12) + 3.2 },
  // Over the brink by bar 61.5, so the flood carries the camera onto the chute without lingering at the sill.
  { a: 30, l: 0, h: chuteFloor(30) + floodDepth(30) + 3.2, bar: 61.5 },
  ...[50, 72, 94, 116, 134, 148].map((a) => ({ a, l: 0, h: chuteFloor(a) + floodDepth(a) + 3.2 })),
  { a: LIP_A, l: 0, h: LIP_HEIGHT + 7, bar: 63 },
  ...[LIP_A + 20, LIP_A + 42, LIP_A + 70, LIP_A + 110, LIP_A + 160, LIP_A + 220, LIP_A + 280].map((a) => ({ a, l: 0, h: flightHeight(a) })),
  { a: LIP_A + 330, l: 0, h: flightHeight(LIP_A + 330), bar: 66 },
  { a: LIP_A + 370, l: 0, h: flightHeight(LIP_A + 370) },
  { a: LIP_A + 420, l: 0, h: flightHeight(LIP_A + 420), bar: 70 },
];

const knots: Vector3[] = [];
const tags: RailTag[] = [];
const knotBanks: Array<{ knot: number; degrees: number }> = [];
{
  // River knots: every 20 units, every 8 through the cascade, always on leg ends.
  const riverEndS = lakeEnd.s;
  const cascadeLeg = LEGS.findIndex((leg) => leg.cascade);
  const cascadeFrom = legEnds[cascadeLeg - 1] - 12;
  const cascadeTo = legEnds[cascadeLeg] + 12;
  const stops = new Set<number>(legEnds.filter((s) => s >= 0));
  for (let s = 0; s <= riverEndS; s += s >= cascadeFrom && s < cascadeTo ? 8 : 20) stops.add(Math.round(s / SPINE_STEP) * SPINE_STEP);
  const sorted = [...stops].sort((a, b) => a - b).filter((s, i, list) => i === 0 || s - list[i - 1] > 5 || barAtS.some((entry) => entry.s === s));
  const lakeRight = new Vector3();
  for (const s of sorted) {
    const sample = spineAt(s);
    const index = knots.length;
    const knot = new Vector3(sample.x, sample.y + sample.ride, sample.z);
    // Out on the lake the rail bears left, onto the boss loop's left point at the lake end.
    const bear = smooth((s - GORGE_MOUTH_S - 40) / (riverEndS - GORGE_MOUTH_S - 40));
    if (bear > 0) knot.addScaledVector(rightVector(sample.heading, lakeRight), -LOOP_RADIUS * bear);
    knots.push(knot);
    const tag = barAtS.find((entry) => Math.abs(entry.s - s) < SPINE_STEP / 2);
    if (tag) tags.push({ knot: index, bar: tag.bar });
  }
  for (const key of bankKeys) {
    if (key.s < 0) continue;
    let nearest = 0;
    for (let i = 0; i < sorted.length; i += 1) if (Math.abs(sorted[i] - key.s) < Math.abs(sorted[nearest] - key.s)) nearest = i;
    knotBanks.push({ knot: nearest, degrees: key.degrees });
  }
  for (const knot of DAM_KNOTS) {
    const index = knots.length;
    knots.push(damPoint(knot.a, knot.l, knot.h));
    if (knot.bar !== undefined) tags.push({ knot: index, bar: knot.bar });
    if (knot.bank !== undefined) knotBanks.push({ knot: index, degrees: knot.bank });
  }
}

/** Rail control points. Clone before handing them to a curve. */
export const RAIL_KNOTS: readonly Vector3[] = knots;
/** Knots the camera must reach on a given bar; the speed profile is solved from them. */
export const RAIL_TAGS: readonly RailTag[] = tags;
/** Bank angle keys by knot index. */
export const RAIL_BANKS: readonly { knot: number; degrees: number }[] = knotBanks;
