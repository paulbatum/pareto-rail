import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { createMusicTime } from '../../engine/music-time';

export const STRANDLINE_SI8M_BPM = 72;
export const STRANDLINE_SI8M_STEPS = 16;
export const STRANDLINE_SI8M_TIME = createMusicTime(STRANDLINE_SI8M_BPM, { stepsPerBar: STRANDLINE_SI8M_STEPS });
export const STRANDLINE_SI8M_RUN_DURATION = STRANDLINE_SI8M_TIME.bar(18); // 18 bars = 60 sec at 72 BPM (4 beats/bar)

export type StrandlineSi8mEnemyKind = 'leech' | 'swarm' | 'brood' | 'parent' | 'web-strand';

export type StrandlineLeechData = { role: 'leech'; lead: number; x: number; y: number; detachAt: number; seed: number };
export type StrandlineSwarmData = { role: 'swarm'; lead: number; x: number; y: number; radius: number; seed: number };
export type StrandlineBroodData = { role: 'brood'; lead: number; x: number; y: number; seed: number };
export type StrandlineParentData = { role: 'parent'; lead: number; seed: number };
export type StrandlineWebStrandData = { role: 'web-strand'; lead: number; x: number; y: number; seed: number };
export type StrandlineSi8mSpawnData = StrandlineLeechData | StrandlineSwarmData | StrandlineBroodData | StrandlineParentData | StrandlineWebStrandData;

export function createStrandlineSi8mRail() {
  // A winding rail through glowing tentacles; wide curves reveal the jelly bell.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 2, 0),
      new Vector3(-8, 4, -30),
      new Vector3(12, -3, -70),
      new Vector3(-14, 2, -120),
      new Vector3(20, 6, -180),
      new Vector3(-6, -5, -250),
      new Vector3(10, 8, -320),
      new Vector3(-18, -2, -390),
      new Vector3(6, 4, -450),
    ],
    false,
    'catmullrom',
    0.42,
  );
}

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineSi8mEnemyKind, StrandlineSi8mSpawnData>;

function leech(time: number, lead: number, x: number, y: number, detachAt: number, seed = 1): StrandlineSpawnEntry {
  return { time, kind: 'leech', data: { role: 'leech', lead, x, y, detachAt, seed } };
}
function swarm(time: number, lead: number, x: number, y: number, radius: number, seed = 1): StrandlineSpawnEntry {
  return { time, kind: 'swarm', data: { role: 'swarm', lead, x, y, radius, seed } };
}
function brood(time: number, lead: number, x: number, y: number, seed = 1): StrandlineSpawnEntry {
  return { time, kind: 'brood', data: { role: 'brood', lead, x, y, seed } };
}
function webStrand(time: number, lead: number, x: number, y: number, seed = 1): StrandlineSpawnEntry {
  return { time, kind: 'web-strand', data: { role: 'web-strand', lead, x, y, seed } };
}
function parent(time: number, lead: number, seed = 1): StrandlineSpawnEntry {
  return { time, kind: 'parent', data: { role: 'parent', lead, seed } };
}

const t = STRANDLINE_SI8M_TIME;

