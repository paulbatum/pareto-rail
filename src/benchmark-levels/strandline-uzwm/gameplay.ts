import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type {
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { createParent, createParentEntries } from './parent';
import {
  STRANDLINE_UZWM_BOSS_TIME,
  STRANDLINE_UZWM_BPM,
  STRANDLINE_UZWM_MARKERS,
  STRANDLINE_UZWM_RUN_DURATION,
  bar,
} from './timing';

// STRANDLINE — 60 seconds freeing a gigantic jellyfish from its parasites:
//
//   Drift    (bars 0–6)    Sunlit strand forest; limpets clamped to the strands.
//   Vista    (bars 6–8)    The rail swings wide: the bell fills the view, then
//                          the rail dives back into the strands.
//   Thicket  (bars 8–14)   Denser forest; skimmers detach to defend the colony.
//   Moon     (bars 14–16)  A curve swings wider still — the bell hangs like a
//                          green moon. A breath before the water wakes.
//   Wake     (bars 16–22)  Darters spit nematocyst bolts; the colony fights.
//   Crown    (bars 22–23)  The strands root into the bell. Riser, quiet.
//   Parent   (bars 23–28)  The brood-mother behind its webbing lattice. Kill
//                          each brood and the webbing it fed withers, until the
//                          parent hangs bare and can be torn loose.
//   Resolve  (bars 28–30)  The camera pulls back and back — the whole animal
//                          in frame, every strand glowing clean.

export { STRANDLINE_UZWM_BPM, STRANDLINE_UZWM_RUN_DURATION };

export const STRANDLINE_UZWM_PLAYER_HEALTH = 3;

export type StrandlineUzwmEnemyKind =
  | 'limpet'
  | 'skimmer'
  | 'darter'
  | 'bolt'
  | 'brood'
  | 'web'
  | 'parent';

export type StrandlineUzwmSpawnData =
  | { role: 'limpet'; lead: number; x: number; y: number; seed: number }
  | { role: 'skimmer'; lead: number; fromX: number; toX: number; y: number; arc: number; delay: number; crossTime: number }
  | { role: 'darter'; lead: number; x: number; y: number; seed: number; shots: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'brood'; wave: number; orbit: number }
  | { role: 'web'; socket: number; webX: number; webY: number }
  | { role: 'parent' };

export type StrandlineUzwmSpawnEntry = LockOnSpawnEntry<StrandlineUzwmEnemyKind, StrandlineUzwmSpawnData>;
export type StrandlineUzwmUpdate = LockOnEnemyUpdate<StrandlineUzwmEnemyKind, StrandlineUzwmSpawnData>;

export function createStrandlineUzwmRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(6, 1, -40),
      new Vector3(-8, 3, -80),
      new Vector3(-4, -2, -118),
      // Vista 1: swing wide so the bell fills the view, then dive back in.
      new Vector3(26, -4, -152),
      new Vector3(30, -2, -178),
      new Vector3(-6, 4, -214),
      // Thicket: tight S-curves threading the strands.
      new Vector3(-16, 0, -248),
      new Vector3(4, 6, -282),
      // Vista 2 (green moon): the widest swing of the run.
      new Vector3(-30, 2, -312),
      new Vector3(-28, 4, -336),
      // Wake + crown ascent toward the bell.
      new Vector3(-2, 2, -366),
      new Vector3(0, 3, -396),
      new Vector3(0, 5, -424),
      new Vector3(0, 7, -448),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

export function strandlineUzwmRunProgress(time: number) {
  return smoothRunProgress(time, STRANDLINE_UZWM_RUN_DURATION);
}

export function strandlineUzwmAnchorAt(curve: CatmullRomCurve3, progress: number, sway: Vector3) {
  return offsetFromRail(curve, MathUtils.clamp(progress, 0, 1), sway);
}

// ---- timeline builders ---------------------------------------------------------

const FORMATION_GAP = 0.14;

const limpets = (
  time: number,
  lead: number,
  offsets: Array<[number, number]>,
): StrandlineUzwmSpawnEntry[] =>
  formation(time, FORMATION_GAP, offsets, ([x, y], index) => ({
    kind: 'limpet',
    data: { role: 'limpet', lead, x, y, seed: index * 1.7 + time },
  }));

const SKIMMER_REACH = 17;

const skimmers = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc?: number; delay?: number }>,
): StrandlineUzwmSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.12,
    kind: 'skimmer',
    data: {
      role: 'skimmer',
      lead,
      fromX: Math.max(-SKIMMER_REACH, Math.min(SKIMMER_REACH, run.fromX)),
      toX: Math.max(-SKIMMER_REACH, Math.min(SKIMMER_REACH, run.toX)),
      y: run.y,
      arc: run.arc ?? 2.4,
      delay: run.delay ?? index * 0.3,
      crossTime: 2.6,
    },
  }));

