import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import {
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  STRANDLINE_MARKERS,
  STRANDLINE_TIME,
} from './timing';

export type StrandlineEnemyKind = 'clasper' | 'skater' | 'nurse' | 'venom' | 'brood' | 'parent';

export type StrandlineSpawnData =
  | { role: 'clasper'; lead: number; x: number; y: number; sway: number; phase: number }
  | { role: 'skater'; lead: number; fromX: number; toX: number; y: number; arc: number; direction: number }
  | { role: 'nurse'; lead: number; radius: number; y: number; phase: number; turns: number }
  | { role: 'venom'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'brood'; slot: number; angle: number }
  | { role: 'parent' };

export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

const SPEED_KEYS: Array<[number, number]> = [
  [0, 0.68],
  [STRANDLINE_TIME.bar(5), 0.82],
  [STRANDLINE_MARKERS.moonReveal, 1.02],
  [STRANDLINE_MARKERS.deepStrands, 1.18],
  [STRANDLINE_TIME.bar(21), 0.92],
  [STRANDLINE_MARKERS.crown, 0.62],
  [STRANDLINE_MARKERS.exposed, 0.48],
  [STRANDLINE_MARKERS.release, 0.2],
  [STRANDLINE_DURATION, 0.12],
];
const speedProfile = createSpeedProfile(SPEED_KEYS, STRANDLINE_DURATION);

export function strandlineRunProgress(time: number, duration = STRANDLINE_DURATION) {
  return speedProfile.runProgress(time, duration);
}

export function createStrandlineRail() {
  return new CatmullRomCurve3([
    new Vector3(0, 2, 8),
    new Vector3(-7, 4, -24),
    new Vector3(9, -2, -58),
    new Vector3(-13, 7, -94),
    new Vector3(12, 1, -130),
    new Vector3(-8, -5, -166),
    new Vector3(-28, 4, -200),
    new Vector3(-46, 16, -232),
    new Vector3(-50, 25, -265),
    new Vector3(-30, 17, -294),
    new Vector3(5, 6, -322),
    new Vector3(18, -5, -350),
    new Vector3(-10, 5, -378),
    new Vector3(3, 15, -405),
    new Vector3(0, 28, -432),
    new Vector3(0, 37, -455),
  ], false, 'catmullrom', 0.48);
}

const t = (bar: number, step = 0) => STRANDLINE_TIME.step(bar, step);
const PASS_GRACE = 0.018;

function claspers(time: number, specs: Array<[number, number]>, lead = 4.6): StrandlineSpawnEntry[] {
  return specs.map(([x, y], index) => ({
    time: time + index * 0.15,
    kind: 'clasper',
    data: { role: 'clasper', lead, x, y, sway: 1.2 + (index % 3) * 0.7, phase: index * 1.71 + time },
  }));
}

function skaters(time: number, specs: Array<[number, number, number]>, lead = 4.5): StrandlineSpawnEntry[] {
  return specs.map(([fromX, toX, y], index) => ({
    time: time + index * 0.18,
    kind: 'skater',
    data: { role: 'skater', lead, fromX, toX, y, arc: 2.5 + index % 2 * 2, direction: Math.sign(toX - fromX) || 1 },
  }));
}

function nurses(time: number, specs: Array<[number, number]>, lead = 4.8): StrandlineSpawnEntry[] {
  return specs.map(([radius, y], index) => ({
    time: time + index * 0.2,
    kind: 'nurse',
    hitStages: [1, 1],
    data: { role: 'nurse', lead, radius, y, phase: index / Math.max(1, specs.length) * Math.PI * 2 + time, turns: 0.55 + index * 0.08 },
  }));
}

const parentEntry: StrandlineSpawnEntry = {
  time: t(22),
  kind: 'parent',
  lockable: false,
  hitStages: [2, 2, 2],
  data: { role: 'parent' },
};

const broodEntries: StrandlineSpawnEntry[] = [
  { time: t(23), kind: 'brood', data: { role: 'brood', slot: 0, angle: MathUtils.degToRad(150) } },
  { time: t(25), kind: 'brood', data: { role: 'brood', slot: 1, angle: MathUtils.degToRad(30) } },
  { time: t(27), kind: 'brood', data: { role: 'brood', slot: 2, angle: MathUtils.degToRad(270) } },
];

