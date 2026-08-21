import { CatmullRomCurve3, Matrix4, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, sampleRailFrame, smoothRunProgress } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import { createEventBus, type EventBus } from '../../events';
import { createDevourer, type DevourerSpawnData } from './devourer';
import { NAVE_WINDOWS, naveWindowPair, naveWindowZ } from './layout';
import { noteStolenWindow } from './lightstate';
import { VESPERS_BPM, VESPERS_MARKERS, VESPERS_RUN_DURATION, VESPERS_TIME } from './timing';

// A 22-bar (~63s) run down the nave in four movements. The processional gives
// each organ voice a wave to enter with; the feast is the dense counterpoint;
// the silence strips the screen to almost nothing so the rose has something to
// break. Every thief carries one stolen pane: the window it stripped relights
// where it falls, and stays lit for the rest of the run.

export { VESPERS_RUN_DURATION } from './timing';
export const VESPERS_PLAYER_HEALTH = 3;

export type VespersEnemyKind =
  | 'shade'
  | 'censer'
  | 'watcher'
  | 'gloom'
  | 'spoke'
  | 'petal'
  | 'heart';
export type VespersTargetKind = VespersEnemyKind | 'letter';
export type VespersWavePattern = 'hold' | 'drift' | 'weave' | 'sweep' | 'pendulum';

type GloomData = {
  role: 'gloom';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

type WaveData = {
  role: 'wave';
  lead: number;
  pattern: VespersWavePattern;
  offset: Vector3;
  phase: number;
  /** Nave window this enemy stripped; relit where it falls. -1 while unassigned. */
  window: number;
};

export type VespersSpawnData = WaveData | GloomData | DevourerSpawnData;
export type VespersSpawnEntry = LockOnSpawnEntry<VespersEnemyKind, VespersSpawnData>;
export type VespersUpdate = LockOnEnemyUpdate<VespersEnemyKind, VespersSpawnData>;

export function createVespersRail() {
  // The nave axis: a slow processional sway, wide enough for the walls and
  // window tiers to parallax, narrow enough that the architecture reads as
  // one built room rather than a tunnel.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(2.2, 0.6, -34),
      new Vector3(-2.8, -0.4, -68),
      new Vector3(3.2, 0.8, -102),
      new Vector3(-3.4, 0.4, -136),
      new Vector3(2.6, -0.8, -170),
      new Vector3(-2.2, 0.6, -204),
      new Vector3(1.8, 0.9, -238),
      new Vector3(-1.6, 0.2, -272),
      new Vector3(1.2, -0.5, -306),
      new Vector3(0.6, 0.4, -340),
      new Vector3(0, 0, -372),
    ],
    false,
    'catmullrom',
    0.5,
  );
}

const RAIL = createVespersRail();
const RAIL_LENGTH = RAIL.getLength();

// Nearest nave window to a rail position — used to decide which pane a thief
// is carrying, so the light returns roughly where the kill happens.
function windowRailU(index: number): number {
  return Math.min(1, Math.abs(naveWindowZ(naveWindowPair(index))) / RAIL_LENGTH);
}

function assignWindows(entries: VespersSpawnEntry[]): VespersSpawnEntry[] {
  const taken = new Set<number>();
  for (const entry of entries) {
    const data = entry.data as WaveData;
    if (data.role !== 'wave') continue;
    const seatU = smoothRunProgress(entry.time + data.lead, VESPERS_RUN_DURATION);
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < NAVE_WINDOWS; index += 1) {
      if (taken.has(index)) continue;
      const distance = Math.abs(windowRailU(index) - seatU);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    if (best >= 0) {
      taken.add(best);
      data.window = best;
    }
  }
  return entries;
}

const wave = (
  time: number,
  lead: number,
  pattern: VespersWavePattern,
  kind: VespersEnemyKind,
  offsets: Array<[number, number]>,
): VespersSpawnEntry[] =>
  formation(time, VESPERS_TIME.seconds(0.16), offsets, (offset, index) => ({
    kind,
    data: {
      role: 'wave',
      lead,
      pattern,
      offset: new Vector3(offset[0], offset[1], 0),
      phase: index * 1.13,
      window: -1,
    },
  }));

const shades = (time: number, lead: number, pattern: VespersWavePattern, offsets: Array<[number, number]>) =>
  wave(time, lead, pattern, 'shade', offsets);

const censers = (time: number, lead: number, offsets: Array<[number, number]>) =>
  wave(time, lead, 'pendulum', 'censer', offsets);

const watchers = (time: number, lead: number, offsets: Array<[number, number]>) =>
  wave(time, lead, 'hold', 'watcher', offsets);

