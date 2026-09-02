import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type {
  LockOnEnemyUpdate,
  LockOnRunnerLevel,
  LockOnSpawnEntry,
} from '../../engine/lock-on-runner';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { formation, section, sortTimeline } from '../../engine/spawn-patterns';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  bar,
  BOSS_TIME,
  FOREST_TIME,
  SERENITY_TIME,
  STRANDLINE_BAR,
  STRANDLINE_BPM,
  STRANDLINE_DURATION,
  STRANDLINE_TIME,
  VISTA_TIME,
} from './timing';

export { STRANDLINE_BPM, STRANDLINE_DURATION } from './timing';

export const STRANDLINE_PLAYER_HEALTH = 4;

export type StrandlineEnemyKind =
  | 'polyp'
  | 'mite'
  | 'spitter'
  | 'spore'
  | 'lattice'
  | 'brood'
  | 'parent'
  | 'letter';

export type StrandlineMovementPattern = 'latched' | 'skitter' | 'orbit' | 'lattice' | 'brood' | 'parent';

type StrandlineWaveData = {
  role: 'wave';
  pattern: StrandlineMovementPattern;
  lead: number;
  offset: Vector3;
  phase?: number;
  fired?: boolean;
};

type StrandlineSporeData = {
  role: 'spore';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

type StrandlineBossData = {
  role: 'boss';
  part: 'lattice' | 'parent';
  index?: number;
  lead: number;
};

export type StrandlineSpawnData = StrandlineWaveData | StrandlineSporeData | StrandlineBossData;
export type StrandlineSpawnEntry = LockOnSpawnEntry<StrandlineEnemyKind, StrandlineSpawnData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineEnemyKind, StrandlineSpawnData>;

// --------------------------------------------------------------------------
// 3D Rail Curve
// --------------------------------------------------------------------------
export function createStrandlineRail(): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0), // Start (t=0s)
      new Vector3(-14, -8, -60), // Shallows: banking left into strands
      new Vector3(18, -16, -130), // Shallows: weaving right between strands
      new Vector3(-20, -22, -210), // Deep Forest: weaving left
      new Vector3(15, -26, -290), // Deep Forest: curving toward the vista
      new Vector3(95, 0, -360), // The Vista: banking wide right into open water!
      new Vector3(135, 35, -430), // Vista Apex: looking back at the colossal bell!
      new Vector3(70, 65, -510), // Swinging inward toward the animal
      new Vector3(15, 50, -580), // Diving back in through oral arms
      new Vector3(-12, 58, -630), // Threading inner oral arms
      new Vector3(0, 84, -680), // Climbing up to the crown
      new Vector3(0, 112, -732), // Crown arrival (boss arena)
      new Vector3(0, 116, -748), // Crown root center
      new Vector3(0, 118, -756), // Serene drift end
    ],
    false,
    'catmullrom',
    0.45,
  );
}

// --------------------------------------------------------------------------
// Speed Profile
// --------------------------------------------------------------------------
const speedProfile = createSpeedProfile(
  [
    [0, 1.0],
    [FOREST_TIME, 1.05],
    [VISTA_TIME, 0.86], // Slowdown to take in the panoramic green moon vista
    [VISTA_TIME + 5.0, 0.95],
    [30.0, 1.18], // Surge during ascent through the oral arms
    [BOSS_TIME - 3.0, 1.0],
    [BOSS_TIME, 0.92], // Steady combat pace around the crown
    [SERENITY_TIME - 1.0, 0.7],
    [SERENITY_TIME, 0.18], // Deceleration after boss kill
    [STRANDLINE_DURATION, 0.05], // Gentle drifting resolution
  ],
  STRANDLINE_DURATION,
);

export const strandlineRunProgress = speedProfile.runProgress;

// --------------------------------------------------------------------------
// Spawn Timeline Construction
// --------------------------------------------------------------------------
const time = STRANDLINE_TIME;
const GAP = time.seconds(0.16);

