import { Vector3, type CatmullRomCurve3 } from 'three';
import type { EventBus } from '../../events';
import { FLAGSHIP_TIME, SCREEN_TIME, TRENCH_TIME, bar } from './timing';
import { SOVEREIGN } from './gameplay';
import type { BroadsideSpawnData, BroadsideSpawnEntry, BroadsideUpdate } from './gameplay';

// The enemy flagship SOVEREIGN, in two phases. Phase one is a close pass down
// her port flank: three shield generators ride the hull while her point
// defense fills the space around you. Kill all three and the shield dome
// falls; her escorts pour from the bays while the rail swings around her
// stern. Phase two is the trench dive along her spine: two power nodes gate
// the core at her heart — but nothing in the trench is targetable until the
// shield is down. Kill the core and the line breaks.
//
// The boss brain is a non-target 'shieldDome' enemy whose mesh IS the shield
// bubble: it drives point-defense fire and carries shield state to visuals
// through its userData.

const PD_PERIOD_START = 1.35;
const PD_PERIOD_END = 0.85;
const PD_STOP_TIME = SCREEN_TIME + bar(0.5);

type FlagshipEntries = {
  domeEntry: BroadsideSpawnEntry;
  generatorEntries: BroadsideSpawnEntry[];
  nodeEntries: BroadsideSpawnEntry[];
  coreEntry: BroadsideSpawnEntry;
  timeline: BroadsideSpawnEntry[];
};

export function createFlagshipEntries(
  curve: CatmullRomCurve3,
  _railU: (time: number) => number,
  approachTime: (curve: CatmullRomCurve3, point: Vector3) => number,
): FlagshipEntries {
  const domeEntry: BroadsideSpawnEntry = {
    // The dome paints up as the rail completes the cut to her flank: any
    // earlier and the bow hides its anchor point from the belly camera.
    time: FLAGSHIP_TIME + bar(0.7),
    kind: 'shieldDome',
    lockable: false,
    countsTowardTotal: false,
    data: { role: 'shieldDome' },
  };
  // Generators paint up as the cut to the flank completes: the bow hull
  // genuinely hides them from the belly approach, so spawning earlier would
  // only park invisible targets on the board. 1HP each — one clean volley
  // pops a generator; the staging lives in there being three of them, spread
  // along the pass, under PD fire.
  const generatorEntries: BroadsideSpawnEntry[] = SOVEREIGN.generatorPositions.map((position, index) => ({
    time: FLAGSHIP_TIME - bar(0.22) + index * 0.5,
    kind: 'generator',
    hitPoints: 1,
    data: {
      role: 'generator' as const,
      position: position.clone(),
      seatTime: approachTime(curve, position),
      index,
    },
  }));
  // Nodes and the core paint up as the rail crests her aft deck — by then
  // the spine is in view; until the shield falls they are scenery with a
  // lockout, then targets on the dive.
  const nodeEntries: BroadsideSpawnEntry[] = SOVEREIGN.nodePositions.map((position, index) => ({
    time: SCREEN_TIME + bar(1.2) + index * 0.4,
    kind: 'node',
    hitPoints: 1,
    lockable: false,
    data: {
      role: 'node' as const,
      position: position.clone(),
      seatTime: approachTime(curve, position),
      index,
    },
  }));
  // One clean shot into her heart ends it — the trench-run fantasy. The
  // staging lives in the generators and nodes; the core is the single
  // killing blow, and the finale lands on its kill event.
  const coreEntry: BroadsideSpawnEntry = {
    // Paints up as the crest straightens: far enough along that the sightline
    // down the genuine cut no longer threads the trench wall's aft face.
    time: SCREEN_TIME + bar(1.0),
    kind: 'core',
    hitPoints: 1,
    lockable: false,
    data: {
      role: 'core' as const,
      position: SOVEREIGN.corePosition.clone(),
      seatTime: approachTime(curve, SOVEREIGN.corePosition),
    },
  };
  return {
    domeEntry,
    generatorEntries,
    nodeEntries,
    coreEntry,
    timeline: [domeEntry, ...generatorEntries, ...nodeEntries, coreEntry],
  };
}

type FlagshipOptions = {
  curve: CatmullRomCurve3;
  entries: FlagshipEntries;
  fireBolt(context: BroadsideUpdate, from: Vector3, speed?: number): void;
};

