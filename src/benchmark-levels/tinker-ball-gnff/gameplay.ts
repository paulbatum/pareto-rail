import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { Object3D } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { createEventBus, type EventBus } from '../../events';
import { createTinkerSpill, type SpillSpawnData, type TinkerSpawnEntry, type TinkerSpill } from './spill';
import { TINKER_BPM, TINKER_MARKERS, TINKER_RUN_DURATION, TINKER_TIME } from './timing';

// Tinker Ball: a 60-second sweep across one oversized worktable. The ball
// rolls its own route (the rail); the player picks off glue monsters built
// around black adhesive cores. Three scale acts — marble, tennis ball,
// melon — then the Spill swallows the table's end and must be cracked open
// layer by layer. The player has a 3-point hull; glue globs home in and must
// be shot down before they splat.

export { TINKER_BPM, TINKER_RUN_DURATION } from './timing';
export const TINKER_PLAYER_HEALTH = 4;

// World height of the table surface. The rail flies a little above it; the
// ball, the props, and the settled debris all sit on this plane.
export const TINKER_TABLE_Y = -3;

export type TinkerEnemyKind =
  | 'beetle'
  | 'snapper'
  | 'walker'
  | 'glob'
  | 'spill-orbit'
  | 'spill-node'
  | 'spill-core';

export type TinkerMovementData =
  | { role: 'scuttle'; lead: number; offset: Vector3; seed: number }
  | { role: 'swoop'; lead: number; fromX: number; toX: number; y: number; arc: number; crossTime: number; delay: number; seed: number }
  | { role: 'stalk'; lead: number; offset: Vector3; seed: number; fireForever?: boolean }
  | { role: 'glob'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState };

export type TinkerSpawnData = TinkerMovementData | SpillSpawnData;
export type TinkerUpdate = LockOnEnemyUpdate<TinkerEnemyKind, TinkerSpawnData>;

export function createTinkerRail() {
  // A wandering route across the table: long lateral sweeps with gentle
  // rises over clutter. Height stays near the table plane so props and the
  // ball can sit on one flat surface.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0.2, 0),
      new Vector3(7, 0.45, -34),
      new Vector3(-6, -0.1, -70),
      new Vector3(-17, 0.4, -104),
      new Vector3(-8, 0.1, -140),
      new Vector3(10, 0.5, -172),
      new Vector3(21, 0.15, -206),
      new Vector3(12, 0.55, -240),
      new Vector3(-7, 0.05, -272),
      new Vector3(-20, 0.45, -306),
      new Vector3(-9, 0.2, -340),
      new Vector3(6, 0.5, -374),
      new Vector3(2, 0.3, -404),
      new Vector3(0, 0.2, -428),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

// ---- spawn helpers ---------------------------------------------------------

const time = TINKER_TIME;

const beetles = (entryTime: number, lead: number, offsets: Array<[number, number]>): TinkerSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: entryTime + index * 0.13,
    kind: 'beetle',
    data: {
      role: 'scuttle',
      lead,
      seed: index * 2.13 + entryTime,
      offset: new Vector3(offset[0], offset[1], 0),
    },
  }));

const snappers = (
  entryTime: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number }>,
): TinkerSpawnEntry[] =>
  runs.map((run, index) => ({
    time: entryTime + index * 0.12,
    kind: 'snapper',
    data: {
      role: 'swoop',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.38,
      crossTime: 2.7,
      seed: index * 1.71 + entryTime,
    },
  }));

const walkers = (entryTime: number, lead: number, offsets: Array<[number, number]>, fireForever = false): TinkerSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: entryTime + index * 0.22,
    kind: 'walker',
    hitStages: [1, 1],
    data: {
      role: 'stalk',
      lead,
      seed: index * 3.07 + entryTime,
      fireForever,
      offset: new Vector3(offset[0], offset[1], 0),
    },
  }));