const darters = (
  time: number,
  lead: number,
  posts: Array<[number, number]>,
  shots: number,
): StrandlineUzwmSpawnEntry[] =>
  posts.map(([x, y], index) => ({
    time: time + index * 0.3,
    kind: 'darter',
    hitPoints: 2,
    data: { role: 'darter', lead, x, y, seed: index * 2.3 + time, shots },
  }));

function buildTimeline(parentTimeline: StrandlineUzwmSpawnEntry[]): StrandlineUzwmSpawnEntry[] {
  return sortTimeline([
    // --- Drift: learn the sweep among clamped limpets.
    ...section(STRANDLINE_UZWM_MARKERS.drift,
      limpets(bar(0.5), 4.2, [[-5, 1], [-1.5, 3.5], [2.5, 3], [6, 0.5]]),
      limpets(bar(2), 4.4, [[-8, -1], [-4, 2], [0, 4.5], [4, 2], [8, -1]]),
      limpets(bar(3.5), 4.4, [[-6, 5], [-2, 0.5], [3, 1], [7, 4]]),
      limpets(bar(5), 4.0, [[-7, 2], [0, 6], [7, 2]]),
    ),

    // --- Vista 1: open water, first defenders detach.
    ...section(STRANDLINE_UZWM_MARKERS.vista1,
      skimmers(bar(0.2), 3.4, [
        { fromX: -24, toX: 24, y: 3, arc: 3 },
        { fromX: 24, toX: -24, y: 7.5, arc: 2 },
        { fromX: -24, toX: 24, y: -3, arc: 3.6 },
      ]),
      skimmers(bar(1.1), 3.2, [
        { fromX: 25, toX: -25, y: 1 },
        { fromX: -25, toX: 25, y: 9, arc: 1.8 },
      ]),
    ),

    // --- Thicket: the colony notices. Dense limpets, crossing skimmers,
    // and the first darters (single sting each).
    ...section(STRANDLINE_UZWM_MARKERS.thicket,
      limpets(bar(0.8), 3.6, [[-5.5, 0], [-2.5, 2.5], [1, 4.5], [4, 1.5], [6.5, -0.5]]),
      skimmers(bar(1), 3.1, [
        { fromX: -26, toX: 26, y: 5.5, arc: 2.4 },
        { fromX: 26, toX: -26, y: 0, arc: 3.2 },
        { fromX: -26, toX: 26, y: 10, arc: 1.8 },
      ]),
      darters(bar(2.5), 4.4, [[-6, 6], [6, 0]], 1),
      limpets(bar(3.5), 4.2, [[-8, 3], [-2, 6.5], [4, 3], [8, 6]]),
      skimmers(bar(4.5), 3.0, [
        { fromX: 27, toX: -27, y: 7, arc: 2.2 },
        { fromX: -27, toX: 27, y: 1.5, arc: 3 },
        { fromX: 27, toX: -27, y: -4, arc: 3.8 },
      ]),
      darters(bar(5), 4.2, [[0, 8.5]], 1),
    ),

    // --- Moon: the green-moon breath. Sparse, wide, quiet.
    ...section(STRANDLINE_UZWM_MARKERS.vista2,
      limpets(bar(0.2), 4.0, [[-6, 2], [0, 5], [6, 2]]),
      skimmers(bar(1), 3.2, [
        { fromX: -24, toX: 24, y: 4, arc: 2.6 },
        { fromX: 24, toX: -24, y: 8, arc: 2 },
      ]),
    ),

    // --- Wake: the colony fights back. Darters spit pairs of bolts.
    ...section(STRANDLINE_UZWM_MARKERS.wake,
      darters(bar(0.2), 4.4, [[-7, 5], [7, 1]], 2),
      skimmers(bar(1), 2.9, [
        { fromX: -27, toX: 27, y: 6, arc: 2.4 },
        { fromX: 27, toX: -27, y: 0.5, arc: 3.2 },
        { fromX: -27, toX: 27, y: 11, arc: 1.7 },
      ]),
      limpets(bar(2), 4.2, [[-8, 0], [-3, 4], [3, 7], [8, 2]]),
      darters(bar(2.5), 4.2, [[-4, 8], [5, -1]], 2),
      skimmers(bar(3.5), 2.9, [
        { fromX: 27, toX: -27, y: 4, arc: 2.6 },
        { fromX: -27, toX: 27, y: 9, arc: 2 },
        { fromX: 27, toX: -27, y: -3, arc: 3.6 },
      ]),
      darters(bar(4.5), 4.2, [[0, 5.5], [-9, 1], [9, 8]], 2),
    ),

    // (bars 22–23: the crown approach. Nothing spawns; the riser is the event.)

    // --- Parent at the crown.
    ...parentTimeline,

    // (bars 28–30: the resolve. The quiet is the payoff.)
  ]);
}