function buildTimeline(): StrandlineSpawnEntry[] {
  return [
    ...claspers(t(1), [[-10, 5], [-4, -2], [4, 7], [10, 0]]),
    ...claspers(t(3), [[-13, -3], [-7, 6], [0, 1], [7, -5], [13, 5]]),
    ...skaters(t(5), [[-18, 15, -3], [18, -18, 5], [-20, 18, 9]]),

    ...claspers(t(6.5), [[-12, 7], [-5, -6], [5, 8], [12, -2]]),
    ...skaters(t(8), [[-20, 19, 6], [20, -19, -4], [-18, 18, 1], [18, -18, 10]]),
    ...nurses(t(10), [[9, -2], [11, 5], [8, 9]], 3.2),

    // The rail banks wide: leave a breath around the first full bell reveal.
    ...claspers(t(13.2), [[-12, -5], [-5, 8], [5, 3], [13, -2]], 4.2),
    ...skaters(t(14.5), [[-22, 20, -4], [22, -20, 4], [-20, 22, 10]], 4.1),

    ...nurses(t(16), [[12, -5], [9, 4], [13, 8], [7, 0]]),
    ...claspers(t(18), [[-14, 8], [-8, -5], [-2, 3], [5, 10], [12, -2]]),
    ...skaters(t(20), [[-23, 22, 8], [23, -22, -5], [-21, 21, 1], [21, -21, 11]]),

    parentEntry,
    broodEntries[0],
    ...claspers(t(23.5), [[-13, -4], [13, 6]], 3.2),
    broodEntries[1],
    ...skaters(t(25.4), [[-18, 18, 8], [18, -18, -4]], 3.1),
    broodEntries[2],
  ].sort((a, b) => a.time - b.time);
}

const SCORES: Record<StrandlineEnemyKind, number> = {
  clasper: 100,
  skater: 130,
  nurse: 180,
  venom: 45,
  brood: 420,
  parent: 2400,
};

