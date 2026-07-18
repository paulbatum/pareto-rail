import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { StrandlineData, StrandlineEntry, StrandlineUpdate } from './gameplay';
import { bar } from './timing';

// THE CROWN — the parent organism, dug into the socket where every strand
// roots into the bell.
//
// It never comes to you and it never leaves. What it does is breed: three
// broods, pumped out on the bar, each one riding a webbing umbilical back to
// the crown. While a brood lives it throws larvae into your frame; while its
// umbilical lives, the panel of webbing it feeds keeps the parent covered.
//
// Kill a brood → its panel withers → one third of the parent is bare.
// Kill all three → the parent has nothing left to hide behind, rears out of
// the socket, and can be torn loose in six locks.
//
// Leave a brood alive and the parent simply cannot be killed. That is the
// whole fight: the boss's health bar is somewhere else on the screen.

export const BROOD_COUNT = 3;
const BROOD_HIT_POINTS = 2;
const PARENT_STAGES = [3, 3];

const BROOD_ARRIVE_SECONDS = 2.2;
const BROOD_SPAWN_INTERVAL = 1.75;
const PARENT_REAR_SECONDS = 1.7;
/** How far out of the socket the parent hauls itself once it is bare. */
const PARENT_REAR_DISTANCE = 34;

/** Brood stations: spread wide and tall so the fight never sits in the middle. */
const BROOD_STATIONS: Array<{ x: number; y: number; at: number }> = [
  { x: -21, y: 7, at: bar(16.3) },
  { x: 22, y: -6, at: bar(17.8) },
  { x: -4, y: 16, at: bar(19.1) },
];

export type CrownOptions = {
  crownCenter: Vector3;
  spawnLarva: (context: StrandlineUpdate, index: number, side: number) => void;
  stationAhead: (runProgress: number, extra?: number) => number;
};

export type CrownController = {
  entries: StrandlineEntry[];
  updateBrood(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'brood' }>): boolean | void;
  updateParent(context: StrandlineUpdate): boolean | void;
  panelsRemaining(): number;
  parentKilled(): boolean;
  summaryLine(): string;
};

