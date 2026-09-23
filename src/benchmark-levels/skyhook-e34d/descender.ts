import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { SkyhookSpawnEntry, SkyhookUpdate } from './gameplay';
import { altitudeAt, HEAD_HEIGHT, SKYHOOK_PLAYER_HEALTH, TETHER_X, TETHER_Y } from './world';
import { BEAT, bar, SKYHOOK_MARKERS } from './timing';

// THE DESCENDER — latches onto the tether far above at bar 20 and climbs down
// it hand over hand, one grip per beat, visibly closer and bigger every bar.
// Four grip claws hold it to the ribbon: every claw shot away makes it slip
// back up the line. The maw stays sealed until the claws are gone or, at bar
// 26, it opens to feed. At bar 28¾ it lunges for the car; if it reaches the
// drive head, it tears the climber apart.

export const DESCENDER_CLAW_COUNT = 4;

/** Distance above the camera at reveal, at the start of the fight, and where it bites the car. */
/** Body scale; claw sockets and the bite distance scale with it. */
export const DESCENDER_SCALE = 1.8;
const REVEAL_DISTANCE = 420;
const FIGHT_DISTANCE = 105;
const ARRIVE_DISTANCE = HEAD_HEIGHT + 10 * DESCENDER_SCALE;
/** Grip-per-beat descent by claws still holding, index = claws alive. */
const STEP_BY_CLAWS = [1.9, 2.2, 2.3, 2.4, 2.5];
const CLAW_SLIP = 5;
const STAGE_SLIP = 4;
/** The lunge: when the dock is near, it stops climbing and drops on the car. */
const LUNGE_AT = bar(28, 3);
const LUNGE_STEP = 16;
const MAW_FORCED_OPEN = bar(26);
/** Beats (from bar 22) where it sheds a brood of ticks down the ribbon. */
const BROOD_BEATS = [4, 12, 20, 26];
/** Claw sockets around the body, in the plane across the tether. */
export const CLAW_RADIUS = 11.5 * DESCENDER_SCALE;
export const CLAW_DROP = 2.5 * DESCENDER_SCALE;
export const clawAngle = (socket: number) => Math.PI / 4 + socket * (Math.PI / 2);

/**
 * Live read-out for the score: the audio schedules the Descender's grip clanks
 * on its own transport and reads how close it is. Written by the active run.
 */
export const descenderTelemetry = { active: false, killed: false, holding: false, distance: 999 };

export type DescenderState = {
  active: boolean;
  /** Distance above the camera along the tether. */
  distance: number;
  /** World position of the maw (the target point, underside center). */
  position: Vector3;
  clawsAlive: boolean[];
  mawOpen: boolean;
  killed: boolean;
  killedAt: number;
  arrived: boolean;
  /** 0→1 through the current grip step; visuals flex the legs with it. */
  stepPhase: number;
  stepIndex: number;
  slip: number;
};

type DescenderOptions = {
  mawEntry: SkyhookSpawnEntry;
  spawnTick(context: SkyhookUpdate, startAbove: number, travelBeats: number): void;
};

