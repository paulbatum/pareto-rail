import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import {
  SPEEDSOLVE_WVDV_BPM,
  SPEEDSOLVE_WVDV_MARKERS,
  SPEEDSOLVE_WVDV_RUN_DURATION,
  SPEEDSOLVE_WVDV_TIME,
  speedsolveBar,
} from './timing';

export { SPEEDSOLVE_WVDV_BPM, SPEEDSOLVE_WVDV_RUN_DURATION } from './timing';

export type SpeedsolveWvdvEnemyKind = 'tile' | 'weakpoint' | 'tetra' | 'octa' | 'prism' | 'bolt' | 'core';
export type SpeedsolveWvdvSpawnData =
  | { role: 'tile'; face: number; row: number; col: number; life: number }
  | { role: 'weakpoint'; face: number; life: number }
  | { role: 'tetra' | 'octa' | 'prism'; laneX: number; laneY: number; phase: number; life: number; fireAge: number }
  | { role: 'bolt'; origin: [number, number, number]; velocity: [number, number, number] }
  | { role: 'core'; life: number };

export type SpeedsolveSpawnEntry = LockOnSpawnEntry<SpeedsolveWvdvEnemyKind, SpeedsolveWvdvSpawnData>;
type SpeedsolveUpdate = LockOnEnemyUpdate<SpeedsolveWvdvEnemyKind, SpeedsolveWvdvSpawnData>;

export const FACE_NORMALS = [
  new Vector3(0, 0, 1),
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, -1),
  new Vector3(-1, 0, 0),
  new Vector3(0, -1, 0),
] as const;

const FACE_RIGHT = [
  new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0),
] as const;
const FACE_UP = [
  new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1),
  new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1),
] as const;

export function facePoint(face: number, col = 0, row = 0, radius = 9.9) {
  return FACE_NORMALS[face].clone().multiplyScalar(radius)
    .addScaledVector(FACE_RIGHT[face], col * 4.15)
    .addScaledVector(FACE_UP[face], row * 4.15);
}

export function createSpeedsolveWvdvRail() {
  const radius = 42;
  const points = [
    FACE_NORMALS[0], FACE_NORMALS[0], FACE_NORMALS[1], FACE_NORMALS[2],
    FACE_NORMALS[3], FACE_NORMALS[4], FACE_NORMALS[5], FACE_NORMALS[0], FACE_NORMALS[0],
  ].map((normal, index) => normal.clone().multiplyScalar(radius + (index % 2) * 1.5));
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.34);
}

const tileSlots: Array<[number, number]> = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
const weakEntries: SpeedsolveSpawnEntry[] = [];
let coreEntry: SpeedsolveSpawnEntry;

function addFaceWave(face: number, base: number): SpeedsolveSpawnEntry[] {
  const tiles = tileSlots.map(([col, row], index): SpeedsolveSpawnEntry => ({
    time: base + SPEEDSOLVE_WVDV_TIME.step(2 + index * 3),
    kind: 'tile',
    data: { role: 'tile', face, row, col, life: SPEEDSOLVE_WVDV_TIME.bar(4) - 0.25 },
  }));
  const weak: SpeedsolveSpawnEntry = {
    time: base + SPEEDSOLVE_WVDV_TIME.bar(2.25),
    kind: 'weakpoint',
    lockable: true,
    data: { role: 'weakpoint', face, life: SPEEDSOLVE_WVDV_TIME.bar(2.1) },
  };
  weakEntries.push(weak);

  const kinds: Array<'tetra' | 'octa' | 'prism'> = ['tetra', 'octa', 'prism'];
  const polyhedra = [0.65, 1.45, 2.9].flatMap((barOffset, group) => {
    const count = group === 2 ? 3 : 2;
    return Array.from({ length: count }, (_, index): SpeedsolveSpawnEntry => ({
      time: base + SPEEDSOLVE_WVDV_TIME.bar(barOffset) + index * SPEEDSOLVE_WVDV_TIME.step(1.5),
      kind: kinds[(face + group + index) % kinds.length],
      data: {
        role: kinds[(face + group + index) % kinds.length],
        laneX: (index - (count - 1) / 2) * (group === 2 ? 5.8 : 7.2) * (face % 2 ? -1 : 1),
        laneY: group === 1 ? 5.3 - index * 7.2 : (index % 2 ? -4.8 : 4.4),
        phase: face * 1.71 + group * 0.83 + index * 2.13,
        life: 5.1,
        fireAge: 1.45 + index * 0.22,
      },
    }));
  });
  return [...tiles, weak, ...polyhedra];
}