const time = VESPERS_TIME;

function createVespersTimeline(devourer: ReturnType<typeof createDevourer>): VespersSpawnEntry[] {
  return [
    // --- Processional (bars 0-7): the pedal note alone, then one thief per
    // entering voice. Room to learn the sweep in a near-dark nave.
    ...section(VESPERS_MARKERS.run,
      shades(time.bar(1, 2), 3.4, 'sweep', [[-9, 2], [-5.5, 4], [1.5, 5.5], [5.5, 4], [9, 2]]),
      shades(time.bar(3, 2), 3.3, 'weave', [[-9.5, -3], [-6, 2], [1.5, 4], [6, 2], [9.5, -3]]),
      censers(time.bar(5, 0), 3.4, [[-7, 0.5], [7, 0.5]]),
      shades(time.bar(5, 1), 3.3, 'weave', [[-8, 5], [2, 6], [8, 5]]),
      shades(time.bar(6, 2), 3.2, 'sweep', [[-10, 1], [-6, -3.5], [1.5, 3.5], [6, -3.5], [10, 1]]),
      censers(time.bar(7, 0), 3.3, [[3, -1]]),
    ),

    // --- Feast (bars 8-13): full counterpoint, watchers shoot back.
    ...section(VESPERS_MARKERS.feast,
      watchers(time.bar(0, 0), 3.3, [[-2.5, 5]]),
      shades(time.bar(0, 1), 3.2, 'sweep', [[-9, 1], [-4.5, -3], [4.5, -3], [9, 1]]),
      censers(time.bar(1, 1), 3.3, [[-7.5, 1.5], [0.5, 4.5], [7.5, 1.5]]),
      shades(time.bar(2, 1), 3.3, 'sweep', [[-10, 3], [-6, 5], [-2, 6], [2, 6], [6, 5], [10, 3]]),
      watchers(time.bar(2, 2), 3.2, [[-6.5, -2.5], [6.5, -2.5]]),
      shades(time.bar(3, 2), 3.2, 'weave', [[-10, 5.5], [-6, 3], [1, -1.5], [6, 3], [10, 5.5]]),
      censers(time.bar(4, 0), 3.3, [[-5, 6], [5, 6]]),
      watchers(time.bar(4, 2), 3.2, [[-6.5, 3.5], [6.5, 3.5]]),
      shades(time.bar(4, 3), 3.1, 'sweep', [[2, 5.5], [-6, 2], [6, 2], [-2, -3]]),
      shades(time.bar(5, 2), 3.1, 'sweep', [[-10, -2], [-6, 4], [-2.5, -3.5], [2.5, -3.5], [6, 4], [10, -2]]),
    ),

    // --- The silence (bars 14-16): one voice, three lone shades in a dark
    // span, so the west end arrives against nothing.
    ...section(VESPERS_MARKERS.silence,
      shades(time.bar(0, 2), 5.6, 'weave', [[-10, 3.5]]),
      shades(time.bar(1, 2), 5.6, 'weave', [[10, 3.5]]),
      shades(time.bar(2, 1), 5.8, 'weave', [[2.5, 5]]),
    ),

    // --- The rose (bar 17+): the Devourer in the dead west window.
    ...devourer.entries(VESPERS_MARKERS.rose),
  ];
}

const traceDevourer = createDevourer(createEventBus(), () => {});
export const VESPERS_TIMELINE: VespersSpawnEntry[] = sortTimeline(
  assignWindows(createVespersTimeline(traceDevourer)),
);

const KILL_SCORE: Record<VespersEnemyKind, number> = {
  shade: 100,
  censer: 150,
  watcher: 150,
  gloom: 40,
  spoke: 120,
  petal: 250,
  heart: 2000,
};

const GLOOM_MAX_AGE = 14;

