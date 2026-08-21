import { MathUtils, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { ThermalInkV1d2SpawnData, ThermalInkV1d2SpawnEntry, ThermalInkV1d2Update } from './gameplay';
import { DIVE_TIME, ENGAGE_TIME, ENRAGE_TIME, EXPOSED_TIME } from './timing';

// The octopus: one creature, one fight. The `core` enemy is the whole animal —
// mantle, eyes, beak — pacing the camera just out of true reach. Six `arm`
// enemies hang off its sockets; breaking them all burns the mantle open and
// exposes the red signal core. It fights with ink (scripted ejects land on the
// arrangement's phrase boundaries) and with gob volleys from its siphon.

const SOCKET_ANGLES = [-2.35, -1.65, -0.7, 0.7, 1.65, 2.35]; // radians around the mantle's lower rim
const ARM_SOCKET_COUNT = SOCKET_ANGLES.length;
export const ARM_HIT_POINTS = 3;
const ARM_REACH = 8.6;
const BOSS_AHEAD = 0.038; // rail-progress lead the body paces at

type OctopusOptions = {
  coreForceTime: number;
  /** Bar 16: past this point, a fully disarmed creature regenerates its arms once. */
  enrageTime: number;
  /** Gameplay owns the shared ink state; the boss only raises the scripted final wall. */
  setBlackout(value: boolean): void;
  spawnInk(context: ThermalInkV1d2Update, lead: number, offset: [number, number], radius: number): void;
  spawnGob(context: ThermalInkV1d2Update, from: Vector3): void;
};

/** Scripted ink ejects — [runSeconds, lead, offsetX, offsetY, radius]. */
const INK_EJECTS: Array<[number, number, number, number, number]> = [
  [ENGAGE_TIME, 3.2, -2.5, 1.5, 13],
  [ENGAGE_TIME + 0.4, 3.9, 5, -1, 11],
  [ENGAGE_TIME + 10, 3.4, 3, 0.5, 12], // bar 8
  [DIVE_TIME, 3.0, 0, -1.5, 14],
  [ENRAGE_TIME, 3.2, -4, 1, 13],
  [ENRAGE_TIME + 0.4, 3.9, 4.5, -1.5, 12],
];

/** Siphon gob volleys — [runSeconds, count]. */
const GOB_VOLLEYS: Array<[number, number]> = [
  [ENGAGE_TIME + 6.25, 2], // bar 6.5
  [ENGAGE_TIME + 16.25, 2], // bar 10.5
  [ENGAGE_TIME + 25, 3], // bar 14
  [ENGAGE_TIME + 35, 3], // bar 18
  [ENGAGE_TIME + 42.5, 2], // bar 21
];

export function createOctopus(bus: EventBus, options: OctopusOptions) {
  const boss = {
    coreId: -1,
    coreSpawned: false,
    coreKilled: false,
    exposed: false,
    dyingFor: -1,
    armIds: new Set<number>(),
    armsSpawned: 0,
    armsRemaining: 0,
    nextInk: 0,
    nextGob: 0,
    pendingRegrow: false,
    regrown: false,
    blackoutAt: -1,
    bodyPosition: new Vector3(),
    bodyRight: new Vector3(1, 0, 0),
    bodyUp: new Vector3(0, 1, 0),
    bodyForward: new Vector3(0, 0, 1),
  };

  bus.on('runstart', () => {
    boss.coreId = -1;
    boss.coreSpawned = false;
    boss.coreKilled = false;
    boss.exposed = false;
    boss.dyingFor = -1;
    boss.armIds.clear();
    boss.armsSpawned = 0;
    boss.armsRemaining = 0;
    boss.nextInk = 0;
    boss.nextGob = 0;
    boss.pendingRegrow = false;
    boss.regrown = false;
    boss.blackoutAt = -1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'arm') {
      boss.armIds.add(enemyId);
      boss.armsSpawned += 1;
      boss.armsRemaining += 1;
    }
    if (kind === 'core') {
      boss.coreSpawned = true;
      boss.coreId = enemyId;
    }
  });

  const onArmGone = (enemyId: number) => {
    if (!boss.armIds.delete(enemyId)) return;
    boss.armsRemaining = Math.max(0, boss.armsRemaining - 1);
    if (boss.armsRemaining === 0 && boss.armsSpawned > 0 && !boss.regrown) {
      boss.pendingRegrow = true;
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onArmGone(enemyId);
    if (enemyId === boss.coreId) {
      boss.coreKilled = true;
      boss.dyingFor = 0;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onArmGone(enemyId);
  });

  function exposeCore(entry: ThermalInkV1d2SpawnEntry, runTime: number) {
    if (boss.exposed || !boss.coreSpawned) return;
    boss.exposed = true;
    entry.lockable = true;
    // Its last defense: a few breaths after the mantle burns open, it fills
    // the water with ink for the final volley.
    boss.blackoutAt = runTime + 2.6;
    bus.emit('bossphase', { phase: 'exposed' });
  }

  function updateCore(context: ThermalInkV1d2Update, _data: Extract<ThermalInkV1d2SpawnData, { role: 'core' }>) {
    const { enemy, runTime, age, runProgress, curve, camera } = context;
    const frame = sampleRailFrame(curve, MathUtils.clamp(runProgress + BOSS_AHEAD, 0, 1));

    // The creature turns to keep you in reach: wide slow weave early, tight
    // and vicious after the dive, throbbing in place once the core is open.
    const enraged = runTime >= ENRAGE_TIME;
    const exposed = boss.exposed;
    const weaveSpeed = exposed ? 0.42 : enraged ? 0.62 : 0.5;
    const weaveWidth = exposed ? 4.5 : enraged ? 9.5 : DIVE_TIME <= runTime ? 8 : 10.5;
    const heightPhase = runTime < DIVE_TIME
      ? 9 + Math.sin(runTime * 0.4) * 3 // looming above the wreck line
      : runTime < EXPOSED_TIME
        ? 15 + Math.sin(runTime * 0.3) * 3 // high, arms hanging into the dive
        : 6.5; // settled in front of you
    const weave = new Vector3(
      Math.sin(runTime * weaveSpeed) * weaveWidth + Math.sin(runTime * weaveSpeed * 2.3) * 2,
      heightPhase + Math.sin(runTime * weaveSpeed * 1.7) * 2.2,
      30,
    );

    boss.bodyPosition
      .copy(frame.position)
      .addScaledVector(frame.right, weave.x)
      .addScaledVector(frame.up, weave.y)
      .addScaledVector(frame.tangent, weave.z);
    boss.bodyRight.copy(frame.right);
    boss.bodyUp.copy(frame.up);
    boss.bodyForward.copy(frame.tangent).negate();

    enemy.mesh.position.copy(boss.bodyPosition);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.5) * 0.1);
    enemy.mesh.userData.exposed = boss.exposed;
    enemy.mesh.userData.age = age;

    // Regeneration: strip every arm before the enrage and the creature grows a
    // fresh set for its final stand — one time only.
    if (boss.pendingRegrow && !boss.exposed && runTime >= options.enrageTime) {
      boss.pendingRegrow = false;
      boss.regrown = true;
      for (let socket = 0; socket < ARM_SOCKET_COUNT; socket += 1) {
        context.spawnEnemy({
          time: runTime,
          kind: 'arm',
          hitPoints: ARM_HIT_POINTS,
          data: { role: 'arm', socket },
        });
      }
      bus.emit('bossphase', { phase: 'summoned' });
    }

    // Exposure: every spawned arm broken (after any regeneration), or the clock
    // forces it so the fight always lands.
    const allArmsBroken = boss.armsSpawned > 0 && boss.armIds.size === 0 && !boss.pendingRegrow;
    if (!boss.exposed && ((allArmsBroken && boss.regrown) || runTime >= options.coreForceTime)) {
      exposeCore(enemy.entry, runTime);
    }

    // Scripted ink ejects, on the arrangement's phrases.
    while (boss.nextInk < INK_EJECTS.length && runTime >= INK_EJECTS[boss.nextInk][0]) {
      const [, lead, ox, oy, radius] = INK_EJECTS[boss.nextInk];
      options.spawnInk(context, lead, [ox, oy], radius);
      boss.nextInk += 1;
    }

    // Siphon gob volleys.
    while (boss.nextGob < GOB_VOLLEYS.length && runTime >= GOB_VOLLEYS[boss.nextGob][0]) {
      const [, count] = GOB_VOLLEYS[boss.nextGob];
      for (let i = 0; i < count; i += 1) {
        const from = boss.bodyPosition
          .clone()
          .addScaledVector(boss.bodyRight, (i - (count - 1) / 2) * 3.4)
          .addScaledVector(boss.bodyUp, -3.2);
        options.spawnGob(context, from);
      }
      boss.nextGob += 1;
    }

    // The final blackout holds until the creature collapses.
    options.setBlackout(boss.blackoutAt > 0 && !boss.coreKilled && runTime >= boss.blackoutAt);
    return false;
  }

  function updateArm(context: ThermalInkV1d2Update, data: Extract<ThermalInkV1d2SpawnData, { role: 'arm' }>) {
    const { enemy, age, camera } = context;
    const socketAngle = SOCKET_ANGLES[data.socket % SOCKET_ANGLES.length];
    const reach = boss.exposed ? ARM_REACH * 0.45 : ARM_REACH; // arms retract when the core opens
    const sway = Math.sin(age * (1.1 + data.socket * 0.13) + data.socket * 1.9);

    const offset = new Vector3(
      Math.sin(socketAngle) * reach + sway * 1.1,
      -2.6 - Math.cos(socketAngle * 0.5) * 1.6 + Math.sin(age * 0.8 + data.socket) * 1.4,
      4.2 + Math.cos(socketAngle) * 1.5,
    );
    enemy.mesh.position
      .copy(boss.bodyPosition)
      .addScaledVector(boss.bodyRight, offset.x)
      .addScaledVector(boss.bodyUp, offset.y)
      .addScaledVector(boss.bodyForward, offset.z);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(socketAngle * 0.35 + Math.sin(age * 0.9 + data.socket * 2) * 0.22);
    enemy.mesh.userData.age = age;
    enemy.mesh.userData.retracted = boss.exposed;
    return false;
  }

  function coreKilled() {
    return boss.coreKilled;
  }

  function armsSummaryLine() {
    if (boss.armsSpawned === 0) return undefined;
    const broken = boss.armsSpawned - boss.armIds.size;
    return `Arms broken ${Math.min(broken, boss.armsSpawned)}/${boss.armsSpawned}`;
  }

  function bossSummaryLine() {
    if (!boss.coreSpawned) return 'The harbor holds its breath';
    return boss.coreKilled ? 'The octopus is slain' : 'The octopus still hunts';
  }

  return { updateCore, updateArm, coreKilled, armsSummaryLine, bossSummaryLine };
}
