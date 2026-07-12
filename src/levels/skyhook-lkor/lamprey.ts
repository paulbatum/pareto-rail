import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { EventBus } from '../../events';
import { CAR_AHEAD_UNITS, TETHER_OFFSET_Y } from './timing';
import type { SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';

// THE LAMPREY — a segmented grinder-machine wrapped around the tether. It
// latches far up the line at bossClank (tiny, dead-centre on the vanishing
// point) and hauls itself hand-over-hand DOWN toward the car for the whole
// fight, so its scale-on-screen IS the fight timer. Three hit stages:
//
//   Stage 1 "arms"  — 4 hits; each blows a grapple pod and lurches it back up.
//   Stage 2 "mouth" — 4 hits; grinder petals flare open on the stage event.
//   Stage 3 "core"  — 6 hits; petals blown wide (bossphase 'exposed'), core bare.
//
// Kill it before it reaches the car at bossDeadline, or it tears the climber
// apart (full-hull damage, run ends died).

const BOSS_FAR_UNITS = 44; // distance up the tether where it first latches
const BOSS_CAR_UNITS = CAR_AHEAD_UNITS - 0.5; // where it arrives at deadline
const LURCH_UNITS = 6; // how far a hit visibly shoves it back up the tether
const LURCH_DECAY_SECONDS = 0.45;

type LampreyOptions = {
  bossEntry: SkyhookSpawnEntry;
  bossFightTime: number;
  deadlineTime: number;
  carAheadUnits: number;
  deltaUForUnits(curve: CatmullRomCurve3, units: number): number;
};

export function createSkyhookLampreyEntry(summonTime: number): SkyhookSpawnEntry {
  return {
    time: summonTime,
    kind: 'lamprey',
    hitStages: [4, 4, 6],
    lockable: false,
    data: { role: 'lamprey' },
  };
}

export function createSkyhookLamprey(bus: EventBus, options: LampreyOptions) {
  const { bossEntry, bossFightTime, deadlineTime } = options;
  const boss = {
    id: -1,
    summoned: false,
    killed: false,
    killTime: -1,
    lastRunTime: 0,
    exposed: false,
    deadlineFired: false,
    userData: { descent: 0, stageIndex: 0, exposed: false, lurch: 0 },
  };

  const reset = () => {
    boss.id = -1;
    boss.summoned = false;
    boss.killed = false;
    boss.killTime = -1;
    boss.lastRunTime = 0;
    boss.exposed = false;
    boss.deadlineFired = false;
    boss.userData = { descent: 0, stageIndex: 0, exposed: false, lurch: 0 };
    bossEntry.lockable = false; // sanctioned entry mutation, gates the boss phase
  };
  reset();
  bus.on('runstart', reset);

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'lamprey') return;
    boss.id = enemyId;
    boss.summoned = true;
    bus.emit('bossphase', { phase: 'summoned' });
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    if (enemyId !== boss.id) return;
    boss.userData.stageIndex = stageIndex;
    if (stageIndex >= 2 && !boss.exposed) {
      boss.exposed = true;
      boss.userData.exposed = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  });

  bus.on('kill', ({ enemyId }) => {
    if (enemyId !== boss.id || boss.killed) return;
    boss.killed = true;
    // The runner removes the boss right after this event, so the updater never
    // runs again — record the margin here off the last frame's run time.
    boss.killTime = boss.lastRunTime;
    bus.emit('bossphase', { phase: 'destroyed' });
  });

  function updateLamprey(context: SkyhookUpdate) {
    const { enemy, runTime, runProgress, curve, camera, damagePlayer } = context;
    boss.lastRunTime = runTime;

    // Open the lock gate once the boss is in range at bossFight.
    if (runTime >= bossFightTime) bossEntry.lockable = true;

    // A hit shoves it back up the tether, then it slides down and resumes — the
    // hit buys a beat without stopping the descent. Track the lurch off the
    // most recent hit stage/HP loss via hitStageIndex + remaining HP.
    const hitSignature = enemy.hitStageIndex * 100 + enemy.stageHitPointsRemaining;
    const st = context.enemyState(() => ({ lastSignature: hitSignature, lurchAt: -Infinity }));
    if (hitSignature !== st.lastSignature) {
      st.lastSignature = hitSignature;
      st.lurchAt = runTime;
    }
    const lurch = Math.exp(-(runTime - st.lurchAt) / LURCH_DECAY_SECONDS);
    const lurchUnits = Number.isFinite(st.lurchAt) ? LURCH_UNITS * lurch : 0;
    boss.userData.lurch = Number.isFinite(st.lurchAt) ? lurch : 0;

    // Descent is time-driven: 0 at summon → 1 at the deadline (the car). Ease it
    // so the approach accelerates ominously.
    const baseDescent = MathUtils.clamp((runTime - bossEntry.time) / (deadlineTime - bossEntry.time), 0, 1);
    const descentEased = baseDescent * baseDescent * (3 - 2 * baseDescent);
    boss.userData.descent = baseDescent;
    boss.userData.stageIndex = enemy.hitStageIndex;
    boss.userData.exposed = enemy.hitStageIndex >= 2;

    const aheadUnits = MathUtils.lerp(BOSS_FAR_UNITS, BOSS_CAR_UNITS, descentEased) + lurchUnits;
    const uBoss = MathUtils.clamp(runProgress + options.deltaUForUnits(curve, aheadUnits), 0, 1);
    // Ride the tether line, a hair above it so it reads and never hides behind the car.
    enemy.mesh.position.copy(offsetFromRail(curve, uBoss, new Vector3(0, TETHER_OFFSET_Y + 1, 0)));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.6) * 0.12);
    enemy.mesh.userData.lamprey = boss.userData;

    // Deadline: if it reaches the car alive, it tears the climber apart.
    if (!boss.killed && !boss.deadlineFired && runTime >= deadlineTime) {
      boss.deadlineFired = true;
      damagePlayer(4);
    }
    return false;
  }

  return {
    updateLamprey,
    isKilled: () => boss.killed,
    reachedCar: () => boss.deadlineFired && !boss.killed,
    marginSeconds: () => Math.max(0, deadlineTime - (boss.killTime < 0 ? deadlineTime : boss.killTime)),
    summoned: () => boss.summoned,
  };
}

export type SkyhookLamprey = ReturnType<typeof createSkyhookLamprey>;
