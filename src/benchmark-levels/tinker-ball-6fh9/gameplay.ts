import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import { TINKER_BPM, TINKER_MARKERS, TINKER_RUN_DURATION, TINKER_TIME } from './timing';

// Tinker Ball: a 60-second lap of one oversized worktable. The player is the
// gun escorting a rolling ball that cleans the table; glue monsters wearing
// stolen stationery scuttle, stride, and swoop in three growth stages, then
// the run ends at a glue spill under the desk lamp — crack its cores, free
// the heart, and coast across the one clean patch of table.

export { TINKER_BPM, TINKER_RUN_DURATION } from './timing';
export const TINKER_PLAYER_HEALTH = 4;

export type TinkerEnemyKind =
  | 'beetle'
  | 'strider'
  | 'snapper'
  | 'bolt'
  | 'spill-core'
  | 'spill-heart';

// Timeline entries carry immutable plain-value config only (the engine reuses
// the timeline across runs; trace:spawns re-serializes it). Per-enemy runtime
// state lives in enemyState bags; globs are spawned dynamically with fresh
// data objects, so theirs may mutate.
type WaveData = {
  role: 'wave';
  lead: number;
  x: number;
  y: number;
  /** Snappers with spit=true lob glue globs at the hull. */
  spit?: boolean;
};

// Globs carry role 'bolt' so the engine's hostile-shot lock priority and the
// volley ordering treat them as interceptable incoming fire.
type GlobData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

type CoreData = { role: 'core'; index: number; x: number; y: number };
type HeartData = { role: 'heart' };

export type TinkerSpawnData = WaveData | GlobData | CoreData | HeartData;
export type TinkerSpawnEntry = LockOnSpawnEntry<TinkerEnemyKind, TinkerSpawnData>;
export type TinkerUpdate = LockOnEnemyUpdate<TinkerEnemyKind, TinkerSpawnData>;

// The route: one lap of the table. Height bakes the ball's growth — the
// camera rides marble-low at the start and melon-high by the spill.
export function createTinkerRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 2.1, 0),
      new Vector3(3, 2.1, -26),
      new Vector3(12, 2.15, -52),
      new Vector3(9, 2.2, -80),
      new Vector3(-7, 2.3, -104),
      new Vector3(-18, 2.45, -130),
      new Vector3(-12, 2.65, -158),
      new Vector3(4, 2.85, -182),
      new Vector3(18, 3.05, -208),
      new Vector3(16, 3.35, -234),
      new Vector3(0, 3.65, -258),
      new Vector3(-13, 3.95, -282),
      new Vector3(-9, 4.3, -308),
      new Vector3(5, 4.55, -330),
      new Vector3(9, 4.7, -354),
      new Vector3(7, 4.78, -378),
      new Vector3(2, 4.8, -404),
    ],
    false,
    'catmullrom',
    0.45,
  );
}

/** Eased rail progress at a run time — shared so the spill and the visuals agree on positions. */
export function tinkerRunProgressAt(time: number) {
  return smoothRunProgress(time, TINKER_RUN_DURATION);
}

/** The heart of the spill is overtaken (rolled through) at the coast downbeat. */
export const SPILL_PASS_TIME = TINKER_MARKERS.coast;
export const SPILL_ANCHOR_U = smoothRunProgress(SPILL_PASS_TIME, TINKER_RUN_DURATION);

const time = TINKER_TIME;
const STAGGER = time.seconds(0.16);
const BOSS_TIME = TINKER_MARKERS.bossEntrance;

// World-space bands: beetles scuttle on the table top, striders stand tall on
// pencil legs, snappers fly. Beetle/strider heights are absolute (they stand
// on the table); snapper y is rail-relative so they pace the climbing camera.
const BEETLE_Y = 0.62;
const STRIDER_Y = 2.35;

const wave = (
  at: number,
  lead: number,
  kind: TinkerEnemyKind,
  offsets: Array<[number, number]>,
  spit = false,
): TinkerSpawnEntry[] =>
  formation(at, STAGGER, offsets, (offset) => ({
    kind,
    data: { role: 'wave' as const, lead, x: offset[0], y: offset[1], ...(spit ? { spit: true } : {}) },
  }));

