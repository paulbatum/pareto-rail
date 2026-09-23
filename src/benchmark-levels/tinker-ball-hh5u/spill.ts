import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { BallDirector } from './ball';
import type { TinkerEnemyKind, TinkerSpawnEntry, TinkerUpdate } from './gameplay';
import { bar, BAR_SECONDS, BEAT_SECONDS, TINKER_BARS } from './timing';

// The spill: a glue lake in the middle of the table that has swallowed the
// table's materials. Three dark cores rise out of it one after another, each
// wrapped in layers recycled from swallowed supplies (every layer a hit stage:
// crack one and the spill wraps the core in the next, while the broken layer
// showers the route with rescued pieces). At bar 27 the heart surfaces — two
// full six-lock layers — and the last glue snaps clean.

export type CoreData = {
  role: 'core';
  index: number;
  angle: number;
  radius: number;
  height: number;
};

export type HeartData = { role: 'heart' };

export type SpillData = CoreData | HeartData;

// Cores ring the heart; angles are measured around the spill centre and
// chosen so each surfaces on the side the orbiting camera is facing.
const CORES: ReadonlyArray<{ atBar: number; angleOffset: number; radius: number; height: number }> = [
  { atBar: TINKER_BARS.spill, angleOffset: -0.25, radius: 15, height: 19 },
  { atBar: 23.5, angleOffset: 0.35, radius: 17, height: 23 },
  { atBar: TINKER_BARS.spillDrive, angleOffset: 0.5, radius: 14, height: 18 },
];

export const CORE_STAGES = [2, 2, 2];
export const HEART_STAGES = [6, 6];
export const HEART_HEIGHT = 24;
const CORE_RISE_SECONDS = 0.9;
const SINK_SECONDS = 1.1;
const GLOB_EVERY_BARS = 2;

type CoreState = { nextGlobBar: number; sinkStart: number | null };

export function createSpill(bus: EventBus, director: BallDirector, fireGlob: (context: TinkerUpdate, from: Vector3) => void) {
  const center = director.route.spillCenter;
  let coresCracked = 0;
  let heartCleared = false;
  let heartSeen = false;
  let heartId = -1;
  const coreIds = new Set<number>();
  const coreState = new Map<number, CoreState>();
  const origin = new Vector3();

  // A core faces the camera side of the lake at the moment it surfaces: its
  // angle is the ball's bearing from the centre when it spawns, nudged.
  function bearingOfBallAt(time: number) {
    const s = director.route.distanceAtTime(time);
    const p = director.frameAt(s).position;
    return Math.atan2(p.z - center.z, p.x - center.x);
  }

  function entries(): TinkerSpawnEntry[] {
    const cores: TinkerSpawnEntry[] = CORES.map((core, index) => ({
      time: bar(core.atBar),
      kind: 'spill-core' as TinkerEnemyKind,
      hitStages: CORE_STAGES,
      data: {
        role: 'core',
        index,
        angle: bearingOfBallAt(bar(core.atBar) + 2.5) + core.angleOffset,
        radius: core.radius,
        height: core.height,
      },
    }));
    const heart: TinkerSpawnEntry = {
      time: bar(TINKER_BARS.heart),
      kind: 'spill-heart',
      hitStages: HEART_STAGES,
      data: { role: 'heart' },
    };
    return [...cores, heart];
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'spill-core') {
      coreIds.add(enemyId);
      if (coreIds.size === 1) bus.emit('bossphase', { phase: 'summoned' });
    }
    if (kind === 'spill-heart') {
      heartId = enemyId;
      heartSeen = true;
      bus.emit('bossphase', { phase: 'exposed' });
    }
  });

  bus.on('kill', ({ enemyId }) => {
    if (coreIds.delete(enemyId)) coresCracked += 1;
    if (enemyId === heartId) {
      heartCleared = true;
      director.markHeartCleared();
      director.growBonus(0.7);
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  function reset() {
    coresCracked = 0;
    heartCleared = false;
    heartSeen = false;
    heartId = -1;
    coreIds.clear();
    coreState.clear();
  }

  function update(context: TinkerUpdate, data: SpillData) {
    const { enemy, age, runTime } = context;
    const b = runTime / BAR_SECONDS;
    const mesh = enemy.mesh;
    if (data.role === 'core') {
      const state = coreState.get(enemy.id) ?? { nextGlobBar: Math.ceil(b) + 1 + data.index * 0.5, sinkStart: null };
      coreState.set(enemy.id, state);
      const rise = easeOutBack(Math.min(1, age / CORE_RISE_SECONDS));
      let y = MathUtils.lerp(4, data.height, rise) + Math.sin(runTime * 1.7 + data.index * 2) * 0.8;
      // Cores still standing when the heart surfaces are pulled back under.
      if (b >= TINKER_BARS.heart && state.sinkStart === null) state.sinkStart = runTime;
      if (state.sinkStart !== null) {
        const k = (runTime - state.sinkStart) / SINK_SECONDS;
        y -= easeInCubic(Math.min(1, k)) * (data.height + 8);
        mesh.userData.sinking = true;
        if (k >= 1) return true;
      }
      const wobble = Math.sin(runTime * 0.6 + data.index) * 0.08;
      origin.set(
        center.x + Math.cos(data.angle + wobble) * data.radius,
        y,
        center.z + Math.sin(data.angle + wobble) * data.radius,
      );
      mesh.position.copy(origin);
      mesh.rotation.set(0, runTime * 0.35 + data.index, 0);
      mesh.userData.stageIndex = enemy.hitStageIndex;
      // Spit a glob every other bar, on the downbeat, once risen.
      if (state.sinkStart === null && age > CORE_RISE_SECONDS && b >= state.nextGlobBar) {
        state.nextGlobBar += GLOB_EVERY_BARS;
        fireGlob(context, origin.clone().add(new Vector3(0, 2.5, 0)));
      }
      return false;
    }

    // The heart: surfaces at bar 27 from the middle of the lake and sinks
    // back, unbeaten, if the ball reaches it first.
    const rise = easeOutBack(Math.min(1, age / 1.2));
    let y = MathUtils.lerp(-4, HEART_HEIGHT, rise) + Math.sin(runTime * 2 * Math.PI / (BEAT_SECONDS * 4)) * 0.6;
    if (b >= 29.55) {
      const k = (b - 29.55) / 0.45;
      y -= easeInCubic(Math.min(1, k)) * (HEART_HEIGHT + 6);
      mesh.userData.sinking = true;
      if (k >= 1) return true;
    }
    mesh.position.set(center.x, y, center.z);
    mesh.rotation.set(0, runTime * 0.5, 0);
    mesh.userData.stageIndex = enemy.hitStageIndex;
    return false;
  }

  return {
    entries,
    update,
    reset,
    summary() {
      if (heartCleared) return 'The spill is spotless';
      if (!heartSeen) return `Spill cores cracked ${coresCracked}/${CORES.length}`;
      return `The spill held · cores cracked ${coresCracked}/${CORES.length}`;
    },
  };
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function easeInCubic(t: number) {
  return t * t * t;
}
