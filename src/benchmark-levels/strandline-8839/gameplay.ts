import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { EventBus } from '../../events';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';

export const BPM = 96;
export const TIME = createMusicTime(BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(24);
export type Kind = 'clasp' | 'ribbon' | 'urchin' | 'brood' | 'parent';
export type SpawnData = { x: number; y: number; phase: number; colony?: number };
export type Life = ReturnType<typeof createLife>;
export function createLife() {
  return { time: 0, running: false, freed: false, freedAt: 0, kills: 0, broods: [0, 0, 0], parentId: -1, exposed: false };
}
export const CROWN = new Vector3(0, 54, -160);
const PATH = [
  [0, -66, -88], [15, -54, -112], [-14, -37, -140], [9, -20, -154],
  [51, -5, -109], [76, 22, -84], [36, 12, -119], [-12, 10, -144],
  [-16, 31, -132], [0, 48, -124],
].map(p => new Vector3(...p as [number, number, number]));
export function createRail() { return new CatmullRomCurve3(PATH, false, 'catmullrom', 0.45); }
const flight = createRail();
const smooth = (v: number) => { const t = MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
export function poseCamera(camera: PerspectiveCamera, time: number, life: Life) {
  const t = Math.min(time, 40) / 40;
  camera.position.copy(flight.getPoint(t));
  const aim = flight.getPoint(Math.min(1, t + 0.035));
  if (time > 16 && time < 29) aim.lerp(new Vector3(0, 65, -160), Math.sin((time - 16) / 13 * Math.PI) * 0.94);
  if (time > 35) aim.lerp(CROWN.clone().add(new Vector3(0, -12, 0)), smooth((time - 35) / 5));
  if (time >= 40) { camera.position.set(Math.sin((time - 40) * 0.16) * 1.5, 48, -124); aim.copy(CROWN).y -= 12; }
  if (life.freed) {
    const pull = smooth((time - life.freedAt) / Math.max(2, 59.5 - life.freedAt));
    camera.position.lerp(new Vector3(120, 38, 190), pull);
    aim.lerp(new Vector3(0, -3, -160), pull);
  }
  camera.up.set(0, 1, 0);
  camera.lookAt(aim);
  if (time < 39) camera.rotateZ(Math.sin(time * 0.38) * 0.12 * Math.sin(Math.PI * Math.min(time / 40, 1)));
  camera.fov = 60 + Math.sin(Math.PI * Math.min(time / 40, 1)) * 3;
  camera.far = 1600;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export function createGameplay(bus: EventBus, life: Life = createLife()): LockOnRunnerLevel<Kind, SpawnData> & { dispose(): void } {
  const timeline: LockOnSpawnEntry<Kind, SpawnData>[] = [];
  const wave = (bar: number, kind: Kind, points: number[][], stagger = 0) => points.forEach(([x, y], i) => {
    timeline.push({ time: TIME.bar(bar) + TIME.step(0, stagger * i), kind, data: { x, y, phase: i * 1.9 + bar }, hitPoints: kind === 'urchin' ? 2 : 1 });
  });
  wave(0.5, 'clasp', [[-12, 5], [0, -6], [12, 4]], 1);
  wave(2, 'clasp', [[-14, -6], [-5, 7], [6, -5], [14, 6]], 1);
  wave(3.5, 'ribbon', [[-14, 6], [-5, -7], [7, 7], [14, -4]], 2);
  wave(5, 'urchin', [[-11, -6], [11, 6]]);
  wave(6, 'ribbon', [[-15, -5], [-8, 6], [3, -7], [12, 5]], 1);
  wave(7.5, 'clasp', [[-13, 7], [0, -6], [13, 6]], 2);
  wave(9.5, 'ribbon', [[-13, -6], [0, 7], [13, -5]], 1);
  wave(11, 'clasp', [[-15, -6], [-9, 6], [-3, -5], [4, 7], [10, -6], [15, 5]]);
  wave(12.5, 'urchin', [[-13, 6], [0, -7], [13, 5]], 1);
  wave(14, 'ribbon', [[-14, 5], [-5, -7], [6, 7], [14, -4]], 1);
  wave(15, 'clasp', [[-13, -5], [0, 7], [13, -5]], 1);
  for (let colony = 0; colony < 3; colony++) {
    for (let i = 0; i < 3; i++) timeline.push({
      time: TIME.bar(16 + colony * 1.5), kind: 'brood',
      data: { x: [-10, 0, 10][i], y: i % 2 === colony % 2 ? 4 : -4, phase: colony * 2 + i, colony },
    });
  }
  timeline.sort((a, b) => a.time - b.time);
  let spawnParent: (() => void) | undefined;
  const ids = new Map<number, { kind: string; colony?: number }>();
  const subscriptions = [bus.on('runstart', () => { Object.assign(life, createLife(), { running: true }); ids.clear(); spawnParent = undefined; }),
  bus.on('runend', () => { life.running = false; }),
  bus.on('kill', e => {
    if (e.letter) return;
    life.kills++;
    const target = ids.get(e.enemyId);
    if (target?.kind === 'brood') {
      life.broods[target.colony ?? 0]++;
      if (life.broods.every(n => n >= 3) && !life.exposed) {
        life.exposed = true;
        spawnParent?.();
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
    if (target?.kind === 'parent') { life.freed = true; life.freedAt = life.time; bus.emit('bossphase', { phase: 'destroyed' }); }
    ids.delete(e.enemyId);
  }),
  bus.on('miss', e => ids.delete(e.enemyId))];
  return {
    dispose() { subscriptions.forEach(unsubscribe => unsubscribe()); },
    bpm: BPM, duration: DURATION, createRail, spawnTimeline: timeline,
    easeRunProgress: (t, duration) => t / duration,
    lockRadiusNdc: 0.15,
    timing: { shotDelay: { maxGridSeconds: 0.14 } },
    updateAttractCamera({ camera, modeTime }) { poseCamera(camera, 1.2 + Math.sin(modeTime * 0.13) * 0.5, createLife()); },
    updateCameraEffects({ camera, runTime }) { life.time = runTime; poseCamera(camera, runTime, life); },
    updateEnemy({ enemy, camera, age, runTime, spawnEnemy }) {
      spawnParent = () => spawnEnemy({ time: runTime, kind: 'parent', data: { x: 0, y: 0, phase: 0 }, hitStages: [3, 3] });
      const d = enemy.entry.data;
      ids.set(enemy.id, { kind: enemy.kind, colony: d.colony });
      if (enemy.kind === 'parent') {
        life.parentId = enemy.id;
        enemy.mesh.position.copy(CROWN);
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateZ(Math.sin(age * 0.7) * 0.12);
        enemy.mesh.userData.webs?.forEach((web: { visible: boolean }) => { web.visible = false; });
        const body = enemy.mesh.children[0];
        if (body) body.scale.setScalar(1 + Math.sin(age * 3) * 0.07 + (6 - enemy.hitPointsRemaining) * 0.035);
        return false;
      }
      let x = d.x * (enemy.kind === 'brood' ? 1 : 1.35), y = d.y * (enemy.kind === 'brood' ? 1 : 1.5);
      const detach = smooth((age - 0.45) / 0.65);
      if (enemy.kind === 'clasp') { x += Math.sin(age * 2 + d.phase) * detach * 1.6; y += detach * 1.3; }
      if (enemy.kind === 'ribbon') { x += Math.sin(age * 1.4 + d.phase) * detach * 3.8; y += Math.sin(age * 2.5 + d.phase) * detach * 1.8; }
      if (enemy.kind === 'urchin') { x += Math.cos(age * 1.5 + d.phase) * 2; y += Math.sin(age * 1.5 + d.phase) * 2.7; }
      if (enemy.kind === 'brood') { x += Math.sin(age * 2 + d.phase) * 2; y += Math.cos(age * 1.4 + d.phase) * 1.2; }
      const z = enemy.kind === 'brood' ? 27 + Math.sin(age) * 2 : 33 - Math.max(0, age - 0.65) * 4.7;
      enemy.mesh.position.set(x, y, -z).applyQuaternion(camera.quaternion).add(camera.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(enemy.kind === 'urchin' ? age * 1.5 : Math.sin(age * 2 + d.phase) * 0.25);
      enemy.mesh.children.forEach(child => { if (child.name === 'tether') child.visible = detach < 0.95; });
      if (enemy.kind === 'ribbon') enemy.mesh.children[0]?.rotation.set(0, Math.sin(age * 4) * 0.45, 0);
      return enemy.kind !== 'brood' && age > 5.5;
    },
    scoreForKill: (size, enemy) => (enemy.kind === 'parent' ? 2400 : enemy.kind === 'urchin' ? 240 : 150) * (1 + (size - 1) * 0.2),
    scoreForHit: () => 65,
    scoreForVolley: results => results.length === 6 && results.every(r => r.killed) ? 600 : 0,
    rankForRun: (_score, kills, total) => life.freed && kills / total > 0.9 ? 'S' : life.freed ? 'A' : kills / total > 0.65 ? 'B' : 'C',
    detailsForRun: () => [life.freed ? 'THE STRANDLINE IS FREE' : 'The crown is still infected', `${life.broods.filter(n => n >= 3).length}/3 brood webs severed`, `${life.kills} parasites released`],
  };
}