const beetles = (at: number, lead: number, offsets: Array<[number, number]>) => wave(at, lead, 'beetle', offsets);
const striders = (at: number, lead: number, offsets: Array<[number, number]>) => wave(at, lead, 'strider', offsets);
const snappers = (at: number, lead: number, offsets: Array<[number, number]>, spit = false) =>
  wave(at, lead, 'snapper', offsets, spit);

function createSpillEntries(): { cores: TinkerSpawnEntry[]; heart: TinkerSpawnEntry } {
  const coreSpots: Array<[number, number]> = [
    [-6, 1.5],
    [6.2, 2.2],
    [0.4, 4.4],
  ];
  const cores = coreSpots.map(([x, y], index): TinkerSpawnEntry => ({
    time: BOSS_TIME + index * 0.22,
    kind: 'spill-core',
    hitPoints: 4,
    lockable: index === 0,
    data: { role: 'core', index, x, y },
  }));
  const heart: TinkerSpawnEntry = {
    time: BOSS_TIME + 0.1,
    kind: 'spill-heart',
    hitPoints: 6,
    lockable: false,
    data: { role: 'heart' },
  };
  return { cores, heart };
}

function createBaseTimeline(): TinkerSpawnEntry[] {
  return [
    // --- Marble (bars 0–8): buttons-and-pins scale. Room to learn the sweep.
    ...section(TINKER_MARKERS.run,
      beetles(time.bar(0, 2.0), 4.6, [[-5, 0], [-2, 0], [2, 0], [5, 0]]),
      beetles(time.bar(2, 1.0), 4.7, [[-7.5, 0], [-3.5, 0], [0, 0], [3.5, 0], [7.5, 0]]),
      striders(time.bar(4, 0.0), 4.8, [[-6, 0], [-2, 0], [2, 0], [6, 0]]),
      beetles(time.bar(5, 2.0), 4.5, [[-6.5, 0], [-1.5, 0], [4, 0]]),
      striders(time.bar(6, 1.5), 4.6, [[-4.5, 0], [4.5, 0]]),
    ),

    // --- Tennis ball (bars 8–16): the table wakes up. Snappers take the air
    // and start lobbing glue at the hull.
    ...section(TINKER_MARKERS.tennis,
      snappers(time.bar(0, 0.5), 5.2, [[-4, 2.2], [4, 2.6]]),
      beetles(time.bar(1, 2.0), 4.6, [[-8, 0], [-4, 0], [0, 0], [4, 0], [8, 0]]),
      striders(time.bar(3, 0.0), 4.8, [[-7, 0], [0, 0], [7, 0]]),
      snappers(time.bar(3, 2.5), 5.2, [[-6, 3.4], [6, 3.0]], true),
      beetles(time.bar(4, 2.0), 4.5, [[-8.5, 0], [-5, 0], [-1.5, 0], [1.5, 0], [5, 0], [8.5, 0]]),
      snappers(time.bar(6, 0.0), 5.0, [[-3, 4.6], [3, 4.2], [0, 2.0]], true),
      striders(time.bar(7, 0.0), 4.4, [[-5.5, 0], [5.5, 0]]),
    ),

    // --- Clutter (bars 16–20): melon scale, densest mixed waves.
    ...section(TINKER_MARKERS.clutter,
      beetles(time.bar(0, 0.0), 4.6, [[-8, 0], [-4.5, 0], [4.5, 0], [8, 0]]),
      striders(time.bar(0, 2.0), 4.8, [[-6.5, 0], [0, 0], [6.5, 0]]),
      snappers(time.bar(1, 2.0), 5.0, [[-5, 3.8], [0, 5.0], [5, 3.4]], true),
      striders(time.bar(2, 2.0), 4.5, [[-7.5, 0], [-2.5, 0], [2.5, 0]]),
      beetles(time.bar(3, 0.0), 4.2, [[-6, 0], [0, 0], [6, 0]]),
      // Bars 20–22 stay clear: the riser plays, the lamp looms, the spill rises.
      snappers(time.bar(4, 0.5), 4.4, [[-4, 2.6], [4, 2.9]]),
    ),

    // --- Keep-the-guns-warm trickle during the spill fight; their pieces
    // shower the approach the ball is about to roll through.
    // Beetles stay early enough that their table-level anchors clear the
    // blob's junk skirt; the late trickle flies instead.
    ...section(TINKER_MARKERS.bossEntrance,
      beetles(time.bar(2, 2.0), 4.0, [[-7, 0], [-3.5, 0], [3.5, 0]]),
      snappers(time.bar(4, 2.0), 4.2, [[-5, 3.2], [5, 3.6]]),
      snappers(time.bar(6, 0.0), 3.4, [[-5.5, 2.4], [0, 4.2], [5.5, 2.8]]),
    ),
  ];
}

