import type { LockOnSpawnEntry } from '../../engine/lock-on-runner-types';
import { MAX_LOCKS } from '../../engine/locks';
import {
  BOSS_DEADLINE,
  type BossPart,
  createEscapementBoss,
  pendulumSide,
  type PalletSide,
} from './boss-logic';
import { ESCAPEMENT_BARS, ESCAPEMENT_RUN_SECTIONS, ESCAPEMENT_TIME, bar } from './timing';

// The Escapement spawn choreography. Every entry is authored to the beat and
// placed relative to the rail or to a named anchor in the environment, so the
// integrator resolves world positions in gameplay.ts and the environment can
// move underneath without editing this file.
//
// Placement frame: `lateral` is metres to the camera's right in the rail
// frame, `vertical` is metres up, and `leadBeats` is the number of beats after
// spawn at which the camera passes the target's seat (the runner's
// `railAnchor(lead)` takes the same value in seconds; use `leadSeconds`).
// For anchored entries the offsets are measured from the anchor.

export type EscapementEnemyKind =
  | 'mote'
  | 'burr'
  | 'tick'
  | 'ratchet'
  | 'wasp'
  | 'chime'
  | 'bolt'
  | 'jewel'
  | 'arbor';

/**
 * Anchors the environment resolves to a world position and a local frame.
 * `index` on the placement picks an instance where the anchor is a family.
 */
export type EscapementAnchor =
  | 'rail'
  | 'lamp-shaft' // Barrel: a shaft of lamp light through a gap in the coil; index counts shafts in rail order
  | 'mesh-teeth' // Train: the point where the ridden wheel meshes with the next; burrs launch here
  | 'gear-face' // Train: the face of the next wheel; ticks walk down it toward the rail
  | 'wheel-rim' // Train: the rim the rail rides; ratchets seat here and turn with the wheel
  | 'orrery-arm' // Orrery: a brass planet arm; index picks the arm; wasps ride it, burrs fling off it
  | 'pallet-left' // Pendulum and boss: the fork's left pallet
  | 'pallet-right' // Pendulum and boss: the fork's right pallet
  | 'swing-path' // Pendulum: the bob's arc; `side` on the chime picks which extreme
  | 'escape-wheel' // Boss: the escape wheel's teeth; burrs are thrown off it
  | 'crown-wheel' // Boss: the crown wheel rim above the fork; ticks pour off it
  | 'fork-tip-left' // Boss: the left pallet jewel
  | 'fork-tip-right' // Boss: the right pallet jewel
  | 'arbor' // Boss: the steel arbor at the fork pivot
  | 'dial-numeral'; // Free Run: the dial numerals; index 1..12

export type EscapementPlacement = {
  anchor: EscapementAnchor;
  index?: number;
  leadBeats: number;
  lateral: number;
  vertical: number;
};