function createTinkerTimeline(spill: TinkerSpill): TinkerSpawnEntry[] {
  return [
    // --- Act 1 · marble-sized. Room to learn the sweep among button beetles.
    ...beetles(time.bar(1, 2), 3.4, [[-7.0, 2.6], [-2.8, 5.5], [2.8, 5.5], [7.0, 2.6]]),
    ...beetles(time.bar(3), 3.6, [[-8.0, -2.3], [-3.8, 4.1], [0.0, 7.2], [3.8, 4.1], [8.0, -2.3]]),
    ...snappers(time.bar(4, 2), 3.4, [
      { fromX: -18, toX: 18, y: 5.1, arc: 3.2 },
      { fromX: 18, toX: -18, y: 7.8, arc: 2.2, delay: 0.3 },
      { fromX: -18, toX: 18, y: -1.6, arc: 3.8, delay: 0.6 },
    ]),
    ...beetles(time.bar(6), 3.5, [[-9.0, -1.4], [-5.2, 4.3], [-1.9, 7.0], [1.9, 7.0], [5.2, 4.3], [9.0, -1.4]]),
    ...snappers(time.bar(7, 2), 3.3, [
      { fromX: -16, toX: 16, y: 6.5, arc: 3.0 },
      { fromX: 16, toX: -16, y: -1.1, arc: 3.6, delay: 0.35 },
    ]),
    ...beetles(time.bar(7, 3), 3.2, [[-5.5, 3.8], [5.5, 3.8]]),

    // --- Act 2 · tennis-ball scale. Snapper flocks thicken; stalkers arrive
    // and start throwing glue.
    ...snappers(time.bar(8, 2), 3.4, [
      { fromX: -18, toX: 18, y: 3.8, arc: 4.1 },
      { fromX: 18, toX: -18, y: 7.0, arc: 2.7, delay: 0.25 },
      { fromX: -18, toX: 18, y: 8.6, arc: 1.9, delay: 0.5 },
      { fromX: 18, toX: -18, y: -2.2, arc: 4.6, delay: 0.75 },
    ]),
    ...walkers(time.bar(10), 4.2, [[0.0, 7.5]]),
    ...beetles(time.bar(10, 1), 3.3, [[-7.5, -1.7], [-3.0, 4.3], [3.0, 4.3], [7.5, -1.7]]),
    ...snappers(time.bar(11, 2), 3.3, [
      { fromX: -19, toX: 19, y: 4.9, arc: 3.8 },
      { fromX: 19, toX: -19, y: -1.4, arc: 4.3, delay: 0.2 },
      { fromX: -19, toX: 19, y: 8.1, arc: 2.4, delay: 0.4 },
      { fromX: 19, toX: -19, y: 0.8, arc: 4.1, delay: 0.6 },
      { fromX: -19, toX: 19, y: 6.5, arc: 3.0, delay: 0.8 },
    ]),
    ...walkers(time.bar(13), 4.0, [[-7.0, 6.1], [7.0, 6.1]]),
    ...beetles(time.bar(13, 1), 3.4, [[-8.5, -2.0], [-3.2, 4.3], [3.2, 4.3], [8.5, -2.0]]),
    ...snappers(time.bar(14, 2), 3.2, [
      { fromX: -20, toX: 20, y: 4.1, arc: 4.3 },
      { fromX: 20, toX: -20, y: 7.3, arc: 3.0, delay: 0.18 },
      { fromX: -20, toX: 20, y: -1.9, arc: 4.9, delay: 0.36 },
      { fromX: 20, toX: -20, y: 5.4, arc: 3.5, delay: 0.54 },
      { fromX: -20, toX: 20, y: 8.9, arc: 2.2, delay: 0.72 },
      { fromX: 20, toX: -20, y: -0.3, arc: 4.5, delay: 0.9 },
    ]),
    ...walkers(time.bar(15, 3), 4.4, [[0.0, 7.5]]),

    // --- Act 3 · melon scale. Heavier waves, stalkers in pairs and trios.
    ...beetles(time.bar(16, 2), 3.3, [[-9.5, -2.3], [-5.8, 4.1], [-2.0, 6.7], [2.0, 6.7], [5.8, 4.1], [9.5, -2.3]]),
    ...walkers(time.bar(17, 2), 3.8, [[-7.5, 6.7], [7.5, 6.7]]),
    ...snappers(time.bar(17, 3), 3.2, [
      { fromX: -20, toX: 20, y: 4.6, arc: 4.1 },
      { fromX: 20, toX: -20, y: 8.1, arc: 2.7, delay: 0.25 },
      { fromX: -20, toX: 20, y: -1.6, arc: 4.6, delay: 0.5 },
      { fromX: 20, toX: -20, y: 1.1, arc: 4.2, delay: 0.75 },
    ]),
    ...walkers(time.bar(19), 3.9, [[-7.5, 5.2], [0.0, 7.8], [7.5, 5.2]]),
    ...snappers(time.bar(20), 3.0, [
      { fromX: -21, toX: 21, y: 5.1, arc: 3.8, delay: 0 },
      { fromX: 21, toX: -21, y: -1.4, arc: 4.5, delay: 0.16 },
      { fromX: -21, toX: 21, y: 8.4, arc: 2.4, delay: 0.32 },
      { fromX: 21, toX: -21, y: 1.1, arc: 4.2, delay: 0.48 },
      { fromX: -21, toX: 21, y: 6.5, arc: 3.1, delay: 0.64 },
      { fromX: 21, toX: -21, y: -2.4, arc: 4.7, delay: 0.8 },
    ]),
    ...beetles(time.bar(20, 1), 3.1, [[-7.0, -1.7], [0.0, 7.0], [7.0, -1.7]]),

    // (bars 20.5–21.5: the table empties for the Spill entrance)

    // --- The Spill. Layers crack one by one; each break showers the route.
    ...spill.entries(TINKER_MARKERS.spillEntrance),
  ];
}