export function createFlagship(bus: EventBus, options: FlagshipOptions) {
  const boss = {
    shieldDown: false,
    shieldDownAt: -1,
    coreKilled: false,
    generatorsRemaining: 3,
    generatorIds: new Set<number>(),
    nodeIds: new Set<number>(),
    coreId: -1,
    domeId: -1,
    nextPdAt: -1,
    pdMount: 0,
  };

  bus.on('runstart', () => {
    boss.shieldDown = false;
    boss.shieldDownAt = -1;
    boss.coreKilled = false;
    boss.generatorsRemaining = 3;
    boss.generatorIds.clear();
    boss.nodeIds.clear();
    boss.coreId = -1;
    boss.domeId = -1;
    boss.nextPdAt = -1;
    boss.pdMount = 0;
    for (const entry of options.entries.nodeEntries) entry.lockable = false;
    options.entries.coreEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'shieldDome') boss.domeId = enemyId;
    if (kind === 'generator') boss.generatorIds.add(enemyId);
    if (kind === 'node') boss.nodeIds.add(enemyId);
    if (kind === 'core') boss.coreId = enemyId;
  });

  const dropShield = () => {
    if (boss.shieldDown) return;
    boss.shieldDown = true;
    // Nodes unlock with the shield; the core's cradle holds its lockout until
    // the run commits to the dive (see updateCore in gameplay.ts).
    for (const entry of options.entries.nodeEntries) entry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  };

  bus.on('kill', ({ enemyId }) => {
    if (boss.generatorIds.delete(enemyId)) {
      boss.generatorsRemaining = Math.max(0, boss.generatorsRemaining - 1);
      if (boss.generatorsRemaining === 0) dropShield();
    }
    if (enemyId === boss.coreId) {
      boss.coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    // A generator that escapes astern still counts toward the shield: the
    // dome stays up and the trench stays locked out.
    boss.generatorIds.delete(enemyId);
  });

  function updateDome(context: BroadsideUpdate, _data: Extract<BroadsideSpawnData, { role: 'shieldDome' }>) {
    const { enemy, runTime } = context;
    // The mesh origin rides the occlusion anchor off her port flank; the
    // bubble shell child is counter-offset in the mesh factory so the shield
    // still wraps the hull.
    enemy.mesh.position.copy(SOVEREIGN.domeAnchor);
    enemy.mesh.userData.shieldStrength = boss.shieldDown ? 0 : boss.generatorsRemaining / 3;
    enemy.mesh.userData.shieldDown = boss.shieldDown;
    // The brain's work ends with the shield: let the collapse read, then
    // strike the dome (its anchor point would linger as a phantom target).
    if (boss.shieldDown) {
      if (boss.shieldDownAt < 0) boss.shieldDownAt = runTime;
      if (runTime >= boss.shieldDownAt + 1.4) return true;
    }

    // Point defense: crimson bolts off the port flank while the shield holds.
    // It spools up after the first generator is already in the sights.
    if (!boss.shieldDown && runTime >= FLAGSHIP_TIME + bar(1.1) && runTime <= PD_STOP_TIME) {
      if (boss.nextPdAt < 0) boss.nextPdAt = runTime + 0.8;
      if (runTime >= boss.nextPdAt) {
        const span = PD_STOP_TIME - FLAGSHIP_TIME;
        const pressure = Math.min(1, Math.max(0, (runTime - FLAGSHIP_TIME) / span));
        boss.nextPdAt = runTime + PD_PERIOD_START + (PD_PERIOD_END - PD_PERIOD_START) * pressure;
        const mount = SOVEREIGN.pdPositions[boss.pdMount % SOVEREIGN.pdPositions.length];
        boss.pdMount += 1;
        options.fireBolt(context, mount.clone(), 6.2);
      }
    }
    return false;
  }

  return {
    updateDome,
    shieldDown: () => boss.shieldDown,
    coreKilled: () => boss.coreKilled,
    generatorsRemaining: () => boss.generatorsRemaining,
    summaryLine() {
      if (boss.coreKilled) return 'SOVEREIGN broken — the enemy line is burning';
      if (boss.shieldDown) return 'SOVEREIGN held the line';
      return 'Her shields never fell';
    },
  };
}

export type Flagship = ReturnType<typeof createFlagship>;