export type EscapementSpawnData =
  | {
      role: 'mote';
      placement: EscapementPlacement;
      /** Motes spawned together share a swarm id; slot is 0..7 within it. */
      swarm: number;
      slot: number;
      /** Spiral radius in metres and beats per turn. */
      spiralRadius: number;
      spiralBeats: number;
      /** Drift in metres per bar along the shaft (lateral, vertical). */
      drift: readonly [number, number];
    }
  | {
      role: 'burr';
      placement: EscapementPlacement;
      /** Lateral start and end in metres; the sign of (to - from) is the crossing direction. */
      fromLateral: number;
      toLateral: number;
      /** Peak vertical lift above the placement's vertical, in metres. */
      arc: number;
      delayBeats: number;
      crossBeats: number;
      tumbleTurnsPerBar: number;
      trail: boolean;
    }
  | {
      role: 'tick';
      placement: EscapementPlacement;
      /** Where the tick starts on the gear face, relative to the placement seat. */
      walkFrom: readonly [number, number];
      walkBeats: number;
      /** Beats after spawn at which the leap starts. Always walkBeats + 1: the pause is the telegraph. */
      leapBeat: number;
      leapBeats: number;
    }
  | {
      role: 'ratchet';
      placement: EscapementPlacement;
      /** Where the ratchet starts relative to its seat; it steps once per beat toward the seat. */
      from: readonly [number, number];
      stepMetres: number;
    }
  | {
      role: 'wasp';
      placement: EscapementPlacement;
      /** Run times in seconds at which the wasp fires a ruby bolt, while it is alive. */
      fireTimes: readonly number[];
      /** Metres per bar the wasp rides along its anchor. */
      rideMetresPerBar: number;
    }
  | {
      role: 'chime';
      placement: EscapementPlacement;
      /** Which swing extreme the chime hangs at. 'centre' for chimes off the pendulum. */
      side: PalletSide | 'centre';
      /** Beats per full sway. */
      swayBeats: number;
    }
  | {
      role: 'bolt';
      /** Run time the bolt was fired and the id of the wasp that fired it. */
      firedAt: number;
      waspId: number;
    }
  | { role: 'jewel'; placement: EscapementPlacement; part: 'jewel-left' | 'jewel-right' }
  | { role: 'arbor'; placement: EscapementPlacement; part: 'arbor' };

export type EscapementSpawnEntry = LockOnSpawnEntry<EscapementEnemyKind, EscapementSpawnData>;

export const ESCAPEMENT_REPLAY_WORD = 'REPLAY';

export const DIAL_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'] as const;

/** Run times of the Train hand-offs. No entry spawns within a beat of these. */
export const HANDOFF_TIMES = [bar(10), bar(14)] as const;
export const HANDOFF_CLEAR_SECONDS = ESCAPEMENT_TIME.beatSeconds;

export const ESCAPEMENT_KILL_SCORE: Record<EscapementEnemyKind, number> = {
  mote: 80,
  burr: 120,
  tick: 160,
  ratchet: 360,
  wasp: 220,
  chime: 150,
  bolt: 40,
  jewel: 600,
  arbor: 1400,
};

const BEAT = ESCAPEMENT_TIME.beatSeconds;
const STEP = ESCAPEMENT_TIME.stepSeconds;

export function leadSeconds(placement: EscapementPlacement) {
  return placement.leadBeats * BEAT;
}

// ---- entry factories --------------------------------------------------------

function place(
  anchor: EscapementAnchor,
  leadBeats: number,
  lateral: number,
  vertical: number,
  index?: number,
): EscapementPlacement {
  return index === undefined ? { anchor, leadBeats, lateral, vertical } : { anchor, index, leadBeats, lateral, vertical };
}

let swarmCounter = 0;

/** Eight tarnish motes in one lamp shaft, one per sixteenth step, spiralling in place. */
function moteSwarm(time: number, shaft: number, leadBeats: number, spiralRadius: number, drift: readonly [number, number]): EscapementSpawnEntry[] {
  swarmCounter += 1;
  const swarm = swarmCounter;
  const seats: Array<readonly [number, number]> = [
    [-3.2, 2.6], [-1.1, 3.4], [1.1, 3.4], [3.2, 2.6],
    [-2.6, 0.6], [-0.8, 1.2], [0.8, 1.2], [2.6, 0.6],
  ];
  return seats.map((seat, slot) => ({
    time: time + slot * STEP,
    kind: 'mote',
    data: {
      role: 'mote',
      placement: place('lamp-shaft', leadBeats, seat[0], seat[1], shaft),
      swarm,
      slot,
      spiralRadius,
      spiralBeats: 8 + slot,
      drift,
    },
  }));
}

type BurrOptions = { arc?: number; crossBeats?: number; trail?: boolean; anchor?: EscapementAnchor; index?: number };