export function createTinkerTimelineSorted(): TinkerSpawnEntry[] {
  const spill = createTinkerSpill(createEventBus(), () => {});
  return createTinkerTimeline(spill).sort((a, b) => a.time - b.time);
}

export const TINKER_TIMELINE: TinkerSpawnEntry[] = createTinkerTimelineSorted();

const KILL_SCORE: Record<TinkerEnemyKind, number> = {
  beetle: 100,
  snapper: 140,
  walker: 220,
  glob: 40,
  'spill-orbit': 150,
  'spill-node': 300,
  'spill-core': 1500,
};

const GLOB_MAX_AGE = 13;

export function createTinkerGameplay(
  bus: EventBus,
): LockOnRunnerLevel<TinkerEnemyKind, TinkerSpawnData> {
  const globInterceptions = new Set<number>();
  let hitsTaken = 0;
  let piecesGathered = 0;

  bus.on('runstart', () => {
    globInterceptions.clear();
    hitsTaken = 0;
    piecesGathered = 0;
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  // Every kill is a rescued supply the ball gathers — the end screen counts
  // them the way a tidy desk would.
  bus.on('kill', () => {
    piecesGathered += 1;
  });

  bus.on('fire', ({ enemyId }) => {
    globInterceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    globInterceptions.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    globInterceptions.delete(enemyId);
  });

  function fireGlob(context: TinkerUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'glob',
      countsTowardTotal: false,
      data: { role: 'glob', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const spill = createTinkerSpill(bus, fireGlob);

  function updateScuttle(context: TinkerUpdate, data: Extract<TinkerSpawnData, { role: 'scuttle' }>) {
    const { enemy, runTime, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    // Scuttle: a quick lateral wiggle with a low bob, like something made of
    // buttons running on spool legs.
    offset.x += Math.sin(age * 3.1 + data.seed) * 2.4;
    offset.y += Math.abs(Math.sin(age * 6.2 + data.seed)) * 0.35 + Math.sin(age * 1.9 + data.seed * 2.1) * 0.8;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 9 + data.seed) * 0.16);
    enemy.mesh.rotateY(Math.sin(runTime * 0.7 + enemy.id) * 0.2);
    return runProgress > anchorU + 0.016;
  }

  function updateSwoop(context: TinkerUpdate, data: Extract<TinkerSpawnData, { role: 'swoop' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.04)),
      data.y + Math.sin(Math.min(1, clamped + 0.04) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    // Flap: wings are level children, driven here through userData handles.
    const flap = Math.sin(age * 13 + data.seed) * 0.55;
    const wingL = enemy.mesh.userData.wingL as Object3D | undefined;
    const wingR = enemy.mesh.userData.wingR as Object3D | undefined;
    if (wingL) wingL.rotation.z = 0.35 + flap;
    if (wingR) wingR.rotation.z = -0.35 - flap;
    return false;
  }

  function updateStalk(context: TinkerUpdate, data: Extract<TinkerSpawnData, { role: 'stalk' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 0.9 + data.seed) * 1.5;
    offset.y += Math.sin(age * 1.3 + data.seed * 1.7) * 0.7;

    // Telegraphed lunge: the stalker rears back on its ruler legs, dashes at
    // the camera, and lets a glob fly at the closest point.
    const fire = context.enemyState(() => ({ nextAt: 1.7, shotsLeft: data.fireForever ? Number.POSITIVE_INFINITY : 2 }));
    const untilShot = fire.nextAt - age;
    if (untilShot < 0.9 && untilShot > 0.5) offset.z += (0.9 - untilShot) * 7; // rear back
    else if (untilShot <= 0.5 && untilShot > 0) offset.z -= (0.5 - untilShot) * 13; // lunge in
    if (fire.shotsLeft > 0 && age >= fire.nextAt) {
      fire.shotsLeft -= 1;
      fire.nextAt = age + (data.fireForever ? 2.2 : 3.6);
      fireGlob(context, enemy.mesh.position);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 2 + data.seed) * 0.08);
    // Cracked open (stage 1): the pencil body shudders.
    if (enemy.hitStageIndex > 0) {
      enemy.mesh.position.x += Math.sin(age * 20) * 0.12;
      enemy.mesh.position.y += Math.cos(age * 16) * 0.1;
    }
    return runProgress > anchorU + 0.014;
  }

  function updateGlob(context: TinkerUpdate, data: Extract<TinkerSpawnData, { role: 'glob' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: globInterceptions.delete(enemy.id),
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

    // A wobbling glue blob that launches loose and then commits to a homing
    // run — a beat to read it before it hunts.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.4,
      maxSpeed: 10,
      accel: 2.8,
      turnRate: 1.9,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    const wobble = 1 + Math.sin(age * 14) * 0.12;
    enemy.mesh.scale.setScalar(wobble);
    enemy.mesh.rotateZ(age * 3);
    return age > GLOB_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  return {
    duration: TINKER_RUN_DURATION,
    bpm: TINKER_BPM,
    playerHealth: TINKER_PLAYER_HEALTH,
    createRail: createTinkerRail,
    spawnTimeline: createTinkerTimelineSorted(),
    easeRunProgress: smoothRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'scuttle':
          return updateScuttle(context, data);
        case 'swoop':
          return updateSwoop(context, data);
        case 'stalk':
          return updateStalk(context, data);
        case 'glob':
          return updateGlob(context, data);
        case 'orbit':
        case 'node':
        case 'core':
          return spill.update(context, data);
      }
    },
    validateRelease(enemies) {
      return spill.validateRelease(enemies);
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.16;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    scoreForHit: () => 40,
    scoreForVolley(results) {
      // A full clean volley is the tinker's signature: every piece rescued in
      // one sweep. Pay it like one.
      if (results.length < 4 || !results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 450 : results.length * 55;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 10500 && clearRate >= 0.85) return 'S';
      if (score >= 7500 && clearRate >= 0.65) return 'A';
      if (score >= 4500 && clearRate >= 0.45) return 'B';
      if (score >= 2000 && clearRate >= 0.25) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, TINKER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${TINKER_PLAYER_HEALTH}`, `${piecesGathered} supplies rescued`];
      const spillLine = spill.summary();
      if (spillLine) lines.push(spillLine);
      return lines;
    },
  };
}