export const STRANDLINE_SI8M_SPAWN_TIMELINE: StrandlineSpawnEntry[] = [
  // Act 1: slow drift through glowing strands (bars 0-6)
  leech(t.bar(0, 2), 4.0, -6, 2, 5, 1),
  leech(t.bar(0, 3), 4.4, 6, 3, 4.5, 2),
  swarm(t.bar(1, 2), 4.2, -5, -2, 1.5, 1),
  swarm(t.bar(1, 3.5), 4.6, 7, -1, 2.0, 3),
  leech(t.bar(2), 4.0, -3, 5, 4, 4),
  leech(t.bar(2, 3), 4.5, 4, -3, 3.5, 5),
  swarm(t.bar(3), 4.3, 0, 6, 1.8, 6),
  swarm(t.bar(3, 3), 4.0, -8, 1, 1.4, 7),
  brood(t.bar(4), 3.8, 2, 4, 8),
  brood(t.bar(4.5), 4.0, -4, -2, 9),

  // Act 2: dense waves, curves reveal bell (bars 6-12)
  leech(t.bar(6), 4.2, -7, 4, 5, 10),
  swarm(t.bar(6.5), 4.5, 8, 2, 2.2, 11),
  leech(t.bar(7), 4.0, 5, -4, 4, 12),
  swarm(t.bar(7.5), 4.3, -2, 5, 1.6, 13),
  brood(t.bar(8), 4.0, 6, 0, 14),
  brood(t.bar(8.5), 4.2, -6, 3, 15),
  leech(t.bar(9), 4.0, 3, 6, 3.5, 16),
  swarm(t.bar(9.5), 4.5, -5, -1, 1.9, 17),
  brood(t.bar(10), 4.0, 7, -3, 18),
  leech(t.bar(10.5), 4.1, -4, 5, 4, 19),
  swarm(t.bar(11), 4.3, 0, 2, 2.1, 20),
  brood(t.bar(11.5), 4.0, 3, -5, 21),

  // Act 3: web lattice and boss entrance (bars 12-16)
  webStrand(t.bar(12), 5.0, -8, 6, 22),
  webStrand(t.bar(12.25), 5.2, 8, 5, 23),
  webStrand(t.bar(12.5), 5.0, 0, 8, 24),
  webStrand(t.bar(13), 5.2, -6, -6, 25),
  webStrand(t.bar(13.25), 5.0, 6, -5, 26),
  parent(t.bar(14), 5.5, 27),
  brood(t.bar(14.5), 4.0, 5, 4, 28),
  brood(t.bar(15), 4.2, -5, 3, 29),
  webStrand(t.bar(15.25), 5.0, -7, 7, 30),
  webStrand(t.bar(15.5), 5.2, 7, 6, 31),
  brood(t.bar(15.75), 4.0, 0, -4, 32),

  // Act 4: boss fight - kill broods, web dies back, parent exposed (bars 16-20)
  // Parent continues to pump broods. Web strands stay until broods killed.
  brood(t.bar(16), 4.0, 4, 5, 33),
  brood(t.bar(16.5), 4.2, -6, -3, 34),
  brood(t.bar(17), 4.0, 7, 0, 35),
  brood(t.bar(17.5), 4.1, -3, 6, 36),
  brood(t.bar(18), 4.2, 5, -5, 37),
  brood(t.bar(18.5), 4.0, -7, 2, 38),

  // Act 5: resolution (bars 20-22) - parent bare
  // No new spawns; existing targets resolve.
];

const KILL_SCORE: Record<StrandlineSi8mEnemyKind, number> = {
  leech: 100,
  swarm: 120,
  brood: 180,
  'web-strand': 200,
  parent: 3000,
};