/** A burr thrown across the rail. `direction` +1 crosses left to right. */
function burr(time: number, direction: 1 | -1, vertical: number, options: BurrOptions = {}): EscapementSpawnEntry {
  const crossBeats = options.crossBeats ?? 4;
  const reach = 7;
  return {
    time,
    kind: 'burr',
    data: {
      role: 'burr',
      placement: place(options.anchor ?? 'mesh-teeth', crossBeats + 1, 0, vertical, options.index),
      fromLateral: -reach * direction,
      toLateral: reach * direction,
      arc: options.arc ?? 1.6,
      delayBeats: 0,
      crossBeats,
      tumbleTurnsPerBar: options.trail ? 3 : 2,
      trail: options.trail ?? false,
    },
  };
}

/** Burrs on consecutive beats, alternating direction. */
function burrVolley(time: number, count: number, firstDirection: 1 | -1, verticals: readonly number[], options: BurrOptions = {}) {
  const entries: EscapementSpawnEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const direction: 1 | -1 = i % 2 === 0 ? firstDirection : firstDirection === 1 ? -1 : 1;
    entries.push(burr(time + i * BEAT, direction, verticals[i % verticals.length], options));
  }
  return entries;
}

/** An oxide tick: walks down a face for `walkBeats`, pauses one beat, then leaps at the rail. */
function tick(time: number, anchor: EscapementAnchor, lateral: number, walkBeats = 4): EscapementSpawnEntry {
  const leapBeats = 2;
  return {
    time,
    kind: 'tick',
    hitPoints: 2,
    data: {
      role: 'tick',
      placement: place(anchor, walkBeats + 1 + leapBeats, lateral, 0.4),
      walkFrom: [lateral * 0.6, 5.5],
      walkBeats,
      leapBeat: walkBeats + 1,
      leapBeats,
    },
  };
}

/** A ratchet: three armour stages of two hits; it steps toward the seat once per beat. */
function ratchet(time: number, anchor: EscapementAnchor, leadBeats: number, lateral: number, vertical: number): EscapementSpawnEntry {
  return {
    time,
    kind: 'ratchet',
    hitStages: [2, 2, 2],
    data: {
      role: 'ratchet',
      placement: place(anchor, leadBeats, lateral, vertical),
      from: [lateral * 2.2, vertical + 4],
      stepMetres: 0.5,
    },
  };
}

/** A jewel wasp riding an anchor; it fires a ruby bolt every two bars starting two bars after spawn. */
function wasp(time: number, anchor: EscapementAnchor, leadBeats: number, lateral: number, vertical: number, index?: number): EscapementSpawnEntry {
  const fireTimes: number[] = [];
  for (let fire = time + 8 * BEAT; fire < time + leadBeats * BEAT - BEAT; fire += 8 * BEAT) fireTimes.push(fire);
  return {
    time,
    kind: 'wasp',
    hitPoints: 2,
    data: {
      role: 'wasp',
      placement: place(anchor, leadBeats, lateral, vertical, index),
      fireTimes,
      rideMetresPerBar: 1.5,
    },
  };
}

/**
 * A chime hung in the swing path so the camera reaches it at a swing extreme.
 * `arrivalBar` is the bar whose beat 2 is the extreme; the side follows from
 * the pendulum phase at that instant.
 */
function swingChime(arrivalBar: number, leadBeats: number, lateral: number, vertical: number): EscapementSpawnEntry {
  const arrival = bar(arrivalBar, 2);
  const side = pendulumSide(arrival);
  if (side === null) throw new Error(`Chime arrival at bar ${arrivalBar} is not a swing extreme`);
  return {
    time: arrival - leadBeats * BEAT,
    kind: 'chime',
    data: {
      role: 'chime',
      placement: place('swing-path', leadBeats, lateral, vertical),
      side,
      swayBeats: 4,
    },
  };
}

/** A chime hung at a dial numeral in the Free Run; its letter is the numeral. */
function dialChime(time: number, numeral: number, leadBeats: number): EscapementSpawnEntry {
  const angle = ((numeral % 12) / 12) * Math.PI * 2;
  return {
    time,
    kind: 'chime',
    letter: DIAL_NUMERALS[numeral - 1],
    data: {
      role: 'chime',
      placement: place('dial-numeral', leadBeats, Math.sin(angle) * 6, Math.cos(angle) * 4.5 + 0.5, numeral),
      side: 'centre',
      swayBeats: 2,
    },
  };
}

