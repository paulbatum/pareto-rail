import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { battle } from './state';
import type { BroadsideSpawnEntry, BroadsideUpdate, CoreData, GeneratorData } from './types';
import { BROADSIDE_BAR, SHIELDS_TIME, bar } from './timing';

// THE ENEMY FLAGSHIP — the level's boss, fought in two passes.
//
// Pass one is a close-range run down its port flank. Six shield emitters ride
// the hull, and each one is a rhythm rather than a puzzle: the emitter holds
// its dome up while its point-defence battery charges, then drops the dome for
// the back sixty percent of every bar to fire. The dome cycles are staggered in
// thirds down the hull, so the openings sweep past you as a wave and there is
// always something shootable — but never everything at once. Four of six
// emitters is enough to collapse the shield envelope; all six is a clean job.
//
// Pass two is the trench. With the shield gone the reactor couplings are
// exposed, two armour stages deep, and the only thing between you and the end
// of the battle is how fast you can work.

export const GENERATOR_COUNT = 6;
/** Emitters that must die before the shield envelope fails. */
export const SHIELD_COLLAPSE_AT = 4;
export const CORE_COUNT = 4;

// Point in each bar-length cycle where the dome drops and the battery fires.
// 0.375 is step 6 of 16, and the three dome phases below are quarter-bar
// offsets, so the six emitters open on steps 6, 2, and 14 — all exactly on the
// sixteenth grid. The score puts an accent on each of those steps, so the
// shield rhythm is something you hear before you have consciously seen it.
const EXPOSED_FROM = 0.375;
/** Dome phase offsets, in bars. Chosen so every opening lands on the grid. */
export const DOME_PHASES = [0, 0.25, 0.5] as const;
/** Sixteenth-note steps within each bar where a dome drops. */
export const DOME_OPEN_STEPS = [6, 2, 14] as const;
const GENERATOR_LEAD = 4.8;
const CORE_LEAD = 3.4;

// You strafe the flagship's dorsal surface, so emitters mount two ways: low on
// the open deck, and high on the flanks of its superstructure towers. Pairs
// alternate deck and tower, and their dome phases run in thirds, so the wave of
// openings crosses the frame diagonally instead of marching along one line.
const GENERATOR_MOUNTS: Array<{ time: number; x: number; y: number; phase: number }> = [
  { time: bar(21.4), x: -19, y: -6, phase: DOME_PHASES[0] },
  { time: bar(21.4), x: 16, y: 12, phase: DOME_PHASES[1] },
  { time: bar(22.6), x: 20, y: -7, phase: DOME_PHASES[2] },
  { time: bar(22.6), x: -14, y: 14, phase: DOME_PHASES[0] },
  { time: bar(23.8), x: 3, y: -8, phase: DOME_PHASES[1] },
  { time: bar(23.8), x: -2, y: 17, phase: DOME_PHASES[2] },
];

// Couplings alternate wall to wall and floor to roof, so the dive is a slalom
// rather than a straight line of targets.
// Four couplings across four bars, and the last one lands with two clear bars
// left. Each is two armour stages of two locks, so the deadline is real without
// being unreachable: a clean run finishes the flagship with time to watch it go.
const CORE_MOUNTS: Array<{ time: number; x: number; y: number }> = [
  { time: bar(28.2), x: -12, y: -8 },
  { time: bar(29.1), x: 13, y: 7 },
  { time: bar(29.9), x: -11, y: 10 },
  { time: bar(30.4), x: 10, y: -9 },
];

export function createFlagshipEntries(): {
  generators: BroadsideSpawnEntry[];
  cores: BroadsideSpawnEntry[];
  timeline: BroadsideSpawnEntry[];
} {
  const generators: BroadsideSpawnEntry[] = GENERATOR_MOUNTS.map((mount, index) => ({
    time: mount.time,
    kind: 'generator',
    hitPoints: 2,
    lockable: false,
    data: { role: 'generator', lead: GENERATOR_LEAD, x: mount.x, y: mount.y, index, phase: mount.phase },
  }));

  const cores: BroadsideSpawnEntry[] = CORE_MOUNTS.map((mount, index) => ({
    time: mount.time,
    kind: 'core',
    // Armour casing, then the coupling itself. One lock pops the casing and
    // two finish the coupling, which fits inside the window the trench gives
    // you at nearly two units a millisecond — a real deadline, not a bluff.
    hitStages: [1, 2],
    lockable: false,
    data: { role: 'core', lead: CORE_LEAD, x: mount.x, y: mount.y, index },
  }));

  return { generators, cores, timeline: [...generators, ...cores] };
}

