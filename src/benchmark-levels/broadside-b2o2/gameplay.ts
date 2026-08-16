import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { createFlagship, createFlagshipEntries } from './flagship';
import {
  BELLY_TIME,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_RUN_TIME,
  CORE_REVEAL_TIME,
  EYE_TIME,
  FLAGSHIP_TIME,
  MELEE2_TIME,
  SCREEN_TIME,
  TRENCH_TIME,
  bar,
} from './timing';

// BROADSIDE — 60 seconds across a full fleet engagement, from the launch deck
// of your own flagship to the heart of theirs:
//
//   Launch      (bars 0–4)    Off the home flagship's deck into the crossfire.
//   Mêlée I     (bars 4–9)    Hard banks between two dueling cruiser pairs.
//   Broadside   (bars 9–13)   A high-speed run down RELENTLESS's flank while
//                             her starboard batteries fire in time with the score.
//   Eye         (bars 13–16)  Near silence. Drifting mines among the wrecks.
//   Mêlée II    (bars 16–21)  The push to the enemy line: heaviest waves.
//   Belly run   (bars 21–25)  Along the belly of an enemy warship, raking turrets.
//   Flagship    (bars 25–29)  SOVEREIGN's port flank: three shield generators
//                             under point-defense fire.
//   Screen      (bars 29–31)  Shield falls; escorts pour from the bay as the
//                             rail swings around her stern.
//   Trench      (bars 31–33)  The dive into her spine trench: two power nodes
//                             and the core. Kill it and the line breaks.

export {
  BELLY_TIME,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_RUN_TIME,
  EYE_TIME,
  FLAGSHIP_TIME,
  MELEE1_TIME,
  MELEE2_TIME,
  SCREEN_TIME,
  TRENCH_TIME,
  bar,
} from './timing';

export const BROADSIDE_PLAYER_HEALTH = 4;

// ---- rail --------------------------------------------------------------------

// One hand-authored curve carries the whole battle. Control points are placed
// so the set pieces land where the speed profile puts the camera on their bar:
// the deck launch, the weave between duelists, the straight flank run, the
// eye's slow S, the mêlée corkscrew, the belly run, the flagship's port pass,
// the stern swing, the spine trench, and the victory U-turn past her bow.
export function createBroadsideRail() {
  const points: Vector3[] = [
    // Launch: over the home deck and up into the gap. (bars 0–4)
    new Vector3(0, 0, 0),
    new Vector3(4, 6, -60),
    new Vector3(-14, 12, -135),
    // Mêlée I: weave between the dueling pairs. (bars 4–9)
    new Vector3(10, 20, -230),
    new Vector3(-16, 16, -330),
    new Vector3(8, 12, -440),
    // Broadside run: straight and fast down RELENTLESS's starboard flank.
    // (bars 9–13)
    new Vector3(18, 10, -580),
    new Vector3(22, 8, -700),
    new Vector3(24, 8, -840),
    new Vector3(20, 5, -960),
    // The eye: a slow S through the wreck field. (bars 13–16)
    new Vector3(8, 2, -1030),
    new Vector3(0, 0, -1100),
    new Vector3(-4, -2, -1160),
    // Mêlée II: the corkscrew push toward the enemy line. (bars 16–21)
    new Vector3(-26, 8, -1230),
    new Vector3(18, 22, -1320),
    new Vector3(-14, 32, -1420),
    new Vector3(10, 26, -1500),
    new Vector3(0, 16, -1600),
    // Belly run: under her ventral hull, bow to stern. (bars 21–25)
    new Vector3(-4, 10, -1660),
    new Vector3(-8, 8, -1760),
    new Vector3(-12, 8, -1860),
    new Vector3(-14, 9, -1960),
    new Vector3(-16, 10, -2050),
    // Cut to SOVEREIGN's port flank and run bow to stern. (bars 25–29)
    // ~25 off her face: close enough to read the plating, clear of her
    // superstructure.
    new Vector3(-52, 16, -2110),
    new Vector3(-70, 22, -2180),
    new Vector3(-74, 24, -2260),
    new Vector3(-74, 25, -2340),
    new Vector3(-72, 26, -2410),
    // Screen: the shield falls and the rail crests her aft deck — escorts
    // pour from the stern bay below as the spine trench opens ahead.
    // (bars 29–31; the hull's aft volume is y<61, so the swing goes OVER.)
    new Vector3(-70, 34, -2450),
    new Vector3(-60, 48, -2500),
    new Vector3(-56, 72, -2540),
    new Vector3(-16, 74, -2548),
    new Vector3(4, 72, -2500),
    new Vector3(2, 70, -2430),
    new Vector3(0, 62, -2375),
    // The trench: straight along the dorsal spine, nodes then core.
    // (bars 31–32.4 — a hard speed surge through the cut)
    new Vector3(0, 56, -2360),
    new Vector3(0, 58, -2300),
    new Vector3(-2, 60, -2250),
    new Vector3(2, 61, -2210),
    new Vector3(0, 62, -2160),
    // Victory pull-out: climb over her bow and away as she breaks.
    // (bars 32.4–33)
    new Vector3(4, 74, -2130),
    new Vector3(14, 86, -2100),
    new Vector3(24, 96, -2070),
  ];
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

// ---- speed profile -------------------------------------------------------------

// Catapult off the deck, surge down the broadside flank, lift nearly everything
// for the eye, drive hard through mêlée II and the belly run, throttle back for
// the close shield pass, surge again through the trench, and cut the throttle
// as we pull out. The keys are tuned against the rail so each set piece lands
// on its bar; probe scripts/seat-probe if you reshape the curve.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.5],
  [bar(1), 0.8],
  [bar(3), 0.9],
  [bar(6), 0.47],
  [bar(8.5), 0.79],
  [bar(9.5), 1.22],
  [bar(12.5), 1.13],
  [bar(13.2), 0.59],
  [bar(15.5), 0.55],
  [bar(16.4), 0.66],
  [bar(19), 0.93],
  [bar(21), 1.1],
  [bar(24.5), 1.04],
  [bar(25.2), 0.56],
  [bar(28.5), 0.82],
  [bar(29.4), 1.96],
  [bar(30.8), 1.9],
  [bar(31.2), 1.25],
  [bar(32.4), 1.53],
  [bar(33), 1.73],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, BROADSIDE_DURATION);