function bossJewel(part: 'jewel-left' | 'jewel-right'): EscapementSpawnEntry {
  const time = bar(ESCAPEMENT_BARS.boss);
  const leadBeats = (ESCAPEMENT_BARS.bossDeadline - ESCAPEMENT_BARS.boss) * ESCAPEMENT_TIME.beatsPerBar;
  const side = part === 'jewel-left' ? -1 : 1;
  return {
    time,
    kind: 'jewel',
    hitPoints: 3,
    lockable: false,
    data: {
      role: 'jewel',
      part,
      placement: place(part === 'jewel-left' ? 'fork-tip-left' : 'fork-tip-right', leadBeats, side * 5.5, 3.5),
    },
  };
}

/**
 * The arbor target. Spawn it with `context.spawnEnemy` when the boss emits
 * its first `arborStage` event: until both jewels break the arbor is behind
 * its shutters, and a target that exists but cannot be locked draws the
 * reticle for nothing.
 */
export function createArborEntry(time: number): EscapementSpawnEntry {
  const leadBeats = Math.max(1, Math.round((BOSS_DEADLINE - time) / BEAT));
  return {
    time,
    kind: 'arbor',
    hitStages: [3, 3],
    lockable: false,
    data: { role: 'arbor', part: 'arbor', placement: place('arbor', leadBeats, 0, 4.5) },
  };
}

/** A ruby bolt fired by a wasp. Spawn it with `context.spawnEnemy` at the wasp's fire time. */
export function createRubyBolt(firedAt: number, waspId: number): EscapementSpawnEntry {
  return {
    time: firedAt,
    kind: 'bolt',
    countsTowardTotal: false,
    data: { role: 'bolt', firedAt, waspId },
  };
}

/** Eight oxide ticks pouring off the crown wheel over one bar, spawned when the boss emits `tickPour`. */
export function createTickPour(time: number): EscapementSpawnEntry[] {
  const laterals = [-5, 3, -1, 5, -3, 1, -4, 4];
  return laterals.map((lateral, i) => ({
    ...tick(time + i * (BEAT / 2), 'crown-wheel', lateral, 3),
    countsTowardTotal: false,
  }));
}

// ---- the timeline -----------------------------------------------------------

