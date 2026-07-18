import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { BroadsideSpawnData, BroadsideSpawnEntry, BroadsideUpdate } from './gameplay';
import { bar } from './timing';

// The enemy flagship, in two passes.
//
// Phase 1 (bars 24–29): a close-range run along its hull. Four shield
// generators come up one by one to port while the point defense fills the
// space around the rail. Every generator must die for the shield to fall.
//
// Phase 2 (bars 31–35): the trench. Three exposed power cores sit in the
// trenchwork; they are shielded (unlockable) until the generators are gone.
// The last core's death breaks the flagship — and the enemy line with it.

const GENERATOR_TIMES = [24.3, 25.4, 26.5, 27.7];
const GENERATOR_OFFSETS: Array<[number, number]> = [[-9.5, 4.8], [-4.6, 6.8], [-8, -1.8], [-3.8, 1.4]];
const GENERATOR_LEAD = 3.0;

const CORE_SPAWNS: Array<{ atBar: number; lead: number; offset: [number, number] }> = [
  { atBar: 31.35, lead: 3.2, offset: [-4.2, 2.6] },
  { atBar: 32.25, lead: 3.0, offset: [4.4, 4.4] },
  { atBar: 33.1, lead: 2.8, offset: [0, 1.2] },
];

const PASS_MARGIN = 0.012;

export type FlagshipEntries = {
  generatorEntries: BroadsideSpawnEntry[];
  coreEntries: BroadsideSpawnEntry[];
  timeline: BroadsideSpawnEntry[];
};

export function createFlagshipEntries(): FlagshipEntries {
  const generatorEntries: BroadsideSpawnEntry[] = GENERATOR_TIMES.map((atBar, index) => ({
    time: bar(atBar),
    kind: 'shieldgen',
    hitPoints: 2,
    data: {
      role: 'shieldgen',
      lead: GENERATOR_LEAD,
      index,
      offset: new Vector3(GENERATOR_OFFSETS[index][0], GENERATOR_OFFSETS[index][1], 0),
    },
  }));
  const coreEntries: BroadsideSpawnEntry[] = CORE_SPAWNS.map((spawn, index) => ({
    time: bar(spawn.atBar),
    kind: 'core',
    hitPoints: 2,
    lockable: false, // read live: flips true the moment the shield falls
    data: { role: 'core', lead: spawn.lead, index, offset: new Vector3(spawn.offset[0], spawn.offset[1], 0) },
  }));
  return { generatorEntries, coreEntries, timeline: [...generatorEntries, ...coreEntries] };
}

type FlagshipOptions = {
  entries: FlagshipEntries;
  fireBolt(context: BroadsideUpdate, from: Vector3, heavy: boolean): void;
};

export function createFlagship(bus: EventBus, options: FlagshipOptions) {
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();
  const state = {
    summoned: false,
    generatorsKilled: 0,
    generatorsMissed: 0,
    shieldDown: false,
    coresKilled: 0,
    destroyed: false,
  };

  bus.on('runstart', () => {
    generatorIds.clear();
    coreIds.clear();
    state.summoned = false;
    state.generatorsKilled = 0;
    state.generatorsMissed = 0;
    state.shieldDown = false;
    state.coresKilled = 0;
    state.destroyed = false;
    for (const entry of options.entries.coreEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'shieldgen') {
      generatorIds.add(enemyId);
      if (!state.summoned) {
        state.summoned = true;
        bus.emit('bossphase', { phase: 'summoned' });
      }
    }
    if (kind === 'core') coreIds.add(enemyId);
  });

  const generatorGone = (enemyId: number, killed: boolean) => {
    if (!generatorIds.delete(enemyId)) return;
    if (killed) state.generatorsKilled += 1;
    else state.generatorsMissed += 1;
    if (state.generatorsKilled === GENERATOR_TIMES.length && !state.shieldDown) {
      state.shieldDown = true;
      for (const entry of options.entries.coreEntries) entry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    generatorGone(enemyId, true);
    if (coreIds.delete(enemyId)) {
      state.coresKilled += 1;
      if (state.coresKilled === CORE_SPAWNS.length) {
        state.destroyed = true;
        bus.emit('bossphase', { phase: 'destroyed' });
      }
    }
  });

  bus.on('miss', ({ enemyId }) => {
    generatorGone(enemyId, false);
    coreIds.delete(enemyId);
  });

  // Generators ride the flagship hull to port: a heavy dome on a pylon,
  // holding formation with the ship while the dome's emitter tracks the rail.
  function updateShieldGenerator(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'shieldgen' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.y += Math.sin(age * 0.9 + data.index * 2.1) * 0.35;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.6 + data.index) * 0.12);

    // Point defense: each living generator throws heavy flak on its own clock.
    const fire = context.enemyState(() => ({ nextAt: 0.7 + data.index * 0.4 }));
    if (age >= fire.nextAt) {
      fire.nextAt = age + 1.8;
      options.fireBolt(context, enemy.mesh.position, true);
    }
    // Housing cracked (1 HP left): the dome arcs and stutters.
    if (enemy.hitPointsRemaining === 1) {
      enemy.mesh.position.x += Math.sin(age * 27) * 0.09;
      enemy.mesh.position.y += Math.cos(age * 21) * 0.08;
    }
    return runProgress > anchorU + PASS_MARGIN;
  }

  // Cores sit in the trench floor structure, venting. While the shield is up
  // they read caged; the cage opens the moment it falls.
  function updateCore(context: BroadsideUpdate, data: Extract<BroadsideSpawnData, { role: 'core' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.y += Math.sin(age * 1.4 + data.index * 1.8) * 0.25;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 0.5 * (data.index % 2 === 0 ? 1 : -1));
    enemy.mesh.userData.caged = !state.shieldDown;
    // Casing cracked: the exposed column strobes hard.
    if (enemy.hitPointsRemaining === 1) {
      enemy.mesh.position.x += Math.sin(age * 25) * 0.11;
      enemy.mesh.position.y += Math.cos(age * 18) * 0.1;
    }
    return runProgress > anchorU + MathUtils.clamp(PASS_MARGIN, 0, 1);
  }

  return {
    updateShieldGenerator,
    updateCore,
    shieldDown: () => state.shieldDown,
    destroyed: () => state.destroyed,
    generatorsKilled: () => state.generatorsKilled,
    coresKilled: () => state.coresKilled,
    summaryLine() {
      if (!state.summoned) return undefined;
      if (state.destroyed) return 'Enemy flagship destroyed — the line breaks';
      if (state.shieldDown) return `Shield down, ${state.coresKilled}/3 cores burned — the flagship limps on`;
      return `${state.generatorsKilled}/4 shield generators down — the flagship holds`;
    },
  };
}

export type Flagship = ReturnType<typeof createFlagship>;
export const FLAGSHIP_GENERATOR_COUNT = GENERATOR_TIMES.length;
export const FLAGSHIP_CORE_COUNT = CORE_SPAWNS.length;