export function createVespersGameplay(bus: EventBus): LockOnRunnerLevel<VespersEnemyKind, VespersSpawnData> {
  const gloomInterceptions = new Set<number>();
  const windowEnemyIds = new Set<number>();
  let hitsTaken = 0;
  let windowsRelit = 0;

  function fireGloom(context: VespersUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.0);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'gloom',
      countsTowardTotal: false,
      data: { role: 'gloom', position: from.clone(), velocity: initial, lastAge: 0 },
    });
  }

  const devourer = createDevourer(bus, fireGloom);
  const timeline = sortTimeline(assignWindows(createVespersTimeline(devourer)));

  bus.on('runstart', () => {
    gloomInterceptions.clear();
    windowEnemyIds.clear();
    hitsTaken = 0;
    windowsRelit = 0;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    gloomInterceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    gloomInterceptions.delete(enemyId);
    if (windowEnemyIds.delete(enemyId)) windowsRelit += 1;
  });

  bus.on('miss', ({ enemyId }) => {
    gloomInterceptions.delete(enemyId);
  });

  function updateWave(context: VespersUpdate, data: WaveData) {
    const { enemy, runTime, age, runProgress, curve, camera, railAnchor } = context;
    context.enemyState(() => {
      if (data.window >= 0) {
        noteStolenWindow(enemy.id, data.window);
        windowEnemyIds.add(enemy.id);
      }
      return {};
    });

    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();

    if (data.pattern === 'drift') {
      offset.x += Math.sin(age * 0.8 + data.phase) * 2.2;
      offset.y += Math.cos(age * 0.6 + data.phase * 0.7) * 0.9;
    } else if (data.pattern === 'weave') {
      offset.x += Math.sin(age * 1.6 + data.phase) * 3.4;
      offset.y += Math.sin(age * 1.1 + data.phase * 1.7) * 1.3;
    } else if (data.pattern === 'sweep') {
      // A long lateral glide across the nave: the thief crosses a whole bay
      // while it is on screen, so the reticle has to travel.
      offset.x += Math.sin(age * 0.85 + data.phase) * 4.8;
      offset.y += Math.cos(age * 0.55 + data.phase) * 1.4;
    } else {
      offset.y += Math.sin(age * 1.2 + data.phase) * 0.35;
    }

    if (enemy.kind === 'censer') {
      // Pendulum: the lantern hangs L below an invisible anchor point and
      // swings through the rail frame; the mesh carries its own chain, so
      // both position and orientation come from the swing angle.
      const L = 6.2;
      const anchorOffset = data.offset.clone();
      anchorOffset.y += L;
      const swing = Math.sin(age * 1.35 + data.phase) * 0.55;
      offset.copy(anchorOffset);
      offset.x += Math.sin(swing) * L;
      offset.y -= Math.cos(swing) * L;

      const frame = sampleRailFrame(curve, anchorU);
      const lantern = offsetFromRail(curve, anchorU, offset);
      const anchor = offsetFromRail(curve, anchorU, anchorOffset);
      const chainUp = anchor.sub(lantern).normalize();
      const right = new Vector3().crossVectors(chainUp, frame.tangent).normalize();
      const forward = new Vector3().crossVectors(right, chainUp).normalize();
      enemy.mesh.position.copy(lantern);
      enemy.mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, chainUp, forward));
      enemy.mesh.rotateY(runTime * 0.6);
      return runProgress > anchorU + 0.02;
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);

    if (enemy.kind === 'watcher') {
      // The iris flares for half a beat before the shot — the telegraph is
      // the tell that this one shoots back.
      const fire = context.enemyState(() => ({ nextAt: 1.7, shotsLeft: 2, charging: false }));
      if (!fire.charging && fire.shotsLeft > 0 && age >= fire.nextAt) {
        fire.charging = true;
        enemy.mesh.userData.chargeUntil = runTime + 0.55;
      }
      if (fire.charging && runTime >= (enemy.mesh.userData.chargeUntil ?? 0)) {
        fire.charging = false;
        fire.shotsLeft -= 1;
        fire.nextAt = age + 2.3;
        fireGloom(context, enemy.mesh.position);
      }
    }

    return runProgress > anchorU + 0.018;
  }

  function updateGloom(context: VespersUpdate, data: GloomData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: gloomInterceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 8);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.2,
      maxSpeed: 10.5,
      accel: 2.8,
      turnRate: 2.0,
    });

    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 2.6);

    return shotBehindCamera(camera, data.position) || age > GLOOM_MAX_AGE;
  }

  return {
    duration: VESPERS_RUN_DURATION,
    bpm: VESPERS_BPM,
    playerHealth: VESPERS_PLAYER_HEALTH,
    createRail: createVespersRail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'gloom':
          return updateGloom(context, data);
        case 'spoke':
        case 'petal':
        case 'heart':
          return devourer.update(context, data);
      }
    },
    validateRelease(enemies) {
      return devourer.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 40,
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 9000 && clearRate >= 0.85) return 'S';
      if (score >= 6800 && clearRate >= 0.7) return 'A';
      if (score >= 4300 && clearRate >= 0.5) return 'B';
      if (score >= 1900 && clearRate >= 0.3) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, VESPERS_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${VESPERS_PLAYER_HEALTH}`, `Windows relit ${Math.min(windowsRelit, NAVE_WINDOWS)}/${NAVE_WINDOWS}`];
      const summary = devourer.summary();
      if (summary) lines.push(summary);
      return lines;
    },
  };
}