export function createStrandlineSi8mLevel(): LockOnRunnerLevel<StrandlineSi8mEnemyKind, StrandlineSi8mSpawnData> {
  const timeline = STRANDLINE_SI8M_SPAWN_TIMELINE;

  const webState = new Map<number, number>(); // enemyId -> broodsKilledThatFeedThis
  const parentState = new Map<number, { broodsKilled: number }>();

  return {
    duration: STRANDLINE_SI8M_RUN_DURATION,
    bpm: STRANDLINE_SI8M_BPM,
    playerHealth: 3,
    createRail: createStrandlineSi8mRail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    startWord: 'FREE',
    replayWord: 'AGAIN',

    updateEnemy(context: LockOnEnemyUpdate<StrandlineSi8mEnemyKind, StrandlineSi8mSpawnData>) {
      const data = context.enemy.entry.data;
      if (data.role === 'leech') {
        const { lead, detachAt, seed, x, y } = data;
        const u = context.railAnchor(lead);
        const detached = context.age >= detachAt;
        const offset = new Vector3(x, y, 0);
        if (detached) {
          // After detaching, the leech swims slowly toward camera with gentle wave
          const driftX = Math.sin(context.age * 1.2 + seed) * 2.5;
          const driftY = Math.cos(context.age * 0.9 + seed) * 1.5;
          offset.set(x + driftX, y + driftY - context.age * 0.35, context.age * 0.15);
        } else {
          // Latched: slight pulse
          offset.set(x + Math.sin(context.age * 2.5 + seed) * 0.3, y + Math.cos(context.age * 2 + seed) * 0.3, 0);
        }
        context.enemy.mesh.position.copy(offsetFromRail(context.curve, u, offset));
        context.enemy.mesh.quaternion.copy(context.camera.quaternion);
        context.enemy.mesh.rotateZ(context.age * 0.25 + seed);
        return context.runProgress > u + 0.022;
      }
      if (data.role === 'swarm') {
        const { lead, x, y, radius, seed } = data;
        const u = context.railAnchor(lead);
        const a = context.age * 0.8 + seed;
        const orbitX = Math.cos(a) * radius + x;
        const orbitY = Math.sin(a * 1.3) * (radius * 0.7) + y;
        context.enemy.mesh.position.copy(offsetFromRail(context.curve, u, new Vector3(orbitX, orbitY, 0)));
        context.enemy.mesh.quaternion.copy(context.camera.quaternion);
        context.enemy.mesh.rotateZ(context.age * 0.4 + seed);
        return context.runProgress > u + 0.020;
      }
      if (data.role === 'brood') {
        const { lead, x, y, seed } = data;
        const u = context.railAnchor(lead);
        const t = Math.min(1, context.age / 5);
        const eased = t * t * (3 - 2 * t);
        const posX = x + Math.sin(context.age * 3 + seed) * 1.2;
        const posY = y + Math.cos(context.age * 2.1 + seed) * 0.6 - eased * 2;
        context.enemy.mesh.position.copy(offsetFromRail(context.curve, u, new Vector3(posX, posY, -eased * 3)));
        context.enemy.mesh.quaternion.copy(context.camera.quaternion);
        context.enemy.mesh.lookAt(context.camera.position);
        return context.runProgress > u + 0.018 || context.age > 7;
      }
      if (data.role === 'parent') {
        const { lead, seed } = data;
        const u = MathUtils.clamp(context.runProgress + 0.015, 0, 1);
        const pos = offsetFromRail(context.curve, u, new Vector3(0, 2, -5));
        context.enemy.mesh.position.copy(pos);
        context.enemy.mesh.quaternion.copy(context.camera.quaternion);
        context.enemy.mesh.rotateX(context.age * 0.08 + seed);
        context.enemy.mesh.rotateY(context.age * 0.05);
        return false; // Boss stays until explicitly ended by event/run
      }
      if (data.role === 'web-strand') {
        const { lead, x, y, seed } = data;
        const u = context.railAnchor(lead);
        // Web strands stay fixed near parent; they only die when broods killed
        const offset = new Vector3(x * 2.5, y * 1.8, 0);
        context.enemy.mesh.position.copy(offsetFromRail(context.curve, u, offset));
        context.enemy.mesh.quaternion.copy(context.camera.quaternion);
        context.enemy.mesh.rotateZ(context.age * 0.15 + seed);
        // Web strand dies when enough broods killed; handled externally
        return context.runProgress > u + 0.025;
      }
      return false;
    },

    scoreForKill(volleySize: number, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit() {
      return 40;
    },
    scoreForVolley(results) {
      return results.length === 6 && results.every((r) => r.killed) ? 800 : 0;
    },

    rankForRun(score: number, kills: number, totalEnemies: number) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 9000 && clearRate >= 0.85) return 'S';
      if (score >= 6800 && clearRate >= 0.7) return 'A';
      if (score >= 4200 && clearRate >= 0.5) return 'B';
      if (score >= 1800 && clearRate >= 0.3) return 'C';
      return 'D';
    },

    detailsForRun() {
      return ['Strandline complete', 'Jellyfish freed'];
    },
  };
}
export const strandlineSi8mGameplay = createStrandlineSi8mLevel();
export default strandlineSi8mGameplay;
