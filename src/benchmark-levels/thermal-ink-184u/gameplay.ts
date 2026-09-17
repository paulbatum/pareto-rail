import { CatmullRomCurve3, Vector3, type PerspectiveCamera } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import type { EventBus } from '../../events';

export const THERMAL_INK_184U_BPM = 96;
export const TIME = createMusicTime(THERMAL_INK_184U_BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(24);
export const CENTER = new Vector3(0, 9, 0);
export type Kind = 'arm' | 'crab' | 'eel' | 'bell' | 'core';
type Data = { socket: number; x: number; y: number; life: number };
export type Fight = ReturnType<typeof createFight>;
export function createFight() {
  return { time: 0, running: false, infrared: false, ink: 0, dead: new Set<number>(), coreDead: false, collapse: 0, hit: 0, switches: 0 };
}
const fights = new WeakMap<EventBus, Fight>();
export function fightFor(bus: EventBus) {
  let fight = fights.get(bus);
  if (!fight) { fight = createFight(); fights.set(bus, fight); }
  return fight;
}
export function inkAt(t: number) {
  let density = 0;
  for (const [start, end] of [[7.5, 12.5], [20, 25], [32.5, 37.5], [43.75, 48.75], [52.5, 58]]) {
    density = Math.max(density, Math.min(1, (t - start) / 0.85, (end - t) / 1.1));
  }
  return Math.max(0, density);
}
export function createThermalInk184uRail() {
  const points: Vector3[] = [];
  for (let i = 0; i <= 32; i++) {
    const p = i / 32;
    const angle = p * Math.PI * 2.3;
    const radius = 40 + 5 * Math.sin(p * Math.PI * 6);
    points.push(new Vector3(Math.sin(angle) * radius, 10 + 6 * Math.sin(p * Math.PI * 4) - 4 * Math.sin(p * Math.PI * 8), Math.cos(angle) * radius));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}
export function bossYaw(camera: PerspectiveCamera) { return Math.atan2(camera.position.x, camera.position.z); }
export function socketLocal(socket: number, t: number) {
  const a = socket / 8 * Math.PI * 2 + Math.PI / 8;
  return new Vector3(Math.cos(a) * 14.3, Math.sin(a) * 8.8 - 2, 10 + Math.sin(t * 0.9 + socket) * 1.3);
}
export function bossPoint(local: Vector3, camera: PerspectiveCamera) {
  return local.applyAxisAngle(new Vector3(0, 1, 0), bossYaw(camera)).add(CENTER);
}
function timeline(): Array<LockOnSpawnEntry<Kind, Data>> {
  const entries: Array<LockOnSpawnEntry<Kind, Data>> = [];
  const add = (bar: number, kind: Kind, x: number, y: number, socket = -1, life = 6) => entries.push({
    time: TIME.bar(bar), kind, hitPoints: kind === 'arm' ? 3 : kind === 'core' ? 6 : 1,
    hitStages: kind === 'arm' ? [1, 1, 1] : kind === 'core' ? [2, 2, 2] : undefined,
    data: { socket, x, y, life },
  });
  // Opposite arms open together; the intervening machinery ejects syncopated spawn.
  for (let pair = 0; pair < 4; pair++) {
    add(pair * 5, 'arm', 0, 0, pair, 60);
    add(pair * 5 + 0.25, 'arm', 0, 0, pair + 4, 60);
    const b = pair * 5;
    for (const [offset, kind, points] of [
      [0.5, 'crab', [[-17, -5], [16, 4], [-8, 9]]],
      [1.75, 'eel', [[-17, 5], [17, -4], [7, -9]]],
      [3, 'bell', [[-13, 7], [13, -7], [14, 7]]],
      [4, 'crab', [[-17, -6], [-10, 5], [17, 1]]],
    ] as const) {
      points.forEach(([x, y], j) => add(b + offset + j * 0.125, kind, x, y));
    }
  }
  add(19.75, 'core', 0, 0, -1, 60);
  for (let i = 0; i < 6; i++) add(20 + i * 0.125, i % 2 ? 'eel' : 'bell', (i % 3 - 1) * 13, i < 3 ? 8 : -7);
  return entries.sort((a, b) => a.time - b.time);
}
export function createGameplay(bus: EventBus, fight: Fight = fightFor(bus)): LockOnRunnerLevel<Kind, Data> {
  const sockets = new Map<number, number>();
  let coreId = -1;
  bus.on('runstart', () => { fight.time = 0; fight.running = true; fight.dead.clear(); fight.coreDead = false; fight.collapse = 0; fight.switches = 0; sockets.clear(); });
  bus.on('runend', () => { fight.running = false; });
  bus.on('kill', ({ enemyId }) => {
    const socket = sockets.get(enemyId);
    if (socket !== undefined) fight.dead.add(socket);
    if (enemyId === coreId) { fight.coreDead = true; bus.emit('bossphase', { phase: 'destroyed' }); }
  });
  return {
    duration: DURATION, bpm: THERMAL_INK_184U_BPM, createRail: createThermalInk184uRail, spawnTimeline: timeline(),
    lockRadiusNdc: 0.15,
    updateAttractCamera({ camera }) { camera.position.set(0, 13, 44); camera.lookAt(CENTER); camera.updateMatrixWorld(); },
    updateCameraEffects({ camera, runTime }) {
      fight.time = runTime;
      fight.ink = fight.coreDead ? 0 : inkAt(runTime);
      camera.lookAt(CENTER.clone().add(new Vector3(Math.sin(runTime * 0.21) * 1.5, -1.5, 0)));
      camera.rotateZ(Math.sin(runTime * 0.39) * 0.035);
      camera.updateMatrixWorld();
    },
    updateEnemy({ enemy, age, camera, runTime }) {
      const d = enemy.entry.data;
      const m = enemy.mesh;
      const blind = fight.ink > 0.72 && !fight.infrared;
      m.visible = !blind;
      enemy.entry.lockable = !blind;
      if (enemy.kind === 'arm') {
        sockets.set(enemy.id, d.socket);
        m.position.copy(bossPoint(socketLocal(d.socket, runTime), camera));
      } else if (enemy.kind === 'core') {
        coreId = enemy.id;
        const open = fight.dead.size === 8 && runTime >= TIME.bar(21.25);
        enemy.entry.lockable = open && !blind;
        m.visible = open && !blind;
        m.position.copy(bossPoint(new Vector3(0, 1.5 + Math.sin(age * 2) * 0.5, 7), camera));
      } else {
        let x = d.x, y = d.y, z = -27 + Math.min(age, 4) * 1.2;
        if (enemy.kind === 'crab') { x += Math.sin(age * 2.4) * 2; y += Math.abs(Math.sin(age * 2.4)) * 1.7; }
        if (enemy.kind === 'eel') { x -= Math.sign(d.x) * age * 2.1; y += Math.sin(age * 2.2) * 2.3; }
        if (enemy.kind === 'bell') { x += Math.sin(age * 1.1 + d.x) * 2.2; y -= age * 0.6; z += Math.sin(age * 3.8) * 2; }
        m.position.set(x, y, z).applyQuaternion(camera.quaternion).add(camera.position);
        if (age > d.life) return true;
      }
      m.quaternion.copy(camera.quaternion);
      if (enemy.kind === 'eel') m.rotateZ(Math.sin(age * 2.2) * 0.35);
      if (enemy.kind === 'bell') m.rotateZ(Math.sin(age) * 0.15);
      m.userData.heat = fight.infrared;
      return false;
    },
    scoreForKill: (size, e) => Math.round((e.kind === 'core' ? 3000 : e.kind === 'arm' ? 600 : 120) * (1 + (size - 1) * 0.22)),
    scoreForHit: (size) => 35 + size * 10,
    scoreForVolley: (results) => results.length === 6 ? 400 : 0,
    rankForRun: (score, kills, total) => fight.coreDead && kills / total > 0.8 ? 'S' : fight.coreDead ? 'A' : score > 6500 ? 'B' : score > 2000 ? 'C' : 'D',
    detailsForRun: () => [`Arms severed  ${fight.dead.size} / 8`, fight.coreDead ? 'THERMAL SIGNATURE LOST — harbor secured' : 'CORE SURVIVED — return to the harbor', `Infrared switches  ${fight.switches}`],
  };
}
