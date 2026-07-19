import type { EventBus } from '../../events';
import type { BroadsideSpawnEntry } from './gameplay';

// The enemy flagship, in two phases. Phase 1 mounts four shield generators on
// the port flank; each is killed or survives as the rail passes it. When all
// four are destroyed the shield falls — otherwise the trench's power cores
// spawn armored (+1 HP each) behind the auxiliary grid. Phase 2 is the trench
// dive: killing all three cores breaks the flagship.

export type FlagshipHooks = {
  onShieldOutcome?(shieldDown: boolean, survivingGenerators: number): void;
  onFlagshipDestroyed?(): void;
};

export type Flagship = {
  registerGenerators(entries: BroadsideSpawnEntry[]): void;
  registerCores(entries: BroadsideSpawnEntry[]): void;
  shieldDown(): boolean;
  destroyed(): boolean;
  summaryLines(): string[];
};

export function createFlagship(bus: EventBus, hooks: FlagshipHooks = {}): Flagship {
  let genEntries: BroadsideSpawnEntry[] = [];
  let coreEntries: BroadsideSpawnEntry[] = [];
  let coreBaseStages: number[][] = [];
  let genIds = new Set<number>();
  let coreIds = new Set<number>();
  let gensResolved = 0;
  let gensKilled = 0;
  let coresKilled = 0;
  let shieldOutcomeFired = false;
  let isShieldDown = false;
  let isDestroyed = false;

  function resolveShieldOutcome() {
    if (shieldOutcomeFired || gensResolved < genEntries.length || genEntries.length === 0) return;
    shieldOutcomeFired = true;
    isShieldDown = gensKilled === genEntries.length;
    if (!isShieldDown) {
      const surviving = genEntries.length - gensKilled;
      for (const entry of coreEntries) entry.hitStages = [coreBaseStages[0][0] + 1];
      hooks.onShieldOutcome?.(false, surviving);
    } else {
      hooks.onShieldOutcome?.(true, 0);
    }
  }

  bus.on('runstart', () => {
    genIds = new Set();
    coreIds = new Set();
    gensResolved = 0;
    gensKilled = 0;
    coresKilled = 0;
    shieldOutcomeFired = false;
    isShieldDown = false;
    isDestroyed = false;
    for (const [index, entry] of coreEntries.entries()) entry.hitStages = [...(coreBaseStages[index] ?? [2])];
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'gen') genIds.add(enemyId);
    if (kind === 'core') coreIds.add(enemyId);
  });

  const onGenGone = (enemyId: number, killed: boolean) => {
    if (!genIds.delete(enemyId)) return;
    gensResolved += 1;
    if (killed) gensKilled += 1;
    resolveShieldOutcome();
  };

  bus.on('kill', ({ enemyId }) => {
    onGenGone(enemyId, true);
    if (coreIds.delete(enemyId)) {
      coresKilled += 1;
      if (coresKilled === coreEntries.length && coreEntries.length > 0 && !isDestroyed) {
        isDestroyed = true;
        hooks.onFlagshipDestroyed?.();
      }
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onGenGone(enemyId, false);
    coreIds.delete(enemyId);
  });

  return {
    registerGenerators(entries) {
      genEntries = entries;
    },
    registerCores(entries) {
      coreEntries = entries;
      coreBaseStages = entries.map((entry) => [...(entry.hitStages ?? [2])]);
    },
    shieldDown: () => isShieldDown,
    destroyed: () => isDestroyed,
    summaryLines() {
      const lines: string[] = [];
      if (shieldOutcomeFired) lines.push(isShieldDown ? 'Shields dropped' : 'Auxiliary shields held');
      if (isDestroyed) lines.push('Enemy flagship destroyed');
      else if (coresKilled > 0) lines.push('Flagship wounded — it limps away');
      return lines;
    },
  };
}
