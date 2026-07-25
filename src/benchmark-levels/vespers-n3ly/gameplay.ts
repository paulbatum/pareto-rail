import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  VESPERS_N3LY_BPM,
  VESPERS_N3LY_MARKERS,
  VESPERS_N3LY_RUN_DURATION,
  VESPERS_N3LY_TIME,
} from './timing';

export { VESPERS_N3LY_BPM, VESPERS_N3LY_RUN_DURATION, VESPERS_N3LY_TIME } from './timing';

export type VespersN3lyEnemyKind =
  | 'pane-wraith'
  | 'candle-eater'
  | 'chorister'
  | 'vigil'
  | 'rose-lobe'
  | 'devourer';

export type VespersN3lyMotion =
  | 'glide'
  | 'descend'
  | 'orbit'
  | 'procession'
  | 'rose'
  | 'core';

export type VespersN3lySpawnData = {
  lead: number;
  motion: VespersN3lyMotion;
  offset: Vector3;
  phase: number;
  roseAngle?: number;
};

export type VespersN3lySpawnEntry = LockOnSpawnEntry<VespersN3lyEnemyKind, VespersN3lySpawnData>;

export function createVespersN3lyRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 1, -44),
      new Vector3(3, 2, -92),
      new Vector3(-4, 2.5, -142),
      new Vector3(-7, 3, -194),
      new Vector3(2, 2, -246),
      new Vector3(6, 2.5, -300),
      new Vector3(0, 3.5, -354),
      new Vector3(-5, 3, -408),
      new Vector3(-2, 2.4, -462),
      new Vector3(4, 3.2, -516),
      new Vector3(1, 4, -570),
      new Vector3(0, 4, -628),
    ],
    false,
    'catmullrom',
    0.46,
  );
}

const time = VESPERS_N3LY_TIME;
const ENTRY_GAP = time.seconds(0.12);

function wave(
  at: number,
  kind: VespersN3lyEnemyKind,
  motion: VespersN3lyMotion,
  offsets: Array<[number, number]>,
  lead = 5.4,
): VespersN3lySpawnEntry[] {
  return offsets.map(([x, y], index) => {
    const stagedY = y * 1.18 + (index % 2 === 0 ? -1.4 : 0.8);
    // The gallery and candle-floor lanes are both playable space. Small
    // authored y offsets are pushed into alternating high/low choir desks so
    // a six-lock sweep crosses the whole frame instead of tracing its center.
    const spreadY = Math.abs(stagedY) < 6.2
      ? (index % 2 === 0 ? -1 : 1) * (7.45 + Math.abs(stagedY) * 0.15)
      : stagedY;
    return {
      time: at + index * ENTRY_GAP,
      kind,
      data: {
        // This cathedral is intentionally intimate despite its scale: targets
        // steal panes near the player's current bay, so volleys resolve around
        // 35–45 m instead of becoming tiny marks at the west end.
        lead: Math.max(3.5, lead - 1.5),
        motion,
        offset: new Vector3(x * 1.16, spreadY, 0),
        phase: index * 1.37 + at * 0.17,
      },
    };
  });
}

