import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import { offsetFromRail } from '../../engine/rail';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';

// Vespers is eighteen 4/4 bars at 72 BPM: a full minute from the first
// downbeat to the rose window's final major chord.
export const VESPERS_X0UX_BPM = 72;
export const VESPERS_X0UX_TIME = createMusicTime(VESPERS_X0UX_BPM, { stepsPerBar: 16 });
export const VESPERS_X0UX_RUN_DURATION = VESPERS_X0UX_TIME.bar(18);
export const VESPERS_X0UX_MARKERS = VESPERS_X0UX_TIME.markers({
  nave: [0, 0],
  arcade: [4, 0],
  silence: [8, 0],
  approach: [11, 0],
  roseEntrance: [13, 2],
  finale: [16, 0],
});

export type VespersEnemyKind = 'wisp' | 'gargoyle' | 'cowl' | 'rose-shell' | 'rose-core';
export type VespersSpawnData =
  | { role: 'wisp'; lead: number; offset: Vector3; phase: number }
  | { role: 'gargoyle'; lead: number; offset: Vector3; phase: number }
  | { role: 'cowl'; lead: number; offset: Vector3; phase: number }
  | { role: 'shell'; lead: number; offset: Vector3 }
  | { role: 'core'; lead: number; offset: Vector3 };

export type VespersSpawnEntry = LockOnSpawnEntry<VespersEnemyKind, VespersSpawnData>;
export type VespersUpdate = LockOnEnemyUpdate<VespersEnemyKind, VespersSpawnData>;

export function createVespersRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 1.2, -34),
      new Vector3(9, 0, -76),
      new Vector3(-8, 2.4, -120),
      new Vector3(-13, -1, -164),
      new Vector3(8, 1.5, -210),
      new Vector3(12, 0, -256),
      new Vector3(-11, 3, -304),
      new Vector3(-16, -1.5, -352),
      new Vector3(10, 2, -400),
      new Vector3(14, 0, -448),
      new Vector3(-8, 1.8, -496),
      new Vector3(-4, 0, -548),
      new Vector3(5, 2, -600),
      new Vector3(0, 0, -650),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

const time = VESPERS_X0UX_TIME;
const formationGap = time.seconds(0.16);

function wave(
  at: number,
  kind: 'wisp' | 'gargoyle' | 'cowl',
  lead: number,
  offsets: Array<[number, number]>,
  phase = 0,
): VespersSpawnEntry[] {
  const seatedLead = Math.max(2.7, lead * 0.72);
  return offsets.map((offset, index) => ({
    time: at + index * formationGap,
    kind,
    data: {
      role: kind,
      lead: seatedLead,
      offset: new Vector3(offset[0], offset[1], 0),
      phase: phase + index * 0.83,
    },
  }));
}

