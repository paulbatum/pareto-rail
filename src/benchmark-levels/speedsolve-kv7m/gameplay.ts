import { CatmullRomCurve3, MathUtils, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { EventBus } from '../../events';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { hostileShotAimPoint, shotBehindCamera, steerHomingShot, updateHostileShotImpact } from '../../engine/hostile-shot';
import { ACTIVE_CELLS, BEAT, BPM, CORE_STAGES, CORE_START, DURATION, FACES, FACE_STARTS, TIME, tilePosition } from './timing';

export type Kind = 'square' | 'spindle' | 'core' | 'tetra' | 'octa' | 'prism' | 'bolt';
type BossData = { role: 'square' | 'spindle'; face: number; cell: number; bank: number } | { role: 'core' };
type WaveData = { role: 'wave'; x: number; y: number; color: number; phase: number; shoots: boolean; life: number };
type BoltData = { role: 'bolt'; position: Vector3; velocity: Vector3; color: number; lastAge: number; impactAt?: number; impactDirection?: Vector3; interceptUntil?: number };
export type SpawnData = BossData | WaveData | BoltData;
type Entry = LockOnSpawnEntry<Kind, SpawnData>;
type Update = LockOnEnemyUpdate<Kind, SpawnData>;
export type Turn = { face: number; step: number; start: number; end: number };
export type Fight = {
  running: boolean; time: number; beat: number; beatAt: number; face: number; faceReadyAt: number; cleared: number;
  turns: number[]; fallenAt: number[]; deadCells: Set<string>; pending: number[]; turn: Turn | null;
  burstAt: number; coreKilled: boolean; coreOpen: boolean; coreHits: number; coreStage: number; view: Quaternion;
  transitionFrom: Quaternion; transitionAt: number; hitsTaken: number; interceptions: number;
};

export function createRail() {
  const points = Array.from({ length: 33 }, (_, i) => {
    const a = i / 32 * Math.PI * 2.1;
    return new Vector3(Math.sin(a) * 35, 5 + Math.sin(a * 0.8) * 10, Math.cos(a) * 35);
  });
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

function buildTimeline(): Entry[] {
  const entries: Entry[] = [];
  for (let face = 0; face < 6; face++) {
    ACTIVE_CELLS.forEach((cell, i) => entries.push({
      time: FACE_STARTS[face], kind: 'square', lockable: false,
      data: { role: 'square', face, cell, bank: i < 3 ? 0 : 1 },
    }));
    entries.push({ time: FACE_STARTS[face], kind: 'spindle', hitPoints: 2, lockable: false, data: { role: 'spindle', face, cell: 4, bank: 0 } });
    // Corner fans answer the first turn; diagonal crossings answer the second bank.
    const t = face * 4;
    [[-11, 6.5], [10.5, -6], [-10, -6.5], [11, 6]].forEach(([x, y], i) => entries.push({
      time: TIME.bar(t, 3 + i * 0.5), kind: (['tetra', 'octa', 'prism', 'tetra'] as const)[(i + face) % 4],
      data: { role: 'wave', x, y, color: (i + face) % 6, phase: i * 1.7 + face, shoots: i === 1 || i === 2, life: TIME.beats(8) },
    }));
    [[-8.5, 8], [8.5, -8], [12, 2], [-12, -1]].forEach(([x, y], i) => entries.push({
      time: TIME.bar(t + 2, i * 0.5), kind: (['prism', 'tetra', 'octa', 'prism'] as const)[i],
      data: { role: 'wave', x, y, color: (face + i + 2) % 6, phase: i * 2.3, shoots: i === 2, life: TIME.beats(7) },
    }));
  }
  for (const bar of [24, 26, 28]) {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + (bar === 26 ? Math.PI / 6 : 0);
      entries.push({ time: TIME.bar(bar, i * 0.25), kind: (['tetra', 'octa', 'prism'] as const)[i % 3], data: {
        role: 'wave', x: Math.cos(a) * 11.5, y: Math.sin(a) * 7.8, color: i, phase: a,
        shoots: bar < 28 && i % 3 === 0, life: TIME.beats(6),
      } });
    }
  }
  entries.push({ time: CORE_START, kind: 'core', lockable: false, hitStages: [3, 3, 6], data: { role: 'core' } });
  return entries.sort((a, b) => a.time - b.time);
}
export const SPEEDSOLVE_TIMELINE = buildTimeline();

export function createSpeedsolveGameplay(bus: EventBus) {
  const fight: Fight = {
    running: false, time: 0, beat: -1, beatAt: 0, face: 0, faceReadyAt: FACE_STARTS[0], cleared: 0,
    turns: Array(6).fill(0), fallenAt: Array(6).fill(Infinity), deadCells: new Set(), pending: [], turn: null,
    burstAt: Infinity, coreKilled: false, coreOpen: false, coreHits: 0, coreStage: 0, view: new Quaternion(),
    transitionFrom: new Quaternion(), transitionAt: -10, hitsTaken: 0, interceptions: 0,
  };
  const timeline = buildTimeline(), targets = new Map<number, SpawnData>(), inFlight = new Set<number>();
  let coreEntry = timeline.find(e => e.kind === 'core')!;
  let coreStageReady = CORE_START, awaitingBurst = false;
  let lastAudioBeat = -Infinity, reconstructing = false;
  const off = [
    bus.on('runstart', () => {
      Object.assign(fight, { running: true, time: 0, beat: -1, beatAt: 0, face: 0, faceReadyAt: FACE_STARTS[0], cleared: 0,
        turn: null, burstAt: Infinity, coreKilled: false, coreOpen: false, coreHits: 0, coreStage: 0, transitionAt: -10, hitsTaken: 0, interceptions: 0 });
      fight.turns.fill(0); fight.fallenAt.fill(Infinity); fight.pending.length = 0; fight.deadCells.clear();
      fight.view.copy(FACES[0].quaternion); fight.transitionFrom.copy(fight.view);
      targets.clear(); inFlight.clear(); awaitingBurst = false; coreStageReady = CORE_START;
      lastAudioBeat = -Infinity;
      for (const entry of timeline) if (entry.data.role !== 'wave') entry.lockable = false;
      bus.emit('bossphase', { phase: 'summoned' });
    }),
    bus.on('runend', () => { fight.running = false; }),
    bus.on('playerhit', () => { fight.hitsTaken++; }),
    bus.on('fire', ({ enemyId }) => { inFlight.add(enemyId); }),
    bus.on('hit', ({ enemyId }) => { if (targets.get(enemyId)?.role === 'core') fight.coreHits++; }),
    bus.on('stage', ({ enemyId, stageIndex }) => {
      if (targets.get(enemyId)?.role !== 'core') return;
      fight.coreStage = stageIndex;
      coreEntry.lockable = false;
      coreStageReady = Math.max(CORE_STAGES[stageIndex], fight.time + BEAT);
    }),
    bus.on('kill', ({ enemyId }) => {
      const data = targets.get(enemyId);
      inFlight.delete(enemyId);
      if (!fight.running || !data) return;
      if (data.role === 'square') {
        fight.deadCells.add(`${data.face}:${data.cell}`); fight.pending.push(data.face);
      } else if (data.role === 'spindle') {
        fight.cleared++;
        fight.transitionFrom.copy(fight.view); fight.transitionAt = fight.time;
        fight.face = Math.min(5, data.face + 1);
        fight.faceReadyAt = Math.max(FACE_STARTS[fight.face], fight.time + BEAT * 2.5);
        if (fight.cleared === 6) bus.emit('bossphase', { phase: 'exposed' });
      } else if (data.role === 'core') { fight.coreKilled = true; fight.coreOpen = false; awaitingBurst = true; }
      else if (data.role === 'bolt') fight.interceptions++;
      targets.delete(enemyId);
    }),
    bus.on('miss', ({ enemyId }) => { targets.delete(enemyId); inFlight.delete(enemyId); }),
    bus.on('beat', ({ beatNumber }) => {
      if (!fight.running) return;
      // Ignore an attract-mode beat already scheduled when START reset the score.
      if (beatNumber > Math.max(0, Math.round((fight.time - 0.06) / BEAT))) return;
      if (!reconstructing) lastAudioBeat = fight.time;
      if (beatNumber <= fight.beat) return;
      fight.beat = beatNumber; fight.beatAt = fight.time;
      if (fight.turn) {
        const face = fight.turn.face;
        fight.turns[face]++; fight.turn = null;
        if (fight.turns[face] === 6) fight.fallenAt[face] = fight.time + BEAT;
      }
      const face = fight.pending.shift();
      if (face !== undefined) fight.turn = { face, step: fight.turns[face], start: fight.time, end: fight.time + BEAT };
      if (awaitingBurst) { awaitingBurst = false; fight.burstAt = fight.time; bus.emit('bossphase', { phase: 'destroyed' }); }
    }),
  ];

  function paintCamera(camera: PerspectiveCamera, time: number, dt: number, attract: boolean) {
    if (!attract) {
      const p = MathUtils.clamp((time - fight.transitionAt) / (BEAT * 2.5), 0, 1);
      fight.view.slerpQuaternions(fight.transitionFrom, FACES[fight.face].quaternion, p * p * (3 - 2 * p));
    }
    const orbit = (time - fight.faceReadyAt) * 0.16;
    const corePull = fight.cleared === 6 ? MathUtils.smoothstep(time - fight.transitionAt, 0, BEAT * 4) : 0;
    const radius = MathUtils.lerp(31, 15.5 + Math.sin(time * 0.5) * 0.7, corePull);
    const local = new Vector3((13.5 + Math.sin(orbit) * 2.2) * (1 - corePull * 0.55), (8.7 + Math.cos(orbit * 0.8)) * (1 - corePull * 0.5), radius);
    if (attract) local.set(18 + Math.sin(time * 0.12) * 3, 12, 33);
    camera.position.copy(local.applyQuaternion(attract ? FACES[0].quaternion : fight.view));
    camera.up.set(0, 1, 0).applyQuaternion(attract ? FACES[0].quaternion : fight.view);
    camera.lookAt(0, 0, 0);
    const impact = Math.max(0, 1 - (time - fight.beatAt) / 0.14);
    const targetFov = 53 + (fight.cleared === 6 ? 3 : 0) + (fight.turn ? impact * 0.65 : 0);
    camera.fov = MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-dt * 12));
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function fireBolt(context: Update, color: number) {
    const from = context.enemy.mesh.position.clone();
    const velocity = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(7);
    context.spawnEnemy({ time: context.runTime, kind: 'bolt', countsTowardTotal: false,
      data: { role: 'bolt', position: from, velocity, color, lastAge: 0 } });
  }
  function updateEnemy(context: Update) {
    const { enemy, age, runTime, camera } = context, data = enemy.entry.data;
    targets.set(enemy.id, data);
    if (data.role === 'square' || data.role === 'spindle') {
      const ready = fight.face === data.face && runTime >= fight.faceReadyAt && fight.cleared <= data.face;
      const fallen = runTime >= fight.fallenAt[data.face];
      const active = ready && (data.role === 'square' ? !fallen && runTime >= fight.faceReadyAt + data.bank * BEAT * 5 : fallen && runTime >= fight.fallenAt[data.face] + BEAT * 1.7);
      enemy.entry.lockable = active; enemy.mesh.visible = active;
      enemy.mesh.position.copy(tilePosition(data.face, data.cell, data.role === 'square' ? 8.78 : 5.9));
      enemy.mesh.quaternion.copy(FACES[data.face].quaternion);
      enemy.mesh.userData.colorIndex = data.face; enemy.mesh.userData.hp = enemy.hitPointsRemaining;
      if (data.role === 'spindle') enemy.mesh.rotateZ(runTime * 1.8);
      // Dormant sockets have no target in the arena until their mechanism opens.
      if (!active) enemy.mesh.position.set(0, 0, 4).applyQuaternion(camera.quaternion).add(camera.position);
      return false;
    }
    if (data.role === 'core') {
      coreEntry = enemy.entry;
      const ready = fight.cleared === 6 && runTime >= coreStageReady;
      fight.coreOpen = ready;
      enemy.entry.lockable = ready; enemy.mesh.visible = ready;
      enemy.mesh.position.set(0, 0, 0); enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(runTime * (0.7 + fight.coreHits * 0.08));
      enemy.mesh.userData.colorIndex = 5; enemy.mesh.userData.hp = enemy.hitPointsRemaining;
      if (!ready) enemy.mesh.position.set(0, 0, 4).applyQuaternion(camera.quaternion).add(camera.position);
      return false;
    }
    if (data.role === 'bolt') {
      const dt = Math.max(0, age - data.lastAge); data.lastAge = age;
      enemy.mesh.userData.colorIndex = data.color;
      const impact = updateHostileShotImpact({ age, camera, position: data.position, velocity: data.velocity, state: data,
        intercepted: inFlight.delete(enemy.id), config: { impactBrake: 0.48, hitDistance: 3.3, damageDistance: 0.7 } });
      if (impact.phase === 'braking') { if (impact.damaged) { context.damagePlayer(); return true; } }
      else steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt,
        { baseSpeed: 8, maxSpeed: 18, accel: 2.7, turnRate: 2.8 });
      enemy.mesh.position.copy(data.position); enemy.mesh.quaternion.copy(camera.quaternion); enemy.mesh.rotateZ(age * 5);
      return shotBehindCamera(camera, data.position) || age > 7 || fight.coreKilled;
    }
    if (data.role !== 'wave') return false;
    let x = data.x, y = data.y;
    if (enemy.kind === 'tetra') { x += Math.sin(age * 1.4 + data.phase) * 1.5; y += Math.cos(age * 2.1 + data.phase) * 0.9; }
    else if (enemy.kind === 'octa') { x += Math.cos(age * 2.3 + data.phase) * 2; y += Math.sin(age * 2.3 + data.phase) * 1.5; }
    else { x += Math.sin(age * 0.95 + data.phase) * 3.2; y += Math.sin(age * 3 + data.phase) * 0.35; }
    // Tangent-plane orbits keep the defensive sweep around, and in front of, the cube.
    const depth = 24 - Math.min(age, data.life) * 1.1;
    enemy.mesh.position.set(x, y, -depth).applyQuaternion(camera.quaternion).add(camera.position);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.phase + age * (enemy.kind === 'octa' ? -1.8 : 0.65));
    enemy.mesh.rotateY(age * (enemy.kind === 'tetra' ? 1.8 : 0.5));
    enemy.mesh.userData.colorIndex = data.color;
    const fire = context.enemyState(() => ({ shot: false }));
    enemy.mesh.userData.charging = data.shoots && !fire.shot && age > BEAT * 1.25;
    if (data.shoots && !fire.shot && age >= BEAT * 3) { fire.shot = true; fireBolt(context, data.color); }
    return age > data.life || fight.coreKilled;
  }
  const level: LockOnRunnerLevel<Kind, SpawnData> = {
    bpm: BPM, duration: DURATION, playerHealth: 5, createRail, spawnTimeline: timeline, updateEnemy,
    lockRadiusNdc: 0.115, allowLockUndo: true,
    timing: { shotDelay: { pattern: 'linear', gapThirtyseconds: 2, releaseShare: 0.65, maxGridSeconds: BEAT, gridRampGapGrowthThirtyseconds: 0 }, actionSfx: { enabled: true, gridThirtyseconds: 1 } },
    updateAttractCamera({ camera, modeTime, dt }) { paintCamera(camera, modeTime, dt, true); },
    updateCameraEffects({ camera, runTime, dt }) {
      fight.time = runTime;
      // Silent inspection and an unavailable audio device still use the same tempo.
      // Live transport events take over as soon as the audio clock starts.
      if (runTime - lastAudioBeat > BEAT * 2.5) {
        const beat = Math.floor((runTime - 0.06) / BEAT);
        if (beat > fight.beat) {
          reconstructing = true;
          bus.emit('beat', { beatNumber: beat, isDownbeat: beat % 4 === 0, audioTime: runTime });
          reconstructing = false;
        }
      }
      paintCamera(camera, runTime, dt, false);
    },
    scoreForKill(size, enemy) {
      const points: Record<Kind, number> = { square: 220, spindle: 750, core: 4000, tetra: 110, octa: 130, prism: 150, bolt: 80 };
      return Math.round(points[enemy.kind] * (1 + (size - 1) * 0.16));
    },
    scoreForHit: (_size, enemy) => enemy.kind === 'core' ? 140 : 70,
    scoreForVolley: results => results.length === 6 && results.every(r => r.killed) ? 600 : 0,
    rankForRun(score, kills, total) {
      if (!fight.coreKilled) return fight.cleared >= 4 ? 'C' : 'D';
      if (score > 28000 && kills / total > 0.88 && fight.hitsTaken === 0) return 'S';
      return fight.hitsTaken < 3 ? 'A' : 'B';
    },
    detailsForRun: () => [fight.coreKilled ? 'SOLVED · CORE SHATTERED' : `TIME LIMIT · ${fight.cleared}/6 FACES`,
      `${fight.turns.reduce((a, b) => a + b, 0)} beat-perfect turns`, `${fight.interceptions} shots intercepted`, `Hull ${Math.max(0, 5 - fight.hitsTaken)}/5`],
  };
  return Object.assign(level, { fight, dispose: () => off.forEach(fn => fn()) });
}
