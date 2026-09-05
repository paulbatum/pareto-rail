import { ESCAPEMENT_BAR, ESCAPEMENT_MARKERS, PENDULUM_PERIOD } from './timing';

// The Escapement boss as a pure state machine. It reads run time and the hits
// the runner reports, and it answers which parts are lockable, which pallet is
// lifted, whether the arbor is exposed, the pendulum amplitude, and the bell
// ring count. It touches no scene object and no event bus: gameplay.ts calls
// `update` every frame, forwards `hit` events for the three boss parts, copies
// `lockable` onto the boss spawn entries, and turns the returned events into
// bus events, visuals, and audio.
//
// The loop:
//   1. Jewels. Each pallet jewel is lockable only during the half-swing when
//      its pallet is lifted off the escape wheel. Three hits break a jewel and
//      raise the pendulum amplitude (20 -> 30 -> 40 degrees).
//   2. Arbor. Once both jewels are gone the arbor is lockable while the bob is
//      in the bottom third of its swing. Two stages of three hits. At the
//      stage break the arbor closes for one bar while ticks pour off the
//      crown wheel.
//   3. Kill. Every hit rings the bell and lifts its pitch one scale degree.
//      3 + 3 + 6 = 12, so the twelfth ring is the kill. If the boss lives at
//      bar 56 the loop fails and the clock stays silent.

export const BOSS_START = ESCAPEMENT_MARKERS.boss;
export const BOSS_DEADLINE = ESCAPEMENT_MARKERS.bossDeadline;

export const JEWEL_HITS = 3;
export const ARBOR_STAGE_HITS = 3;
export const ARBOR_STAGES = 2;
export const TOTAL_RINGS = JEWEL_HITS * 2 + ARBOR_STAGE_HITS * ARBOR_STAGES;
export const TICK_POUR_SECONDS = ESCAPEMENT_BAR;

// Pendulum amplitude in degrees indexed by the number of broken jewels.
export const AMPLITUDE_BY_BROKEN_JEWELS = [20, 30, 40] as const;

// The arbor is exposed while the bob's height above its lowest point is within
// this fraction of the swing's full height range: the bottom third of the swing.
export const ARBOR_EXPOSURE_HEIGHT_FRACTION = 1 / 3;

export type PalletSide = 'left' | 'right';
export type BossPart = 'jewel-left' | 'jewel-right' | 'arbor';
export type BossStage = 'dormant' | 'jewels' | 'arbor' | 'pour' | 'dead' | 'failed';

export type BossEvent =
  | { type: 'engaged'; time: number }
  | { type: 'ring'; time: number; ring: number; degree: number; part: BossPart }
  | { type: 'jewelBroken'; time: number; side: PalletSide; amplitude: number }
  | { type: 'arborStage'; time: number; stage: 1 | 2 }
  | { type: 'tickPour'; time: number; until: number }
  | { type: 'killed'; time: number }
  | { type: 'deadline'; time: number };

export type BossSnapshot = {
  time: number;
  stage: BossStage;
  amplitude: number;
  /** Pendulum angle in degrees, positive toward the left extreme. */
  angle: number;
  /** The pallet lifted off the escape wheel, or null while the fork passes through centre. */
  liftedPallet: PalletSide | null;
  arborExposed: boolean;
  lockable: Record<BossPart, boolean>;
  alive: Record<BossPart, boolean>;
  jewelHits: Record<PalletSide, number>;
  arborHits: number;
  /** 1 while the first three arbor hits are pending, 2 after the pour. 0 before the arbor opens. */
  arborStage: 0 | 1 | 2;
  pourUntil: number | null;
  rings: number;
  /** Scale degree of the next ring (1..12), or 12 once the bell has struck twelve. */
  nextDegree: number;
};

export type EscapementBoss = {
  /** Advance to run time `time`. `angle` overrides the pendulum angle when the rail's real bob angle differs from the formula. */
  update(time: number, angle?: number): BossEvent[];
  /** Report a projectile landing on a boss part at run time `time`. Hits on a dead part or before the boss engages are ignored. */
  hit(part: BossPart, time: number): BossEvent[];
  snapshot(): BossSnapshot;
  reset(): void;
  /** End-screen line for the boss, or undefined before it engages. */
  summaryLine(): string | undefined;
};

/** sin(2πt / PENDULUM_PERIOD): +1 at the left extreme, -1 at the right extreme, 0 at the bottom of the swing. */
export function pendulumPhase(time: number) {
  return Math.sin((2 * Math.PI * time) / PENDULUM_PERIOD);
}

export function pendulumAngle(time: number, amplitude: number) {
  return pendulumPhase(time) * amplitude;
}

/** Which side the bob is on at `time`, or null when it is at centre. */
export function pendulumSide(time: number): PalletSide | null {
  const phase = pendulumPhase(time);
  if (phase > 0) return 'left';
  if (phase < 0) return 'right';
  return null;
}

/** True when the bob is at a swing extreme at `time` (|phase| within `tolerance` of 1). */
export function atSwingExtreme(time: number, tolerance = 0.01) {
  return Math.abs(pendulumPhase(time)) >= 1 - tolerance;
}

// While the fork is within this angle of centre both pallets touch the escape
// wheel: the transfer instant. Neither jewel is lifted, so neither is lockable.
export const FORK_TRANSFER_DEGREES = 0.5;

/** The pallet lifted off the escape wheel for a given fork angle: the fork tilts with the bob. */
export function liftedPalletFor(angle: number): PalletSide | null {
  if (angle > FORK_TRANSFER_DEGREES) return 'left';
  if (angle < -FORK_TRANSFER_DEGREES) return 'right';
  return null;
}

