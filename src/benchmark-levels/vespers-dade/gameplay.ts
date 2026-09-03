import { CatmullRomCurve3, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import { createMusicTime } from '../../engine/music-time';

// Vespers: a 60-second flight down the nave of a black cathedral while
// something eats the light out of it. Three movements: the voices enter
// (bars 0-7), the dark span (bars 12-15, almost nothing on screen), and the
// finale at the dead rose window (bars 15-21) where the stolen colours burn.

export const VESPERS_DADE_BPM = 84;
export const VESPERS_DADE_TIME = createMusicTime(VESPERS_DADE_BPM, { stepsPerBar: 16 });

export const VESPERS_DADE_BARS = {
  run: 0,
  secondVoice: 2,
  thirdVoice: 4,
  choir: 6,
  pressure: 7,
  darkSpan: 12,
  boss: 15,
  roseIgnite: 20,
  end: 21,
} as const;

export const VESPERS_DADE_MARKERS = VESPERS_DADE_TIME.markers({
  run: VESPERS_DADE_BARS.run,
  secondVoice: VESPERS_DADE_BARS.secondVoice,
  thirdVoice: VESPERS_DADE_BARS.thirdVoice,
  choir: VESPERS_DADE_BARS.choir,
  pressure: VESPERS_DADE_BARS.pressure,
  darkSpan: VESPERS_DADE_BARS.darkSpan,
  boss: VESPERS_DADE_BARS.boss,
  roseIgnite: VESPERS_DADE_BARS.roseIgnite,
});

export const VESPERS_DADE_RUN_DURATION = VESPERS_DADE_TIME.bar(VESPERS_DADE_BARS.end);
export const VESPERS_DADE_PLAYER_HEALTH = 3;

export type VespersDadeEnemyKind =
  | 'moth'
  | 'gargoyle'
  | 'thurible'
  | 'cinder'
  | 'petal'
  | 'eater';

type VespersWaveData = {
  role: 'wave';
  lead: number;
  pattern: 'drift' | 'lunge' | 'swing';
  offset: Vector3;
  colorIndex: number;
};

type VespersCinderData = {
  role: 'cinder';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

type VespersBossData = {
  role: 'boss';
  lead: number;
  orbitRadius: number;
  orbitPhase: number;
  orbitSpeed: number;
  colorIndex: number;
};

export type VespersDadeSpawnData = VespersWaveData | VespersCinderData | VespersBossData;
export type VespersDadeSpawnEntry = LockOnSpawnEntry<VespersDadeEnemyKind, VespersDadeSpawnData>;
export type VespersDadeUpdate = LockOnEnemyUpdate<VespersDadeEnemyKind, VespersDadeSpawnData>;

export function createVespersDadeRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 2, 0),
      new Vector3(0, 3.5, -30),
      new Vector3(4, 1, -62),
      new Vector3(-6, 4.5, -96),
      new Vector3(-6, 0.5, -130),
      new Vector3(3, 5, -164),
      new Vector3(6, 1, -198),
      new Vector3(0, 4, -232),
      new Vector3(-3, 0.5, -266),
      new Vector3(0, 3.5, -300),
      new Vector3(0, 2, -334),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

const time = VESPERS_DADE_TIME;
const GAP = time.seconds(0.22);

let colorCounter = 0;
const nextColor = () => colorCounter++ % 4;

const wave = (
  at: number,
  lead: number,
  pattern: VespersWaveData['pattern'],
  kind: VespersDadeEnemyKind,
  offsets: Array<[number, number]>,
): VespersDadeSpawnEntry[] =>
  formation(at, GAP, offsets, (offset) => ({
    kind,
    data: { role: 'wave', lead, pattern, offset: new Vector3(offset[0], offset[1], 0), colorIndex: nextColor() },
  }));

const BOSS_TIME = VESPERS_DADE_MARKERS.boss;

function createTimeline(): VespersDadeSpawnEntry[] {
  colorCounter = 0;
  const petalOffsets: Array<[number, number]> = [[-4.5, 3.5], [4.5, 3.5], [-4.5, -1.5], [4.5, -1.5]];
  return sortTimeline([
    // Movement I — the voices enter one at a time. Sparse flat shapes off glass.
    ...section(VESPERS_DADE_MARKERS.run,
      wave(time.bar(0, 2), 4.6, 'drift', 'moth', [[-8, -1], [8, 4]]),
      wave(time.bar(2), 3.6, 'drift', 'moth', [[-7, 5], [1, -3], [8, 0]]),
      wave(time.bar(3, 1), 4.6, 'swing', 'thurible', [[-8, 1], [-2, 6], [6, -3]]),
      wave(time.bar(4, 2), 4.6, 'drift', 'moth', [[-8, 3], [-4, -3], [4, 5], [8, -2]]),
      wave(time.bar(5, 2), 4.4, 'lunge', 'gargoyle', [[-7, 5], [7, -2]]),
      wave(time.bar(6), 3.5, 'swing', 'thurible', [[-8, 3], [-4, 6], [4, -3], [8, 5]]),
    ),
    // Movement II — pressure. Gargoyles spit cinders; full counterpoint.
    // Times are relative to the pressure marker (bar 7).
    ...section(VESPERS_DADE_MARKERS.pressure,
      wave(time.bar(0), 3.5, 'drift', 'moth', [[-8, 4], [-4, -3], [4, 6], [8, -2]]),
      wave(time.bar(0, 2), 4.3, 'lunge', 'gargoyle', [[-1, 6]]),
      wave(time.bar(1), 3.5, 'swing', 'thurible', [[-8, -3], [0, 4], [8, -2]]),
      wave(time.bar(2), 3.4, 'drift', 'moth', [[-8, -1], [-5, 5], [1, -3], [6, 4], [8, 6]]),
      wave(time.bar(3), 3.3, 'lunge', 'gargoyle', [[-8, 5], [8, -1]]),
      wave(time.bar(3, 2), 4.5, 'swing', 'thurible', [[-7, 6], [0, -3], [7, 6]]),
      wave(time.bar(4), 3.2, 'drift', 'moth', [[-8, -2], [-3, 6], [4, -3], [8, 4]]),
    ),
    // The dark span — one voice, almost nothing. Three lone shapes cross.
    // Times are relative to the dark-span marker (bar 12).
    // The dark span — one voice, almost nothing. Two lone shapes cross the dark.
    ...section(VESPERS_DADE_MARKERS.darkSpan,
      wave(time.bar(0, 2), 5.0, 'drift', 'moth', [[-7, 4]]),
      wave(time.bar(1, 2), 5.0, 'swing', 'thurible', [[7, -2]]),
      wave(time.bar(2, 1), 5.0, 'drift', 'moth', [[-1, -3]]),
    ),
    // Finale — the Eater nested in the dead rose, holding every colour.
    ...petalOffsets.map(([x, y], i) => ({
      time: BOSS_TIME + i * time.seconds(0.35),
      kind: 'petal' as const,
      hitPoints: 2,
      hitStages: [1, 1],
      data: {
        role: 'boss' as const, lead: 5.5, orbitRadius: 4.2, orbitPhase: (i / 4) * Math.PI * 2, orbitSpeed: 0.55,
        colorIndex: i,
      },
    })),
    {
      time: BOSS_TIME + time.seconds(1.2),
      kind: 'eater',
      hitPoints: 6,
      hitStages: [2, 2, 2],
      data: { role: 'boss', lead: 6.5, orbitRadius: 0, orbitPhase: 0, orbitSpeed: 0, colorIndex: 0 },
    },
    ...section(BOSS_TIME + time.seconds(2.5),
      wave(time.seconds(0.5), 3.2, 'drift', 'moth', [[-8, 5], [8, 1]]),
      wave(time.seconds(3.5), 3.2, 'swing', 'thurible', [[-7, -3], [7, 2], [0, 6]]),
      wave(time.seconds(6.5), 3.2, 'drift', 'moth', [[-6, 4], [0, -3], [6, 4]]),
      wave(time.seconds(5.0), 3.2, 'drift', 'moth', [[-3, 1], [3, 3]]),
    ),
  ]);
}

export const VESPERS_DADE_SPAWN_TIMELINE: VespersDadeSpawnEntry[] = createTimeline();

const KILL_SCORE: Record<VespersDadeEnemyKind, number> = {
  moth: 100,
  gargoyle: 150,
  thurible: 120,
  cinder: 40,
  petal: 220,
  eater: 1500,
};

const CINDER_MAX_AGE = 12;

export function createVespersDadeGameplay(): LockOnRunnerLevel<VespersDadeEnemyKind, VespersDadeSpawnData> {
  const cinderInterceptions = new Set<number>();
  let hitsTaken = 0;
  let eaterId = -1;

  function fireCinder(context: VespersDadeUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'cinder',
      countsTowardTotal: false,
      data: { role: 'cinder', position: from.clone(), velocity: initial, lastAge: 0 },
    });
  }

  return {
    duration: VESPERS_DADE_RUN_DURATION,
    bpm: VESPERS_DADE_BPM,
    playerHealth: VESPERS_DADE_PLAYER_HEALTH,
    createRail: createVespersDadeRail,
    spawnTimeline: VESPERS_DADE_SPAWN_TIMELINE,
    easeRunProgress: smoothRunProgress,
    startWord: 'START',
    replayWord: 'REPLAY',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'cinder') return updateCinder(context, data);
      if (data.role === 'boss') return updateBoss(context, data);
      return updateWave(context, data, fireCinder);
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 40,
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 8200 && clearRate >= 0.85) return 'S';
      if (score >= 6000 && clearRate >= 0.7) return 'A';
      if (score >= 3800 && clearRate >= 0.5) return 'B';
      if (score >= 1800 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, VESPERS_DADE_PLAYER_HEALTH - hitsTaken);
      return [`Hull ${hull}/${VESPERS_DADE_PLAYER_HEALTH}`];
    },
  };

  function updateWave(
    context: VespersDadeUpdate,
    data: VespersWaveData,
    fire: (c: VespersDadeUpdate, from: Vector3) => void,
  ) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    if (data.pattern === 'drift') {
      offset.x += Math.sin(age * 0.9 + enemy.id * 1.3) * 1.6 + age * 0.45;
      offset.y += Math.cos(age * 0.7 + enemy.id) * 0.9;
    } else if (data.pattern === 'swing') {
      // Thurible: wide pendulum swing on its chain.
      offset.x += Math.sin(age * 1.5 + enemy.id) * 3.2;
      offset.y += Math.abs(Math.cos(age * 1.5 + enemy.id)) * -1.8;
    } else {
      // Gargoyle lunge: slow push toward the camera sells menace.
      offset.z = Math.sin(age * 1.4) * 1.1 - Math.min(2.2, age * 0.35);
      const state = context.enemyState(() => ({ nextAt: 1.6, shotsLeft: 2 }));
      if (state.shotsLeft > 0 && age >= state.nextAt && runTime < VESPERS_DADE_MARKERS.darkSpan) {
        state.shotsLeft -= 1;
        state.nextAt = age + 3.4;
        fire(context, enemy.mesh.position);
      }
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    if (data.pattern === 'drift') {
      enemy.mesh.rotateZ(Math.sin(age * 3.2 + enemy.id) * 0.35);
    } else if (data.pattern === 'swing') {
      enemy.mesh.rotateZ(Math.sin(age * 1.5 + enemy.id) * 0.5);
    }
    enemy.mesh.rotateY(Math.sin(runTime * 0.7 + enemy.id) * 0.25);
    return runProgress > anchorU + 0.02;
  }

  function updateCinder(context: VespersDadeUpdate, data: VespersCinderData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: cinderInterceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      if (impact.damaged) {
        hitsTaken += 1;
        damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.5,
      maxSpeed: 10.5,
      accel: 3.0,
      turnRate: 2.0,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 4);
    return shotBehindCamera(camera, data.position) || age > CINDER_MAX_AGE;
  }

  function updateBoss(context: VespersDadeUpdate, data: VespersBossData) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    if (enemy.kind === 'eater' && eaterId === -1) eaterId = enemy.id;
    const anchorU = railAnchor(data.lead);
    const offset = new Vector3(0, 2.2, 0);
    if (enemy.kind === 'petal') {
      const a = data.orbitPhase + age * data.orbitSpeed;
      offset.x += Math.cos(a) * data.orbitRadius;
      offset.y += Math.sin(a) * data.orbitRadius * 0.8;
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(runTime * (enemy.kind === 'eater' ? 0.35 : -0.8) + data.orbitPhase);
    return runProgress > anchorU + 0.03;
  }
}

export const vespersDadeGameplay = createVespersDadeGameplay();