function createTimeline() {
  const timeline: VespersN3lySpawnEntry[] = [
    // The pedal: broad, simple sweeps with enough silence to read the nave.
    ...wave(time.bar(1) - time.beats(1.25), 'pane-wraith', 'glide', [
      [-8.5, 4.5], [-3, 1], [3, -4.1], [8.5, 4.5],
    ], 5.8),
    ...wave(time.bar(2) + time.beats(0.25), 'candle-eater', 'descend', [
      [-9, -2], [-4.5, 3], [0, 6], [4.5, 3], [9, -2],
    ], 5.6),
    ...wave(time.bar(3) + time.beats(0.4), 'chorister', 'orbit', [
      [-7, 5], [-2.5, -1.5], [2.5, -1.5], [7, 5],
    ], 5.5),

    // Voices enter: alternating antiphonal formations from arcade and gallery.
    ...wave(time.bar(4) + time.beats(0.45), 'pane-wraith', 'glide', [
      [-10, 3], [-6, -1], [-2, 4], [2, 4], [6, -1], [10, 3],
    ], 5.7),
    ...wave(time.bar(5) + time.beats(2), 'vigil', 'procession', [
      [-9, 6], [-5.5, 1], [0, -2], [5.5, 1], [9, 6],
    ], 5.6),
    ...wave(time.bar(7), 'candle-eater', 'descend', [
      [-9.5, -3], [-7, 2], [-2.5, 1], [2.5, 1], [7, 5], [11, 0],
    ], 5.5),
    ...wave(time.bar(8) + time.beats(1.65), 'chorister', 'orbit', [
      [-9, -2], [-5, 4.5], [0, 6.5], [5, 4.5], [9, -2],
    ], 5.8),

    // The theft: denser six-note phrases, stacked high and low.
    ...wave(time.bar(9) + time.beats(0.5), 'pane-wraith', 'glide', [
      [-11, 5.5], [-7, 0], [-2.5, 3], [2.5, -2], [7, 3], [11, 0],
    ], 5.4),
    ...wave(time.bar(10) + time.beats(2.1), 'vigil', 'procession', [
      [-10, -2.5], [-6, 2], [-2, 6], [2, 6], [6, 2], [10, -2.5],
    ], 5.4),
    ...wave(time.bar(11) + time.beats(2.8), 'candle-eater', 'descend', [
      [-11, 5], [-7, -1.5], [-2.5, 2], [2.5, -1], [7, 4], [11, -2],
    ], 5.2),
    ...wave(time.bar(12) + time.beats(1.9), 'chorister', 'orbit', [
      [-8.5, 5.5], [-4.5, 0], [0, 3.5], [4.5, 0], [8.5, 5.5],
    ], 5.1),

    // Four bars of almost nothing. One last chorister crosses the dead nave.
    ...wave(time.bar(14) + time.beats(1.5), 'chorister', 'procession', [[-5.5, 4.2]], 6.4),

    // Return: the held-back space fills from the outside inward.
    ...wave(time.bar(17) + time.beats(0.45), 'vigil', 'procession', [
      [-11, 6], [0, -1], [11, 6],
    ], 5.8),
    ...wave(time.bar(18) + time.beats(0.7), 'pane-wraith', 'glide', [
      [-11, -1.5], [-7, 4], [-2.5, 7], [2.5, 7], [7, 4], [9, -1.5],
    ], 5.5),
    ...wave(time.bar(19) + time.beats(1.9), 'candle-eater', 'descend', [
      [-10, 6], [-6, 0], [-2, 4], [2, 4], [6, 0], [10, 6],
    ], 5.3),
  ];

  // The dead rose: six stolen panes orbit the mouth. Destroying all six
  // unlocks the two-stage core; the perfect policy can resolve both stages
  // before the final cadence.
  const lobeTime = VESPERS_N3LY_MARKERS.rose - time.beats(0.75);
  for (let index = 0; index < 6; index += 1) {
    timeline.push({
      time: lobeTime + index * ENTRY_GAP,
      kind: 'rose-lobe',
      data: {
        lead: 8.9,
        motion: 'rose',
        offset: new Vector3(0, 2.5, 0),
        phase: index * 0.77,
        roseAngle: index / 6 * Math.PI * 2,
      },
    });
  }
  timeline.push({
    time: VESPERS_N3LY_MARKERS.rose + time.beats(0.55),
    kind: 'devourer',
    hitPoints: 10,
    hitStages: [4, 6],
    lockable: false,
    data: {
      lead: 8.35,
      motion: 'core',
      offset: new Vector3(0, 2.5, 0),
      phase: 0,
    },
  });

  return sortTimeline(timeline);
}

// Read-only authoring trace. Runtime instances build a fresh timeline because
// the boss core's live lockable flag changes when all six lobes die.
export const VESPERS_N3LY_SPAWN_TIMELINE = createTimeline();

const KILL_SCORE: Record<VespersN3lyEnemyKind, number> = {
  'pane-wraith': 110,
  'candle-eater': 125,
  chorister: 140,
  vigil: 160,
  'rose-lobe': 240,
  devourer: 2400,
};