/** Height of the bob above its lowest point, as a fraction of the height at the current amplitude. */
export function swingHeightFraction(angle: number, amplitude: number) {
  const rad = (Math.PI / 180) * angle;
  const max = 1 - Math.cos((Math.PI / 180) * amplitude);
  if (max <= 0) return 0;
  return (1 - Math.cos(rad)) / max;
}

export function arborExposedFor(angle: number, amplitude: number) {
  return swingHeightFraction(angle, amplitude) <= ARBOR_EXPOSURE_HEIGHT_FRACTION;
}

export function createEscapementBoss(): EscapementBoss {
  let time = 0;
  let angle = 0;
  let stage: BossStage = 'dormant';
  let jewelHits: Record<PalletSide, number> = { left: 0, right: 0 };
  let arborHits = 0;
  let pourUntil: number | null = null;
  let rings = 0;
  let engagedAt: number | null = null;

  function reset() {
    time = 0;
    angle = 0;
    stage = 'dormant';
    jewelHits = { left: 0, right: 0 };
    arborHits = 0;
    pourUntil = null;
    rings = 0;
    engagedAt = null;
  }

  function brokenJewels() {
    return Number(jewelHits.left >= JEWEL_HITS) + Number(jewelHits.right >= JEWEL_HITS);
  }

  function amplitude() {
    return AMPLITUDE_BY_BROKEN_JEWELS[brokenJewels()];
  }

  function alive(): Record<BossPart, boolean> {
    const bossAlive = stage !== 'dead' && stage !== 'failed';
    return {
      'jewel-left': bossAlive && jewelHits.left < JEWEL_HITS,
      'jewel-right': bossAlive && jewelHits.right < JEWEL_HITS,
      arbor: bossAlive && arborHits < ARBOR_STAGE_HITS * ARBOR_STAGES,
    };
  }

  function arborStage(): 0 | 1 | 2 {
    if (brokenJewels() < 2) return 0;
    return arborHits >= ARBOR_STAGE_HITS && stage !== 'pour' ? 2 : 1;
  }

  function lockable(): Record<BossPart, boolean> {
    const parts = alive();
    const lifted = liftedPalletFor(angle);
    return {
      'jewel-left': stage === 'jewels' && parts['jewel-left'] && lifted === 'left',
      'jewel-right': stage === 'jewels' && parts['jewel-right'] && lifted === 'right',
      arbor: stage === 'arbor' && parts.arbor && arborExposedFor(angle, amplitude()),
    };
  }

  function update(now: number, angleOverride?: number): BossEvent[] {
    const events: BossEvent[] = [];
    time = now;
    angle = angleOverride ?? pendulumAngle(now, amplitude());

    if (stage === 'dormant' && now >= BOSS_START) {
      stage = 'jewels';
      engagedAt = now;
      events.push({ type: 'engaged', time: now });
    }

    if (stage === 'pour' && pourUntil !== null && now >= pourUntil) {
      stage = 'arbor';
      pourUntil = null;
      events.push({ type: 'arborStage', time: now, stage: 2 });
    }

    if ((stage === 'jewels' || stage === 'arbor' || stage === 'pour') && now >= BOSS_DEADLINE) {
      stage = 'failed';
      events.push({ type: 'deadline', time: now });
    }

    return events;
  }

  function ring(part: BossPart, at: number, events: BossEvent[]) {
    rings += 1;
    events.push({ type: 'ring', time: at, ring: rings, degree: rings, part });
  }

  function hit(part: BossPart, at: number): BossEvent[] {
    const events: BossEvent[] = [];
    if (stage === 'dormant' || stage === 'dead' || stage === 'failed') return events;
    if (!alive()[part]) return events;

    if (part === 'jewel-left' || part === 'jewel-right') {
      // A jewel can be hit while engaged: the lock was placed while it was
      // lifted and the projectile arrived late. Only lockability is gated.
      const side: PalletSide = part === 'jewel-left' ? 'left' : 'right';
      jewelHits[side] += 1;
      ring(part, at, events);
      if (jewelHits[side] >= JEWEL_HITS) {
        events.push({ type: 'jewelBroken', time: at, side, amplitude: amplitude() });
        if (brokenJewels() === 2) {
          stage = 'arbor';
          events.push({ type: 'arborStage', time: at, stage: 1 });
        }
      }
      return events;
    }

    if (stage === 'jewels') return events; // the arbor cannot be reached while a jewel lives
    arborHits += 1;
    ring(part, at, events);
    if (arborHits === ARBOR_STAGE_HITS && stage === 'arbor') {
      stage = 'pour';
      pourUntil = at + TICK_POUR_SECONDS;
      events.push({ type: 'tickPour', time: at, until: pourUntil });
    } else if (arborHits >= ARBOR_STAGE_HITS * ARBOR_STAGES) {
      stage = 'dead';
      pourUntil = null;
      events.push({ type: 'killed', time: at });
    }
    return events;
  }

  function snapshot(): BossSnapshot {
    return {
      time,
      stage,
      amplitude: amplitude(),
      angle,
      liftedPallet: liftedPalletFor(angle),
      arborExposed: stage === 'arbor' && arborExposedFor(angle, amplitude()),
      lockable: lockable(),
      alive: alive(),
      jewelHits: { ...jewelHits },
      arborHits,
      arborStage: arborStage(),
      pourUntil,
      rings,
      nextDegree: Math.min(TOTAL_RINGS, rings + 1),
    };
  }

  function summaryLine() {
    if (engagedAt === null) return undefined;
    if (stage === 'dead') return 'The clock struck twelve';
    return 'The hour never struck';
  }

  return { update, hit, snapshot, reset, summaryLine };
}