export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  const timeline = buildTimeline();
  let broodsKilled = 0;
  let parentKilled = false;
  let hitsTaken = 0;
  let parentId = -1;
  let venomIntercepted = 0;
  const liveBroods = new Map<number, number>();
  const killedBroodSlots = new Set<number>();
  const liveVenom = new Set<number>();
  const interceptedVenom = new Set<number>();
  let nextBroodSpawn = 0;

  bus.on('runstart', () => {
    broodsKilled = 0;
    parentKilled = false;
    hitsTaken = 0;
    parentId = -1;
    venomIntercepted = 0;
    liveBroods.clear();
    killedBroodSlots.clear();
    nextBroodSpawn = 0;
    liveVenom.clear();
    interceptedVenom.clear();
    parentEntry.lockable = false;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') {
      parentId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
    if (kind === 'brood') {
      const entry = broodEntries[nextBroodSpawn];
      if (entry?.data.role === 'brood') liveBroods.set(enemyId, entry.data.slot);
      nextBroodSpawn += 1;
    }
    if (kind === 'venom') liveVenom.add(enemyId);
  });
  bus.on('fire', ({ enemyId }) => {
    if (liveVenom.has(enemyId)) interceptedVenom.add(enemyId);
  });
  bus.on('playerhit', ({ damage }) => { hitsTaken += damage; });
  bus.on('kill', ({ enemyId }) => {
    if (enemyId === parentId) {
      parentKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
      return;
    }
    if (liveVenom.delete(enemyId)) {
      venomIntercepted += 1;
      return;
    }
    const broodSlot = liveBroods.get(enemyId);
    if (broodSlot === undefined) return;
    liveBroods.delete(enemyId);
    killedBroodSlots.add(broodSlot);
    broodsKilled += 1;
    if (broodsKilled >= broodEntries.length) {
      parentEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  });
  bus.on('miss', ({ enemyId }) => {
    liveVenom.delete(enemyId);
    interceptedVenom.delete(enemyId);
  });

  function fireVenom(context: StrandlineUpdate, from: Vector3) {
    const velocity = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.4);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'venom',
      countsTowardTotal: false,
      data: { role: 'venom', position: from.clone(), velocity, lastAge: 0, impact: {} },
    });
  }

  function updateClasper(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'clasper' }>) {
    const anchor = context.railAnchor(data.lead);
    const detach = MathUtils.smoothstep(context.age, 0.35, 1.15);
    const curl = Math.sin(context.age * (1.8 + detach * 0.75) + data.phase);
    const lunge = Math.sin(Math.max(0, context.age - 0.65) * 2.1) * data.sway * 1.8 * detach;
    const x = data.x + curl * data.sway * (0.25 + detach * 0.75) + lunge;
    const y = data.y + Math.cos(context.age * 1.25 + data.phase) * data.sway * (0.2 + detach * 0.65);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(x, y, Math.sin(context.age * 2.2 + data.phase))));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(curl * 0.32);
    context.enemy.mesh.userData.pump = 0.5 + 0.5 * Math.sin(context.age * 4 + data.phase);
    context.enemy.mesh.userData.detach = detach;
    return context.runProgress > anchor + PASS_GRACE;
  }

  function updateSkater(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'skater' }>) {
    const anchor = context.railAnchor(data.lead);
    const p = MathUtils.clamp(context.age / 3.25, 0, 1);
    const ease = p * p * (3 - 2 * p);
    const x = MathUtils.lerp(data.fromX, data.toX, ease);
    const y = data.y + Math.sin(p * Math.PI) * data.arc;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(x, y, Math.sin(context.age * 5) * 0.5)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(-data.direction * (0.55 + Math.sin(p * Math.PI) * 0.5));
    context.enemy.mesh.userData.pump = Math.sin(context.age * 7) * 0.5 + 0.5;
    return p >= 1 || context.runProgress > anchor + PASS_GRACE;
  }

  function updateNurse(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'nurse' }>) {
    const anchor = context.railAnchor(data.lead);
    const angle = data.phase + context.age * data.turns;
    const tighten = MathUtils.lerp(1, 0.64, Math.min(1, context.age / data.lead));
    const x = Math.cos(angle) * data.radius * tighten;
    const y = data.y + Math.sin(angle) * data.radius * 0.55 * tighten;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(x, y, Math.sin(angle * 2) * 1.4)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(angle + Math.PI * 0.5);
    context.enemy.mesh.userData.pump = 0.5 + Math.sin(context.age * 3.1) * 0.5;
    const state = context.enemyState(() => ({ fired: false }));
    if (!state.fired && context.age > 1.35 && Math.sin(data.phase) > -0.15) {
      state.fired = true;
      context.enemy.mesh.userData.justFiredUntil = context.runTime + 0.28;
      fireVenom(context, context.enemy.mesh.position);
    }
    return context.runProgress > anchor + PASS_GRACE;
  }

  function updateVenom(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'venom' }>) {
    const dt = Math.max(0, context.age - data.lastAge);
    data.lastAge = context.age;
    const impact = updateHostileShotImpact({
      age: context.age,
      camera: context.camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: interceptedVenom.delete(context.enemy.id),
      config: { hitDistance: 1.2, damageDistance: 0.58 },
    });
    context.enemy.mesh.userData.brake = impact.phase === 'braking' ? 1 : 0;
    if (impact.phase === 'braking') {
      context.enemy.mesh.position.copy(data.position);
      context.enemy.mesh.quaternion.copy(context.camera.quaternion);
      context.enemy.mesh.rotateZ(context.age * 9);
      if (impact.damaged) {
        liveVenom.delete(context.enemy.id);
        context.damagePlayer(1);
        return true;
      }
      return false;
    }
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(context.camera, data.position), context.age, dt, {
      baseSpeed: 4.8,
      maxSpeed: 10.5,
      accel: 2.8,
      turnRate: 2.1,
    });
    context.enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) context.enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    const done = context.age > 11 || shotBehindCamera(context.camera, data.position);
    if (done) liveVenom.delete(context.enemy.id);
    return done;
  }

  function updateCrown(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'brood' | 'parent' }>) {
    const crownU = 0.99;
    if (data.role === 'parent') {
      context.enemy.mesh.position.copy(offsetFromRail(context.curve, crownU, new Vector3(0, 4.5, 0)));
      context.enemy.mesh.quaternion.copy(context.camera.quaternion);
      context.enemy.mesh.rotateZ(Math.sin(context.runTime * 0.45) * 0.16);
      context.enemy.mesh.userData.webs = 3 - broodsKilled;
      context.enemy.mesh.userData.webMask = [0, 1, 2].map((slot) => !killedBroodSlots.has(slot));
      context.enemy.mesh.userData.pump = 0.5 + Math.sin(context.runTime * 2.7) * 0.5;
      const state = context.enemyState(() => ({ answeredBroods: 0 }));
      // Every dying brood makes the parent convulse and spit a defender from
      // behind the remaining lattice. This is sparse enough to read as a boss
      // answer instead of ambient bullet spam.
      if (broodsKilled > state.answeredBroods) {
        state.answeredBroods = broodsKilled;
        context.enemy.mesh.userData.justFiredUntil = context.runTime + 0.32;
        fireVenom(context, context.enemy.mesh.position);
      }
      return false;
    }
    const emerge = MathUtils.smoothstep(context.age, 0.1, 1.25);
    const radius = (10.5 - data.slot * 0.7) * emerge;
    const angle = data.angle + Math.sin(context.age * 0.65 + data.slot) * 0.2;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, crownU, new Vector3(
      Math.cos(angle) * radius,
      4.5 + Math.sin(angle) * radius * 0.58,
      1.5 + data.slot * 0.3,
    )));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(angle + context.age * 0.24);
    context.enemy.mesh.userData.pump = 0.5 + Math.sin(context.age * 4.5 + data.slot) * 0.5;
    context.enemy.mesh.userData.emerge = emerge;
    context.enemy.mesh.userData.broodSlot = data.slot;
    const state = context.enemyState(() => ({ fired: false }));
    if (!state.fired && context.age > 2.1 + data.slot * 0.25) {
      state.fired = true;
      fireVenom(context, context.enemy.mesh.position);
    }
    return context.runTime > STRANDLINE_MARKERS.release - 0.2;
  }

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: 4,
    createRail: createStrandlineRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    lockRadiusNdc: 0.17,
    startWord: 'AWAKEN',
    replayWord: 'RETURN',
    timing: { shotDelay: { maxGridSeconds: 0.22 }, actionSfx: { gridThirtyseconds: 1 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      if (data.role === 'clasper') return updateClasper(context, data);
      if (data.role === 'skater') return updateSkater(context, data);
      if (data.role === 'nurse') return updateNurse(context, data);
      if (data.role === 'venom') return updateVenom(context, data);
      return updateCrown(context, data);
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      const u = 0.012;
      camera.position.copy(curve.getPointAt(u)).add(new Vector3(Math.sin(modeTime * 0.22) * 0.8, Math.cos(modeTime * 0.3) * 0.45, 0));
      camera.lookAt(curve.getPointAt(0.055));
      camera.rotateZ(Math.sin(modeTime * 0.17) * 0.025);
    },
    updateCameraEffects({ camera, runTime }) {
      // Long, slow body roll in the strand forest; a committed outside bank
      // opens the bell reveal, then the camera rolls the opposite way as the
      // rail dives back into the veil. The crown steadies for precision.
      const reveal = Math.exp(-(((runTime - STRANDLINE_MARKERS.moonReveal - 1.2) / 3.3) ** 2));
      const dive = Math.exp(-(((runTime - STRANDLINE_MARKERS.deepStrands - 0.9) / 2.7) ** 2));
      const crownSettle = MathUtils.smoothstep(runTime, STRANDLINE_MARKERS.crown - 2, STRANDLINE_MARKERS.crown + 1);
      const forestRoll = Math.sin(runTime * 0.34) * 0.045 * (1 - crownSettle);
      camera.rotateZ(forestRoll - reveal * 0.115 + dive * 0.09);
    },
    scoreForHit: (_volley, enemy) => enemy.kind === 'parent' ? 140 : 55,
    scoreForKill(volleySize, enemy) {
      return Math.round(SCORES[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.14));
    },
    scoreForVolley(results) {
      return results.length === 6 && results.every((result) => result.killed) ? 900 : results.length * results.length * 12;
    },
    rankForRun(score, kills, total) {
      const clear = total ? kills / total : 0;
      if (parentKilled && clear >= 0.9 && score >= 10500) return 'PELAGIC';
      if (parentKilled && clear >= 0.74) return 'LUMINOUS';
      if (parentKilled) return 'CLEANSED';
      if (clear >= 0.55) return 'DRIFTER';
      return 'INFESTED';
    },
    detailsForRun() {
      return [
        `WEB SECTORS CLEARED ${broodsKilled}/3`,
        parentKilled ? 'PARENT TORN FREE' : 'PARENT STILL ATTACHED',
        `VENOM INTERCEPTED ${venomIntercepted}`,
        `HULL ${Math.max(0, 4 - hitsTaken)}/4`,
      ];
    },
  };
}
