import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createMusicTime } from '../../engine/music-time';
import type { EventBus } from '../../events';

export const SKYHOOK_9UIB_BPM = 120;
export const SKYHOOK_9UIB_TIME = createMusicTime(SKYHOOK_9UIB_BPM, { stepsPerBar: 16 });
export const SKYHOOK_9UIB_RUN_DURATION = SKYHOOK_9UIB_TIME.bar(30); // exactly 60 seconds
export const SKYHOOK_MARKERS = {
  storm: SKYHOOK_9UIB_TIME.bar(0),
  cloudbreak: SKYHOOK_9UIB_TIME.bar(8),
  thinAir: SKYHOOK_9UIB_TIME.bar(16),
  clampfall: SKYHOOK_9UIB_TIME.bar(21),
  docking: SKYHOOK_9UIB_TIME.bar(27),
};

export type Skyhook9uibEnemyKind = 'sailwing' | 'grappler' | 'orbiter' | 'clamp';
export type Skyhook9uibSpawnData =
  | { role: 'sail'; lead: number; side: number; height: number; phase: number }
  | { role: 'grapple'; lead: number; side: number; height: number; attackAt: number }
  | { role: 'orbit'; lead: number; radius: number; phase: number; direction: number }
  | { role: 'boss'; attackAt: number };
export type SkyhookEntry = LockOnSpawnEntry<Skyhook9uibEnemyKind, Skyhook9uibSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<Skyhook9uibEnemyKind, Skyhook9uibSpawnData>;

export function createSkyhook9uibRail() {
  // The camera climbs a gently swaying tether. Forward remains mostly -Z so
  // targets stay readable while the rising Y and falling planet sell altitude.
  return new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(2, 32, -75),
    new Vector3(-4, 72, -155),
    new Vector3(5, 118, -245),
    new Vector3(-3, 170, -345),
    new Vector3(3, 228, -455),
    new Vector3(-2, 292, -570),
    new Vector3(1, 360, -690),
    new Vector3(0, 430, -815),
    new Vector3(0, 502, -945),
  ], false, 'catmullrom', 0.38);
}

const bar = (value: number) => SKYHOOK_9UIB_TIME.bar(value);

function sails(time: number, layout: Array<[number, number]>, lead = 5): SkyhookEntry[] {
  return layout.map(([side, height], index) => ({
    time: time + index * 0.12,
    kind: 'sailwing',
    data: { role: 'sail', lead, side, height, phase: time * 0.7 + index * 1.9 },
  }));
}

function grapplers(time: number, layout: Array<[number, number]>, lead = 6.2): SkyhookEntry[] {
  return layout.map(([side, height], index) => ({
    time: time + index * 0.18,
    kind: 'grappler',
    hitPoints: 2,
    data: { role: 'grapple', lead, side, height, attackAt: 5.5 + index * 0.18 },
  }));
}

function orbiters(time: number, count: number, radius: number, lead = 5.2): SkyhookEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    time: time + index * 0.11,
    kind: 'orbiter',
    data: { role: 'orbit', lead, radius, phase: index / count * Math.PI * 2, direction: index % 2 ? -1 : 1 },
  }));
}

export const SKYHOOK_9UIB_SPAWN_TIMELINE: SkyhookEntry[] = [
  // Weather: broad wind-rider formations teach long horizontal sweeps.
  ...sails(bar(1), [[-7, -2], [-3.5, 1], [0, 3.5], [3.5, 1], [7, -2]], 5.3),
  ...sails(bar(3), [[-8, 3], [-4.5, 0], [4.5, 0], [8, 3]], 4.8),
  ...grapplers(bar(4.5), [[-6, 1], [6, 1]]),
  ...sails(bar(6), [[-8, -2], [-5, 1], [-2, 4], [2, 4], [5, 1], [8, -2]], 4.7),

  // Cloudbreak: hardware emerges from the glare and dives at the car.
  ...grapplers(bar(8.5), [[-7, 4], [0, -1], [7, 4]], 6),
  ...sails(bar(10.5), [[-9, 0], [-4.5, 4], [0, -2], [4.5, 4], [9, 0]], 4.8),
  ...orbiters(bar(12), 6, 7.5, 5.3),
  ...grapplers(bar(14), [[-8, -1], [-3, 4], [3, 4], [8, -1]], 6.1),

  // Thin air: wind forms vanish; vacuum drones circle the tether in rings.
  ...orbiters(bar(16), 5, 8.5, 5.1),
  ...orbiters(bar(18), 6, 9.5, 5),
  ...grapplers(bar(19.2), [[-6, -3], [6, 5]], 5.8),

  // The clamp is visible for the whole final fight, crawling down the tether.
  ...([{
    time: bar(21),
    kind: 'clamp',
    hitStages: [2, 3, 2],
    data: { role: 'boss', attackAt: 12.8 },
  }] satisfies SkyhookEntry[]),
].sort((a, b) => a.time - b.time);

