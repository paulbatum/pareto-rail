import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createMusicTime } from '../../engine/music-time';

export const STRANDLINE_SI7K_BPM = 96;
export const STRANDLINE_SI7K_TIME = createMusicTime(STRANDLINE_SI7K_BPM, { stepsPerBar: 16 });

export const STRANDLINE_SI7K_RUN_DURATION = STRANDLINE_SI7K_TIME.bar(24);

export type StrandlineEnemyKind = 'clamp' | 'larva' | 'brood' | 'parent' | 'web';
export type StrandlineSpawnData = {
  role?: 'wave' | 'brood' | 'boss-web' | 'boss-parent';
  lead?: number;
  offset?: Vector3;
  pattern?: string;
};

function createStrandlineSi7kRail() {
  // A winding rail through glowing strands: curves left/right and up/down
  // to create the sense of threading between tentacles.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 2, 0),
      new Vector3(8, -1, -30),
      new Vector3(-12, 4, -65),
      new Vector3(14, -3, -100),
      new Vector3(-10, 6, -140),
      new Vector3(6, -2, -180),
      new Vector3(-16, 5, -220),
      new Vector3(10, -4, -260),
      new Vector3(-4, 8, -300),
      new Vector3(18, -2, -340),
      new Vector3(-8, 6, -380),
      new Vector3(0, 3, -420),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

const time = STRANDLINE_SI7K_TIME;

export const STRANDLINE_SI7K_SPAWN_TIMELINE: Array<LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>> = [
  // Opening ambient: a few gentle clamps on strands
  { time: time.bar(0, 1), kind: 'clamp', data: { role: 'wave', lead: 4.2, offset: new Vector3(-3, 2.5, 0) } },
  { time: time.bar(0, 2.5), kind: 'clamp', data: { role: 'wave', lead: 4.4, offset: new Vector3(4, 3, 0) } },
  { time: time.bar(1, 0.5), kind: 'clamp', data: { role: 'wave', lead: 4.6, offset: new Vector3(-2, -1.5, 0) } },
  // First larva detaches and swims
  { time: time.bar(2, 2), kind: 'larva', data: { role: 'wave', lead: 4.0, offset: new Vector3(6, 1, 0) } },
  { time: time.bar(3, 1), kind: 'larva', data: { role: 'wave', lead: 4.2, offset: new Vector3(-5, 2, 0) } },
  // More clamps with wider spread
  { time: time.bar(4, 0), kind: 'clamp', data: { role: 'wave', lead: 4.8, offset: new Vector3(-7, 4, 0) } },
  { time: time.bar(4, 1.5), kind: 'clamp', data: { role: 'wave', lead: 4.6, offset: new Vector3(5, -2, 0) } },
  { time: time.bar(5, 0), kind: 'clamp', data: { role: 'wave', lead: 4.4, offset: new Vector3(-4, 5, 0) } },
  { time: time.bar(5, 2.5), kind: 'larva', data: { role: 'wave', lead: 4.0, offset: new Vector3(8, 0, 0) } },
  // Build: denser waves
  { time: time.bar(6, 1), kind: 'clamp', data: { role: 'wave', lead: 4.5, offset: new Vector3(-6, 3.5, 0) } },
  { time: time.bar(6, 2.5), kind: 'larva', data: { role: 'wave', lead: 4.3, offset: new Vector3(7, -1.5, 0) } },
  { time: time.bar(7, 0.5), kind: 'clamp', data: { role: 'wave', lead: 4.7, offset: new Vector3(-3, -3, 0) } },
  { time: time.bar(7, 2), kind: 'clamp', data: { role: 'wave', lead: 4.5, offset: new Vector3(5, 4, 0) } },
  { time: time.bar(8, 1), kind: 'larva', data: { role: 'wave', lead: 4.2, offset: new Vector3(-8, 1.5, 0) } },
  { time: time.bar(8, 3), kind: 'clamp', data: { role: 'wave', lead: 4.6, offset: new Vector3(3, -4, 0) } },
  // Mid-run intensity
  { time: time.bar(9, 0.5), kind: 'clamp', data: { role: 'wave', lead: 4.4, offset: new Vector3(-7, -2, 0) } },
  { time: time.bar(9, 2), kind: 'larva', data: { role: 'wave', lead: 4.1, offset: new Vector3(6, 3.5, 0) } },
  { time: time.bar(10, 1), kind: 'clamp', data: { role: 'wave', lead: 4.8, offset: new Vector3(-4, 5.5, 0) } },
  { time: time.bar(10, 3), kind: 'larva', data: { role: 'wave', lead: 4.3, offset: new Vector3(8, -3, 0) } },
  { time: time.bar(11, 0), kind: 'clamp', data: { role: 'wave', lead: 4.7, offset: new Vector3(-9, 0, 0) } },
  // Boss entrance: parent organism at crown, with web lattice ahead
  { time: time.bar(14, 0), kind: 'parent', data: { role: 'boss-parent', lead: 5.5, offset: new Vector3(0, 6, 0) }, hitPoints: 8, hitStages: [3, 3, 2], lockable: false },
  // Web pieces guard the parent; they unlock as previous web dies
  { time: time.bar(13, 2), kind: 'web', data: { role: 'boss-web', lead: 5.0, offset: new Vector3(-7, 4, 0) }, hitPoints: 1, lockable: false },
  { time: time.bar(13, 3), kind: 'web', data: { role: 'boss-web', lead: 5.0, offset: new Vector3(7, 4, 0) }, hitPoints: 1, lockable: false },
  { time: time.bar(14, 0.5), kind: 'brood', data: { role: 'brood', lead: 3.8, offset: new Vector3(-4, 2, 0) }, hitPoints: 1 },
  // Fresh broods pump from boss during fight
  { time: time.bar(15, 1), kind: 'brood', data: { role: 'brood', lead: 3.8, offset: new Vector3(5, 2, 0) }, hitPoints: 1 },
  { time: time.bar(16, 0.5), kind: 'brood', data: { role: 'brood', lead: 3.6, offset: new Vector3(-6, 3, 0) }, hitPoints: 1 },
  { time: time.bar(16, 2.5), kind: 'brood', data: { role: 'brood', lead: 3.6, offset: new Vector3(6, 3, 0) }, hitPoints: 1 },
  // Final push: dense clamps and larvas before finale
  { time: time.bar(18, 0), kind: 'clamp', data: { role: 'wave', lead: 4.5, offset: new Vector3(-8, 5, 0) } },
  { time: time.bar(18, 2), kind: 'larva', data: { role: 'wave', lead: 4.0, offset: new Vector3(9, -1, 0) } },
  { time: time.bar(19, 1), kind: 'clamp', data: { role: 'wave', lead: 4.8, offset: new Vector3(-5, -3, 0) } },
  { time: time.bar(20, 0.5), kind: 'larva', data: { role: 'wave', lead: 4.2, offset: new Vector3(7, 4, 0) } },
  // Finale build
  { time: time.bar(21, 0), kind: 'clamp', data: { role: 'wave', lead: 4.6, offset: new Vector3(-9, 2, 0) } },
  { time: time.bar(21, 2), kind: 'larva', data: { role: 'wave', lead: 4.0, offset: new Vector3(8, -4, 0) } },
  { time: time.bar(22, 1), kind: 'clamp', data: { role: 'wave', lead: 4.9, offset: new Vector3(-4, 6, 0) } },
  { time: time.bar(23, 0), kind: 'larva', data: { role: 'wave', lead: 4.3, offset: new Vector3(5, -5, 0) } },
];

export const strandlineSi7kGameplay: LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> = {
  duration: STRANDLINE_SI7K_RUN_DURATION,
  bpm: STRANDLINE_SI7K_BPM,
  createRail: createStrandlineSi7kRail,
  spawnTimeline: STRANDLINE_SI7K_SPAWN_TIMELINE,
  playerHealth: 3,
  startWord: 'STRAND',
  replayWord: 'DRIFT',
  updateEnemy(context) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const data = enemy.entry.data as StrandlineSpawnData;
    const kind = enemy.kind;
    const anchorU = railAnchor(data.lead ?? 4.5);

    if (kind === 'clamp') {
      const offset = data.offset?.clone() ?? new Vector3(0, 2, 0);
      // Gentle sway on the strand
      offset.y += Math.sin(age * 0.9 + enemy.id * 0.7) * 0.6;
      offset.x += Math.cos(age * 0.6 + enemy.id * 1.3) * 0.9;
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotation.z = Math.sin(runTime * 0.5 + enemy.id) * 0.3;
      return runProgress > anchorU + 0.02;
    }

    if (kind === 'larva') {
      const offset = data.offset?.clone() ?? new Vector3(0, 2, 0);
      // Swimming motion: arcs across screen with slight vertical bob
      offset.x += Math.sin(age * 1.3 + enemy.id) * 2.5 + age * 0.3;
      offset.y += Math.cos(age * 0.8 + enemy.id * 0.9) * 1.2;
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotation.z = age * 2.5;
      return runProgress > anchorU + 0.02;
    }

    if (kind === 'brood') {
      const offset = data.offset?.clone() ?? new Vector3(0, 1, 0);
      // Pulsing approach: small violet orbs that drift slightly
      offset.x += Math.sin(age * 2.1) * 0.8;
      offset.y += Math.sin(age * 1.4) * 0.5 + 1.5;
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.scale.setScalar(0.8 + Math.sin(age * 3.5) * 0.15);
      return runProgress > anchorU + 0.015;
    }

    if (kind === 'parent') {
      // Boss anchored near crown; stays visible until killed
      const baseOffset = data.offset?.clone() ?? new Vector3(0, 6, 0);
      baseOffset.y += Math.sin(runTime * 0.35) * 1.2;
      baseOffset.z = 28 + Math.sin(runTime * 0.6) * 2;
      enemy.mesh.position.copy(offsetFromRail(curve, MathUtils.clamp(runProgress, 0, 0.95), baseOffset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotation.z = runTime * 0.2;
      return false; // Boss never misses; ends when run ends or killed
    }

    if (kind === 'web') {
      const offset = data.offset?.clone() ?? new Vector3(0, 0, 0);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotation.z = runTime * 0.5 + enemy.id;
      return runProgress > anchorU + 0.02;
    }

    return false;
  },
  scoreForKill: (_volleySize, enemy) => {
    if (enemy.kind === 'parent') return 2500;
    if (enemy.kind === 'brood') return 180;
    if (enemy.kind === 'web') return 220;
    if (enemy.kind === 'larva') return 130;
    return 100;
  },
  scoreForHit: () => 35,
  scoreForVolley: (results) => {
    const kills = results.filter((r) => r.killed).length;
    if (kills >= 4) return 500 + kills * 80;
    if (kills >= 2) return 200 + kills * 40;
    return kills * 60;
  },
  rankForRun(score, kills, totalEnemies) {
    const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
    if (score >= 8000 && clearRate >= 0.85) return 'S';
    if (score >= 5500 && clearRate >= 0.7) return 'A';
    if (score >= 3500 && clearRate >= 0.5) return 'B';
    if (score >= 1500 && clearRate >= 0.25) return 'C';
    return 'D';
  },
};
