import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { BROADSIDE_MARKERS, bar } from './timing';
import type { BroadsideSpawnData, BroadsideSpawnEntry, BroadsideUpdate } from './gameplay';

// The enemy flagship, fought in two passes. Phase one runs close along its
// port hull: four shield generators come up one by one while the hull's point
// defense fills the air with crimson. Kill all four and the shield falls with
// a visible collapse; miss some and the generators overload on their own as
// the flagship diverts power to its guns — the trench opens either way, but
// only a clean sweep is *your* kill. Phase two is the trench: three exposed
// power cores on the spine, the last of which takes the ship with it.

const GEN_COUNT = 4;
const CORE_COUNT = 3;

// Where the generators sit relative to the rail during the hull pass: pushed
// toward the hull face (+x) with the frame's full height used across the four.
// x stays under +9: farther right and a late generator can end up inside the
// hull face itself once the rail climbs toward the deck line.
const GEN_OFFSETS: Array<[number, number]> = [[6, -5], [9, 6], [5, 10], [4, 0]];
const GEN_TIMES = [22.1, 23.0, 23.9, 24.8];
const GEN_LEAD = 3.5;

// Cores sit low in the trench, staggered across its width.
const CORE_OFFSETS: Array<[number, number]> = [[-6, 0], [6.5, 3], [0, -1]];
const CORE_TIMES = [28.9, 30.0, 31.1];
const CORE_LEAD = 2.5;

// Point-defense cadence during the hull pass.
const PD_PERIOD = 1.35;

// If generators survive the pass, the shield still collapses (overload) just
// after the trench opens — phase two must be playable on every run.
const SHIELD_OVERLOAD_TIME = BROADSIDE_MARKERS.trench + bar(0.6);

type FlagshipEntries = {
  genEntries: BroadsideSpawnEntry[];
  coreEntries: BroadsideSpawnEntry[];
  timeline: BroadsideSpawnEntry[];
};

type FlagshipOptions = {
  genEntries: BroadsideSpawnEntry[];
  coreEntries: BroadsideSpawnEntry[];
  fireBolt(context: BroadsideUpdate, from: Vector3, speed?: number): void;
};

export function createFlagshipEntries(): FlagshipEntries {
  const genEntries: BroadsideSpawnEntry[] = GEN_OFFSETS.map(([x, y], index) => ({
    time: bar(GEN_TIMES[index]),
    kind: 'shieldgen',
    hitPoints: 2,
    data: { role: 'shieldgen', lead: GEN_LEAD, x, y, index },
  }));
  const coreEntries: BroadsideSpawnEntry[] = CORE_OFFSETS.map(([x, y], index) => ({
    time: bar(CORE_TIMES[index]),
    kind: 'core',
    // Armor housing first, then the naked core — the stage break is the
    // moment the fins blow off.
    hitStages: [1, 1],
    lockable: false,
    data: { role: 'core', lead: CORE_LEAD, x, y, index },
  }));
  return { genEntries, coreEntries, timeline: [...genEntries, ...coreEntries] };
}

export function createFlagship(bus: EventBus, options: FlagshipOptions) {
  const boss = {
    genIds: new Set<number>(),
    gensSpawned: 0,
    gensKilled: 0,
    shieldDown: false,
    shieldDownByPlayer: false,
    coreIds: new Set<number>(),
    coresKilled: 0,
    destroyed: false,
    nextPdAt: -1,
  };

  bus.on('runstart', () => {
    boss.genIds.clear();
    boss.gensSpawned = 0;
    boss.gensKilled = 0;
    boss.shieldDown = false;
    boss.shieldDownByPlayer = false;
    boss.coreIds.clear();
    boss.coresKilled = 0;
    boss.destroyed = false;
    boss.nextPdAt = -1;
    for (const entry of options.coreEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'shieldgen') {
      boss.genIds.add(enemyId);
      boss.gensSpawned += 1;
    }
    if (kind === 'core') boss.coreIds.add(enemyId);
  });

  function dropShield(byPlayer: boolean) {
    if (boss.shieldDown) return;
    boss.shieldDown = true;
    boss.shieldDownByPlayer = byPlayer;
    for (const entry of options.coreEntries) entry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  }

  bus.on('kill', ({ enemyId }) => {
    if (boss.genIds.delete(enemyId)) {
      boss.gensKilled += 1;
      if (boss.gensKilled >= GEN_COUNT) dropShield(true);
    }
    if (boss.coreIds.delete(enemyId)) {
      boss.coresKilled += 1;
      if (boss.coresKilled >= CORE_COUNT && !boss.destroyed) {
        boss.destroyed = true;
        bus.emit('bossphase', { phase: 'destroyed' });
      }
    }
  });

  bus.on('miss', ({ enemyId }) => {
    boss.genIds.delete(enemyId);
    boss.coreIds.delete(enemyId);
  });

  function updateGen(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'shieldgen' }>) {
    const { enemy, runTime, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Mounted on a pylon off the hull face; a slow bob sells the mass.
    const bob = Math.sin(runTime * 1.6 + data.index * 2.1) * 0.5;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x, data.y + bob, 0)));
    enemy.mesh.rotation.y += 0.01;
    enemy.mesh.userData.armed = enemy.hitPointsRemaining;

    // Point defense: while any generator stands during the hull pass, the
    // face behind them spits interceptable fire on a steady cadence. It stops
    // a bar before the spine crossing so no bolt spawns behind the deck edge.
    if (runTime < BROADSIDE_MARKERS.around - bar(1.2) && age > 0.8) {
      if (boss.nextPdAt < 0) boss.nextPdAt = runTime + 1.1;
      if (runTime >= boss.nextPdAt) {
        boss.nextPdAt = runTime + PD_PERIOD;
        const jitterY = Math.sin(runTime * 17.3) * 7;
        const from = offsetFromRail(curve, Math.min(1, anchorU + 0.004), new Vector3(8, jitterY, 0));
        options.fireBolt(context, from, 7);
      }
    }
    return runProgress > anchorU + 0.012;
  }

  function updateCore(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'core' }>) {
    const { enemy, runTime, runProgress, curve, railAnchor } = context;
    if (!boss.shieldDown && runTime >= SHIELD_OVERLOAD_TIME) dropShield(false);
    const anchorU = railAnchor(data.lead);
    const pulse = Math.sin(runTime * 5 + data.index * 2.4) * 0.25;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x, data.y + pulse * 0.4, 0)));
    enemy.mesh.rotation.z += 0.02;
    enemy.mesh.userData.exposed = boss.shieldDown;
    enemy.mesh.userData.chargePulse = pulse;
    return runProgress > anchorU + 0.012;
  }

  return {
    updateGen,
    updateCore,
    destroyed: () => boss.destroyed,
    shieldDown: () => boss.shieldDown,
    shieldDownByPlayer: () => boss.shieldDownByPlayer,
    coresKilled: () => boss.coresKilled,
    gensKilled: () => boss.gensKilled,
    genSummaryLine() {
      if (boss.gensSpawned === 0) return undefined;
      if (boss.gensKilled >= GEN_COUNT) return 'Shield grid brought down by your guns';
      return `${boss.gensKilled}/${GEN_COUNT} shield generators destroyed`;
    },
    summaryLine() {
      if (boss.destroyed) return 'Flagship destroyed — the enemy line breaks';
      if (boss.coresKilled > 0) return `Flagship crippled: ${boss.coresKilled}/${CORE_COUNT} power cores destroyed`;
      return 'The flagship endured';
    },
  };
}

export type Flagship = ReturnType<typeof createFlagship>;