export function createCrown(bus: EventBus, options: CrownOptions): CrownController {
  const parentEntry: StrandlineEntry = {
    time: bar(16),
    kind: 'parent',
    hitStages: [...PARENT_STAGES],
    lockable: false,
    data: { role: 'parent' },
  };

  const broodEntries: StrandlineEntry[] = BROOD_STATIONS.map((station, slot) => ({
    time: station.at,
    kind: 'brood',
    hitPoints: BROOD_HIT_POINTS,
    data: { role: 'brood', slot, x: station.x, y: station.y },
  }));

  let broodsKilled = 0;
  let exposed = false;
  let exposedAt = -1;
  let parentDead = false;
  let parentId = -1;
  let larvaeBred = 0;

  const broodIds = new Set<number>();
  const scratch = new Vector3();
  const stationPoint = new Vector3();

  function reset() {
    broodsKilled = 0;
    exposed = false;
    exposedAt = -1;
    parentDead = false;
    parentId = -1;
    larvaeBred = 0;
    // The timeline is shared across runs; the gate has to be re-armed by hand.
    parentEntry.lockable = false;
  }

  reset();
  bus.on('runstart', reset);

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'brood') broodIds.add(enemyId);
    if (kind !== 'parent') return;
    parentId = enemyId;
    bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('kill', ({ enemyId }) => {
    if (enemyId === parentId) {
      parentDead = true;
      bus.emit('bossphase', { phase: 'destroyed' });
      return;
    }
    // A brood dying starves the panel of webbing it was feeding.
    if (!broodIds.delete(enemyId)) return;
    broodsKilled = Math.min(BROOD_COUNT, broodsKilled + 1);
  });

  bus.on('miss', ({ enemyId }) => {
    broodIds.delete(enemyId);
  });

  function panelsRemaining() {
    return Math.max(0, BROOD_COUNT - broodsKilled);
  }

  // ---- broods ------------------------------------------------------------------

  function updateBrood(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'brood' }>) {
    const { enemy, age, curve, runProgress, camera } = context;
    const state = context.enemyState(() => ({ nextBreed: BROOD_ARRIVE_SECONDS + 0.6, bred: 0 }));

    // The station rides ahead of the camera, so a brood you ignore keeps
    // breeding in your face instead of quietly falling behind.
    stationPoint.copy(offsetFromRail(curve, options.stationAhead(runProgress), scratch.set(data.x, data.y, 0)));

    if (age < BROOD_ARRIVE_SECONDS) {
      // Extruded from the crown: it is pushed out along its own umbilical.
      const k = age / BROOD_ARRIVE_SECONDS;
      const eased = k * k * (3 - 2 * k);
      // No scale trick: perspective does the growing, so the brood reads as
      // travelling toward you rather than inflating in place.
      enemy.mesh.position.copy(options.crownCenter).lerp(stationPoint, eased);
      enemy.mesh.userData.arriving = 1 - eased;
    } else {
      const settled = age - BROOD_ARRIVE_SECONDS;
      enemy.mesh.position.copy(stationPoint);
      enemy.mesh.position.y += Math.sin(settled * 1.5 + data.slot) * 1.1;
      enemy.mesh.position.x += Math.cos(settled * 1.1 + data.slot * 2) * 0.9;
      enemy.mesh.userData.arriving = 0;

      if (age >= state.nextBreed) {
        state.nextBreed = age + BROOD_SPAWN_INTERVAL;
        options.spawnLarva(context, larvaeBred, state.bred % 2 === 0 ? -1 : 1);
        state.bred += 1;
        larvaeBred += 1;
        enemy.mesh.userData.contraction = 1;
      }
    }

    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 0.8 + data.slot * 1.9) * 0.22);
    // The visual layer draws the umbilical from here back into the crown.
    enemy.mesh.userData.tetherTo = options.crownCenter;
    enemy.mesh.userData.pulse = age;
    enemy.mesh.userData.breedIn = Math.max(0, state.nextBreed - age);
    return false;
  }

  // ---- the parent ---------------------------------------------------------------

  function updateParent(context: StrandlineUpdate) {
    const { enemy, age, runTime, camera } = context;

    if (!exposed && panelsRemaining() === 0) {
      exposed = true;
      exposedAt = runTime;
      parentEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }

    const rear = exposed ? MathUtils.clamp((runTime - exposedAt) / PARENT_REAR_SECONDS, 0, 1) : 0;
    const eased = rear * rear * (3 - 2 * rear);

    // Bare, it hauls itself part-way out of the socket toward you — the same
    // motion the clings make, at forty times the size.
    scratch.copy(camera.position).sub(options.crownCenter);
    const reach = scratch.lengthSq() > 0.001 ? scratch.normalize() : scratch.set(0, 0, 1);
    enemy.mesh.position.copy(options.crownCenter).addScaledVector(reach, eased * PARENT_REAR_DISTANCE);

    // Idle it breathes with the animal; bare it thrashes.
    const agitation = 0.35 + eased * 1.9;
    enemy.mesh.position.x += Math.sin(age * (0.9 + eased * 3.4)) * agitation;
    enemy.mesh.position.y += Math.cos(age * (0.7 + eased * 2.8)) * agitation * 0.8;

    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 0.45) * 0.12 + eased * Math.sin(age * 6.5) * 0.1);

    enemy.mesh.userData.panelsRemaining = panelsRemaining();
    enemy.mesh.userData.exposedAmount = eased;
    enemy.mesh.userData.stageIndex = enemy.hitStageIndex;
    enemy.mesh.userData.pulse = age;
    return false;
  }

  return {
    entries: [parentEntry, ...broodEntries],
    updateBrood,
    updateParent,
    panelsRemaining,
    parentKilled: () => parentDead,
    summaryLine() {
      if (parentDead) return 'Parent torn loose — the colony is clean';
      if (panelsRemaining() === 0) return 'Parent bare but still rooted';
      const left = panelsRemaining();
      return `${left} webbing panel${left === 1 ? '' : 's'} still feeding the parent`;
    },
  };
}