export type FlagshipHooks = {
  /** Launch a point-defence shell from a hull emplacement. */
  fireShell(context: BroadsideUpdate, from: Vector3): void;
};

export function createFlagship(bus: EventBus, hooks: FlagshipHooks) {
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();

  bus.on('runstart', () => {
    generatorIds.clear();
    coreIds.clear();
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'generator') generatorIds.add(enemyId);
    if (kind === 'core') coreIds.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    if (generatorIds.delete(enemyId)) {
      battle.generatorsDown += 1;
      if (!battle.shieldDown && battle.generatorsDown >= SHIELD_COLLAPSE_AT) {
        battle.shieldDown = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
      return;
    }
    if (coreIds.delete(enemyId)) {
      battle.coresDown += 1;
      if (battle.coresDown >= CORE_COUNT && !battle.flagshipKilled) {
        battle.flagshipKilled = true;
        bus.emit('bossphase', { phase: 'destroyed' });
      }
    }
  });

  /** Position in the emitter's bar-long dome cycle, in [0,1). */
  function generatorCycle(runTime: number, data: GeneratorData) {
    const cycles = (runTime - SHIELDS_TIME) / BROADSIDE_BAR + data.phase;
    return { index: Math.floor(cycles), within: cycles - Math.floor(cycles) };
  }

  function updateGenerator(context: BroadsideUpdate, data: GeneratorData) {
    const { enemy, runTime, runProgress, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const cycle = generatorCycle(runTime, data);
    const exposed = cycle.within >= EXPOSED_FROM;
    const state = context.enemyState(() => ({ wasExposed: false, firedCycle: -1 }));

    // Live gate: the runner re-reads `lockable` every frame, so the dome is
    // the hit-box rule and the readable visual at the same time.
    enemy.entry.lockable = exposed;
    enemy.mesh.userData.exposed = exposed;
    // Dome charge winds 0 → 1 while shut, so the drop is telegraphed.
    enemy.mesh.userData.domeCharge = exposed ? 0 : MathUtils.clamp(cycle.within / EXPOSED_FROM, 0, 1);

    // The instant the dome drops, the battery under it fires. Every emitter is
    // therefore a metronome you can hear as well as see. Alternating emitters
    // fire on alternating bars so the flak never becomes a wall.
    if (exposed && !state.wasExposed && cycle.index !== state.firedCycle) {
      state.firedCycle = cycle.index;
      if ((cycle.index + data.index) % 2 === 0) hooks.fireShell(context, enemy.mesh.position.clone());
    }
    state.wasExposed = exposed;

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x, data.y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    return runProgress > anchorU + 0.012;
  }

  function updateCore(context: BroadsideUpdate, data: CoreData) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);

    // Shielded couplings are visible but untouchable: the whole point of the
    // first pass is earning the right to shoot these.
    enemy.entry.lockable = battle.shieldDown;
    enemy.mesh.userData.exposed = battle.shieldDown;
    enemy.mesh.userData.breached = enemy.hitStageIndex > 0;
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(age * 7 + data.index * 1.7);

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x, data.y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    return runProgress > anchorU + 0.012;
  }

  function summaryLine() {
    if (battle.flagshipKilled) return 'Enemy flagship destroyed';
    if (battle.shieldDown) return `Shield down — ${battle.coresDown}/${CORE_COUNT} reactor couplings blown`;
    return `Flagship shield held — ${battle.generatorsDown}/${SHIELD_COLLAPSE_AT} emitters cut`;
  }

  return { updateGenerator, updateCore, summaryLine };
}