function wave(
  entryTime: number,
  lead: number,
  pattern: StrandlineMovementPattern,
  kind: StrandlineEnemyKind,
  offsets: Array<[number, number]>,
  hitStages?: number[],
): StrandlineSpawnEntry[] {
  return formation(entryTime, GAP, offsets, (offset, i) => ({
    kind,
    hitStages,
    data: {
      role: 'wave',
      lead,
      pattern,
      offset: new Vector3(offset[0], offset[1], 0),
      phase: i * 0.9,
    },
  }));
}

function createTimeline(): StrandlineSpawnEntry[] {
  const entries: StrandlineSpawnEntry[] = [];

  // =========================================================================
  // ACT 1: SHALLOWS & OUTER STRANDS (Bars 1 to 5.5, 2.5s to 13.75s)
  // Well-framed lateral offsets (avoiding screen center) and leads 2.8 - 3.2s
  // =========================================================================
  // Bar 1 (2.5s): Pair of latched polyps on left and right flanks
  entries.push(
    ...wave(bar(1.0), 3.2, 'latched', 'polyp', [
      [-16, 5],
      [16, -4],
    ]),
  );

  // Bar 2 (5.0s): Trio sweeping across the viewport
  entries.push(
    ...wave(bar(2.0), 3.0, 'latched', 'polyp', [
      [-17, 7],
      [-10, -6],
      [15, 6],
    ]),
  );

  // Bar 3 (7.5s): 4 polyps forming an open bracket
  entries.push(
    ...wave(bar(3.0), 3.0, 'latched', 'polyp', [
      [-16, -4],
      [-11, 7],
      [11, 7],
      [16, -4],
    ]),
  );

  // Bar 4 (10.0s): Lateral bracket with high screen spread
  entries.push(
    ...wave(bar(4.0), 2.9, 'latched', 'polyp', [
      [-17, 5],
      [-12, -6],
      [12, -6],
      [17, 5],
    ]),
  );

  // Bar 5 (12.5s): 4 polyps waking as we plunge deeper
  entries.push(
    ...wave(bar(5.0), 2.9, 'latched', 'polyp', [
      [-15, -6],
      [-10, 6],
      [10, 6],
      [15, -6],
    ]),
  );

  // =========================================================================
  // ACT 2: DEEP FOREST & THE VISTA (Bars 6 to 11.5, 15.0s to 28.75s)
  // Fast skittering mites sweeping across screen, plus first armored spitter.
  // =========================================================================
  // Bar 6 (15.0s): Fast skittering mites emerging from strand canopy
  entries.push(
    ...wave(bar(6.0), 3.0, 'skitter', 'mite', [
      [-16, 4],
      [16, -4],
      [-10, 7],
      [10, 7],
    ]),
  );

  // Bar 7 (17.5s): Flanking mites crossing the viewport
  entries.push(
    ...wave(bar(7.0), 2.9, 'skitter', 'mite', [
      [-17, -5],
      [-11, 5],
      [11, 5],
      [17, -5],
    ]),
  );

  // Bar 8 (20.0s): Heavy spore spitter + guarding mites
  entries.push(
    ...wave(bar(8.0), 3.2, 'orbit', 'spitter', [[-14, 6]], [2, 1]),
    ...wave(bar(8.2), 2.9, 'skitter', 'mite', [
      [-16, -5],
      [16, -5],
    ]),
  );

  // Bar 9 (22.5s): Wide vista opens! Colossal bell fills view like a green moon!
  entries.push(
    ...wave(bar(9.0), 3.2, 'skitter', 'mite', [
      [-17, 5],
      [17, 5],
    ]),
  );

  // Bar 10 (25.0s): Vista wave - wide diamond sweep
  entries.push(
    ...wave(bar(10.0), 3.0, 'skitter', 'mite', [
      [-16, -6],
      [-10, 7],
      [10, 7],
      [16, -6],
    ]),
  );

  // Bar 11 (27.5s): Second spitter + polyps before diving back into the tentacles
  entries.push(
    ...wave(bar(11.0), 3.2, 'orbit', 'spitter', [[14, 5]], [2, 1]),
    ...wave(bar(11.2), 2.9, 'latched', 'polyp', [
      [-16, -5],
      [-11, 5],
    ]),
  );

  // =========================================================================
  // ACT 3: THE CROWN ASCENT (Bars 12 to 17.5, 30.0s to 43.75s)
  // Rail dives into the oral arms and surges upward. Dense, multi-stage combat.
  // =========================================================================
  // Bar 12 (30.0s): Rapid swarm of mites threading the oral arms
  entries.push(
    ...wave(bar(12.0), 2.8, 'skitter', 'mite', [
      [-17, 5],
      [-11, -5],
      [11, -5],
      [17, 5],
    ]),
  );

  // Bar 13 (32.5s): Twin spitters flanking the climb!
  entries.push(
    ...wave(bar(13.0), 3.2, 'orbit', 'spitter', [
      [-15, -3],
      [15, -3],
    ], [2, 1]),
  );

  // Bar 14 (35.0s): Mixed wave - waking polyps and skittering mites
  entries.push(
    ...wave(bar(14.0), 2.8, 'latched', 'polyp', [
      [-16, 6],
      [16, 6],
    ]),
    ...wave(bar(14.2), 2.8, 'skitter', 'mite', [
      [-10, -5],
      [10, -5],
    ]),
  );

  // Bar 15 (37.5s): Dense cross formation climbing upward
  entries.push(
    ...wave(bar(15.0), 2.9, 'skitter', 'mite', [
      [-17, 2],
      [17, 2],
      [-11, 6],
      [11, -6],
    ]),
  );

  // Bar 16 (40.0s): Armored spitter + mites guarding the crown approach
  entries.push(
    ...wave(bar(16.0), 3.1, 'orbit', 'spitter', [[-14, 6]], [2, 1]),
    ...wave(bar(16.2), 2.8, 'skitter', 'mite', [
      [-16, -5],
      [16, -5],
    ]),
  );

  // Bar 17 (42.5s): Final ascent barrage before the boss
  entries.push(
    ...wave(bar(17.0), 2.8, 'skitter', 'mite', [
      [-16, 6],
      [-10, -5],
      [10, -5],
      [16, 6],
    ]),
  );

  // =========================================================================
  // ACT 4: THE CROWN PARASITE / BOSS (Bars 18 to 22, 45.0s to 55.0s)
  // Parent Organism shielded behind 4 Webbing Lattice nodes and Broods.
  // =========================================================================
  entries.push({
    time: BOSS_TIME,
    kind: 'parent',
    hitStages: [2, 2, 2],
    lockable: false,
    data: {
      role: 'boss',
      part: 'parent',
      lead: 10.0,
    },
  });

  // 4 Lattice webbing nodes in a wide ring around the crown (radius 16)
  for (let i = 0; i < 4; i += 1) {
    entries.push({
      time: BOSS_TIME,
      kind: 'lattice',
      hitPoints: 2,
      data: {
        role: 'boss',
        part: 'lattice',
        index: i,
        lead: 10.0,
      },
    });
  }

  // Brood waves spawned during the boss fight
  entries.push(
    ...wave(bar(18.6), 3.0, 'brood', 'brood', [
      [-18, 6],
      [18, -6],
    ]),
    ...wave(bar(19.4), 3.0, 'brood', 'brood', [
      [-19, -7],
      [19, 7],
      [-12, 9],
      [12, -9],
    ]),
    ...wave(bar(20.2), 3.0, 'brood', 'brood', [
      [-20, 5],
      [20, 5],
      [-14, -8],
      [14, -8],
    ]),
    // Extra late waves to bridge seamlessly into serenity
    ...wave(bar(20.8), 2.9, 'brood', 'brood', [
      [-18, -6],
      [18, 6],
    ]),
    ...wave(bar(21.4), 2.8, 'brood', 'brood', [
      [-21, 7],
      [21, -7],
    ]),
  );

  return sortTimeline(entries);
}

