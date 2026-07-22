import { MathUtils, Vector3 } from 'three';
import { hostileShotAimPoint } from '../../engine/hostile-shot';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { PURSE_TIME } from './timing';
import { PURSE_TUNING } from './tuning';
import { orientAlongRail } from './rider-motion';
import type { PurseSpawnEntry, PurseUpdate } from './gameplay-types';

const BAR = PURSE_TIME.barSeconds;
const LANES = PURSE_TUNING.enemies.laneOffsetsUnits;
const DECK = -PURSE_TUNING.road.cameraHeightUnits;

export type BossSpawnData = { role: 'boss' };

/**
 * The gang boss rides eight bars ahead of the run's end on a heavy bike with
 * your purse on a shoulder strap. It does not simply take damage: the fight is
 * an alternation of *windows*, where its chrome flank is exposed and lockable,
 * and *barrages*, where it drops back into your lane, goes untargetable, and
 * throws bombs and spike clusters onto the road for you to shoot down.
 *
 * Window and barrage boundaries are authored in bars from the boss's entrance,
 * so the fight breathes with the track rather than with the player's aim.
 */
type BossPhase = 'arrive' | 'window' | 'barrage';

type BossBeat = { at: number; phase: BossPhase };

// Bars from the boss entrance. Four exposure windows, three barrages between
// them, then the flank stays open so a slow player still gets their purse back.
const PHASES: readonly BossBeat[] = [
  { at: 0, phase: 'arrive' },
  { at: 0.48, phase: 'window' },
  { at: 1.5, phase: 'barrage' },
  { at: 2.5, phase: 'window' },
  { at: 4.0, phase: 'barrage' },
  { at: 5.0, phase: 'window' },
  { at: 6.25, phase: 'barrage' },
  { at: 7.0, phase: 'window' },
] as const;

// Bars from the boss entrance → what gets thrown, and into which lane.
type Throw = { at: number; kind: 'bomb' | 'spike'; lane: number };
const THROWS: readonly Throw[] = [
  { at: 1.62, kind: 'bomb', lane: 1 },
  { at: 2.12, kind: 'bomb', lane: 4 },
  { at: 4.12, kind: 'spike', lane: 0 },
  { at: 4.5, kind: 'spike', lane: 3 },
  { at: 4.87, kind: 'spike', lane: 5 },
  { at: 6.37, kind: 'bomb', lane: 2 },
  { at: 6.62, kind: 'spike', lane: 1 },
  { at: 6.87, kind: 'bomb', lane: 4 },
] as const;

type BossState = {
  thrown: number;
  phase: BossPhase;
  entered: boolean;
};

export type PurseBoss = ReturnType<typeof createPurseBoss>;