export function createVespersTimeline() {
  const shell: VespersSpawnEntry = {
    time: VESPERS_X0UX_MARKERS.roseEntrance,
    kind: 'rose-shell',
    hitStages: [1],
    data: { role: 'shell', lead: 12.8, offset: new Vector3(0, 3.1, 0) },
  };
  const core: VespersSpawnEntry = {
    time: time.bar(13, 2.25),
    kind: 'rose-core',
    hitStages: [1, 1],
    lockable: false,
    data: { role: 'core', lead: 12.3, offset: new Vector3(0, 3.1, 0) },
  };

  return [
    // The first voices enter one at a time: a clean nave for learning the
    // sweep, then formations that climb from the candle floor to the vault.
    ...wave(time.step(0, 4), 'wisp', 4.7, [[-7.8, -1.4], [-2.6, 2.8], [2.7, 4.4], [7.5, 0.2]], 0.2),
    ...wave(time.step(1, 2), 'gargoyle', 4.9, [[-8.5, 4.8], [0, -1.8], [8.5, 3.8]], 1.1),
    ...wave(time.step(2, 0), 'cowl', 4.8, [[-8.8, 1], [-4.1, 5.2], [1, 0.8], [5.2, 4.4], [9, -1]], 0.5),
    ...wave(time.step(3, 4), 'wisp', 4.4, [[-9.4, 3.8], [-5.2, -1.8], [0, 5.8], [5.3, -0.8], [9.3, 3.4]], 2.2),

    // Arcade/gallery: overlapping fan formations, but every line has a
    // different silhouette and a different route through the nave.
    ...wave(time.bar(4), 'cowl', 4.7, [[-9.5, -1.2], [-6.1, 3], [-2.6, 5.7], [2.4, 1], [6.5, 5.1], [9.5, -0.5]], 0.1),
    ...wave(time.step(5, 3), 'wisp', 4.5, [[-8.8, 5.4], [-4.3, 1], [0, -2.2], [4.5, 2.7], [9, 5.8]], 1.4),
    ...wave(time.bar(6), 'gargoyle', 4.6, [[-8.8, 0], [-4.5, 4.8], [0, -1], [4.8, 5.6], [9, 1.2]], 2.6),
    ...wave(time.step(6, 9), 'wisp', 4.2, [[-9.2, 2], [-5, 5.5], [-1.2, 0], [3.4, 4.8], [7.6, -1.2]], 0.8),
    ...wave(time.step(7, 5), 'cowl', 4.3, [[-9.5, 4.6], [-4.7, -1.2], [0.5, 5.9], [5.1, 0.4], [9.2, 3.8]], 1.8),

    // The long dark span. One voice at a time, with whole phrases left open
    // for the organ's held pedal and the player's own kill line.
    ...wave(time.step(8, 5), 'wisp', 5.0, [[-8.8, 4.8]], 0.4),
    ...wave(time.bar(9), 'gargoyle', 5.0, [[8.6, -1.8]], 2.2),
    ...wave(time.step(10, 8), 'cowl', 4.9, [[-7.8, 5.7]], 1.1),
    ...wave(time.step(11, 4), 'wisp', 4.8, [[8.9, 2.3]], 3.4),

    // Light begins to return in the approach to the west end.
    ...wave(time.step(11, 12), 'cowl', 4.3, [[-9.2, -0.7], [0, 5.8], [9.2, 0.8]], 0.3),
    ...wave(time.bar(12), 'gargoyle', 4.2, [[-8.2, 4.4], [-3.8, -1.2], [3.8, 0], [8.4, 5.2]], 1.8),
    ...wave(time.step(12, 10), 'wisp', 4.0, [[-8.8, 5.7], [-4.3, 1.3], [0, -1.7], [4.4, 2.6], [8.8, 5.2]], 2.8),

    shell,
    core,
  ].sort((a, b) => a.time - b.time);
}

export const VESPERS_X0UX_SPAWN_TIMELINE = createVespersTimeline();

const KILL_SCORE: Record<VespersEnemyKind, number> = {
  wisp: 110,
  gargoyle: 145,
  cowl: 165,
  'rose-shell': 320,
  'rose-core': 1800,
};