export function createSpeedsolveTimeline() {
  weakEntries.length = 0;
  const timeline = Array.from({ length: 6 }, (_, face) => addFaceWave(face, speedsolveBar(face * 4))).flat();
  // When the colored shell has gone, one last guard ring orbits the naked
  // mechanism. Its stagger bridges the face-fall phrase into core spinup.
  const guardKinds: Array<'tetra' | 'octa' | 'prism'> = ['tetra', 'octa', 'prism'];
  for (let index = 0; index < 6; index += 1) {
    const role = guardKinds[index % guardKinds.length];
    timeline.push({
      time: SPEEDSOLVE_WVDV_MARKERS.shellOpen + SPEEDSOLVE_WVDV_TIME.bar(0.35 + index * 0.58),
      kind: role,
      data: {
        role,
        laneX: (index - 2.5) * 3.6,
        laneY: index % 2 === 0 ? 5.8 : -5.2,
        phase: 12.5 + index * 1.31,
        life: 4.6,
        fireAge: 1.4 + (index % 3) * 0.18,
      },
    });
  }
  coreEntry = {
    time: SPEEDSOLVE_WVDV_MARKERS.core,
    kind: 'core',
    hitStages: [3, 3, 3],
    lockable: true,
    data: { role: 'core', life: SPEEDSOLVE_WVDV_RUN_DURATION - SPEEDSOLVE_WVDV_MARKERS.core - 0.25 },
  };
  timeline.push(coreEntry);
  return timeline.sort((a, b) => a.time - b.time);
}

export const SPEEDSOLVE_WVDV_SPAWN_TIMELINE = createSpeedsolveTimeline();

const SCORE: Record<SpeedsolveWvdvEnemyKind, number> = {
  tile: 180, weakpoint: 480, tetra: 120, octa: 150, prism: 190, bolt: 80, core: 4200,
};

function cameraBasis(camera: SpeedsolveUpdate['camera']) {
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const right = new Vector3().crossVectors(forward, camera.up).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  return { forward, right, up };
}