export const speedFactorAt = speedProfile.speedAt;

export function broadsideRunProgress(time: number, duration = BROADSIDE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t`. */
export const railU = (time: number) => broadsideRunProgress(MathUtils.clamp(time, 0, BROADSIDE_DURATION));

/** Run time at which the camera comes closest to a world point (coarse scan + refine). */
export function closestApproachTime(curve: CatmullRomCurve3, point: Vector3) {
  let bestT = 0;
  let bestDistance = Infinity;
  const sample = (t: number) => curve.getPointAt(railU(t)).distanceTo(point);
  for (let t = 0; t <= BROADSIDE_DURATION; t += 0.2) {
    const d = sample(t);
    if (d < bestDistance) {
      bestDistance = d;
      bestT = t;
    }
  }
  for (let step = 0.05; step >= 0.005; step /= 5) {
    for (const t of [bestT - step, bestT + step]) {
      if (t < 0 || t > BROADSIDE_DURATION) continue;
      const d = sample(t);
      if (d < bestDistance) {
        bestDistance = d;
        bestT = t;
      }
    }
  }
  return bestT;
}

// ---- the fleet: world placement shared by gameplay and environment -------------

export type ShipAnchor = {
  /** Run time whose rail frame the ship is hung on. */
  at: number;
  /** Rail-frame offset: x = right, y = up, z = tangent. */
  offset: Vector3;
  /** Extra yaw applied after rail alignment (radians). */
  yaw?: number;
  /** Hull length in units. */
  length: number;
  faction: 'friendly' | 'enemy';
  variant: 'carrier' | 'cruiser' | 'wreck';
};

// Anchored to the rail so the set pieces meet the camera on their bars.
export const SHIP_ANCHORS = {
  home: { at: bar(0), offset: new Vector3(0, -34, 40), length: 900, faction: 'friendly', variant: 'carrier' },
  duelFriendly: { at: bar(6), offset: new Vector3(-175, 26, -40), yaw: -0.16, length: 620, faction: 'friendly', variant: 'cruiser' },
  duelEnemy: { at: bar(6.5), offset: new Vector3(185, 42, -60), yaw: 0.2, length: 620, faction: 'enemy', variant: 'cruiser' },
  relentless: { at: bar(10.5), offset: new Vector3(-88, -10, -30), length: 860, faction: 'friendly', variant: 'cruiser' },
  // The belly cruiser faces the friendly line (+z): we overtake her bow-to-
  // stern, raking the ventral turrets as her hull slides overhead.
  belly: { at: bar(22.5), offset: new Vector3(4, 54, -20), yaw: Math.PI, length: 560, faction: 'enemy', variant: 'cruiser' },
} as const satisfies Record<string, ShipAnchor>;

// Broken hulks drifting in the eye of the battle.
export const WRECK_ANCHORS: ShipAnchor[] = [
  { at: bar(13.5), offset: new Vector3(-42, -18, -70), yaw: 0.7, length: 260, faction: 'enemy', variant: 'wreck' },
  { at: bar(14.5), offset: new Vector3(36, 14, -110), yaw: -1.9, length: 200, faction: 'friendly', variant: 'wreck' },
  { at: bar(15), offset: new Vector3(-12, 34, -190), yaw: 2.6, length: 220, faction: 'enemy', variant: 'wreck' },
];

// Far silhouettes that sell the battle's scale: dark slabs on the horizon.
export const DISTANT_ANCHORS: ShipAnchor[] = [
  { at: bar(4), offset: new Vector3(-420, 60, -420), yaw: 0.3, length: 700, faction: 'friendly', variant: 'cruiser' },
  { at: bar(8), offset: new Vector3(480, 90, -520), yaw: -0.4, length: 760, faction: 'enemy', variant: 'cruiser' },
  { at: bar(18), offset: new Vector3(420, -60, -500), yaw: 0.15, length: 640, faction: 'enemy', variant: 'cruiser' },
  { at: bar(20), offset: new Vector3(-460, -40, -560), yaw: -0.2, length: 680, faction: 'friendly', variant: 'cruiser' },
];

// SOVEREIGN, the enemy flagship: fixed in world space because the rail wraps
// around her. Bow toward +Z (facing the battle), port flank toward -X. Every
// mount derives from the center so the whole encounter moves with one edit.
const SOV_CENTER = new Vector3(0, 30, -2260);
const sov = (x: number, y: number, z: number) =>
  new Vector3(SOV_CENTER.x + x, SOV_CENTER.y + y, SOV_CENTER.z + z);

export const SOVEREIGN = {
  center: SOV_CENTER,
  /** Overall length, beam, and height of the hull volume. */
  length: 620,
  beam: 96,
  height: 88,
  /** Dorsal surface height (trench rim). */
  dorsalY: 72,
  /** Trench floor height and half-width. */
  trenchFloorY: 58,
  trenchHalfWidth: 13,
  /** Trench span (stern -> core) in world z. The cut reaches far aft so the
   * rail's descent off the aft deck enters between walls, not through bare
   * hull. */
  trenchZFrom: SOV_CENTER.z - 140,
  trenchZTo: SOV_CENTER.z + 120,
  // The core sits in the genuine cut at the foot of her command tower: from
  // the crest it reads down the open corridor (foreshadowing under a lockout),
  // and the dive closes to point-blank.
  corePosition: sov(0, 32, 30),
  // Nodes hang at rim height on the trench walls so the crest reveal and the
  // dive both have clean sightlines down the cut.
  nodePositions: [sov(-7, 38, -40), sov(7, 38, 20)],
  // Generators ride pylons six off the face so the flank's armor facets and
  // PD mounts never eat the sightline to them. The aft one sits forward of
  // the stern superstructure so the pass leaves enough flight time to kill it.
  generatorPositions: [sov(-54, 8, 80), sov(-54, 16, -20), sov(-54, 8, -70)],
  /** Port-side hangar the phase-1 escorts launch from. */
  portBayPosition: sov(-50, 0, 210),
  /** Stern bay the screen-phase escorts pour from. */
  sternBayPosition: sov(0, -8, -310),
  /** Deck-edge point above the stern bay: screen-phase escorts scramble up
   * over the aft edge from here — the bay mouth itself sits below the deck
   * silhouette from the crest, so pouring from it would hide the launch. */
  sternDeckPosition: sov(0, 36, -310),
  /** Occlusion anchor for the shield dome's mesh origin: off the port flank
   * and above the deck so the checker (and the eye) always has a clean
   * sightline to it. The bubble shell counter-offsets to stay on the ship. */
  domeAnchor: sov(-60, 55, 0),
  /** Point-defense muzzle points on the port flank. */
  pdPositions: [sov(-50, 22, 200), sov(-50, 0, 110), sov(-50, 26, 40)],
} as const;

export type ShipPlacement = {
  position: Vector3;
  quaternion: Quaternion;
  length: number;
  faction: 'friendly' | 'enemy';
  variant: 'carrier' | 'cruiser' | 'wreck';
};

export function placeShip(curve: CatmullRomCurve3, anchor: ShipAnchor): ShipPlacement {
  const frame = sampleRailFrame(curve, railU(anchor.at));
  const position = frame.position
    .clone()
    .addScaledVector(frame.right, anchor.offset.x)
    .addScaledVector(frame.up, anchor.offset.y)
    .addScaledVector(frame.tangent, anchor.offset.z);
  // Hulls align to the rail frame (nose along tangent); an authored yaw lets
  // duelists angle into their exchange.
  const basis = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
  const quaternion = new Quaternion().setFromRotationMatrix(basis);
  if (anchor.yaw) quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), anchor.yaw));
  return { position, quaternion, length: anchor.length, faction: anchor.faction, variant: anchor.variant };
}

export function placeFleet(curve: CatmullRomCurve3) {
  return {
    home: placeShip(curve, SHIP_ANCHORS.home),
    duelFriendly: placeShip(curve, SHIP_ANCHORS.duelFriendly),
    duelEnemy: placeShip(curve, SHIP_ANCHORS.duelEnemy),
    relentless: placeShip(curve, SHIP_ANCHORS.relentless),
    belly: placeShip(curve, SHIP_ANCHORS.belly),
    wrecks: WRECK_ANCHORS.map((anchor) => placeShip(curve, anchor)),
    distant: DISTANT_ANCHORS.map((anchor) => placeShip(curve, anchor)),
  };
}

// ---- spawn data ------------------------------------------------------------------

export type BroadsideEnemyKind =
  | 'dart'
  | 'weaver'
  | 'gunship'
  | 'mine'
  | 'turret'
  | 'escort'
  | 'bolt'
  | 'generator'
  | 'node'
  | 'core'
  | 'shieldDome';

export type BroadsideSpawnData =
  | { role: 'dart'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'weaver'; lead: number; cx: number; cy: number; r: number; phase: number; dir: number; delay: number }
  | { role: 'gunship'; lead: number; x: number; y: number; seed: number }
  | { role: 'mine'; lead: number; x: number; y: number; seed: number }
  | { role: 'turret'; position: Vector3; seatTime: number; index: number }
  | { role: 'escort'; origin: Vector3; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'generator'; position: Vector3; seatTime: number; index: number }
  | { role: 'node'; position: Vector3; seatTime: number; index: number }
  | { role: 'core'; position: Vector3; seatTime: number }
  | { role: 'shieldDome' };

export type BroadsideSpawnEntry = LockOnSpawnEntry<BroadsideEnemyKind, BroadsideSpawnData>;
export type BroadsideUpdate = LockOnEnemyUpdate<BroadsideEnemyKind, BroadsideSpawnData>;

// ---- spawn timeline ---------------------------------------------------------------

const darts = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.09,
    kind: 'dart',
    data: {
      role: 'dart',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.34,
      crossTime: run.crossTime ?? 2.2,
    },
  }));

const weaverPair = (time: number, lead: number, cx: number, cy: number, r = 3.6): BroadsideSpawnEntry[] =>
  [0, 1].map((index) => ({
    time: time + index * 0.05,
    kind: 'weaver',
    data: { role: 'weaver', lead, cx, cy, r, phase: index * Math.PI, dir: 1, delay: index * 0.05 },
  }));

const gunship = (time: number, lead: number, x: number, y: number): BroadsideSpawnEntry => ({
  time,
  kind: 'gunship',
  hitStages: [2, 2],
  data: { role: 'gunship', lead, x, y, seed: time * 1.37 },
});

const mines = (time: number, lead: number, spots: Array<[number, number]>): BroadsideSpawnEntry[] =>
  spots.map(([x, y], index) => ({
    time: time + index * 0.5,
    kind: 'mine',
    data: { role: 'mine', lead, x, y, seed: time * 2.13 + index * 7.7 },
  }));

const escorts = (
  time: number,
  origin: Vector3,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
  lead = 2.4,
): BroadsideSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.22,
    kind: 'escort',
    data: {
      role: 'escort',
      origin,
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.15,
      crossTime: run.crossTime ?? 2.4,
    },
  }));

function buildTurretEntries(curve: CatmullRomCurve3): BroadsideSpawnEntry[] {
  // A rake of turrets across the belly ship's ventral hull: two loose rows the
  // player sweeps through as the ship passes overhead. Positions are authored
  // in world space from the belly anchor so they sit on the hull. The belly
  // anchor hangs the ship's center ~54 above the rail; a 560 hull is ~48 tall
  // with belly armor ~27 below center, so mounts live ~26 above the rail.
  const frame = sampleRailFrame(curve, railU(BELLY_TIME + bar(1.5)));
  const base = frame.position
    .clone()
    .addScaledVector(frame.right, 0)
    .addScaledVector(frame.up, 26)
    .addScaledVector(frame.tangent, -40);
  const forward = frame.tangent.clone();
  const right = frame.right.clone();
  const spots: Vector3[] = [];
  const rows: Array<{ lateral: number; along: number[] }> = [
    { lateral: -12, along: [-170, -120, -70, -18, 36] },
    { lateral: 11, along: [-146, -94, -42, 12, 64] },
  ];
  for (const row of rows) {
    for (const along of row.along) {
      spots.push(
        base.clone().addScaledVector(right, row.lateral).addScaledVector(forward, along),
      );
    }
  }
  // All ten spawn as the belly heaves into view so the rake reads ahead of the
  // pass; each expires shortly after the camera passes its mount.
  return spots.map((position, index) => ({
    time: BELLY_TIME - bar(2.2) + index * 0.28,
    kind: 'turret',
    data: { role: 'turret', position, seatTime: closestApproachTime(curve, position), index },
  }));
}

function buildTimeline(curve: CatmullRomCurve3): {
  timeline: BroadsideSpawnEntry[];
  flagship: ReturnType<typeof createFlagshipEntries>;
} {
  const flagship = createFlagshipEntries(curve, railU, closestApproachTime);
  const timeline: BroadsideSpawnEntry[] = [
    // --- Launch: first contacts as we clear the deck. Wide, slow, readable.
    // Lanes are authored so their midpoints sit off the screen center — kills
    // land across the frame, not in a pile on the reticle.
    ...darts(bar(1), 2.5, [
      { fromX: -26, toX: 8, y: 7, arc: 2.6 },
      { fromX: -24, toX: 10, y: 12, arc: 1.8 },
    ]),
    ...darts(bar(2.2), 2.4, [
      { fromX: 26, toX: -8, y: -4, arc: 3.0 },
      { fromX: 24, toX: -10, y: 3, arc: 2.2 },
      { fromX: 26, toX: -6, y: 11, arc: 1.6 },
    ]),
    ...darts(bar(3.4), 2.2, [
      { fromX: -26, toX: 12, y: 9, arc: 3.4 },
      { fromX: 26, toX: -12, y: -2, arc: 2.6, delay: 0.4 },
    ]),

    // --- Mêlée I: the weave. Helix pairs and the first gunship.
    ...weaverPair(bar(4.4), 2.8, -11, 8),
    ...darts(bar(5.2), 2.1, [
      { fromX: -27, toX: 9, y: -6, arc: 4.2, delay: 0 },
      { fromX: 25, toX: -11, y: 4, arc: 3.0, delay: 0.3 },
      { fromX: -25, toX: 7, y: 12, arc: 2.2, delay: 0.6 },
    ]),
    gunship(bar(5.9), 3.2, -13, 6),
    ...darts(bar(6.8), 2.0, [
      { fromX: 26, toX: -8, y: 13, arc: 2.0, delay: 0 },
      { fromX: 24, toX: -12, y: 6, arc: 2.8, delay: 0.25 },
      { fromX: 26, toX: -10, y: -6, arc: 3.6, delay: 0.5 },
      { fromX: -26, toX: 10, y: 2, arc: 2.4, delay: 0.9 },
    ]),
    ...weaverPair(bar(7.6), 2.7, 11, 2, 4.2),
    ...darts(bar(8.3), 2.0, [
      { fromX: -25, toX: 9, y: -3, arc: 3.2 },
      { fromX: 24, toX: -8, y: 11, arc: 2.2, delay: 0.35 },
    ]),

    // --- Broadside run: craft knotted through the gap between us and RELENTLESS.
    ...darts(bar(9.3), 1.9, [
      { fromX: -25, toX: 8, y: 2, arc: 3.8, crossTime: 1.9 },
      { fromX: -23, toX: 10, y: 11, arc: 2.4, delay: 0.25, crossTime: 1.9 },
      { fromX: 23, toX: -12, y: -7, arc: 4.4, delay: 0.5, crossTime: 1.9 },
    ]),
    ...weaverPair(bar(10.2), 2.5, 9, 8, 4.6),
    ...darts(bar(10.8), 1.9, [
      { fromX: 24, toX: -10, y: -2, arc: 3.4, crossTime: 1.8 },
      { fromX: -16, toX: 8, y: 10, arc: 2.8, delay: 0.2, crossTime: 1.8 },
      { fromX: 26, toX: -12, y: 13, arc: 1.8, delay: 0.4, crossTime: 1.8 },
      { fromX: -15, toX: 10, y: -6, arc: 4.6, delay: 0.7, crossTime: 1.8 },
    ]),
    ...darts(bar(11.7), 1.85, [
      { fromX: -16, toX: 7, y: 7, arc: 3.0, crossTime: 1.8 },
      { fromX: 24, toX: -9, y: 12, arc: 2.0, delay: 0.3, crossTime: 1.8 },
    ]),
    ...weaverPair(bar(12.3), 2.4, -9, 1, 3.8),

    // --- The eye: quiet sky, drifting mines, one far patrol.
    ...mines(bar(13.3), 4.2, [[-11, 4], [9, 9]]),
    ...darts(bar(14.2), 2.6, [{ fromX: -26, toX: 14, y: 14, arc: 1.4, crossTime: 3.2 }]),
    ...mines(bar(14.6), 4.0, [[-4, -6], [12, 2], [-14, 10]]),

    // --- Mêlée II: the push. Densest waves of the run.
    ...darts(bar(16.2), 2.0, [
      { fromX: -27, toX: 9, y: -8, arc: 4.4, delay: 0 },
      { fromX: 25, toX: -11, y: 1, arc: 3.2, delay: 0.2 },
      { fromX: -26, toX: 8, y: 9, arc: 2.6, delay: 0.4 },
      { fromX: 27, toX: -9, y: 13, arc: 1.8, delay: 0.6 },
    ]),
    ...weaverPair(bar(16.9), 2.6, -9, 8),
    gunship(bar(17.4), 3.1, 12, 2),
    ...darts(bar(18.2), 1.9, [
      { fromX: 25, toX: -9, y: 11, arc: 2.4, delay: 0 },
      { fromX: -26, toX: 10, y: 3, arc: 3.4, delay: 0.25 },
      { fromX: 24, toX: -12, y: -7, arc: 4.0, delay: 0.5 },
    ]),
    ...weaverPair(bar(18.9), 2.5, 10, 9, 4.4),
    gunship(bar(19.4), 3.0, -11, 8),
    ...darts(bar(20.1), 1.9, [
      { fromX: -24, toX: 8, y: 6, arc: 3.0 },
      { fromX: 25, toX: -10, y: 12, arc: 2.0, delay: 0.3 },
    ]),

    // --- Belly run: rake the turrets; escorts harass from her hangar line.
    ...buildTurretEntries(curve),
    ...darts(bar(22), 2.1, [
      { fromX: -22, toX: 10, y: -9, arc: 2.6 },
      { fromX: 22, toX: -12, y: -14, arc: 2.2, delay: 0.35 },
    ]),
    ...darts(bar(21.9), 1.4, [{ fromX: -12, toX: 8, y: -8, arc: 3.2 }]),

    // --- Flagship: generators (boss module), a trickle of escorts, then the
    // screen wave as the rail swings around her stern.
    ...escorts(bar(26.2), SOVEREIGN.portBayPosition, [
      { fromX: -19, toX: 7, y: 6, arc: 2.4 },
      { fromX: -15, toX: 11, y: 12, arc: 2.0 },
    ]),
    ...escorts(bar(27.4), SOVEREIGN.portBayPosition, [
      { fromX: -20, toX: 6, y: -2, arc: 3.0 },
    ]),
    ...escorts(SCREEN_TIME + bar(0.9), SOVEREIGN.sternDeckPosition, [
      { fromX: -17, toX: 11, y: 8, arc: 5.5 },
      { fromX: 17, toX: -11, y: 14, arc: 4.6 },
      { fromX: -13, toX: 9, y: 18, arc: 3.8 },
    ], 1.2),
    ...escorts(SCREEN_TIME + bar(0.8), SOVEREIGN.sternDeckPosition, [
      { fromX: 18, toX: -9, y: 6, arc: 6.0 },
      { fromX: -17, toX: 8, y: 12, arc: 4.8 },
    ]),
    ...flagship.timeline,
  ];
  return {
    timeline: timeline.sort((a, b) => a.time - b.time),
    flagship,
  };
}

const KILL_SCORE: Record<BroadsideEnemyKind, number> = {
  dart: 100,
  weaver: 130,
  gunship: 340,
  mine: 90,
  turret: 110,
  escort: 140,
  bolt: 40,
  generator: 420,
  node: 460,
  core: 2200,
  shieldDome: 0,
};

const BOLT_MAX_AGE = 11;
const MINE_BLAST_RADIUS = 8;

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<BroadsideEnemyKind, BroadsideSpawnData> {
  const curve = createBroadsideRail();
  const { timeline, flagship: flagshipEntries } = buildTimeline(curve);

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let boltsShot = 0;
  let turretsRaked = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    boltsShot = 0;
    turretsRaked = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });

  function fireBolt(context: BroadsideUpdate, from: Vector3, speed = 5.5) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const flagship = createFlagship(bus, {
    curve,
    entries: flagshipEntries,
    fireBolt,
  });

  // ---- movement -----------------------------------------------------------------

  function updateDart(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'dart' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 7.1 + enemy.id) * 0.25;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.06)),
      data.y + Math.sin(Math.min(1, clamped + 0.06) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * (0.6 + Math.sin(clamped * Math.PI) * 0.6));
    return false;
  }

  function updateWeaver(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'weaver' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = age - data.delay;
    if (t < 0) {
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.cx, data.cy, 0)));
      return false;
    }
    // Two craft braided around a shared lane: the pair reads as one helix.
    const angle = t * 4.6 * data.dir + data.phase;
    const drift = Math.min(1, t / 3) * 6;
    const x = data.cx + Math.cos(angle) * data.r + drift * (data.phase > 1 ? 1 : -1);
    const y = data.cy + Math.sin(angle) * data.r * 0.75;
    if (runProgress > anchorU + 0.012) return true;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      data.cx + Math.cos(angle + 0.3) * data.r + drift * (data.phase > 1 ? 1 : -1),
      data.cy + Math.sin(angle + 0.3) * data.r * 0.75,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(Math.sin(angle) * 0.5);
    return false;
  }

  function updateGunship(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'gunship' }>) {
    const { enemy, runProgress, age, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ fireAt: 1.6, shots: 0 }));
    const x = data.x + Math.sin(age * 0.45 + data.seed) * 4.5;
    const y = data.y + Math.sin(age * 0.7 + data.seed * 2.1) * 1.4;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 0.4 + data.seed) * 0.12);

    const untilShot = state.fireAt - age;
    enemy.mesh.userData.charge = untilShot < 0.8 && state.shots < 3 ? 1 - Math.max(0, untilShot) / 0.8 : 0;
    if (age >= state.fireAt && state.shots < 3) {
      state.shots += 1;
      state.fireAt = age + 2.7;
      fireBolt(context, enemy.mesh.position.clone(), 5.2);
    }
    enemy.mesh.userData.cracked = enemy.hitStageIndex > 0;
    return runProgress > anchorU + 0.014;
  }

  function updateMine(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'mine' }>) {
    const { enemy, runProgress, age, camera, railAnchor, damagePlayer } = context;
    const anchorU = railAnchor(data.lead);
    // Dead-slow tumble through the wreck field, pulsing.
    const x = data.x + Math.sin(age * 0.32 + data.seed) * 2.2;
    const y = data.y + Math.cos(age * 0.24 + data.seed * 1.3) * 1.6;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.rotation.set(age * 0.5 + data.seed, age * 0.33 + data.seed * 2, age * 0.21);
    enemy.mesh.userData.pulse = 0.5 + Math.sin(age * 2.6 + data.seed) * 0.5;
    const distance = enemy.mesh.position.distanceTo(camera.position);
    if (distance < MINE_BLAST_RADIUS) {
      // Proximity detonation: the miss handler bursts it where it died.
      damagePlayer(1);
      return true;
    }
    return runProgress > anchorU + 0.014;
  }

  function updateHullMount(context: BroadsideUpdate, position: Vector3, seatTime: number, grace = 0.55) {
    const { enemy, runTime, camera, age } = context;
    enemy.mesh.position.copy(position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.userData.age = age;
    return runTime > seatTime + grace;
  }

  function updateCore(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'core' }>) {
    // The cradle stays locked out until the run commits to the dive: visible
    // down the cut from the crest, but only killable from inside the trench.
    if (flagship.shieldDown() && context.runTime >= CORE_REVEAL_TIME) context.enemy.entry.lockable = true;
    return updateHullMount(context, data.position, data.seatTime, 1.6);
  }

  function updateEscort(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'escort' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    const lane = offsetFromRail(curve, anchorU, new Vector3(x, y, 0));
    // Pour out of the bay: blend from the hangar mouth onto the intercept lane.
    const pour = MathUtils.clamp(age / 1.1, 0, 1);
    const pourEased = pour * pour * (3 - 2 * pour);
    const launch = data.origin.clone().addScaledVector(new Vector3(0, Math.sin(pour * Math.PI) * 6, 0), 1);
    enemy.mesh.position.copy(launch.lerp(lane, pourEased));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.06)),
      data.y + Math.sin(Math.min(1, clamped + 0.06) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * 0.7);
    return false;
  }

  function updateBolt(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    // Her point defense dies with the shield: once the dome falls, every
    // bolt in the air fizzles. This also clears the dive for the trench.
    if (flagship.shieldDown() && age > 0.5) return true;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: interceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6.5,
      maxSpeed: 15,
      accel: 3.4,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  // ---- level definition ---------------------------------------------------------

  return {
    duration: BROADSIDE_DURATION,
    bpm: BROADSIDE_BPM,
    playerHealth: BROADSIDE_PLAYER_HEALTH,
    createRail: createBroadsideRail,
    spawnTimeline: timeline,
    easeRunProgress: broadsideRunProgress,
    startWord: 'LAUNCH',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'dart':
          return updateDart(context, data);
        case 'weaver':
          return updateWeaver(context, data);
        case 'gunship':
          return updateGunship(context, data);
        case 'mine':
          return updateMine(context, data);
        case 'turret':
          return updateHullMount(context, data.position, data.seatTime);
        case 'escort':
          return updateEscort(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'generator':
          return updateHullMount(context, data.position, data.seatTime, 1.0);
        case 'node':
          return updateHullMount(context, data.position, data.seatTime, 0.5);
        case 'core':
          return updateCore(context, data);
        case 'shieldDome':
          return flagship.updateDome(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsShot += 1;
      if (enemy.kind === 'turret') turretsRaked += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 50,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 65;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const won = flagship.coreKilled();
      if (won && score >= 13000 && clearRate >= 0.9) return 'S';
      if (won && score >= 9500 && clearRate >= 0.75) return 'A';
      if (score >= 6000 && clearRate >= 0.5) return 'B';
      if (score >= 3000 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, BROADSIDE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${BROADSIDE_PLAYER_HEALTH}`];
      if (turretsRaked > 0) lines.push(`${turretsRaked} belly turret${turretsRaked === 1 ? '' : 's'} raked`);
      if (boltsShot > 0) lines.push(`${boltsShot} incoming bolt${boltsShot === 1 ? '' : 's'} intercepted`);
      const bossLine = flagship.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