export function createEscapementTimeline(): EscapementSpawnEntry[] {
  swarmCounter = 0;
  const entries: EscapementSpawnEntry[] = [
    // --- The Barrel (bars 0-7): the sweep tutorial. Two swarms drift in the lamp shafts.
    ...moteSwarm(bar(2), 0, 10, 0.9, [0, -0.6]),
    ...moteSwarm(bar(4, 2), 1, 10, 1.2, [0.4, -0.8]),

    // --- The Train (bars 7-17): burrs thrown from the meshing teeth, ticks down
    // the gear faces, the first ratchets seated on the rim. Hand-offs on the
    // downbeats of bars 10 and 14 keep a beat clear either side.
    ...burrVolley(bar(7), 2, 1, [1.5, 2.5]),
    burr(bar(7, 2), -1, 3),
    tick(bar(8), 'gear-face', -3.5),
    tick(bar(8, 1), 'gear-face', 3.5),
    ...burrVolley(bar(9), 3, 1, [1, 2.5, 0.5]), // beats 0-2; beat 3 clear for the hand-off at bar 10
    ratchet(bar(10, 2), 'wheel-rim', 20, 3.5, 1),
    tick(bar(11), 'gear-face', -2),
    tick(bar(11, 1), 'gear-face', 4.5),
    ...burrVolley(bar(11, 2), 2, -1, [2, 1]),
    ...burrVolley(bar(12), 2, 1, [0.5, 2.5]),
    ratchet(bar(12, 2), 'wheel-rim', 18, -3.5, 1.5),
    tick(bar(13), 'gear-face', -4),
    tick(bar(13, 1), 'gear-face', 1),
    ...burrVolley(bar(13, 1), 2, -1, [2.5, 1]), // beats 1-2; beat 3 clear for the hand-off at bar 14
    ...burrVolley(bar(14, 2), 2, 1, [1.5, 3]),
    tick(bar(15), 'gear-face', -3),
    tick(bar(15, 1), 'gear-face', 3),
    tick(bar(15, 2), 'gear-face', 0),
    ...burrVolley(bar(16), 3, -1, [0.5, 2, 1]),

    // --- The Orrery (bars 17-26): speed 1.4x. Fast burrs with ribbon trails fling
    // off the arms; jewel wasps ride the arms and fire every two bars.
    wasp(bar(17), 'orrery-arm', 24, -4.5, 3.5, 0),
    ...burrVolley(bar(17, 1), 2, 1, [1, 2.5], { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 0 }),
    ...burrVolley(bar(18), 3, -1, [2, 0.5, 3], { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 1 }),
    wasp(bar(19), 'orrery-arm', 20, 4.5, 4, 1),
    ...burrVolley(bar(19, 1), 2, 1, [1.5, 2.5], { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 1 }),
    ...burrVolley(bar(20), 3, 1, [0.5, 2, 3.5], { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 2 }),
    wasp(bar(21), 'orrery-arm', 16, -3.5, 2.5, 2),
    ...burrVolley(bar(21, 1), 2, -1, [2.5, 1], { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 2 }),
    ...burrVolley(bar(22), 4, 1, [1, 3, 0.5, 2.5], { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 3 }),
    wasp(bar(23), 'orrery-arm', 10, 3.5, 3, 3),
    ...burrVolley(bar(23, 1), 2, -1, [2, 0.5], { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 3 }),
    ...burrVolley(bar(24), 4, 1, [1.5, 3, 0.5, 2], { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 4 }),
    burr(bar(25), -1, 2, { crossBeats: 3, trail: true, anchor: 'orrery-arm', index: 4 }),

    // --- The Strike (bars 26-29): a breath. Nothing spawns.

    // --- The Pendulum (bars 29-42): ratchets and ticks ride the pallets; chimes
    // hang in the swing path and reach the reticle at the swing extremes.
    swingChime(30, 6, 0, 2.5),
    tick(bar(29, 2), 'pallet-left', -3),
    swingChime(31, 6, 1.5, 3.5),
    ratchet(bar(30, 2), 'pallet-right', 16, 3, 2),
    tick(bar(31, 2), 'pallet-right', 3),
    swingChime(33, 8, -1, 2),
    swingChime(33, 6, 1.5, 4),
    tick(bar(32, 2), 'pallet-left', -2),
    tick(bar(33), 'pallet-left', -4),
    swingChime(34, 6, 0, 3),
    ratchet(bar(34, 2), 'pallet-left', 16, -3, 2),
    swingChime(35, 6, 2, 2.5),
    swingChime(36, 8, -2, 4),
    tick(bar(35, 2), 'pallet-right', 4),
    tick(bar(36), 'pallet-right', 2),
    swingChime(37, 6, 1, 3),
    swingChime(38, 6, 0, 2),
    ratchet(bar(38, 2), 'pallet-right', 14, 3, 2),
    tick(bar(38, 2), 'pallet-left', -3),
    swingChime(39, 6, 2, 3.5),
    swingChime(40, 8, -1.5, 2.5),
    tick(bar(40), 'pallet-left', -1),
    tick(bar(40, 1), 'pallet-right', 3),
    swingChime(41, 6, 0, 3),
    swingChime(42, 6, -2, 3),

    // --- The Escapement (bars 42-56): the boss and its escort. Wasps ride the
    // pallets, burrs fly off the escape wheel on the beats after each jewel
    // window opens, chimes keep arriving at the extremes. The arbor target
    // spawns when both jewels are broken (createArborEntry) and ticks pour
    // from the crown wheel at the arbor stage break (createTickPour).
    bossJewel('jewel-left'),
    bossJewel('jewel-right'),
    wasp(bar(43), 'pallet-left', 16, -4, 1.5),
    swingChime(44, 6, 1.5, 2),
    ...burrVolley(bar(44, 2), 2, 1, [1, 2.5], { anchor: 'escape-wheel' }),
    swingChime(46, 6, -1.5, 2.5),
    wasp(bar(46), 'pallet-right', 16, 4, 1.5),
    ...burrVolley(bar(47), 2, -1, [2, 1], { anchor: 'escape-wheel' }),
    swingChime(48, 6, 1, 3),
    ...burrVolley(bar(49, 2), 2, 1, [1.5, 0.5], { anchor: 'escape-wheel' }),
    swingChime(50, 6, -1, 2),
    wasp(bar(50), 'pallet-left', 16, -4, 2),
    swingChime(52, 6, 1.5, 3),
    swingChime(54, 6, -1.5, 2.5),

    // --- Free Run (bars 56-60): the escapement is broken and the rail runs out
    // through the dial. One chime hangs at each numeral, I to XII, one per beat.
    ...DIAL_NUMERALS.map((_, i) => dialChime(bar(56) + i * BEAT, i + 1, 4)),
  ];
  return entries.sort((a, b) => a.time - b.time);
}

