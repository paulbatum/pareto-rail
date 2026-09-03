import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';

// Tinker Ball: a 60-second cleanup run across one oversized worktable. The
// ball starts marble-sized among buttons and pins and ends melon-sized,
// gathering rulers and jars. Three glue-monster kinds (scuttling button
// beetles, flapping clothespin birds, marching ruler stilters) plus glue
// blobs hold the middle, and a three-core glue spill is the finale.
export const TINKER_BALL_72PR_BPM = 132;
export const TINKER_BALL_72PR_TIME = createMusicTime(TINKER_BALL_72PR_BPM, { stepsPerBar: 16 });
const time = TINKER_BALL_72PR_TIME;
export const TINKER_BALL_72PR_RUN_DURATION = time.bar(33);

export const TINKER_BALL_72PR_MARKERS = time.markers({
  run: 0,
  act1: 2,
  act2: 11,
  breath: 20,
  boss: 24,
  outro: 31,
});

export const TINKER_BALL_72PR_SECTIONS = [
  { name: 'intro', fromBar: 0, toBar: 2 },
  { name: 'marble', fromBar: 2, toBar: 11 },
  { name: 'tennis', fromBar: 11, toBar: 20 },
  { name: 'breath', fromBar: 20, toBar: 24 },
  { name: 'spill', fromBar: 24, toBar: 31 },
  { name: 'outro', fromBar: 31 },
] as const;

export type TinkerBall72prEnemyKind =
  | 'beetle'
  | 'bird'
  | 'stilter'
  | 'blob'
  | 'boss-core';
export type TinkerBall72prTargetKind = TinkerBall72prEnemyKind | 'letter';

export type TinkerBall72prSpawnData = {
  role: TinkerBall72prEnemyKind;
  lead: number;
  offset: Vector3;
  seed: number;
  coreIndex?: number;
};
export type TinkerBall72prSpawnEntry = LockOnSpawnEntry<TinkerBall72prEnemyKind, TinkerBall72prSpawnData>;
export type TinkerBall72prUpdate = LockOnEnemyUpdate<TinkerBall72prEnemyKind, TinkerBall72prSpawnData>;

export function createTinkerBall72prRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 5, 0),
      new Vector3(3, 5.5, -22),
      new Vector3(-8, 5, -46),
      new Vector3(-14, 6, -70),
      new Vector3(2, 5.2, -94),
      new Vector3(14, 6, -118),
      new Vector3(8, 5, -142),
      new Vector3(-8, 6.2, -166),
      new Vector3(-14, 5, -190),
      new Vector3(0, 5.5, -214),
      new Vector3(10, 5, -238),
      new Vector3(2, 4.4, -260),
      new Vector3(0, 4.2, -282),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

const FORMATION_GAP = time.seconds(0.16);

function wave(
  at: number,
  lead: number,
  kind: TinkerBall72prEnemyKind,
  offsets: Array<[number, number]>,
  seedBase = 0,
): TinkerBall72prSpawnEntry[] {
  return formation(at, FORMATION_GAP, offsets, (offset, index) => ({
    kind,
    data: {
      role: kind,
      lead,
      offset: new Vector3(offset[0], offset[1], 0),
      seed: seedBase + index * 1.618 + at,
    },
  }));
}

function cores(at: number): TinkerBall72prSpawnEntry[] {
  const specs: Array<{ dt: number; index: number; offset: [number, number] }> = [
    { dt: 0, index: 0, offset: [-6, 4] },
    { dt: 0.85, index: 1, offset: [6, 5] },
    { dt: 1.7, index: 2, offset: [0, 1.5] },
  ];
  return specs.map((spec) => ({
    time: at + spec.dt,
    kind: 'boss-core',
    hitPoints: 4,
    data: {
      role: 'boss-core',
      lead: 7.5 - spec.index * 0.5,
      offset: new Vector3(spec.offset[0], spec.offset[1], 0),
      seed: 40 + spec.index * 2.3,
      coreIndex: spec.index,
    },
  }));
}