export function createVespersGameplay(bus: EventBus): LockOnRunnerLevel<VespersEnemyKind, VespersSpawnData> {
  const timeline = createVespersTimeline();
  const coreEntry = timeline.find((entry) => entry.kind === 'rose-core')!;
  let shellId = -1;
  let coreId = -1;
  let roseExposed = false;
  let roseDestroyed = false;
  let hitsTaken = 0;

  bus.on('runstart', () => {
    shellId = -1;
    coreId = -1;
    roseExposed = false;
    roseDestroyed = false;
    hitsTaken = 0;
    coreEntry.lockable = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'rose-shell') {
      shellId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    } else if (kind === 'rose-core') {
      coreId = enemyId;
    }
  });
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== shellId || roseExposed) return;
    roseExposed = true;
    coreEntry.lockable = true;
    bus.emit('bossphase', { phase: 'exposed' });
  });
  bus.on('kill', ({ enemyId }) => {
    // The shell is a single decisive break: the stolen colours spill out and
    // the previously sealed oculus becomes a final two-strike target.
    if (enemyId === shellId && !roseExposed) {
      roseExposed = true;
      coreEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
    if (enemyId === coreId && !roseDestroyed) {
      roseDestroyed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('playerhit', () => { hitsTaken += 1; });

  function updateWave(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'wisp' | 'gargoyle' | 'cowl' }>) {
    const { enemy, age, runProgress, curve, camera, railAnchor } = context;
    const anchor = railAnchor(data.lead);
    const offset = data.offset.clone();
    // Rail-relative offsets are authored in nave metres; the extra spread keeps
    // the player sweeping the full stained-glass width instead of a central
    // column once perspective compresses the distant targets.
    offset.x *= 1.15;
    offset.y = offset.y * 1.25 - 0.8;
    if (data.role === 'wisp') {
      // A slow, almost weightless lateral sway: the black silhouette stays
      // legible while the stolen pane in its chest catches the eye.
      offset.x += Math.sin(age * 1.1 + data.phase) * 1.25;
      offset.y += Math.cos(age * 0.78 + data.phase) * 0.55;
      offset.z += Math.sin(age * 1.6 + data.phase) * 0.35;
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * (0.6 + (enemy.id % 3) * 0.08));
    } else if (data.role === 'gargoyle') {
      // A broad cross-nave glide with a rising wingbeat arc.
      const cross = Math.sin(MathUtils.clamp(age / Math.max(0.1, data.lead), 0, 1) * Math.PI);
      offset.x += Math.sin(age * 0.62 + data.phase) * 1.1 + cross * (enemy.id % 2 === 0 ? 2.1 : -2.1);
      offset.y += Math.sin(age * 0.9 + data.phase) * 0.65 + cross * 1.2;
      offset.z += Math.sin(age * 1.2 + data.phase) * 0.5;
      enemy.mesh.lookAt(offsetFromRail(curve, anchor, offset.clone().add(new Vector3(0.5, 0.15, -0.1))));
      enemy.mesh.rotateZ(Math.sin(age * 2.2 + data.phase) * 0.22);
    } else {
      // The cowl traces a slow orbit, like a hooded figure circling a pillar.
      const orbit = age * 0.92 + data.phase;
      offset.x += Math.cos(orbit) * 1.8;
      offset.y += Math.sin(orbit * 1.15) * 1.6;
      offset.z += Math.sin(orbit) * 0.8;
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(-orbit * 0.72);
      enemy.mesh.rotateY(Math.sin(orbit * 0.6) * 0.28);
    }
    enemy.mesh.position.copy(offsetFromRail(curve, anchor, offset));
    return runProgress > anchor + 0.018;
  }

  function updateRose(context: VespersUpdate, data: Extract<VespersSpawnData, { role: 'shell' | 'core' }>) {
    const { enemy, age, camera } = context;
    // The west rose is a screen-space set piece. It holds a readable seat just
    // ahead of the camera while the nave keeps moving under it.
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    enemy.mesh.position.copy(camera.position)
      .addScaledVector(forward, 18)
      .addScaledVector(right, data.offset.x)
      .addScaledVector(up, data.offset.y);
    enemy.mesh.quaternion.copy(camera.quaternion);
    if (data.role === 'shell') {
      enemy.mesh.rotateZ(-age * 0.17);
      enemy.mesh.rotateY(Math.sin(age * 0.32) * 0.12);
      enemy.mesh.userData.exposed = roseExposed;
    } else {
      enemy.mesh.visible = roseExposed;
      enemy.mesh.rotateZ(age * 0.38);
      enemy.mesh.rotateX(Math.sin(age * 1.4) * 0.08);
      enemy.mesh.userData.exposed = roseExposed;
      // A delayed rose pulse makes the exposed oculus more than a static
      // target: quick volleys are safe, hesitation costs one hull point.
      const pulse = context.enemyState(() => ({ emitted: false }));
      if (roseExposed && !pulse.emitted && age > 0.68) {
        pulse.emitted = true;
        context.damagePlayer(1);
      }
    }
    // Boss placement is deliberately camera-seated and long-lived: this is a
    // set piece, not a normal target that should be passed immediately.
    return false;
  }

  return {
    duration: VESPERS_X0UX_RUN_DURATION,
    bpm: VESPERS_X0UX_BPM,
    createRail: createVespersRail,
    spawnTimeline: timeline,
    startWord: 'START!',
    replayWord: 'REPLAY',
    playerHealth: 3,
    timing: {
      shotDelay: { maxGridSeconds: 0.48, gapThirtyseconds: 1, gridRampGapGrowthThirtyseconds: 1 },
      actionSfx: { enabled: true, gridThirtyseconds: 2 },
    },
    updateAttractCamera({ camera, modeTime }) {
      camera.rotateZ(Math.sin(modeTime * 0.36) * 0.002);
      camera.position.y += Math.sin(modeTime * 0.6) * 0.015;
    },
    updateCameraEffects({ camera, runTime, runProgress }) {
      const swell = runProgress > 0.72 ? (runProgress - 0.72) / 0.28 : 0;
      camera.rotateZ(Math.sin(runTime * 0.38) * 0.0025 + swell * 0.006);
      camera.rotateX(Math.sin(runTime * 0.29 + 1.2) * 0.0015);
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wisp':
        case 'gargoyle':
        case 'cowl':
          return updateWave(context, data);
        case 'shell':
        case 'core':
          return updateRose(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 55,
    scoreForVolley(results) {
      if (results.length >= 4 && results.every((result) => result.killed)) return results.length === 6 ? 420 : results.length * 55;
      return 0;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (roseDestroyed && score >= 9000 && clearRate >= 0.72) return 'S';
      if (score >= 7600 && clearRate >= 0.55) return 'A';
      if (score >= 4700 && clearRate >= 0.35) return 'B';
      if (score >= 2200 && clearRate >= 0.18) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, 3 - hitsTaken);
      return [`Hull ${hull}/3`, roseDestroyed ? 'Rose window reclaimed' : 'The west rose remains dark'];
    },
  };
}