export function createVespersN3lyGameplay(
  bus: EventBus,
): LockOnRunnerLevel<VespersN3lyEnemyKind, VespersN3lySpawnData> {
  const timeline = createTimeline();
  const coreEntry = timeline.find((entry) => entry.kind === 'devourer');
  const kindsById = new Map<number, VespersN3lyEnemyKind>();
  let roseLobesRemaining = 6;
  let restoredPanes = 0;

  bus.on('runstart', () => {
    kindsById.clear();
    roseLobesRemaining = 6;
    restoredPanes = 0;
    if (coreEntry) coreEntry.lockable = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'letter') return;
    kindsById.set(enemyId, kind as VespersN3lyEnemyKind);
    if (kind === 'devourer') bus.emit('bossphase', { phase: 'summoned' });
  });
  bus.on('kill', ({ enemyId }) => {
    const kind = kindsById.get(enemyId);
    if (!kind) return;
    restoredPanes += 1;
    if (kind === 'rose-lobe') {
      roseLobesRemaining -= 1;
      if (roseLobesRemaining <= 0 && coreEntry) {
        coreEntry.lockable = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
    if (kind === 'devourer') bus.emit('bossphase', { phase: 'destroyed' });
    kindsById.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    kindsById.delete(enemyId);
  });

  return {
    duration: VESPERS_N3LY_RUN_DURATION,
    bpm: VESPERS_N3LY_BPM,
    createRail: createVespersN3lyRail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    lockRadiusNdc: 0.145,
    timing: {
      shotDelay: {
        gapThirtyseconds: 1,
        releaseShare: 0.58,
        pattern: 'grid-ramp',
        gridRampGapGrowthThirtyseconds: 1,
        maxGridSeconds: 1.1,
      },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      const drift = Math.sin(modeTime * 0.19);
      camera.position.copy(offsetFromRail(curve, 0.018, new Vector3(drift * 1.8, 1.2 + Math.sin(modeTime * 0.13) * 0.5, 0)));
      camera.lookAt(offsetFromRail(curve, 0.075, new Vector3(drift * -0.8, 2.2, 0)));
      camera.rotateZ(Math.sin(modeTime * 0.11) * 0.008);
    },
    updateEnemy({ enemy, runTime, runProgress, age, curve, camera, railAnchor }) {
      const data = enemy.entry.data;
      const anchorU = railAnchor(data.lead);
      const offset = data.offset.clone();

      switch (data.motion) {
        case 'glide': {
          const direction = Math.sign(data.offset.x || Math.sin(data.phase)) || 1;
          offset.x += Math.sin(age * 1.05 + data.phase) * 2.4 - direction * age * 0.42;
          offset.y += Math.sin(age * 1.8 + data.phase) * 0.9;
          offset.z = Math.cos(age * 0.72 + data.phase) * 0.8;
          break;
        }
        case 'descend':
          offset.x += Math.sin(age * 0.9 + data.phase) * 1.25;
          offset.y += (
            data.offset.y > 0
              ? Math.max(0, 1.4 - age * 0.55)
              : Math.max(0, 3.4 - age * 1.1)
          ) + Math.sin(age * 2.1 + data.phase) * 0.45;
          break;
        case 'orbit':
          offset.x += Math.cos(age * 1.55 + data.phase) * 2.3;
          offset.y += Math.sin(age * 1.55 + data.phase) * 2.3;
          offset.z = Math.sin(age * 0.85 + data.phase) * 1.2;
          break;
        case 'procession':
          offset.x += Math.sin(age * 0.48 + data.phase) * 0.8;
          offset.y += Math.sin(age * 0.92 + data.phase) * 0.55;
          offset.z = -Math.sin(Math.min(1, age / 4) * Math.PI) * 1.4;
          break;
        case 'rose': {
          const angle = (data.roseAngle ?? 0) + age * 0.09;
          const radius = 11.6 - Math.min(0.8, age * 0.06);
          offset.x += Math.cos(angle) * radius;
          offset.y += Math.sin(angle) * radius;
          offset.z = Math.sin(age * 0.7 + data.phase) * 0.7;
          break;
        }
        case 'core':
          offset.x += Math.sin(age * 0.45) * 0.3;
          offset.y += Math.sin(age * 0.62) * 0.35;
          offset.z = -Math.min(2.4, age * 0.34);
          break;
      }

      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
      enemy.mesh.quaternion.copy(camera.quaternion);

      if (data.motion === 'core') {
        enemy.mesh.rotateZ(runTime * 0.08);
        const damage = 1 - enemy.hitPointsRemaining / 10;
        enemy.mesh.scale.setScalar(1 + Math.sin(runTime * (2.2 + damage * 2.8)) * (0.025 + damage * 0.07));
      } else if (data.motion === 'rose') {
        enemy.mesh.rotateZ((data.roseAngle ?? 0) + runTime * 0.12);
      } else {
        enemy.mesh.rotateZ(Math.sin(runTime * 0.45 + data.phase) * 0.18);
        enemy.mesh.rotateY(Math.sin(runTime * 0.7 + data.phase) * 0.16);
      }

      const grace = data.motion === 'core' || data.motion === 'rose' ? 0.02 : 0.026;
      return runProgress > Math.min(1, anchorU + grace);
    },
    scoreForHit(volleySize) {
      return 45 + volleySize * 12;
    },
    scoreForKill(volleySize, enemy) {
      const choirMultiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * choirMultiplier);
    },
    rankForRun(score, kills, totalEnemies) {
      const ratio = totalEnemies > 0 ? kills / totalEnemies : 0;
      if (ratio >= 0.98 && score >= 12_000) return 'LUX';
      if (ratio >= 0.86) return 'CANTOR';
      if (ratio >= 0.68) return 'VIGIL';
      if (ratio >= 0.45) return 'EMBER';
      return 'UMBRA';
    },
    detailsForRun() {
      return [`PANES RESTORED ${restoredPanes}`];
    },
  };
}
