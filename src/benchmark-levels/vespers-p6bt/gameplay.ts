import { MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { WINDOW_COUNT, createVespersRail, mirrorWindow, nearestWindowIndex } from './nave';
import { createRoseFight, type RoseSpawnData, type VespersRoseFight } from './rose';
import { VESPERS_BPM, VESPERS_MARKERS, VESPERS_RUN_DURATION, VESPERS_TIME } from './timing';

// A flight down the nave in five movements: an almost empty opening over a
// held pedal, two acts that fill the frame, a long dark span where the
// building empties out, and the rose fight at the west end.
//
// The level's own economy runs underneath the shooting. Everything that spawns
// has stripped a window; killing it gives that window back, and its twin
// across the nave with it. Letting one past costs the pane for good, so the
// run is scored partly on how much of the cathedral is burning at the end.

export { VESPERS_BPM, VESPERS_RUN_DURATION } from './timing';
export const VESPERS_PLAYER_HEALTH = 3;

export type VespersEnemyKind =
  | 'shade'
  | 'seraph'
  | 'censer'
  | 'gargoyle'
  | 'mote'
  | 'rose-petal'
  | 'rose-heart';

export type VespersMotion = 'peel' | 'hover' | 'swing' | 'perch';

type WaveData = {
  role: 'wave';
  lead: number;
  motion: VespersMotion;
  offset: Vector3;
  phase: number;
};

// Motes are spawned at runtime with fresh data objects, so unlike the authored
// timeline entries — which the engine reuses across runs — theirs may mutate.
type MoteData = {
  // The engine gives lock priority and volley priority to entries whose role
  // names a hostile shot, which is exactly what a mote is.
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type VespersSpawnData = WaveData | MoteData | RoseSpawnData;
export type VespersSpawnEntry = LockOnSpawnEntry<VespersEnemyKind, VespersSpawnData>;
export type VespersUpdate = LockOnEnemyUpdate<VespersEnemyKind, VespersSpawnData>;

const time = VESPERS_TIME;
const FORMATION_GAP = time.seconds(0.15);
const MISS_GRACE_U = 0.016;
/** Chain length of a censer: the pivot hangs this far above the bowl at rest. */
const SWING_RADIUS = 8;
const MOTE_MAX_AGE = 13;

/**
 * Stately entry, a long build through the gallery, the floor dropping out at
 * the hush, then a surge that carries the player into the rose and a slow
 * arrival in front of it.
 */
const SPEED = createSpeedProfile(
  [
    [0, 0.40],
    [time.bar(1), 0.70],
    [time.bar(4), 0.95],
    [time.bar(8), 1.30],
    [time.bar(11.5), 1.38],
    [time.bar(12), 0.52],
    [time.bar(14), 0.60],
    [time.bar(15), 1.45],
    [time.bar(17), 1.15],
    [time.bar(20), 0.72],
    [VESPERS_RUN_DURATION, 0.45],
  ],
  VESPERS_RUN_DURATION,
);

const wave = (
  at: number,
  lead: number,
  motion: VespersMotion,
  kind: VespersEnemyKind,
  offsets: Array<[number, number]>,
): VespersSpawnEntry[] => formation(at, FORMATION_GAP, offsets, (offset, index) => ({
  kind,
  data: { role: 'wave', lead, motion, offset: new Vector3(offset[0], offset[1], 0), phase: index * 0.9 },
}));

function createVespersTimeline(rose: VespersRoseFight): VespersSpawnEntry[] {
  return [
    // --- Nave. One voice over the pedal; room to learn the sweep.
    ...section(VESPERS_MARKERS.pedal,
      wave(time.beats(2), 4.4, 'peel', 'shade', [
        [-15, 1], [-6, 7], [6, 7], [15, 1],
      ]),
      wave(time.beats(7), 4.2, 'peel', 'shade', [
        [-17, -6], [-9, 4], [9, 4], [17, -6],
      ]),
      wave(time.beats(12), 4.2, 'hover', 'seraph', [
        [-12, 9], [0, 12], [12, 9],
      ]),
    ),

    // --- Subject. The answer enters; censers start their pendulum and the
    // first gargoyle unpins itself from the arcade.
    ...section(VESPERS_MARKERS.subject,
      wave(time.beats(0.5), 4.0, 'peel', 'shade', [
        [-16, 3], [-8, -5], [0, 6], [8, -5], [16, 3],
      ]),
      wave(time.beats(4), 4.0, 'hover', 'seraph', [
        [-14, 8], [-5, 11], [5, 11], [14, 8],
      ]),
      wave(time.beats(8), 3.9, 'swing', 'censer', [
        [-11, -2], [0, -4], [11, -2],
      ]),
      wave(time.beats(11), 3.8, 'peel', 'shade', [
        [-17, 5], [-11, -3], [-4, 8], [4, -3], [11, 5], [17, -1],
      ]),
      wave(time.beats(14), 4.2, 'perch', 'gargoyle', [[0, 11]]),
    ),

    // --- Gallery. Descant, bell and full ranks; the densest the nave gets.
    ...section(VESPERS_MARKERS.gallery,
      wave(time.beats(0.5), 3.7, 'swing', 'censer', [
        [-13, 0], [-5, -4], [5, -4], [13, 0],
      ]),
      wave(time.beats(3), 3.7, 'hover', 'seraph', [
        [-16, 6], [-8, 11], [0, 13], [8, 11], [16, 6],
      ]),
      wave(time.beats(6), 3.9, 'perch', 'gargoyle', [[-13, 9], [13, 9]]),
      wave(time.beats(8), 3.6, 'peel', 'shade', [
        [-17, -2], [-12, 6], [-6, -6], [6, -6], [12, 6], [17, -2],
      ]),
      wave(time.beats(11), 3.6, 'swing', 'censer', [
        [-15, 3], [-6, 8], [6, 8], [15, 3],
      ]),
      wave(time.beats(12.5), 3.4, 'hover', 'seraph', [
        [-10, -5], [-3, 10], [3, -5], [10, 10],
      ]),
      // Last of the gallery, and the last thing on screen before the nave
      // empties: short leads so the hush really is empty when it arrives.
      wave(time.beats(14), 2.9, 'perch', 'gargoyle', [[-7, 2], [7, 2]]),
    ),

    // --- Hush. The nave empties. Three targets in eleven seconds, each one
    // alone in the frame with the building.
    ...section(VESPERS_MARKERS.hush,
      wave(time.beats(2), 4.6, 'peel', 'shade', [[-16, -7]]),
      wave(time.beats(6), 4.4, 'swing', 'censer', [[2, 4]]),
      wave(time.beats(9.5), 4.4, 'peel', 'shade', [[15, 9]]),
    ),

    // --- Approach. Everything comes back at once, and the dead rose comes out
    // of the dark ahead.
    ...section(VESPERS_MARKERS.approach,
      wave(time.beats(0.5), 3.4, 'perch', 'gargoyle', [[-11, 6], [11, 6]]),
      wave(time.beats(2), 3.2, 'hover', 'seraph', [
        [-14, -3], [-5, 9], [5, 9], [14, -3],
      ]),
    ),

    ...rose.entries(VESPERS_MARKERS.roseEntrance),
  ];
}

const KILL_SCORE: Record<VespersEnemyKind, number> = {
  shade: 100,
  seraph: 130,
  censer: 150,
  gargoyle: 190,
  mote: 40,
  'rose-petal': 400,
  'rose-heart': 2200,
};

export function createVespersGameplay(bus: EventBus): LockOnRunnerLevel<VespersEnemyKind, VespersSpawnData> {
  const interceptions = new Set<number>();
  /** Which pane each live target stripped, so a kill knows where to send it back. */
  const stolen = new Map<number, number>();
  const relit = new Set<number>();
  let hitsTaken = 0;

  function fireMote(context: VespersUpdate, from: Vector3) {
    const launch = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'mote',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: launch, lastAge: 0 },
    });
  }

  const rose = createRoseFight(bus, fireMote);
  const timeline = sortTimeline(createVespersTimeline(rose));

  bus.on('runstart', () => {
    interceptions.clear();
    stolen.clear();
    relit.clear();
    hitsTaken = 0;
  });

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    if (kind === 'mote' || kind.startsWith('rose-')) return;
    stolen.set(enemyId, nearestWindowIndex(worldPosition));
  });

  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    const window = stolen.get(enemyId);
    if (window === undefined) return;
    stolen.delete(enemyId);
    relit.add(window);
    relit.add(mirrorWindow(window));
  });

  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    stolen.delete(enemyId);
  });

  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  function updateWave(context: VespersUpdate, data: WaveData) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    let roll = 0;
    let spin = 0;

    switch (data.motion) {
      case 'peel':
        // A pane coming off the wall: it lets go outboard and slides in toward
        // the middle of the nave, turning edge-on as it goes.
        offset.x -= Math.sign(offset.x || 1) * age * 0.9;
        offset.y += Math.sin(age * 0.9 + data.phase) * 0.9;
        roll = Math.sin(age * 1.1 + data.phase) * 0.5;
        spin = age * 1.3 + data.phase;
        break;
      case 'hover':
        // Wings holding station, then sinking: a slow ellipse with drift.
        offset.x += Math.cos(age * 1.35 + data.phase) * 2.8;
        offset.y += Math.sin(age * 1.35 + data.phase) * 1.8 - age * 0.55;
        roll = Math.sin(age * 0.7 + data.phase) * 0.22;
        break;
      case 'swing': {
        // A thurible on a chain, swinging in strict tempo: one full sweep
        // every two beats, so the censers are the metronome you can see.
        const angle = Math.sin((runTime / time.beatSeconds) * Math.PI + data.phase) * 0.95;
        offset.x += Math.sin(angle) * SWING_RADIUS;
        offset.y += SWING_RADIUS * (1 - Math.cos(angle));
        roll = -angle;
        break;
      }
      case 'perch': {
        // Crouched on the arcade, then a lunge straight down the nave at the
        // player, spitting an ember on the way in.
        const crouch = Math.min(1, age / 1.6);
        offset.y += Math.sin(age * 2.4 + data.phase) * 0.4 * (1 - crouch);
        offset.z = crouch * crouch * 9;
        roll = Math.sin(age * 1.6 + data.phase) * 0.12;
        const spit = context.enemyState(() => ({ nextAt: 0.85 + data.phase * 0.3, left: 2 }));
        if (spit.left > 0 && age >= spit.nextAt) {
          spit.left -= 1;
          spit.nextAt = age + 1.9;
          fireMote(context, enemy.mesh.position);
        }
        break;
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(roll);
    if (spin !== 0) enemy.mesh.rotateY(spin);

    return runProgress > anchorU + MISS_GRACE_U;
  }

  function updateMote(context: VespersUpdate, data: MoteData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: interceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 7);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5,
      maxSpeed: 11,
      accel: 3,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 2.7);

    return shotBehindCamera(camera, data.position) || age > MOTE_MAX_AGE;
  }

  return {
    duration: VESPERS_RUN_DURATION,
    bpm: VESPERS_BPM,
    playerHealth: VESPERS_PLAYER_HEALTH,
    createRail: createVespersRail,
    spawnTimeline: timeline,
    easeRunProgress: SPEED.runProgress,
    // Shots are slow, heavy and spaced wide: a volley in here reads as a
    // sequence of struck notes rather than a burst.
    timing: { shotDelay: { gapThirtyseconds: 3, gridRampGapGrowthThirtyseconds: 2, maxGridSeconds: 0.75 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'bolt':
          return updateMote(context, data);
        default:
          return rose.update(context, data);
      }
    },
    validateRelease(enemies) {
      return rose.validateRelease(enemies);
    },
    updateCameraEffects({ camera, runTime }) {
      // A slow list from side to side, and a lift of the head into the vault
      // through the hush, where there is nothing else to look at.
      const hush = MathUtils.smoothstep(runTime, VESPERS_MARKERS.hush - 1.5, VESPERS_MARKERS.hush + 2.5)
        * (1 - MathUtils.smoothstep(runTime, VESPERS_MARKERS.approach - 1, VESPERS_MARKERS.approach + 0.5));
      camera.rotateZ(Math.sin(runTime * 0.21) * 0.021);
      camera.rotateX(hush * 0.085 + Math.sin(runTime * 0.17) * 0.008);
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      // The attract screen is the establishing shot: drifting down the middle
      // of a black nave with the letters glazed into it.
      const forward = MathUtils.clamp(modeTime * 0.0016, 0, 0.05);
      camera.position.copy(curve.getPointAt(forward)).add(new Vector3(
        Math.sin(modeTime * 0.23) * 1.4,
        1.2 + Math.cos(modeTime * 0.19) * 0.6,
        0,
      ));
      camera.lookAt(curve.getPointAt(forward + 0.05).setY(3 + Math.sin(modeTime * 0.16) * 1.2));
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(KILL_SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.16));
    },
    scoreForHit: () => 60,
    // A volley where nothing was wasted pays for the whole chord at once.
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      if (kills < 3 || kills < results.length) return 0;
      return kills * kills * 45;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      const light = relit.size / WINDOW_COUNT;
      if (score >= 16000 && clearRate >= 0.85 && light >= 0.45) return 'S';
      if (score >= 10500 && clearRate >= 0.72) return 'A';
      if (score >= 6000 && clearRate >= 0.52) return 'B';
      if (score >= 2800 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const lines = [
        `Hull ${Math.max(0, VESPERS_PLAYER_HEALTH - hitsTaken)}/${VESPERS_PLAYER_HEALTH}`,
        `Windows relit ${relit.size}/${WINDOW_COUNT}`,
      ];
      const verdict = rose.summary();
      if (verdict) lines.push(verdict);
      return lines;
    },
  };
}
