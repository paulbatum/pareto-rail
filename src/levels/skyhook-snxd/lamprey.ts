import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import { BREACH_TIME, DOCK_TIME } from './timing';
import type { SkyhookSpawnData, SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';

// The Lamprey: a salvage-breaker the size of a house that slams onto the
// tether far overhead and hauls itself down toward the climber, hand over
// hand. The whole fight is one readable number — the gap between its maw and
// the car — and every phase reads off it: claws come into lock range, the
// core bares itself, and if the gap ever reaches zero it starts tearing the
// climber apart.

// Sockets hug the maw's face: at claw-engage range the whole grip cluster
// sits inside one lock sweep centred on the head.
const CLAW_SOCKETS: Array<[number, number]> = [[-5.2, 2.2], [5.2, 2.2], [0, -4.4]];
const CLAW_LOCK_RANGE = 108; // camera-to-maw distance where the claws become targets
const REACH_GAP = 8.5; // metres of tether left when it is "on the car"
const TEAR_PERIOD = 1.8;
const FLINCH_SECONDS = 1.6;
const BOLT_PERIOD = 5.2;

type LampreyEntries = {
  mawEntry: SkyhookSpawnEntry;
  clawEntries: SkyhookSpawnEntry[];
  timeline: SkyhookSpawnEntry[];
};

type LampreyOptions = {
  mawEntry: SkyhookSpawnEntry;
  clawEntries: SkyhookSpawnEntry[];
  tetherPoint(s: number, out: Vector3): Vector3;
  climbDistance(position: Vector3): number;
  frameRight: Vector3;
  frameUp: Vector3;
  spawnBossBolt(context: SkyhookUpdate, from: Vector3): void;
};

export function createLampreyEntries(time: number): LampreyEntries {
  const mawEntry: SkyhookSpawnEntry = {
    time,
    kind: 'maw',
    hitStages: [3, 3],
    lockable: false,
    data: { role: 'maw' },
  };
  const clawEntries: SkyhookSpawnEntry[] = CLAW_SOCKETS.map((_socket, index) => ({
    time: time + 0.12 + index * 0.1,
    kind: 'claw',
    hitPoints: 2,
    lockable: false,
    data: { role: 'claw', socket: index },
  }));
  return { mawEntry, clawEntries, timeline: [mawEntry, ...clawEntries] };
}

export function createLamprey(bus: EventBus, options: LampreyOptions) {
  const boss = {
    mawId: -1,
    mawSpawned: false,
    mawKilled: false,
    killedAtGap: -1,
    exposed: false,
    reached: false,
    flinchUntil: -1,
    pausedTotal: 0,
    lastRunTime: -1,
    nextTearAt: -1,
    nextBoltAt: -1,
    clawIds: new Set<number>(),
    clawsInRange: false,
    mawPosition: new Vector3(),
    gap: 170,
  };

  bus.on('runstart', () => {
    boss.mawId = -1;
    boss.mawSpawned = false;
    boss.mawKilled = false;
    boss.killedAtGap = -1;
    boss.exposed = false;
    boss.reached = false;
    boss.flinchUntil = -1;
    boss.pausedTotal = 0;
    boss.lastRunTime = -1;
    boss.nextTearAt = -1;
    boss.nextBoltAt = -1;
    boss.clawIds.clear();
    boss.clawsInRange = false;
    boss.gap = 170;
    options.mawEntry.lockable = false;
    for (const entry of options.clawEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'claw') boss.clawIds.add(enemyId);
    if (kind === 'maw') {
      boss.mawSpawned = true;
      boss.mawId = enemyId;
    }
  });

  const onClawGone = (enemyId: number) => {
    if (!boss.clawIds.delete(enemyId)) return;
    if (boss.clawIds.size === 0 && boss.mawSpawned && !boss.exposed) {
      boss.exposed = true;
      if (boss.flinchUntil < boss.lastRunTime) options.mawEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onClawGone(enemyId);
    if (enemyId === boss.mawId) {
      boss.mawKilled = true;
      boss.killedAtGap = boss.gap;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onClawGone(enemyId);
  });

  // Stage break: the maw loses its grip, slews sideways, and hangs unlockable
  // for a breath — then comes on again. Descent pauses while it recovers.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== boss.mawId) return;
    boss.flinchUntil = boss.lastRunTime + FLINCH_SECONDS;
    options.mawEntry.lockable = false;
  });

  function descentGap(runTime: number, dt: number) {
    const flinching = boss.flinchUntil > runTime;
    if (flinching) boss.pausedTotal += dt;
    const span = DOCK_TIME - BREACH_TIME;
    const effective = MathUtils.clamp(runTime - BREACH_TIME - boss.pausedTotal, 0, span);
    const p = effective / span;
    return REACH_GAP + (170 - REACH_GAP) * (1 - p) ** 1.7;
  }

  function updateMaw(context: SkyhookUpdate, _data: Extract<SkyhookSpawnData, { role: 'maw' }>) {
    const { enemy, runTime, camera, damagePlayer } = context;
    const dt = boss.lastRunTime < 0 ? 0 : Math.max(0, runTime - boss.lastRunTime);
    boss.lastRunTime = runTime;
    const flinching = boss.flinchUntil > runTime;

    if (!boss.mawKilled) boss.gap = descentGap(runTime, dt);
    const carS = options.climbDistance(camera.position) + 22;
    const s = carS + boss.gap;

    // Hand-over-hand: the whole body ratchets as it climbs, and the loose-grip
    // flinch lets it swing wide of the ribbon.
    const ratchet = Math.sin(runTime * 2.1) * Math.min(2.2, boss.gap * 0.02);
    const swing = flinching ? Math.sin(runTime * 3.4) * 3.2 : Math.sin(runTime * 0.7) * 0.9;
    options.tetherPoint(s + ratchet, enemy.mesh.position);
    enemy.mesh.position
      .addScaledVector(options.frameRight, swing)
      .addScaledVector(options.frameUp, Math.sin(runTime * 1.1) * 0.7);
    boss.mawPosition.copy(enemy.mesh.position);

    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.6) * 0.12 + (flinching ? Math.sin(runTime * 5) * 0.2 : 0));
    enemy.mesh.userData.exposed = boss.exposed && !flinching && !boss.mawKilled;
    enemy.mesh.userData.flinching = flinching;
    enemy.mesh.userData.gap = boss.gap;

    // Claws enter lock range as it closes; the maw re-arms after a flinch.
    if (!boss.clawsInRange && camera.position.distanceTo(enemy.mesh.position) < CLAW_LOCK_RANGE) {
      boss.clawsInRange = true;
      for (const entry of options.clawEntries) entry.lockable = true;
    }
    if (boss.exposed && !flinching && !boss.mawKilled) options.mawEntry.lockable = true;

    // On the car: rhythmic tearing until it dies or the climber does.
    if (!boss.mawKilled && boss.gap <= REACH_GAP + 0.5) {
      if (!boss.reached) {
        boss.reached = true;
        boss.nextTearAt = runTime + 0.9;
        bus.emit('bossphase', { phase: 'summoned' });
      }
      if (runTime >= boss.nextTearAt) {
        boss.nextTearAt = runTime + TEAR_PERIOD;
        damagePlayer(1);
      }
    }

    // Debris hurled down the tether once it is close enough to matter.
    if (!boss.mawKilled && !flinching && boss.gap < 145) {
      if (boss.nextBoltAt < 0) boss.nextBoltAt = runTime + 2.2;
      if (runTime >= boss.nextBoltAt) {
        boss.nextBoltAt = runTime + BOLT_PERIOD;
        const side = Math.sin(runTime * 13.7) > 0 ? 1 : -1;
        // Launch clear of the tether/car line so the debris reads in the open sky.
        options.spawnBossBolt(context, enemy.mesh.position.clone()
          .addScaledVector(options.frameRight, side * 5.2)
          .addScaledVector(options.frameUp, 2.6));
        options.spawnBossBolt(context, enemy.mesh.position.clone()
          .addScaledVector(options.frameRight, -side * 3.2)
          .addScaledVector(options.frameUp, 3.4));
      }
    }
    return false;
  }

  function updateClaw(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'claw' }>) {
    const { enemy, age, camera } = context;
    const socket = CLAW_SOCKETS[data.socket];
    const wobble = Math.sin(age * 1.7 + data.socket * 2.4) * 0.6;
    enemy.mesh.position
      .copy(boss.mawPosition)
      .addScaledVector(options.frameRight, socket[0] + wobble * 0.5)
      .addScaledVector(options.frameUp, socket[1] + wobble)
      .addScaledVector(options.frameUp, Math.sin(age * 2.3 + data.socket) * 0.3);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.socket * 2.1 + Math.sin(age * 1.2 + data.socket) * 0.25);
    return false;
  }

  return {
    updateMaw,
    updateClaw,
    mawKilled: () => boss.mawKilled,
    mawSpawned: () => boss.mawSpawned,
    reachedCar: () => boss.reached,
    gap: () => boss.gap,
    killedAtGap: () => boss.killedAtGap,
    summaryLine() {
      if (!boss.mawSpawned) return undefined;
      if (!boss.mawKilled) return 'The Lamprey was never cut loose';
      if (boss.killedAtGap <= REACH_GAP + 1) return 'Lamprey torn off the car itself';
      return `Lamprey severed ${boss.killedAtGap.toFixed(0)} m short of the car`;
    },
  };
}

export type Lamprey = ReturnType<typeof createLamprey>;