export function createDescender(bus: EventBus, options: DescenderOptions) {
  const state: DescenderState = {
    active: false,
    distance: REVEAL_DISTANCE,
    position: new Vector3(),
    clawsAlive: Array.from({ length: DESCENDER_CLAW_COUNT }, () => true),
    mawOpen: false,
    killed: false,
    killedAt: -1,
    arrived: false,
    stepPhase: 0,
    stepIndex: -1,
    slip: 0,
  };
  let mawId = -1;
  const clawSockets = new Map<number, number>();
  let stepFrom = FIGHT_DISTANCE;
  let stepTo = FIGHT_DISTANCE;
  let stepStartedAt = 0;
  let pauseUntilBeat = -1;
  let broodIndex = 0;
  let killedDistance = 0;

  function reset() {
    state.active = false;
    state.distance = REVEAL_DISTANCE;
    state.clawsAlive.fill(true);
    state.mawOpen = false;
    state.killed = false;
    state.killedAt = -1;
    state.arrived = false;
    state.stepPhase = 0;
    state.stepIndex = -1;
    state.slip = 0;
    mawId = -1;
    clawSockets.clear();
    stepFrom = FIGHT_DISTANCE;
    stepTo = FIGHT_DISTANCE;
    stepStartedAt = 0;
    pauseUntilBeat = -1;
    broodIndex = 0;
    killedDistance = 0;
    options.mawEntry.lockable = false;
    descenderTelemetry.active = false;
    descenderTelemetry.killed = false;
    descenderTelemetry.holding = false;
    descenderTelemetry.distance = 999;
  }

  bus.on('runstart', reset);

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'maw') return;
    mawId = enemyId;
    state.active = true;
    bus.emit('bossphase', { phase: 'summoned' });
  });

  function slipBack(amount: number, pauseBeats: number, runTime: number) {
    stepTo = Math.max(stepTo, state.distance) + amount;
    stepFrom = state.distance;
    stepStartedAt = runTime;
    state.slip = 1;
    pauseUntilBeat = Math.floor(runTime / BEAT) + pauseBeats;
  }

  let lastRunTime = 0;

  bus.on('kill', ({ enemyId }) => {
    const socket = clawSockets.get(enemyId);
    if (socket !== undefined) {
      state.clawsAlive[socket] = false;
      clawSockets.delete(enemyId);
      slipBack(CLAW_SLIP, 2, lastRunTime);
      if (state.clawsAlive.every((alive) => !alive)) openMaw();
    }
    if (enemyId === mawId && !state.killed) {
      state.killed = true;
      state.killedAt = lastRunTime;
      killedDistance = state.distance;
      descenderTelemetry.active = false;
      descenderTelemetry.killed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('stage', ({ enemyId }) => {
    if (enemyId === mawId) slipBack(STAGE_SLIP, 1, lastRunTime);
  });

  function openMaw() {
    if (state.mawOpen) return;
    state.mawOpen = true;
    options.mawEntry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  }

  function updateMaw(context: SkyhookUpdate) {
    const { runTime } = context;
    lastRunTime = runTime;
    const cameraAltitude = altitudeAt(runTime);

    if (runTime < SKYHOOK_MARKERS.boss) {
      // The reveal: it drops down the line fast, then catches and grips.
      const t = MathUtils.clamp((runTime - SKYHOOK_MARKERS.contact) / (SKYHOOK_MARKERS.boss - SKYHOOK_MARKERS.contact), 0, 1);
      state.distance = MathUtils.lerp(REVEAL_DISTANCE, FIGHT_DISTANCE, 1 - (1 - t) ** 3);
      stepFrom = stepTo = state.distance;
      state.stepPhase = 0;
    } else {
      const beat = Math.floor(runTime / BEAT);
      if (beat !== state.stepIndex) {
        state.stepIndex = beat;
        if (beat >= pauseUntilBeat) {
          const clawsAlive = state.clawsAlive.filter(Boolean).length;
          stepFrom = state.distance;
          const step = runTime >= LUNGE_AT ? LUNGE_STEP : STEP_BY_CLAWS[clawsAlive];
          stepTo = Math.max(ARRIVE_DISTANCE - 3, Math.min(stepTo, state.distance) - step);
          stepStartedAt = runTime;
        }
      }
      const phase = MathUtils.clamp((runTime - stepStartedAt) / (BEAT * 0.42), 0, 1);
      state.stepPhase = phase;
      state.distance = MathUtils.lerp(stepFrom, stepTo, MathUtils.smoothstep(phase, 0, 1));
      if (runTime >= MAW_FORCED_OPEN) openMaw();

      const beatsIn = Math.floor((runTime - SKYHOOK_MARKERS.boss) / BEAT);
      if (broodIndex < BROOD_BEATS.length && beatsIn >= BROOD_BEATS[broodIndex] && !state.arrived) {
        broodIndex += 1;
        const travelBeats = MathUtils.clamp(Math.round(state.distance / 11), 5, 12);
        options.spawnTick(context, state.distance - 12, travelBeats);
      }
    }
    state.slip = Math.max(0, state.slip - 0.04);

    descenderTelemetry.active = runTime >= SKYHOOK_MARKERS.boss && !state.killed;
    descenderTelemetry.killed = state.killed;
    descenderTelemetry.holding = Math.floor(runTime / BEAT) < pauseUntilBeat;
    descenderTelemetry.distance = state.distance;

    state.position.set(TETHER_X, TETHER_Y, -(cameraAltitude + state.distance));
    context.enemy.mesh.position.copy(state.position);
    context.enemy.mesh.userData.distance = state.distance;

    if (state.distance <= ARRIVE_DISTANCE) {
      // It has the car. Keep trying until the invulnerability window lapses.
      state.arrived = true;
      context.damagePlayer(SKYHOOK_PLAYER_HEALTH);
    }
    return false;
  }

  const clawOffset = new Vector3();

  function updateClaw(context: SkyhookUpdate, socket: number) {
    const { enemy, age } = context;
    if (!clawSockets.has(enemy.id) && state.clawsAlive[socket]) clawSockets.set(enemy.id, socket);
    if (state.killed || !state.active) return true;
    const angle = clawAngle(socket);
    // Each grip flexes as the step lands: the claw tightens, then releases.
    const flex = Math.sin(state.stepPhase * Math.PI) * 0.9 * DESCENDER_SCALE;
    clawOffset.set(Math.cos(angle) * (CLAW_RADIUS - flex), Math.sin(angle) * (CLAW_RADIUS - flex) * 0.92, CLAW_DROP + flex * 0.6);
    enemy.mesh.position.copy(state.position).add(clawOffset);
    enemy.mesh.userData.socket = socket;
    enemy.mesh.userData.age = age;
    return false;
  }

  function summaryLine() {
    if (state.killed) return `Descender destroyed ${Math.round(killedDistance * 10)} m above the car`;
    if (state.arrived) return 'The Descender reached the car';
    return 'The Descender is still on the line';
  }

  return { state, updateMaw, updateClaw, summaryLine };
}