export function createPurseBoss(bus: EventBus, entranceTime: number) {
  // One mutable entry: `lockable` is read live every frame, so flipping it is
  // how the flank opens and closes. The engine reuses the timeline between
  // runs, so runstart puts it back.
  const entry: PurseSpawnEntry = {
    time: entranceTime,
    kind: 'boss',
    hitStages: [...PURSE_TUNING.boss.stageHitPoints],
    lockable: false,
    data: { role: 'boss' },
  };

  let bossId = -1;
  let stagesBroken = 0;
  let purseRecovered = false;

  bus.on('runstart', () => {
    entry.lockable = false;
    bossId = -1;
    stagesBroken = 0;
    purseRecovered = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'boss') return;
    bossId = enemyId;
    bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== bossId) return;
    stagesBroken += 1;
    bus.emit('bossphase', { phase: 'exposed' });
  });

  bus.on('kill', ({ enemyId }) => {
    if (enemyId !== bossId) return;
    purseRecovered = true;
    bus.emit('bossphase', { phase: 'destroyed' });
  });

  function phaseAt(age: number): BossPhase {
    const bars = age / BAR;
    let phase: BossPhase = 'arrive';
    for (const beat of PHASES) {
      if (bars >= beat.at) phase = beat.phase;
      else break;
    }
    return phase;
  }

  function entries(): PurseSpawnEntry[] {
    return [entry];
  }

  function update(context: PurseUpdate) {
    const { enemy, runTime, age, curve, camera, runProgress } = context;
    const state = context.enemyState<BossState>(() => ({ thrown: 0, phase: 'arrive', entered: false }));
    const phase = phaseAt(age);
    const railLength = curve.getLength();

    if (phase !== state.phase) {
      state.phase = phase;
    }
    entry.lockable = phase === 'window';

    // Standoff: it arrives out of the haze, then holds a fighting distance and
    // drops back into your face for each barrage.
    const arrival = MathUtils.clamp(age / (BAR * 0.48), 0, 1);
    const arriveEase = 1 - (1 - arrival) ** 3;
    const standoff = MathUtils.lerp(78, PURSE_TUNING.boss.standoffUnits, arriveEase);
    const pressure = phase === 'barrage' ? PURSE_TUNING.boss.chargeUnits : 0;
    const breathe = Math.sin(age * 1.1) * 2.2;
    const distanceAhead = Math.max(9, standoff - pressure + breathe);

    // The boss weaves the full width of the highway on a two-bar cycle, so the
    // player is always sweeping rather than parking the reticle.
    const weave = Math.sin(age * ((Math.PI * 2) / (BAR * 2)));
    const laneX = weave * 9.2 + Math.sin(age * 2.7) * 0.9;
    const rise = DECK + PURSE_TUNING.enemies.rideHeightUnits * PURSE_TUNING.boss.modelScale + Math.sin(age * 3.1) * 0.07;

    // Anchored to where the camera is *now*, not to the spawn point: the boss
    // holds station ahead of you for the whole fight instead of being passed.
    const anchorU = MathUtils.clamp(runProgress + distanceAhead / railLength, 0, 1);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(laneX, rise, 0)));

    orientAlongRail(enemy.mesh, curve, anchorU, weave * -0.42, weave * 0.2);

    const userData = enemy.mesh.userData;
    userData.bossPhase = phase;
    userData.bossLean = weave;
    userData.bossDamage = stagesBroken / PURSE_TUNING.boss.stageHitPoints.length;
    userData.bossSpeed = Math.abs(weave);

    // Barrage: bombs get lobbed at the windscreen, spike clusters get scattered
    // across the lanes. Both are lockable; neither counts against your clear.
    while (state.thrown < THROWS.length && age >= THROWS[state.thrown].at * BAR) {
      const shot = THROWS[state.thrown];
      state.thrown += 1;
      if (shot.kind === 'bomb') throwBomb(context, enemy.mesh.position, shot.lane);
      else scatterSpikes(context, anchorU, shot.lane);
    }

    // The boss never leaves under its own power; the run ending is its exit.
    void runTime;
    void camera;
    return false;
  }

  function throwBomb(context: PurseUpdate, from: Vector3, lane: number) {
    const origin = from.clone();
    origin.y += 0.9;
    const aim = hostileShotAimPoint(context.camera, origin);
    const launch = aim.sub(origin).normalize().multiplyScalar(4.2);
    launch.y += 3.4;
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bomb',
      countsTowardTotal: false,
      data: {
        role: 'bomb',
        position: origin,
        velocity: launch,
        lastAge: 0,
        spin: LANES[lane] ?? 0,
      },
    });
  }

  function scatterSpikes(context: PurseUpdate, bossAnchorU: number, lane: number) {
    context.spawnEnemy({
      time: context.runTime,
      kind: 'spike',
      countsTowardTotal: false,
      data: {
        role: 'spike',
        anchorU: bossAnchorU - 3 / context.curve.getLength(),
        lane: LANES[lane] ?? 0,
        drift: (lane % 2 === 0 ? 1 : -1) * 1.4,
      },
    });
  }

  /**
   * The chrome flank is the whole gate: the boss is only lockable inside an
   * exposure window, and `lockable` is read live, so no release-time rule is
   * needed to express it. Releases pass through untouched.
   */
  function summary() {
    if (purseRecovered) return `Purse recovered — ${stagesBroken}/${PURSE_TUNING.boss.stageHitPoints.length} plates off`;
    if (stagesBroken > 0) return `Purse gone — ${stagesBroken}/${PURSE_TUNING.boss.stageHitPoints.length} plates off`;
    return 'Purse gone';
  }

  return {
    entries,
    update,
    summary,
    get purseRecovered() {
      return purseRecovered;
    },
  };
}