export const ESCAPEMENT_TIMELINE: EscapementSpawnEntry[] = createEscapementTimeline();

// ---- analysis helpers --------------------------------------------------------

/** Seconds an entry stays on screen after spawn before the runner should count it missed. */
export function screenSeconds(entry: EscapementSpawnEntry): number {
  const data = entry.data;
  switch (data.role) {
    case 'burr':
      return (data.delayBeats + data.crossBeats) * BEAT;
    case 'tick':
      return (data.leapBeat + data.leapBeats) * BEAT;
    case 'bolt':
      return 6;
    case 'jewel':
    case 'arbor':
      return BOSS_DEADLINE - entry.time;
    default:
      return leadSeconds(data.placement);
  }
}

export function countsTowardTotal(entry: EscapementSpawnEntry) {
  return entry.countsTowardTotal !== false;
}

export function hitStagesOf(entry: EscapementSpawnEntry): number[] {
  return entry.hitStages ?? [entry.hitPoints ?? 1];
}

export function sectionNameAt(time: number) {
  for (const section of ESCAPEMENT_RUN_SECTIONS) {
    if (time >= bar(section.fromBar) && time < bar(section.toBar)) return section.name;
  }
  return 'end';
}

export type DensityRow = {
  bar: number;
  section: string;
  spawns: number;
  targets: number;
  lockDemand: number;
  /** Largest number of counted targets alive at one instant during the bar. */
  peakOnScreen: number;
  kinds: string;
};

/** One row per bar: what spawns in it and how crowded the screen gets. */
export function densityTable(timeline: EscapementSpawnEntry[] = ESCAPEMENT_TIMELINE): DensityRow[] {
  const rows: DensityRow[] = [];
  for (let b = 0; b < ESCAPEMENT_BARS.end; b += 1) {
    const start = bar(b);
    const end = bar(b + 1);
    const spawned = timeline.filter((entry) => entry.time >= start && entry.time < end);
    const counted = spawned.filter(countsTowardTotal);
    const kinds = new Map<string, number>();
    for (const entry of spawned) kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1);
    let peak = 0;
    for (let t = start; t < end; t += BEAT / 4) {
      const alive = timeline.filter((entry) => countsTowardTotal(entry) && entry.time <= t && entry.time + screenSeconds(entry) > t).length;
      peak = Math.max(peak, alive);
    }
    rows.push({
      bar: b,
      section: sectionNameAt(start),
      spawns: spawned.length,
      targets: counted.length,
      lockDemand: counted.reduce((sum, entry) => sum + hitStagesOf(entry).reduce((a, c) => a + c, 0), 0),
      peakOnScreen: peak,
      kinds: [...kinds.entries()].map(([kind, n]) => `${n} ${kind}`).join(', '),
    });
  }
  return rows;
}