// --------------------------------------------------------------------------
// Gameplay Implementation
// --------------------------------------------------------------------------
export function createStrandlineGameplay(bus: EventBus): LockOnRunnerLevel<StrandlineEnemyKind, StrandlineSpawnData> {
  const curve = createStrandlineRail();
  const timeline = createTimeline();

  let hitsTaken = 0;
  let latticeRemaining = 4;
  let parentExposed = false;
  let parentDefeated = false;
  const enemyKinds = new Map<number, string>();

  bus.on('runstart', () => {
    hitsTaken = 0;
    latticeRemaining = 4;
    parentExposed = false;
    parentDefeated = false;
    enemyKinds.clear();
  });

  bus.on('playerhit', () => {
    hitsTaken += 1;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    enemyKinds.set(enemyId, kind);
  });

  bus.on('kill', ({ enemyId }) => {
    const kind = enemyKinds.get(enemyId);
    if (kind === 'lattice') {
      latticeRemaining = Math.max(0, latticeRemaining - 1);
      if (latticeRemaining === 0 && !parentExposed) {
        parentExposed = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    } else if (kind === 'parent') {
      parentDefeated = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
    enemyKinds.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    enemyKinds.delete(enemyId);
  });

  function fireSpore(context: StrandlineUpdate, origin: Vector3) {
    const toCamera = context.camera.position.clone().sub(origin).normalize();
    const initialVel = toCamera.multiplyScalar(14.0);

    context.spawnEnemy({
      time: context.runTime,
      kind: 'spore',
      hitPoints: 1,
      countsTowardTotal: false,
      data: {
        role: 'spore',
        position: origin.clone(),
        velocity: initialVel,
        lastAge: 0,
      },
    });
  }

  function updateWave(context: StrandlineUpdate, data: StrandlineWaveData): boolean {
    const { enemy, age, runTime, camera } = context;
    const anchorU = context.railAnchor(data.lead);
    const runProgress = strandlineRunProgress(runTime);

    // Dynamic offset based on pattern
    const offset = data.offset.clone();
    const phase = data.phase ?? 0;

    switch (data.pattern) {
      case 'latched': {
        // Clamped to strand, then corkscrews outward
        if (age > 0.6) {
          const corkscrew = Math.min(2.5, (age - 0.6) * 1.5);
          offset.x += Math.sin(age * 5.0 + phase) * (corkscrew + 1.5);
          offset.y += Math.cos(age * 5.0 + phase) * (corkscrew + 1.0);
        }
        break;
      }
      case 'skitter': {
        // Wide sweeping Lissajous motion across the viewport
        offset.x += Math.sin(age * 2.8 + phase) * 7.5;
        offset.y += Math.cos(age * 1.9 + phase) * 4.5;
        break;
      }
      case 'orbit': {
        // Helical orbit around the strand cluster
        offset.x += Math.cos(age * 1.5 + phase) * 6.0;
        offset.y += Math.sin(age * 1.5 + phase) * 4.0;

        // Spitter fires spore hazard at age 1.4s
        if (!data.fired && age >= 1.4 && age < 1.6) {
          data.fired = true;
          fireSpore(context, enemy.mesh.position);
        }
        break;
      }
      case 'brood': {
        // Controlled spiral
        const r = 3.0 + age * 1.6;
        offset.x += Math.cos(age * 5.5 + phase) * r;
        offset.y += Math.sin(age * 5.5 + phase) * r;
        break;
      }
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);

    // Swimming / squirming rotation
    enemy.mesh.rotateZ(runTime * 0.8 + phase);
    enemy.mesh.rotateY(Math.sin(runTime * 1.2 + phase) * 0.35);

    // Despawn once camera passes the anchor point
    return runProgress > anchorU + 0.022;
  }

  function updateSpore(context: StrandlineUpdate, data: StrandlineSporeData): boolean {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      config: {
        hitDistance: 6.5,
        impactBrake: 0.45,
        damageDistance: 1.2,
      },
    });

    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9.0);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    // Steer homing spore aggressively toward the player's view center
    steerHomingShot(
      data.position,
      data.velocity,
      hostileShotAimPoint(camera, data.position, 6.5),
      age,
      dt,
      {
        baseSpeed: 12.0,
        maxSpeed: 28.0,
        accel: 8.0,
        turnRate: 4.5,
      },
    );

    enemy.mesh.position.copy(data.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 4.0);

    return shotBehindCamera(camera, data.position) || age > 6.0;
  }

  function updateBoss(context: StrandlineUpdate, data: StrandlineBossData): boolean {
    const { enemy, age, runTime, camera } = context;

    // Boss arena is anchored at the crown near the rail end: u = 0.94
    const crownU = 0.94;
    const frame = sampleRailFrame(curve, crownU);

    if (data.part === 'lattice') {
      const idx = data.index ?? 0;
      const angle = (idx / 4) * Math.PI * 2 + age * 0.4;
      const radius = 16.0;

      const offset = new Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        -1.0,
      );

      enemy.mesh.position.copy(frame.position)
        .addScaledVector(frame.right, offset.x)
        .addScaledVector(frame.up, offset.y)
        .addScaledVector(frame.tangent, offset.z);

      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 1.5 + idx);

      // Despawn if boss is defeated or run ends
      return parentDefeated || runTime >= SERENITY_TIME;
    }

    if (data.part === 'parent') {
      // The parent organism rests at the center of the crown
      enemy.mesh.position.copy(frame.position);
      enemy.mesh.quaternion.copy(camera.quaternion);

      // Writhing motion
      enemy.mesh.rotateZ(Math.sin(runTime * 1.5) * 0.15);
      enemy.mesh.rotateX(Math.cos(runTime * 1.2) * 0.1);

      // Dynamically make lockable once lattice is destroyed or at bar 20.5
      const shouldExpose = latticeRemaining === 0 || runTime >= bar(20.5);
      if (shouldExpose && !parentExposed) {
        parentExposed = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
      enemy.entry.lockable = parentExposed;

      // Despawn once serenity begins or if killed
      return parentDefeated || runTime >= SERENITY_TIME;
    }

    return false;
  }

  return {
    duration: STRANDLINE_DURATION,
    bpm: STRANDLINE_BPM,
    playerHealth: STRANDLINE_PLAYER_HEALTH,
    createRail: () => curve,
    spawnTimeline: timeline,
    easeRunProgress: strandlineRunProgress,
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'wave':
          return updateWave(context, data);
        case 'spore':
          return updateSpore(context, data);
        case 'boss':
          return updateBoss(context, data);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      const baseScores: Record<string, number> = {
        polyp: 120,
        mite: 160,
        spitter: 280,
        spore: 80,
        lattice: 350,
        brood: 140,
        parent: 2500,
        letter: 100,
      };
      const base = baseScores[enemy.kind] ?? 100;
      return Math.round(base * multiplier);
    },
    scoreForHit() {
      return 50; // Non-lethal hits on multi-stage spitters, lattice, and boss
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (score >= 9500 && clearRate >= 0.88) return 'S';
      if (score >= 7200 && clearRate >= 0.72) return 'A';
      if (score >= 4800 && clearRate >= 0.52) return 'B';
      if (score >= 2400 && clearRate >= 0.32) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, STRANDLINE_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${STRANDLINE_PLAYER_HEALTH}`];
      if (parentDefeated) lines.push('Infestation Purged — Animal Serene');
      else lines.push('Colony Survived');
      return lines;
    },
  };
}
