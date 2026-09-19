import type { Vector3 } from 'three';
import type { HostileShotImpactState } from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import type { EventBus } from '../../events';
import { createBoss, createBossSpawns, type BossSpawnData } from './boss';
import { PEEL_GAP, PEEL_SECONDS, POD_LOWER_SECONDS, createCableRegistry, createEnemyMotion, skiffFlightSeconds, type SkiffLaunch } from './enemies';
import { createSpillwayRail, spillwayRunProgress } from './rail';
import { SPILLWAY_BAR, SPILLWAY_BPM, SPILLWAY_DURATION, bar } from './timing';

// SPILLWAY — the combat of the chase, bar by bar at 132 BPM. The walker
// wades ahead down the gorge and throws everything it carries at you:
//
//   upper      0–8   skiffs arc in from the walker's back, far off; a first flock
//   narrows    8–20  drums enter: pods winch down the walls on the downbeat,
//                    the first cable surfaces across the river
//   chute     20–22  a flock dives the cascade beside you; skiffs splash down at its foot
//   whitewater 22–36 full pressure in the S-bends; under the walker (28–31) a
//                    cable trails from it, a flock drops out of its belly, and
//                    its rear rack dumps skiffs onto the theme's return at 32
//   reservoir 36–42  the breakdown: two slow flocks and one wide skiff wave
//   boss      44–58  boss.ts
//   spillway  60–66  the spotters flee the breach; skiffs surf the flood and
//                    leap the lip with you; a last flock in the open sky
//   valley    66–70  empty water: the chase is over
//
// Skiffs own the low band, spotters the high band, pods the sides; cables span
// the middle. Every target paces the camera with the rail pacer, so a lead is
// the seconds it stays on screen whatever the river speed.

export { SPILLWAY_BPM } from './timing';

export const SPILLWAY_PLAYER_HEALTH = 4;

export type SpillwayEnemyKind = 'skiff' | 'spotter' | 'pod' | 'rivet' | 'clamp' | 'leg' | 'core' | 'slab';

export type SpotterEntrance = 'left' | 'right' | 'belly' | 'dive';