// ---- plausible-player simulation --------------------------------------------

export type PlausiblePlayer = {
  /** Bars between the start of one sweep and the next. */
  cadenceBars: number;
  /** Bars the pointer is held during a sweep; locks accrue on everything lockable in that window. */
  holdBars: number;
  /** Seconds after release until the shots land. */
  flightSeconds: number;
};

export const FLOOR_PLAYER: PlausiblePlayer = { cadenceBars: 2, holdBars: 1, flightSeconds: 0.5 };
export const STEADY_PLAYER: PlausiblePlayer = { cadenceBars: 1, holdBars: 0.5, flightSeconds: 0.5 };

export type SimulationResult = {
  total: number;
  kills: number;
  misses: number;
  killRate: number;
  bossKilledAt: number | null;
  rings: number;
  perKind: Record<string, { total: number; kills: number }>;
  perSection: Record<string, { total: number; kills: number }>;
  volleys: number;
  /** One line per volley: release bar and the kinds locked. */
  volleyLog: string[];
};

type SimTarget = {
  entry: EscapementSpawnEntry;
  spawn: number;
  expire: number;
  stages: number[];
  stageIndex: number;
  stageHp: number;
  pendingLocks: number;
  dead: boolean;
  missed: boolean;
};

/**
 * Drives the timeline with a scripted player: hold for `holdBars`, locking up
 * to six targets (a lifted jewel or the exposed arbor first, then whatever
 * expires soonest), release, wait out the cadence. Boss parts follow
 * boss-logic; the tick pour spawns when the boss emits it.
 */
