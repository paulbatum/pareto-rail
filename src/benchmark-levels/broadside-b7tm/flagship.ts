import { MathUtils } from 'three';
import type { EventBus } from '../../events';
import type {
  BroadsidePublicEnemy,
  BroadsideSeat,
  BroadsideSpawnData,
  BroadsideSpawnEntry,
  BroadsideUpdate,
} from './gameplay';
import { bar } from './timing';

// THE ENEMY FLAGSHIP, in two passes.
//
// Pass one (bars 23–28): you run the length of its dorsal spine with the hull
// sliding past beneath you. Six shield generators stand up off that spine on
// pylons — deliberately alternating low and high so clearing them is a sweep of
// the whole frame, not a row of targets in one corner. Each takes two locks;
// each answers with point defence.
//
// Pass two (bars 30–34): the rail comes back down into the trenchwork cut into
// the same spine, where three power cores sit behind armor. The cores are
// lockable at all times — but while the shield holds, the release is eaten at
// the shield wall and the frame flares where the volley should have landed.
// Clearing all six generators is the only way to make the trench mean anything.

export const GENERATOR_COUNT = 6;
export const CORE_COUNT = 3;

// (bar, rail-relative x, rail-relative y). The pylons alternate short and tall
// so the six of them draw a zigzag across the whole screen as they come.
const GENERATOR_POSTS: Array<readonly [number, number, number]> = [
  [23.2, -24, -9],
  [23.9, 17, 4],
  [24.6, -7, -12],
  [25.3, 26, 8],
  [26.0, 8, -7],
  [26.6, -21, 6],
];
const GENERATOR_LEAD = 3.6;

// (bar, lead, rail-relative x, rail-relative y): three cores down the trench,
// the last one arriving exactly on the pull-out deadline.
const CORE_POSTS: Array<readonly [number, number, number, number]> = [
  [30.4, 3.5, -16, 3],
  [31.5, 3.5, 15, -6],
  [32.6, 3.1, 0, 10],
];

/** Matches gameplay's pass margin: about six units of grace behind the camera. */
const PASS_MARGIN = 0.0035;

/** Authored boss spawns. Module-level so the timeline is inspectable without a run. */
export const FLAGSHIP_SPAWN_ENTRIES: BroadsideSpawnEntry[] = [
  ...GENERATOR_POSTS.map(([atBar, x, y], index): BroadsideSpawnEntry => ({
    time: bar(atBar),
    kind: 'generator',
    hitPoints: 2,
    data: { role: 'generator', index, lead: GENERATOR_LEAD, x, y },
  })),
  ...CORE_POSTS.map(([atBar, lead, x, y], index): BroadsideSpawnEntry => ({
    time: bar(atBar),
    kind: 'core',
    hitStages: [2, 2],
    data: { role: 'core', index, lead, x, y },
  })),
];