function createTinkerBall72prTimeline(): TinkerBall72prSpawnEntry[] {
  const BOSS = TINKER_BALL_72PR_MARKERS.boss;
  return sortTimeline([
    // --- Act 1, marble scale: readable singles, one kind at a time.
    ...section(TINKER_BALL_72PR_MARKERS.act1,
      wave(time.bar(0), 4.2, 'beetle', [[-5, 0.5], [-1.5, 2.5], [2, 2], [5.5, 0]], 1),
      wave(time.bar(2), 4.4, 'bird', [[-6, 3.5], [-2, 1], [2.5, 1.5], [6.5, 3]], 7),
      wave(time.bar(4), 4.4, 'stilter', [[-5, -1], [0, 2.5], [5, -1]], 13),
      wave(time.bar(5, 2), 4.6, 'beetle', [[-7, 2], [-3.5, -2], [0, 4.5], [3.5, -2], [7, 2]], 19),
      wave(time.bar(7), 4.6, 'bird', [[-8, 4], [-4, 0.5], [0, 3], [4, 0.5], [8, 4]], 29),
      wave(time.bar(8, 2), 4.4, 'stilter', [[-6, -2], [-2, 2], [2, -1], [6, 2]], 37),
    ),
    // --- Act 2, tennis scale: denser mixed waves, wider sweeps.
    ...section(TINKER_BALL_72PR_MARKERS.act2,
      wave(time.bar(0), 4.5, 'beetle', [[-8, -1], [-4, 2.5], [0, -2], [4, 2.5], [8, -1]], 43),
      wave(time.bar(1, 2), 4.7, 'bird', [[-7, 4.5], [-3, 1], [1, 4], [5, 1]], 53),
      wave(time.bar(3), 4.5, 'stilter', [[-8, 1], [-4, -2], [0, 4], [4, -2], [8, 1]], 61),
      wave(time.bar(4, 2), 4.8, 'blob', [[-6, 3], [-2, -1], [2, 3], [6, -1]], 71),
      wave(time.bar(6), 4.6, 'beetle', [[-9, 0], [-5.5, 3.5], [-2, -2], [1.5, 4], [5, -2], [8.5, 3]], 79),
      wave(time.bar(7, 2), 4.7, 'bird', [[-8, -2], [-4, 2.5], [0, -1], [4, 2.5], [8, -2]], 91),
      wave(time.bar(8, 2), 4.5, 'stilter', [[-7, 3.5], [-2.5, 0], [2.5, 3], [7, 0]], 101),
    ),
    // --- Breath before the spill: two small low-band waves, keeping the
    // high sightlines clear for the incoming cores.
    ...section(TINKER_BALL_72PR_MARKERS.breath,
      wave(time.bar(0, 2), 4.6, 'blob', [[-5, 0.5], [0, -1], [5, 0.5]], 109),
      wave(time.bar(2), 4.8, 'beetle', [[-7, -1.5], [-3, 1], [1, -1.5], [5, 1]], 113),
    ),
    // --- Boss: the glue spill. Three staggered cores hold the high band
    // while recycled blobs work the low band.
    ...section(BOSS,
      cores(time.bar(0)),
      wave(time.bar(1), 5.0, 'blob', [[-8, -1.5], [-4, 0], [1, 2.5], [5, 0], [8.5, -1.5]], 121),
      wave(time.bar(2, 2), 5.0, 'bird', [[-7, 5], [0, 3], [7, 5]], 131),
      wave(time.bar(4), 5.2, 'blob', [[-8, 1], [-4, 4], [0, 0], [4, 4], [8, 1]], 139),
      wave(time.bar(5, 2), 5.2, 'stilter', [[-6, -1], [0, 3], [6, -1]], 149),
      wave(time.bar(6, 2), 4.6, 'blob', [[-4, 2], [4, 2]], 157),
    ),
  ]);
}

export const TINKER_BALL_72PR_SPAWN_TIMELINE: TinkerBall72prSpawnEntry[] =
  createTinkerBall72prTimeline();

const KILL_SCORE: Record<TinkerBall72prEnemyKind, number> = {
  beetle: 100,
  bird: 100,
  stilter: 110,
  blob: 130,
  'boss-core': 550,
};