// Timeline data is immutable apart from `lockable`, which a skiff sets on its
// own entry while it is in the air. Per-enemy runtime state lives in the
// runner's enemyState bags; rivets get fresh data objects each launch.
export type SpillwaySpawnData =
  | { role: 'skiff'; engagement: RailLead; landAt: number; launch: SkiffLaunch; rack: number; lane: number; weave: number; rate: number; phase: number }
  | { role: 'spotter'; engagement: RailLead; entrance: SpotterEntrance; slot: number; size: number; x: number; y: number; peelAt: number; lineY: number }
  | { role: 'pod'; engagement: RailLead; side: 1 | -1; height: number; firstShot: number; every: number }
  | { role: 'clamp'; engagement: RailLead; cable: number; slot: number; of: number; lane: number }
  | { role: 'rivet'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | BossSpawnData;

export type SpillwaySpawnEntry = LockOnSpawnEntry<SpillwayEnemyKind, SpillwaySpawnData>;
export type SpillwayUpdate = LockOnEnemyUpdate<SpillwayEnemyKind, SpillwaySpawnData>;

// ---- pacing --------------------------------------------------------------------

/** Where a paced target first appears: close enough to lock, far enough to read. */
const SPAWN_AHEAD = 44;

export const spillwayPacer = createRailPacer({
  curve: createSpillwayRail(),
  duration: SPILLWAY_DURATION,
  runProgress: spillwayRunProgress,
  spawnAheadUnits: SPAWN_AHEAD,
  defaultLeadSeconds: 4.4,
});

/** Pods hang on the walls, far off the rail: they start further out to stay on screen as long. */
export const spillwayWallPacer = createRailPacer({
  curve: createSpillwayRail(),
  duration: SPILLWAY_DURATION,
  runProgress: spillwayRunProgress,
  spawnAheadUnits: 68,
  defaultLeadSeconds: 6,
});

const BEAT = SPILLWAY_BAR / 4;

/** Seconds each kind stays on screen once it can be locked. */
const LEAD = { skiff: 4.2, spotter: 5.4, pod: 6.4, clamp: 4.4, flood: 3.6 };

// ---- wave builders -------------------------------------------------------------

/**
 * Skiffs authored by the bar their first one lands on, so splashdowns hit the
 * music; each is launched one flight time earlier. `lanes` are
 * [across the river -1..1, weave amplitude].
 */
function skiffs(landBar: number, lanes: Array<[number, number]>, options: { launch?: SkiffLaunch; stagger?: number; lead?: number } = {}): SpillwaySpawnEntry[] {
  const launch = options.launch ?? 'back';
  const stagger = options.stagger ?? BEAT / 2;
  return lanes.map(([lane, weave], index) => {
    const landAt = bar(landBar) + index * stagger;
    const flight = skiffFlightSeconds(landAt, launch);
    return {
      time: landAt - flight,
      kind: 'skiff',
      data: {
        role: 'skiff',
        engagement: spillwayPacer.resolve(landAt, options.lead ?? (launch === 'flood' ? LEAD.flood : LEAD.skiff)),
        landAt,
        launch,
        rack: index,
        lane,
        weave,
        rate: 1.3 + (index % 3) * 0.35,
        phase: index * 2.1 + landBar,
      },
    };
  });
}

/**
 * A flock that holds formation, then from `peelBar` peels off one by one along
 * a line across the screen. The lead stretches to cover the last one's crossing.
 */
function flock(atBar: number, size: number, entrance: SpotterEntrance, options: { x: number; y: number; peelBar: number; lineY: number; lead?: number }): SpillwaySpawnEntry[] {
  return Array.from({ length: size }, (_, slot) => {
    const time = bar(atBar) + slot * 0.06;
    const crossing = bar(options.peelBar) - time + (size - 1) * PEEL_GAP + PEEL_SECONDS * 0.9;
    return {
      time,
      kind: 'spotter',
      data: {
        role: 'spotter',
        engagement: spillwayPacer.resolve(time, Math.max(options.lead ?? LEAD.spotter, crossing / 0.8)),
        entrance,
        slot,
        size,
        x: options.x,
        y: options.y,
        peelAt: bar(options.peelBar) - time,
        lineY: options.lineY,
      },
    };
  });
}

/** Pods authored by the bar they bite into the wall: [side, height above the water]. */
function pods(anchorBar: number, placements: Array<[1 | -1, number]>): SpillwaySpawnEntry[] {
  return placements.map(([side, height], index) => {
    const time = bar(anchorBar) - POD_LOWER_SECONDS + index * BEAT * 0.5;
    return {
      time,
      kind: 'pod',
      hitPoints: 2,
      data: {
        role: 'pod',
        engagement: spillwayWallPacer.resolve(time, LEAD.pod),
        side,
        height,
        firstShot: POD_LOWER_SECONDS + 0.9 + index * BEAT,
        every: 2 * SPILLWAY_BAR,
      },
    };
  });
}

let nextCable = 0;

/** A cable surfacing across the river on `atBar`, held by one clamp per lane. */
function cable(atBar: number, lanes: number[]): SpillwaySpawnEntry[] {
  const id = nextCable;
  nextCable += 1;
  const time = bar(atBar);
  const engagement = spillwayPacer.resolve(time, LEAD.clamp);
  return lanes.map((lane, slot) => ({ time, kind: 'clamp', data: { role: 'clamp', engagement, cable: id, slot, of: lanes.length, lane } }));
}

// ---- spawn timeline ------------------------------------------------------------

function buildTimeline(): SpillwaySpawnEntry[] {
  nextCable = 0;
  return [
    // --- upper (0–8): the kora alone on the pool. Far launches, one flock, room to learn.
    ...skiffs(2.5, [[-0.55, 0.2], [0.5, 0.25]], { stagger: BEAT }),
    ...flock(3.5, 4, 'left', { x: -13, y: 8, peelBar: 5.5, lineY: 5.5 }),
    ...skiffs(5, [[-0.75, 0.2], [-0.15, 0.35], [0.6, 0.2]]),
    ...skiffs(7, [[-0.5, 0.3], [0.65, 0.25]], { stagger: BEAT }),

    // --- narrows (8–20): the drums enter; pods bite into the walls on the downbeat.
    ...pods(8, [[-1, 9], [1, 12]]),
    ...flock(9, 6, 'right', { x: 12, y: 9, peelBar: 10.75, lineY: 6.5 }),
    ...cable(10.5, [-0.65, 0.05, 0.7]),
    ...skiffs(12, [[-0.8, 0.15], [-0.3, 0.3], [0.3, 0.3], [0.8, 0.15]]),
    ...pods(13, [[1, 10], [-1, 14]]),
    ...flock(14, 6, 'left', { x: -11, y: 10, peelBar: 15.75, lineY: 7 }),
    ...cable(15.5, [-0.6, 0.6]),
    ...skiffs(16, [[-0.7, 0.25], [0.1, 0.4], [0.75, 0.2]]),
    ...pods(17, [[-1, 11], [1, 9]]),
    ...cable(18, [-0.7, -0.05, 0.65]),

    // --- chute (20–22): a flock dives the cascade with you; skiffs splash into the plunge pool on the big drum.
    ...flock(19.75, 6, 'dive', { x: 6, y: 7, peelBar: 21, lineY: 5, lead: 3.4 }),
    ...skiffs(22, [[-0.7, 0.2], [0.05, 0.35], [0.7, 0.2]], { stagger: BEAT / 4 }),

    // --- whitewater (22–36): full drive in the S-bends.
    ...pods(23, [[1, 12], [-1, 9]]),
    ...flock(23.5, 6, 'left', { x: -10, y: 10, peelBar: 25, lineY: 7.5 }),
    ...skiffs(24.5, [[-0.85, 0.15], [-0.35, 0.3], [0.25, 0.3], [0.8, 0.15]]),
    // The walker is close: a cable trails behind it across the river.
    ...cable(25.25, [-0.6, 0.1, 0.7]),
    ...skiffs(25.75, [[-0.7, 0.2], [0.65, 0.2]], { lead: 3.4 }),
    // Under the belly (bars 28–31) the camera looks up: its hatch drops a
    // flock around the legs, and pods hang high on the walls beside it.
    ...flock(28.25, 6, 'belly', { x: 0, y: 0, peelBar: 30, lineY: 0 }),
    ...pods(29.5, [[-1, 34], [1, 30]]),
    // It pulls ahead and its rear rack dumps skiffs onto the theme's return.
    ...skiffs(32, [[-0.7, 0.2], [0.05, 0.3], [0.7, 0.2]], { launch: 'belly', stagger: BEAT / 2 }),
    ...pods(32.5, [[-1, 12], [1, 10]]),
    ...flock(33, 5, 'right', { x: 11, y: 9, peelBar: 34.5, lineY: 6 }),
    ...cable(34, [-0.6, 0.65]),
    ...skiffs(35, [[-0.75, 0.2], [0.15, 0.35], [0.8, 0.15]]),

    // --- reservoir (36–42): the breakdown. Slow flocks over still water, one wide skiff wave.
    ...flock(37, 5, 'left', { x: -14, y: 9, peelBar: 39, lineY: 6, lead: 6 }),
    ...skiffs(39.5, [[-0.9, 0.1], [-0.35, 0.2], [0.35, 0.2], [0.9, 0.1]], { stagger: BEAT }),
    ...flock(40.5, 4, 'right', { x: 13, y: 10, peelBar: 42.25, lineY: 7, lead: 5.6 }),

    // --- boss (44–58)
    ...createBossSpawns({ flock }),

    // --- spillway (60–66): the flock flees the breach, skiffs ride the flood off the lip.
    ...flock(60, 6, 'left', { x: -9, y: 9, peelBar: 61.25, lineY: 6, lead: 4.6 }),
    ...skiffs(61.5, [[-0.6, 0.15], [-0.2, 0.2], [0.25, 0.2], [0.65, 0.15]], { launch: 'flood', stagger: BEAT / 2 }),
    ...flock(63, 6, 'right', { x: 10, y: 8, peelBar: 64.5, lineY: 5, lead: 3.8 }),

    // --- valley (66–70): nothing. The river runs out into the sun.
  ];
}

export function createSpillwayTimeline() {
  return buildTimeline().sort((a, b) => a.time - b.time);
}

export const SPILLWAY_SPAWN_TIMELINE: SpillwaySpawnEntry[] = createSpillwayTimeline();

// ---- scoring ---------------------------------------------------------------------

const KILL_SCORE: Record<SpillwayEnemyKind, number> = {
  skiff: 120,
  spotter: 100,
  pod: 280,
  rivet: 50,
  clamp: 140,
  leg: 400,
  core: 2000,
  slab: 80,
};

const CABLE_CUT_BONUS = 300;

export function createSpillwayGameplay(bus: EventBus): LockOnRunnerLevel<SpillwayEnemyKind, SpillwaySpawnData> {
  const cables = createCableRegistry();
  const motion = createEnemyMotion({ pacer: spillwayPacer, wallPacer: spillwayWallPacer, cables });
  const boss = createBoss(bus, motion);
  const cableCount = new Set(SPILLWAY_SPAWN_TIMELINE.flatMap((entry) => (entry.data.role === 'clamp' ? [entry.data.cable] : []))).size;

  let hitsTaken = 0;
  let podsDowned = 0;

  bus.on('runstart', () => {
    cables.reset();
    hitsTaken = 0;
    podsDowned = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => motion.intercepted.add(enemyId));
  bus.on('miss', ({ enemyId }) => motion.intercepted.delete(enemyId));
  bus.on('kill', ({ enemyId }) => {
    motion.intercepted.delete(enemyId);
    cables.clampKilled(enemyId);
  });

  return {
    duration: SPILLWAY_DURATION,
    bpm: SPILLWAY_BPM,
    playerHealth: SPILLWAY_PLAYER_HEALTH,
    createRail: createSpillwayRail,
    easeRunProgress: spillwayRunProgress,
    spawnTimeline: SPILLWAY_SPAWN_TIMELINE,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'skiff':
          return motion.skiff(context, data);
        case 'spotter':
          return motion.spotter(context, data);
        case 'pod':
          return motion.pod(context, data);
        case 'clamp':
          return motion.clamp(context, data);
        case 'rivet':
          return motion.rivet(context, data);
        case 'boss':
          return boss.update(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      let award = KILL_SCORE[enemy.kind] * multiplier;
      if (enemy.kind === 'pod') podsDowned += 1;
      if (enemy.kind === 'clamp' && cables.isLastClamp(enemy.id)) award += CABLE_CUT_BONUS;
      return Math.round(award);
    },
    scoreForHit: () => 40,
    scoreForVolley(results) {
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 600 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 28000 && clearRate >= 0.9 && hitsTaken === 0) return 'S';
      if (score >= 21000 && clearRate >= 0.7) return 'A';
      if (score >= 13000 && clearRate >= 0.5) return 'B';
      if (score >= 6000 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [`Hull ${Math.max(0, SPILLWAY_PLAYER_HEALTH - hitsTaken)}/${SPILLWAY_PLAYER_HEALTH}`, `Cables cut ${cables.cutCount()}/${cableCount}`];
      if (podsDowned > 0) lines.push(`${podsDowned} winch pod${podsDowned === 1 ? '' : 's'} dropped`);
      const bossLine = boss.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