export function createFlagship(bus: EventBus) {
  const generatorIds = new Set<number>();
  const coreIds = new Set<number>();
  let generatorsDestroyed = 0;
  let generatorsResolved = 0;
  let coresDestroyed = 0;
  let shieldFell = false;
  let announcedApproach = false;

  function resolveGenerator() {
    generatorsResolved += 1;
    if (generatorsResolved < GENERATOR_COUNT || shieldFell) return;
    if (generatorsDestroyed >= GENERATOR_COUNT) {
      shieldFell = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  }

  bus.on('runstart', () => {
    generatorIds.clear();
    coreIds.clear();
    generatorsDestroyed = 0;
    generatorsResolved = 0;
    coresDestroyed = 0;
    shieldFell = false;
    announcedApproach = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'generator') {
      generatorIds.add(enemyId);
      if (!announcedApproach) {
        announcedApproach = true;
        bus.emit('bossphase', { phase: 'summoned' });
      }
    } else if (kind === 'core') {
      coreIds.add(enemyId);
    }
  });

  bus.on('kill', ({ enemyId }) => {
    if (generatorIds.delete(enemyId)) {
      generatorsDestroyed += 1;
      resolveGenerator();
      return;
    }
    if (!coreIds.delete(enemyId)) return;
    coresDestroyed += 1;
    if (coresDestroyed >= CORE_COUNT) bus.emit('bossphase', { phase: 'destroyed' });
  });

  bus.on('miss', ({ enemyId }) => {
    if (generatorIds.delete(enemyId)) resolveGenerator();
    else coreIds.delete(enemyId);
  });

  // The shield eats a release aimed at the cores. Visuals and audio read this
  // through the engine's own `shielded` event, so the block has its own
  // language rather than borrowing the generic rejection.
  function reportShieldBlock(blocked: BroadsidePublicEnemy[], released: BroadsidePublicEnemy[]) {
    bus.emit('shielded', {
      shields: blocked.map((enemy) => ({ enemyId: enemy.id, worldPosition: enemy.mesh.position.clone() })),
      blockedEnemyIds: released.map((enemy) => enemy.id),
    });
  }

  // Generators: bolted to the spine, swaying with the hull's slow roll, their
  // containment ring spinning faster the closer they are to going up.
  function updateGenerator(
    context: BroadsideUpdate,
    data: Extract<BroadsideSpawnData, { role: 'generator' }>,
    seat: BroadsideSeat,
  ) {
    const { enemy, runProgress, age, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const state = context.enemyState(() => ({ surgeFrom: 0.8 + data.index * 0.17, spin: 0, lastAge: 0 }));

    const sway = Math.sin(age * 0.9 + data.index) * 0.5;
    enemy.mesh.position.copy(seat(context, anchorU, data.x + sway, data.y, 0));
    enemy.mesh.lookAt(camera.position);

    // The containment ring spins up when the node is one hit from going: the
    // rate changes, so it has to integrate rather than read off age.
    const damaged = enemy.stageHitPointsRemaining <= 1;
    state.spin += (damaged ? 7.5 : 3.1) * Math.max(0, age - state.lastAge);
    state.lastAge = age;
    enemy.mesh.userData.strain = damaged ? 1 : 0;
    enemy.mesh.userData.spin = state.spin;

    // The flagship's point defence is the environment's business — streams of
    // tracer thrown up past the canopy — so the generators themselves never
    // launch a lockable round. What they do is surge: the ring brightens on a
    // cycle, and that is the tell that it is about to blow.
    const surge = (age - state.surgeFrom) % 1.5;
    enemy.mesh.userData.charge = age < state.surgeFrom ? 0 : Math.max(0, 1 - Math.abs(surge - 0.2) / 0.5);
    return runProgress > anchorU + PASS_MARGIN;
  }

  // Cores: sunk into the trench wall behind two armor shells. Once the armor is
  // off, the exposed core beats — and it is the only thing left worth shooting.
  function updateCore(
    context: BroadsideUpdate,
    data: Extract<BroadsideSpawnData, { role: 'core' }>,
    seat: BroadsideSeat,
  ) {
    const { enemy, runProgress, age, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    enemy.mesh.position.copy(seat(context, anchorU, data.x, data.y, 0));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.userData.exposed = enemy.hitStageIndex > 0;
    enemy.mesh.userData.shielded = !shieldFell;
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(age * (enemy.hitStageIndex > 0 ? 9 : 3.4));
    enemy.mesh.userData.spin = MathUtils.euclideanModulo(age * 0.8, Math.PI * 2);
    return runProgress > anchorU + PASS_MARGIN;
  }

  function summaryLines() {
    const lines: string[] = [];
    lines.push(`Shield generators ${generatorsDestroyed}/${GENERATOR_COUNT}`);
    if (coresDestroyed >= CORE_COUNT) lines.push('Enemy flagship destroyed — the line breaks');
    else if (shieldFell) lines.push(`Flagship cores ${coresDestroyed}/${CORE_COUNT} — it holds together`);
    else lines.push('Flagship shield never fell');
    return lines;
  }

  return {
    updateGenerator,
    updateCore,
    reportShieldBlock,
    shieldDown: () => shieldFell,
    flagshipDestroyed: () => coresDestroyed >= CORE_COUNT,
    generatorsDown: () => generatorsDestroyed,
    coresDown: () => coresDestroyed,
    summaryLines,
  };
}