export function simulatePlausiblePlayer(player: PlausiblePlayer, timeline: EscapementSpawnEntry[] = createEscapementTimeline()): SimulationResult {
  const boss = createEscapementBoss();
  const targets: SimTarget[] = [];
  const bossTargets = new Map<BossPart, SimTarget>();
  let bossKilledAt: number | null = null;
  const perKind: SimulationResult['perKind'] = {};
  const perSection: SimulationResult['perSection'] = {};

  function addTarget(entry: EscapementSpawnEntry) {
    const stages = hitStagesOf(entry);
    const target: SimTarget = {
      entry,
      spawn: entry.time,
      expire: entry.time + screenSeconds(entry),
      stages,
      stageIndex: 0,
      stageHp: stages[0],
      pendingLocks: 0,
      dead: false,
      missed: false,
    };
    targets.push(target);
    if (entry.data.role === 'jewel' || entry.data.role === 'arbor') bossTargets.set(entry.data.part, target);
    if (countsTowardTotal(entry)) {
      const section = sectionNameAt(entry.time);
      (perKind[entry.kind] ??= { total: 0, kills: 0 }).total += 1;
      (perSection[section] ??= { total: 0, kills: 0 }).total += 1;
    }
    return target;
  }

  for (const entry of timeline) addTarget(entry);

  function lockableAt(target: SimTarget, time: number) {
    if (target.dead || time < target.spawn || time >= target.expire) return false;
    const role = target.entry.data.role;
    if (role === 'jewel' || role === 'arbor') return boss.snapshot().lockable[target.entry.data.part];
    return true;
  }

  function land(target: SimTarget, time: number) {
    if (target.dead) return;
    const role = target.entry.data.role;
    if (role === 'jewel' || role === 'arbor') {
      for (const event of boss.hit(target.entry.data.part, time)) {
        if (event.type === 'tickPour') for (const pour of createTickPour(event.time)) addTarget(pour);
        if (event.type === 'arborStage' && event.stage === 1) addTarget(createArborEntry(event.time));
        if (event.type === 'jewelBroken') target.dead = true;
        if (event.type === 'killed') {
          target.dead = true;
          bossKilledAt = event.time;
        }
      }
      return;
    }
    target.stageHp -= 1;
    if (target.stageHp > 0) return;
    target.stageIndex += 1;
    if (target.stageIndex >= target.stages.length) target.dead = true;
    else target.stageHp = target.stages[target.stageIndex];
  }

  const dt = BEAT / 4;
  const cadence = player.cadenceBars * ESCAPEMENT_TIME.barSeconds;
  const hold = player.holdBars * ESCAPEMENT_TIME.barSeconds;
  let nextSweep = 0;
  let holdUntil = -1;
  let locks: SimTarget[] = [];
  const inFlight: Array<{ at: number; target: SimTarget }> = [];
  let volleys = 0;
  const volleyLog: string[] = [];

  for (let time = 0; time <= ESCAPEMENT_TIME.bar(ESCAPEMENT_BARS.end); time += dt) {
    boss.update(time);
    for (const target of bossTargets.values()) {
      if (!target.dead && boss.snapshot().stage === 'failed') target.expire = Math.min(target.expire, time);
    }

    while (inFlight.length > 0 && inFlight[0].at <= time) {
      const shot = inFlight.shift()!;
      shot.target.pendingLocks = Math.max(0, shot.target.pendingLocks - 1);
      land(shot.target, shot.at);
    }

    // The player starts a sweep on cadence once something is there to lock.
    // While the boss lives they watch the fork and wait for a lifted jewel or
    // the exposed arbor: the lifted jewel is the only white-hot thing in frame.
    const bossSnapshot = boss.snapshot();
    const bossLive = bossSnapshot.stage === 'jewels' || bossSnapshot.stage === 'arbor' || bossSnapshot.stage === 'pour';
    const bossOpen = Object.values(bossSnapshot.lockable).some(Boolean);
    if (holdUntil < 0 && time >= nextSweep && (bossLive ? bossOpen : targets.some((target) => lockableAt(target, time)))) {
      holdUntil = time + hold;
      locks = [];
    }
    if (holdUntil >= 0) {
      const candidates = targets
        .filter((target) => lockableAt(target, time))
        .sort((a, b) => {
          const aBoss = a.entry.data.role === 'jewel' || a.entry.data.role === 'arbor';
          const bBoss = b.entry.data.role === 'jewel' || b.entry.data.role === 'arbor';
          if (aBoss !== bBoss) return aBoss ? -1 : 1;
          return a.expire - b.expire;
        });
      // A dwell on one target places up to its stage HP in locks, as the runner allows.
      for (const target of candidates) {
        let placed = locks.filter((locked) => locked === target).length;
        while (locks.length < MAX_LOCKS && placed + target.pendingLocks < target.stageHp) {
          locks.push(target);
          placed += 1;
        }
        if (locks.length >= MAX_LOCKS) break;
      }
      if (time >= holdUntil) {
        if (locks.length > 0) {
          volleys += 1;
          volleyLog.push(`bar ${(time / ESCAPEMENT_TIME.barSeconds).toFixed(2)}: ${locks.map((target) => target.entry.kind).join(', ')}`);
          for (const target of locks) {
            target.pendingLocks += 1;
            inFlight.push({ at: time + player.flightSeconds, target });
          }
          inFlight.sort((a, b) => a.at - b.at);
        }
        holdUntil = -1;
        nextSweep = time + cadence - hold;
      }
    }

    for (const target of targets) {
      if (!target.dead && !target.missed && time >= target.expire) target.missed = true;
    }
  }

  let kills = 0;
  let misses = 0;
  for (const target of targets) {
    if (!countsTowardTotal(target.entry)) continue;
    const section = sectionNameAt(target.entry.time);
    if (target.dead) {
      kills += 1;
      perKind[target.entry.kind].kills += 1;
      perSection[section].kills += 1;
    } else misses += 1;
  }
  const total = kills + misses;
  return {
    total,
    kills,
    misses,
    killRate: total === 0 ? 0 : kills / total,
    bossKilledAt,
    rings: boss.snapshot().rings,
    perKind,
    perSection,
    volleys,
    volleyLog,
  };
}