const KILL_SCORE: Record<StrandlineUzwmEnemyKind, number> = {
  limpet: 100,
  skimmer: 120,
  darter: 200,
  bolt: 40,
  brood: 260,
  web: 0,
  parent: 2500,
};

const BOLT_MAX_AGE = 12;

export function createStrandlineUzwmGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineUzwmEnemyKind, StrandlineUzwmSpawnData> {
  const curve = createStrandlineUzwmRail();
  const entries = createParentEntries(STRANDLINE_UZWM_BOSS_TIME);
  const timeline = buildTimeline(entries.timeline);

  const interceptions = new Set<number>();
  let hitsTaken = 0;
  let boltsShot = 0;
  let parent: StrandlineParent | null = null;

  bus.on('runstart', () => {
    interceptions.clear();
    hitsTaken = 0;
    boltsShot = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('fire', ({ enemyId }) => {
    interceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
  });
  // Gameplay owns the kill→web mapping: brood spawn events arrive in
  // timeline order, so a FIFO queue of authored waves assigns membership.
  const pendingBroodWaves = timeline
    .filter((entry) => entry.kind === 'brood')
    .map((entry) => (entry.data as { wave: number }).wave);
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind !== 'brood' || !parent) return;
    parent.registerBrood(enemyId, pendingBroodWaves.shift() ?? 3);
  });

  function fireBolt(context: StrandlineUzwmUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5.5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  parent = createParent(bus, {
    curve,
    parentEntry: entries.parentEntry,
    webEntries: entries.webEntries,
    anchorAt: (progress, sway) => strandlineUzwmAnchorAt(curve, progress, sway),
    runProgressAt: (runTime) => strandlineUzwmRunProgress(runTime),
    spawnBossBolt: fireBolt,
  });
  const boss = parent;

  // ---- movement ---------------------------------------------------------------

  function updateLimpet(context: StrandlineUzwmUpdate, data: Extract<StrandlineUzwmSpawnData, { role: 'limpet' }>) {
    const { enemy, runTime, runProgress, age, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Clamped to its strand: a slow sucking pulse, never leaves its seat.
    const breathe = Math.sin(age * 2.2 + data.seed) * 0.5;
    const offset = new Vector3(data.x + breathe * 0.4, data.y + breathe * 0.3, Math.sin(age * 1.4 + data.seed) * 0.4);
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.9 + data.seed) * 0.3);
    enemy.mesh.userData.pulse = 0.5 + 0.5 * Math.sin(age * 3.1 + data.seed * 2);
    return runProgress > anchorU + 0.015;
  }

  function updateSkimmer(context: StrandlineUzwmUpdate, data: Extract<StrandlineUzwmSpawnData, { role: 'skimmer' }>) {
    const { enemy, runProgress, age, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 5.2 + enemy.id) * 0.35;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)),
      data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ((data.toX > data.fromX ? -1 : 1) * (0.55 + Math.sin(clamped * Math.PI) * 0.45));
    return false;
  }

  function updateDarter(context: StrandlineUzwmUpdate, data: Extract<StrandlineUzwmSpawnData, { role: 'darter' }>) {
    const { enemy, runProgress, age, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Weaves around its post, then commits to the sting: a readable wind-up.
    const weave = Math.sin(age * 2.6 + data.seed) * 1.6;
    const bob = Math.cos(age * 3.4 + data.seed) * 0.9;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x + weave, data.y + bob, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.8 + data.seed) * 0.4);
    const state = context.enemyState(() => ({ shotsLeft: data.shots, nextAt: 1.5 + (data.seed % 0.8) }));
    const untilShot = state.nextAt - age;
    enemy.mesh.userData.charge = state.shotsLeft > 0 && untilShot < 0.8 ? 1 - Math.max(0, untilShot) / 0.8 : 0;
    if (state.shotsLeft > 0 && age >= state.nextAt) {
      state.shotsLeft -= 1;
      state.nextAt = age + 3.4;
      fireBolt(context, enemy.mesh.position);
    }
    return runProgress > anchorU + 0.015;
  }

  function updateBolt(context: StrandlineUzwmUpdate, data: Extract<StrandlineUzwmSpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: interceptions.delete(enemy.id),
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 6,
      maxSpeed: 13,
      accel: 3.4,
      turnRate: 2.6,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  return {
    duration: STRANDLINE_UZWM_RUN_DURATION,
    bpm: STRANDLINE_UZWM_BPM,
    playerHealth: STRANDLINE_UZWM_PLAYER_HEALTH,
    createRail: createStrandlineUzwmRail,
    spawnTimeline: timeline,
    easeRunProgress: strandlineUzwmRunProgress,
    startWord: 'RELEASE',
    replayWord: 'RETURN',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'limpet':
          return updateLimpet(context, data);
        case 'skimmer':
          return updateSkimmer(context, data);
        case 'darter':
          return updateDarter(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'brood':
          return boss.updateBrood(context, data);
        case 'web':
          return boss.updateWeb(context, data);
        case 'parent':
          return boss.updateParent(context);
      }
    },
    validateRelease(enemies) {
      // The parent's bulk is untouchable while any webbing still feeds —
      // volleys aimed at it wash off until it hangs bare.
      const deniedIds = new Set<number>();
      const flashIds = new Set<number>();
      const parentTargets = enemies.filter((enemy) => enemy.kind === 'parent');
      if (parentTargets.length > 0 && !boss.exposed()) {
        for (const enemy of parentTargets) deniedIds.add(enemy.id);
        for (const enemy of enemies) {
          if (enemy.kind === 'web' || enemy.kind === 'brood') flashIds.add(enemy.id);
        }
        bus.emit('shielded', {
          shields: [...flashIds].map((enemyId) => ({
            enemyId,
            worldPosition: enemies.find((enemy) => enemy.id === enemyId)?.mesh.position.clone() ?? new Vector3(),
          })),
          blockedEnemyIds: [...deniedIds],
        });
        return enemies.filter((enemy) => !deniedIds.has(enemy.id));
      }
      return true;
    },
    scoreForKill(volleySize, enemy) {
      if (enemy.kind === 'bolt') boltsShot += 1;
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping armor (darter plates, broods, the parent) pays a little.
    scoreForHit: () => 45,
    scoreForVolley(results) {
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (boss.parentKilled() && score >= 11800 && clearRate >= 0.9) return 'S';
      if (score >= 9600 && clearRate >= 0.62) return 'A';
      if (score >= 5200 && clearRate >= 0.4) return 'B';
      if (score >= 2200 && clearRate >= 0.2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_UZWM_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${STRANDLINE_UZWM_PLAYER_HEALTH}`];
      if (boltsShot > 0) lines.push(`${boltsShot} sting${boltsShot === 1 ? '' : 's'} shot down`);
      const bossLine = boss.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}

type StrandlineParent = ReturnType<typeof createParent>;