export function createSpeedsolveGameplay(bus: EventBus): LockOnRunnerLevel<SpeedsolveWvdvEnemyKind, SpeedsolveWvdvSpawnData> {
  const tileCounts = new Array<number>(6).fill(0);
  const roles = new Map<number, SpeedsolveWvdvSpawnData>();
  let facesDown = 0;
  let coreDestroyed = false;
  let boltsStopped = 0;
  let hullHits = 0;

  bus.on('runstart', () => {
    tileCounts.fill(0);
    roles.clear();
    facesDown = 0;
    coreDestroyed = false;
    boltsStopped = 0;
    hullHits = 0;
    for (const entry of weakEntries) entry.lockable = true;
    coreEntry.lockable = true;
    bus.emit('bossphase', { phase: 'summoned' });
  });
  bus.on('kill', ({ enemyId }) => {
    const data = roles.get(enemyId);
    if (!data) return;
    if (data.role === 'tile') {
      tileCounts[data.face] += 1;
      if (tileCounts[data.face] >= tileSlots.length) weakEntries[data.face].lockable = true;
    } else if (data.role === 'weakpoint') {
      facesDown += 1;
      if (facesDown >= 6) {
        coreEntry.lockable = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    } else if (data.role === 'bolt') boltsStopped += 1;
    else if (data.role === 'core') {
      coreDestroyed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  bus.on('playerhit', () => { hullHits += 1; });

  const updateEnemy = ({ enemy, age, runTime, camera, enemyState, spawnEnemy, damagePlayer }: SpeedsolveUpdate) => {
    const data = enemy.entry.data;
    roles.set(enemy.id, data);
    const state = enemyState(() => ({
      fired: false,
      damaged: false,
      impact: {} as HostileShotImpactState,
      lastStage: -1,
      position: data.role === 'bolt' ? new Vector3(...data.origin) : new Vector3(),
      velocity: data.role === 'bolt' ? new Vector3(...data.velocity) : new Vector3(),
    }));

    if (data.role === 'tile') {
      enemy.mesh.userData.face = data.face;
      enemy.mesh.position.copy(facePoint(data.face, data.col, data.row));
      enemy.mesh.lookAt(camera.position);
      enemy.mesh.rotation.z += Math.sin(age * 5 + data.row) * 0.002;
      return age > data.life;
    }
    if (data.role === 'weakpoint') {
      enemy.mesh.userData.face = data.face;
      enemy.mesh.position.copy(facePoint(data.face, 0, 0, 10.35));
      enemy.mesh.lookAt(camera.position);
      enemy.mesh.rotation.z += 0.012;
      return age > data.life;
    }
    if (data.role === 'core') {
      const spinUp = MathUtils.smoothstep(runTime, SPEEDSOLVE_WVDV_MARKERS.core, SPEEDSOLVE_WVDV_MARKERS.resolve);
      enemy.mesh.position.set(0, 0, 0);
      enemy.mesh.rotation.x = age * (0.45 + spinUp * 2.4);
      enemy.mesh.rotation.y = age * (0.72 + spinUp * 3.2);
      if (enemy.hitStageIndex !== state.lastStage) {
        state.lastStage = enemy.hitStageIndex;
        enemy.mesh.scale.setScalar(1 + enemy.hitStageIndex * 0.16);
      }
      return age > data.life;
    }
    if (data.role === 'bolt') {
      const shot = state;
      const dt = Math.min(0.04, Math.max(0.001, age - ((enemy.mesh.userData.previousAge as number | undefined) ?? age - 1 / 60)));
      enemy.mesh.userData.previousAge = age;
      steerHomingShot(shot.position, shot.velocity, hostileShotAimPoint(camera, shot.position), age, dt, {
        baseSpeed: 9, maxSpeed: 24, accel: 3.8, turnRate: 2.6,
      });
      const impact = updateHostileShotImpact({ age, camera, position: shot.position, velocity: shot.velocity, state: shot.impact });
      enemy.mesh.position.copy(shot.position);
      enemy.mesh.lookAt(shot.position.clone().add(shot.velocity));
      if (impact.phase === 'braking' && impact.damaged && !shot.damaged) {
        shot.damaged = true;
        damagePlayer();
      }
      return shot.damaged || shotBehindCamera(camera, shot.position) || age > 5.5;
    }

    const basis = cameraBasis(camera);
    const depth = data.role === 'prism' ? MathUtils.lerp(23, 10, MathUtils.smoothstep(age, 0, data.life)) : 19;
    let x = data.laneX;
    let y = data.laneY;
    if (data.role === 'tetra') {
      x += Math.sin(age * 2.15 + data.phase) * 5.2;
      y += Math.sin(age * 4.3 + data.phase) * 1.1;
      enemy.mesh.rotation.set(age * 1.8, age * 2.4, age * 1.2);
    } else if (data.role === 'octa') {
      x += Math.cos(age * 1.7 + data.phase) * 4.3;
      y += Math.sin(age * 1.7 + data.phase) * 4.3;
      enemy.mesh.rotation.set(age * 0.7, age * 2.7, -age * 1.4);
    } else {
      x *= 1 - MathUtils.smoothstep(age, 0, data.life) * 0.55;
      y += Math.sin(age * 2.8 + data.phase) * 2.2;
      enemy.mesh.rotation.set(Math.PI / 2, age * 3.4, Math.sin(age * 2) * 0.5);
    }
    enemy.mesh.position.copy(camera.position)
      .addScaledVector(basis.forward, depth)
      .addScaledVector(basis.right, x)
      .addScaledVector(basis.up, y);

    if (!state.fired && age >= data.fireAge) {
      state.fired = true;
      const initial = camera.position.clone().sub(enemy.mesh.position).normalize().multiplyScalar(7.5);
      spawnEnemy({
        time: runTime,
        kind: 'bolt',
        countsTowardTotal: false,
        data: { role: 'bolt', origin: enemy.mesh.position.toArray(), velocity: initial.toArray() },
      });
    }
    return age > data.life;
  };

  return {
    duration: SPEEDSOLVE_WVDV_RUN_DURATION,
    bpm: SPEEDSOLVE_WVDV_BPM,
    createRail: createSpeedsolveWvdvRail,
    spawnTimeline: SPEEDSOLVE_WVDV_SPAWN_TIMELINE,
    playerHealth: 5,
    lockRadiusNdc: 0.17,
    timing: { shotDelay: { maxGridSeconds: 0.28 }, actionSfx: { gridThirtyseconds: 2 } },
    startWord: 'SOLVE',
    replayWord: 'AGAIN',
    updateAttractCamera({ camera, modeTime }) {
      const angle = modeTime * 0.16;
      camera.position.set(Math.sin(angle) * 34, 5.5 + Math.sin(modeTime * 0.31) * 2.2, Math.cos(angle) * 34);
      camera.lookAt(0, 0, 0);
    },
    updateCameraEffects({ camera, runTime }) {
      const faceDuration = speedsolveBar(4);
      if (runTime < SPEEDSOLVE_WVDV_MARKERS.shellOpen) {
        const phase = Math.min(5, Math.floor(runTime / faceDuration));
        const local = (runTime - phase * faceDuration) / faceDuration;
        const next = Math.min(5, phase + 1);
        const transition = MathUtils.smootherstep(local, 0.72, 1);
        const normal = FACE_NORMALS[phase].clone().lerp(FACE_NORMALS[next], transition).normalize();
        camera.position.copy(normal.multiplyScalar(34)).add(new Vector3(0, Math.sin(runTime * 0.7) * 1.0, 0));
      } else {
        const t = MathUtils.clamp((runTime - SPEEDSOLVE_WVDV_MARKERS.shellOpen) / speedsolveBar(8), 0, 1);
        const angle = t * Math.PI * 0.62;
        camera.position.set(Math.sin(angle) * MathUtils.lerp(34, 25, t), Math.sin(t * Math.PI) * 5.5, Math.cos(angle) * MathUtils.lerp(34, 25, t));
      }
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    },
    updateEnemy,
    scoreForHit(volleySize, enemy) {
      return (enemy.kind === 'core' ? 220 : 75) + volleySize * 18;
    },
    scoreForKill(volleySize, enemy) {
      return Math.round(SCORE[enemy.kind] * (1 + Math.max(0, volleySize - 1) * 0.12));
    },
    scoreForVolley(results) {
      return results.length === 6 && results.every((result) => result.killed) ? 1280 : 0;
    },
    rankForRun(_score, kills, total) {
      const ratio = total ? kills / total : 0;
      if (coreDestroyed && ratio >= 0.92 && hullHits === 0) return 'WORLD RECORD';
      if (coreDestroyed && ratio >= 0.75) return 'SPEEDSOLVED';
      if (coreDestroyed) return 'SOLVED';
      if (facesDown >= 4) return 'DNF';
      return 'SCRAMBLED';
    },
    detailsForRun() {
      return [
        `FACES ${facesDown}/6`,
        `BOLTS ${boltsStopped} ERASED`,
        coreDestroyed ? 'CORE: CHECKMATE' : 'CORE: LIVE',
      ];
    },
  };
}