const SCORES: Record<Skyhook9uibEnemyKind, number> = {
  sailwing: 110,
  grappler: 240,
  orbiter: 150,
  clamp: 2600,
};

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<Skyhook9uibEnemyKind, Skyhook9uibSpawnData> {
  let hullHits = 0;
  let grapplersStopped = 0;
  let bossDestroyed = false;

  bus.on('runstart', () => {
    hullHits = 0;
    grapplersStopped = 0;
    bossDestroyed = false;
  });
  bus.on('playerhit', ({ damage }) => { hullHits += damage; });
  bus.on('kill', ({ enemyId }) => {
    const entry = SKYHOOK_9UIB_SPAWN_TIMELINE.find((_, index) => index + 1 === enemyId);
    if (entry?.kind === 'grappler') grapplersStopped += 1;
    if (entry?.kind === 'clamp') bossDestroyed = true;
  });

  function updateSail(context: SkyhookUpdate, data: Extract<Skyhook9uibSpawnData, { role: 'sail' }>) {
    const anchor = context.railAnchor(data.lead * 0.76);
    const sweep = data.side * 2.25 + Math.sin(context.age * 1.25 + data.phase) * 3.4;
    const lift = data.height * 1.8 + Math.sin(context.age * 2.1 + data.phase) * 1.8;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(sweep, lift, 0)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(-Math.sin(context.age * 1.25 + data.phase) * 0.65);
    context.enemy.mesh.rotateY(Math.sin(context.age * 2.5 + data.phase) * 0.22);
    return context.runProgress > anchor + 0.018;
  }

  function updateGrappler(context: SkyhookUpdate, data: Extract<Skyhook9uibSpawnData, { role: 'grapple' }>) {
    const state = context.enemyState(() => ({ struck: false }));
    const closing = MathUtils.smoothstep(context.age, 0, data.attackAt);
    const lead = MathUtils.lerp(data.lead * 0.76, 0.3, closing);
    const anchor = context.railAnchor(lead);
    const offset = new Vector3(
      MathUtils.lerp(data.side * 2.1, data.side * 0.12, closing),
      MathUtils.lerp(data.height * 1.7, -1.7, closing),
      Math.sin(context.age * 6) * (1 - closing) * 0.4,
    );
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, offset));
    context.enemy.mesh.lookAt(context.camera.position);
    context.enemy.mesh.rotateZ(Math.sin(context.age * 5) * 0.14);
    if (!state.struck && context.age >= data.attackAt) {
      state.struck = true;
      context.damagePlayer(1);
      return true;
    }
    return context.runProgress > anchor + 0.025;
  }

  function updateOrbiter(context: SkyhookUpdate, data: Extract<Skyhook9uibSpawnData, { role: 'orbit' }>) {
    const anchor = context.railAnchor(data.lead * 0.76);
    const angle = data.phase + context.age * 0.8 * data.direction;
    const radius = data.radius * 1.9 * (0.9 + Math.sin(context.age * 1.7 + data.phase) * 0.1);
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius + 1.2,
      Math.sin(context.age * 2 + data.phase) * 0.7,
    )));
    context.enemy.mesh.lookAt(offsetFromRail(context.curve, anchor, new Vector3(0, 1, 0)));
    context.enemy.mesh.rotateZ(context.age * 1.8 * data.direction);
    return context.runProgress > anchor + 0.018;
  }

  function updateBoss(context: SkyhookUpdate, data: Extract<Skyhook9uibSpawnData, { role: 'boss' }>) {
    const state = context.enemyState(() => ({ struck: false }));
    const approach = MathUtils.smoothstep(context.age, 0, data.attackAt);
    // Descend from a distant point on the tether toward the climber. Its scale
    // stays constant; perspective is what makes the threat grow.
    const lead = MathUtils.lerp(12, 0.28, approach * approach);
    const anchor = context.railAnchor(lead);
    const stage = context.enemy.hitStageIndex;
    const stagger = stage > 0 ? Math.sin(context.age * (12 + stage * 4)) * 0.18 : 0;
    context.enemy.mesh.position.copy(offsetFromRail(context.curve, anchor, new Vector3(stagger, 1.2, 0)));
    context.enemy.mesh.quaternion.copy(context.camera.quaternion);
    context.enemy.mesh.rotateZ(Math.sin(context.age * 1.4) * 0.08 + stage * 0.07);
    if (!state.struck && context.age >= data.attackAt) {
      state.struck = true;
      context.damagePlayer(4);
      return true;
    }
    return false;
  }

  return {
    duration: SKYHOOK_9UIB_RUN_DURATION,
    bpm: SKYHOOK_9UIB_BPM,
    playerHealth: 4,
    createRail: createSkyhook9uibRail,
    spawnTimeline: SKYHOOK_9UIB_SPAWN_TIMELINE,
    startWord: 'ASCEND',
    replayWord: 'AGAIN',
    lockRadiusNdc: 0.2,
    timing: {
      shotDelay: { maxGridSeconds: 0.42 },
      actionSfx: { enabled: true, gridThirtyseconds: 1 },
    },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'sail': return updateSail(context, data);
        case 'grapple': return updateGrappler(context, data);
        case 'orbit': return updateOrbiter(context, data);
        case 'boss': return updateBoss(context, data);
      }
    },
    scoreForHit: () => 55,
    scoreForKill(volleySize, enemy) {
      return Math.round(SCORES[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.16));
    },
    scoreForVolley(results) {
      return results.length === 6 ? 360 : results.length >= 4 ? 120 : 0;
    },
    rankForRun(score, kills, total) {
      const ratio = total ? kills / total : 0;
      if (bossDestroyed && ratio >= 0.9 && hullHits === 0) return 'ORBITAL';
      if (bossDestroyed && ratio >= 0.72) return 'ASCENDER';
      if (bossDestroyed) return 'DOCKED';
      return score > 4500 ? 'HOLDING' : 'GROUNDED';
    },
    detailsForRun() {
      return [
        `CLIMBER HULL ${Math.max(0, 4 - hullHits)}/4`,
        `GRAPPLERS STOPPED ${grapplersStopped}/11`,
        bossDestroyed ? 'SKYHOOK SECURED' : 'TETHER OVERRUN',
      ];
    },
  };
}