export const tinkerBall72prGameplay: LockOnRunnerLevel<TinkerBall72prEnemyKind, TinkerBall72prSpawnData> = {
  duration: TINKER_BALL_72PR_RUN_DURATION,
  bpm: TINKER_BALL_72PR_BPM,
  createRail: createTinkerBall72prRail,
  spawnTimeline: TINKER_BALL_72PR_SPAWN_TIMELINE,
  easeRunProgress: smoothRunProgress,
  // Attract dolly: a slow push over the table toward the START letters,
  // keeping the lamp hardware out of frame.
  updateAttractCamera({ camera, curve, modeTime }) {
    const drift = (Math.sin(modeTime * 0.12) * 0.5 + 0.5) * 0.018;
    const pos = curve.getPointAt(0.012 + drift);
    const ahead = curve.getPointAt(0.13 + drift);
    camera.position.set(pos.x, pos.y + 1.2, pos.z + 7);
    camera.lookAt(ahead.x, ahead.y + 0.5, ahead.z);
  },
  updateEnemy(context) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const data = enemy.entry.data;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    const s = data.seed;

    if (data.role === 'beetle') {
      // Scuttle: fast sideways skitter over a held station.
      offset.x += Math.sin(age * 5.2 + s) * 1.7 + Math.sin(age * 1.3 + s * 2) * 0.7;
      offset.y += Math.abs(Math.sin(age * 6.1 + s)) * 0.35;
    } else if (data.role === 'bird') {
      // Flap-and-circle: orbits its station while bobbing hard.
      offset.x += Math.cos(age * 2.1 + s) * 2.2;
      offset.y += Math.sin(age * 3.4 + s) * 1.6;
      offset.z += Math.sin(age * 2.1 + s) * 1.2;
    } else if (data.role === 'stilter') {
      // March: slow wide sway, high knee-bob, leaning into the camera.
      offset.x += Math.sin(age * 1.15 + s) * 2.8;
      offset.y += Math.abs(Math.sin(age * 3.0 + s * 1.7)) * 0.9;
      offset.z -= age * 0.45;
    } else if (data.role === 'blob') {
      // Glue wobble: drifts down-camera with a heavy jiggle.
      offset.x += Math.sin(age * 2.6 + s) * 1.1;
      offset.y += Math.cos(age * 3.1 + s * 2.2) * 0.9 - age * 0.35;
      offset.z -= age * 0.8;
    } else {
      // Boss cores: slow menacing sway, holding station far ahead. Once
      // the camera passes, they duck under the table instead of filling
      // the screen.
      const passed = runProgress - anchorU;
      if (passed > 0) {
        const sink = context.enemyState(() => ({ t0: -1 }));
        if (sink.t0 < 0) sink.t0 = age;
        const dtp = age - sink.t0;
        offset.y -= dtp * 9;
        offset.z += dtp * 5;
        if (dtp > 0.8) return true;
      }
      offset.x += Math.sin(runTime * 0.7 + s) * 1.6;
      offset.y += Math.sin(runTime * 1.1 + s * 2) * 0.9;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    const spin = data.role === 'boss-core' ? 0.35 : 0.5 + (enemy.id % 5) * 0.08;
    enemy.mesh.rotateZ(runTime * spin + s);
    if (data.role === 'bird' || data.role === 'blob') {
      enemy.mesh.rotateX(Math.sin(runTime * 2.2 + s) * 0.35);
    }

    // Flap the bird's wings; jiggle blobs and cores.
    const wings = enemy.mesh.userData.wings as Array<{ rotation: { y: number } }> | undefined;
    if (wings) {
      const flap = Math.sin(runTime * 14 + s) * 0.7;
      wings[0].rotation.y = flap;
      wings[1].rotation.y = -flap;
    }
    const jiggle = enemy.mesh.userData.jiggle as { scale: { set: (x: number, y: number, z: number) => void } } | undefined;
    if (jiggle) {
      const w = 1 + Math.sin(runTime * 7 + s) * 0.06;
      jiggle.scale.set(w, 2 - w > 0 ? 1 / w : 1, w);
    }

    return runProgress > anchorU + 0.02;
  },
  scoreForKill(volleySize, enemy) {
    const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
    return Math.round(KILL_SCORE[enemy.kind] * multiplier);
  },
  scoreForHit: () => 45,
  rankForRun(score, kills, totalEnemies) {
    const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
    if (score >= 8800 && clearRate >= 0.85) return 'S';
    if (score >= 6400 && clearRate >= 0.7) return 'A';
    if (score >= 4000 && clearRate >= 0.48) return 'B';
    if (score >= 1700 && clearRate >= 0.28) return 'C';
    return 'D';
  },
  detailsForRun: () => ['Table cleared — nice rolling'],
};