const KILL_SCORE: Record<TinkerEnemyKind, number> = {
  beetle: 100,
  strider: 120,
  snapper: 150,
  bolt: 40,
  'spill-core': 400,
  'spill-heart': 1500,
};

const GLOB_MAX_AGE = 13;
const scratch = new Vector3();
const scratchSpit = new Vector3();

function faceCamera(mesh: Object3D, camera: PerspectiveCamera, tilt: number) {
  mesh.quaternion.copy(camera.quaternion);
  mesh.rotateZ(tilt);
}

export type TinkerGameplay = LockOnRunnerLevel<TinkerEnemyKind, TinkerSpawnData> & {
  /** Pieces rescued so far this run (for the end card and visuals). */
  rescuedPieces(): number;
};

export function createTinkerGameplay(bus: EventBus): TinkerGameplay {
  const curve = createTinkerRail();
  const curveLength = curve.getLength();
  // Cores hover this many rail-units ahead of the camera until the blob stops them.
  const coreLeadU = 30 / curveLength;

  const spill = createSpillEntries();
  const timeline = sortTimeline([...createBaseTimeline(), ...spill.cores, spill.heart]);

  const globInterceptions = new Set<number>();
  const globIds = new Set<number>();
  const coreIds = new Map<number, number>(); // enemyId -> core index
  let heartId = -1;
  let coresResolved = 0;
  let coresCracked = 0;
  let heartKilled = false;
  let hitsTaken = 0;
  let rescued = 0;
  let smoothedRoll = 0;

  function resetSpillEntries() {
    spill.cores.forEach((entry, index) => {
      entry.lockable = index === 0;
    });
    spill.heart.lockable = false;
  }

  function advanceSpillGate() {
    coresResolved += 1;
    const next = spill.cores[coresResolved];
    if (next) next.lockable = true;
    else if (spill.heart.lockable !== true) {
      spill.heart.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  }

  bus.on('runstart', () => {
    globInterceptions.clear();
    globIds.clear();
    coreIds.clear();
    heartId = -1;
    coresResolved = 0;
    coresCracked = 0;
    heartKilled = false;
    hitsTaken = 0;
    rescued = 0;
    smoothedRoll = 0;
    resetSpillEntries();
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind === 'spill-core') {
      if (coreIds.size === 0) bus.emit('bossphase', { phase: 'summoned' });
      coreIds.set(enemyId, coreIds.size);
    }
    if (kind === 'spill-heart') heartId = enemyId;
    if (kind === 'bolt') globIds.add(enemyId);
  });

  bus.on('fire', ({ enemyId }) => {
    globInterceptions.add(enemyId);
  });

  bus.on('kill', ({ enemyId, letter }) => {
    globInterceptions.delete(enemyId);
    if (coreIds.has(enemyId)) {
      coresCracked += 1;
      rescued += 6;
      advanceSpillGate();
      return;
    }
    if (enemyId === heartId) {
      heartKilled = true;
      rescued += 10;
      bus.emit('bossphase', { phase: 'destroyed' });
      return;
    }
    // Globs are glue, not supplies, and letters are not run targets.
    if (!globIds.delete(enemyId) && letter === undefined) rescued += 3;
  });

  bus.on('miss', ({ enemyId }) => {
    globInterceptions.delete(enemyId);
    globIds.delete(enemyId);
    // A missed core still hands the fight forward so the heart is not
    // permanently sealed by one escaped target.
    if (coreIds.has(enemyId)) advanceSpillGate();
  });

  function fireGlob(context: TinkerUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4.2);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0 },
    });
  }

  function updateWave(context: TinkerUpdate, data: WaveData) {
    const { enemy, runProgress, age, curve: rail, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const seed = enemy.id * 1.7;

    if (enemy.kind === 'beetle') {
      // Skittering scuttle: a broad weave with quick nervous sub-steps.
      const x = data.x + Math.sin(age * 1.9 + seed) * 1.5 + Math.sin(age * 6.8 + seed * 2.3) * 0.35;
      const position = offsetFromRail(rail, anchorU, scratch.set(x, 0, 0));
      position.y = BEETLE_Y + Math.abs(Math.sin(age * 6.8 + seed)) * 0.16;
      enemy.mesh.position.copy(position);
      faceCamera(enemy.mesh, camera, Math.sin(age * 6.8 + seed) * 0.14);
      enemy.mesh.userData.gaitPhase = age * 6.8 + seed;
    } else if (enemy.kind === 'strider') {
      // Stilt gait: tall, slow strides with a heavy vertical bob and lean.
      const stride = age * 3.1 + seed;
      const x = data.x + Math.sin(age * 0.7 + seed) * 1.1;
      const position = offsetFromRail(rail, anchorU, scratch.set(x, 0, 0));
      position.y = STRIDER_Y + Math.abs(Math.sin(stride)) * 0.42;
      enemy.mesh.position.copy(position);
      faceCamera(enemy.mesh, camera, Math.sin(stride) * 0.1);
      enemy.mesh.userData.gaitPhase = stride;
    } else {
      // Snapper: swooping figure-eights in the lamp light, flapping.
      const x = data.x + Math.sin(age * 0.95 + seed) * 2.6;
      const y = data.y + Math.sin(age * 1.7 + seed * 0.6) * 1.5;
      enemy.mesh.position.copy(offsetFromRail(rail, anchorU, scratch.set(x, y, 0)));
      faceCamera(enemy.mesh, camera, Math.sin(age * 1.7 + seed) * 0.22);
      enemy.mesh.userData.gaitPhase = age * 5.4 + seed;
      if (data.spit) {
        const spit = context.enemyState(() => ({ nextAt: 1.5 + (enemy.id % 3) * 0.4, shotsLeft: 2 }));
        if (spit.shotsLeft > 0 && age >= spit.nextAt) {
          spit.shotsLeft -= 1;
          spit.nextAt = age + 3.4;
          fireGlob(context, enemy.mesh.position);
          enemy.mesh.userData.spitFlash = 0.35;
        }
      }
    }

    return runProgress > anchorU + 0.016;
  }

  function updateGlob(context: TinkerUpdate, data: GlobData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      // Lenient interception: while a player shot is in flight at this glob,
      // keep refreshing the grace window — firing at the glue means you
      // blocked it. The set is cleared when the shot resolves (kill or miss).
      intercepted: globInterceptions.has(enemy.id),
      config: { hitDistance: 2.5, impactBrake: 0.45, damageDistance: 0.7 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // A lobbed drip that tightens into a homing run; slow enough to read and
    // shoot down before it lands on the hull.
    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.0,
      maxSpeed: 9.0,
      accel: 2.5,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotation.z = age * 2.4;

    return shotBehindCamera(camera, data.position) || age > GLOB_MAX_AGE;
  }

  function updateCore(context: TinkerUpdate, data: CoreData) {
    const { enemy, runProgress, age, curve: rail, camera } = context;
    // Cores rise out of the spill and pace the camera at lock range, tethered
    // back to the blob; they pile up on the spill itself as the ball closes in.
    const anchorU = Math.min(SPILL_ANCHOR_U - 0.014, runProgress + coreLeadU);
    const emerge = MathUtils.smoothstep(Math.min(1, age / 1.6), 0, 1);
    const wobble = Math.sin(age * 1.3 + data.index * 2.4) * 0.6;
    const position = offsetFromRail(rail, anchorU, scratch.set(data.x + wobble, 0, 0));
    position.y = (data.y + 1.2 + Math.sin(age * 1.05 + data.index) * 0.4) * emerge + 0.5;
    enemy.mesh.position.copy(position);
    faceCamera(enemy.mesh, camera, Math.sin(age * 0.8 + data.index) * 0.12);
    return runProgress > SPILL_ANCHOR_U - 0.006;
  }

  function updateHeart(context: TinkerUpdate) {
    const { enemy, runProgress, age, curve: rail, camera, railAnchor } = context;
    const anchorU = railAnchor(SPILL_PASS_TIME - BOSS_TIME - 0.1);
    const exposed = spill.heart.lockable === true;
    const position = offsetFromRail(rail, anchorU, scratch.set(0, 0, 0));
    // Buried in the blob while shelled; rises hot once the last core cracks.
    const rise = enemy.mesh.userData.heartRise as number | undefined;
    const targetRise = exposed ? 6.2 : 4.8;
    const nextRise = MathUtils.lerp(rise ?? 4.8, targetRise, 0.03);
    enemy.mesh.userData.heartRise = nextRise;
    position.y = nextRise + Math.sin(age * 1.4) * 0.22;
    enemy.mesh.position.copy(position);
    faceCamera(enemy.mesh, camera, Math.sin(age * 0.9) * 0.08);
    enemy.mesh.userData.exposed = exposed;

    // The spill spits glue while it still has shells; the exposed heart
    // spits faster — the last stand.
    const spitState = context.enemyState(() => ({ nextAt: 2.2 }));
    if (age >= spitState.nextAt && runProgress < SPILL_ANCHOR_U - 0.02) {
      spitState.nextAt = age + (exposed ? 3.0 : 4.2);
      // Spit from above the blob so the glob is readable from birth.
      fireGlob(context, enemy.mesh.position.clone().add(scratchSpit.set(0, 2.2, 0)));
      enemy.mesh.userData.spitFlash = 0.4;
    }

    return runProgress > anchorU + 0.006;
  }

  return {
    duration: TINKER_RUN_DURATION,
    bpm: TINKER_BPM,
    playerHealth: TINKER_PLAYER_HEALTH,
    createRail: createTinkerRail,
    spawnTimeline: timeline,
    easeRunProgress: smoothRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'bolt':
          return updateGlob(context, data);
        case 'core':
          return updateCore(context, data);
        case 'heart':
          return updateHeart(context);
      }
    },
    updateCameraEffects({ camera, curve: rail, runProgress, dt }) {
      // A gentle fixed downward pitch keeps the tabletop in frame, and a
      // cosmetic bank leans the camera into the route's arcs. Applied after
      // the runner's lookAt and kept small so lock hit-testing stays honest.
      const ahead = rail.getTangentAt(MathUtils.clamp(runProgress + 0.006, 0, 1));
      const here = rail.getTangentAt(MathUtils.clamp(runProgress, 0, 1));
      const targetRoll = MathUtils.clamp((here.x - ahead.x) * 2.6, -0.13, 0.13);
      smoothedRoll += (targetRoll - smoothedRoll) * Math.min(1, dt * 3.4);
      camera.rotateX(-0.045);
      camera.rotateZ(smoothedRoll);
      camera.updateMatrixWorld();
    },
    updateAttractCamera({ camera, curve: rail, modeTime }) {
      // Park low over the table start, breathing gently, with the resting
      // ball just under the START word.
      const base = rail.getPointAt(0);
      camera.position.set(
        base.x + Math.sin(modeTime * 0.5) * 0.4,
        base.y + 0.3 + Math.cos(modeTime * 0.7) * 0.12,
        base.z + 0.5,
      );
      // Barely below level: the START word spawns 20 units down the camera's
      // forward axis, so a hard pitch would sink it into the table.
      const look = rail.getPointAt(0.02);
      camera.lookAt(look.x + Math.sin(modeTime * 0.4) * 0.5, look.y - 0.15, look.z);
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping a core's shell pays a little per hit.
    scoreForHit: () => 30,
    scoreForVolley(results) {
      const kills = results.filter((result) => result.killed).length;
      if (kills < 4 || kills < results.length) return 0;
      return kills * 70;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (heartKilled && score >= 13000 && clearRate >= 0.9) return 'S';
      if (score >= 8600 && clearRate >= 0.68) return 'A';
      if (score >= 5000 && clearRate >= 0.46) return 'B';
      if (score >= 2200 && clearRate >= 0.26) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, TINKER_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${TINKER_PLAYER_HEALTH}`, `${rescued} pieces rescued`];
      lines.push(
        heartKilled
          ? 'The spill is beaten — the table is clean'
          : coresCracked > 0
            ? `${coresCracked}/3 glue cores cracked`
            : 'The glue spill remains',
      );
      return lines;
    },
    rescuedPieces: () => rescued,
  };
}

// Static copy of the timeline for trace:spawns and timeline diffing.
const traceSpill = createSpillEntries();
export const TINKER_SPAWN_TIMELINE: TinkerSpawnEntry[] = sortTimeline([
  ...createBaseTimeline(),
  ...traceSpill.cores,
  traceSpill.heart,
]);
