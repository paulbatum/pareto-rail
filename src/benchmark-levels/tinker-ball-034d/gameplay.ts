import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import type { EventBus } from '../../events';
export const BPM = 128;
export const TIME = createMusicTime(BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(32); // 60 seconds; eight four-bar phrases.
export type Kind = 'button-beetle' | 'pencil-skater' | 'cardboard-bird' | 'spill-core';
type Data = {
  x: number;
  y: number;
  seed: number;
  size: number;
  window: number;
};
export const zoomAt = (t: number) => 1 + Math.min(1, t / 55) * 1.05;
export function createRail() {
  return new CatmullRomCurve3([
    [0, 0, 82], [-16, 0, 54], [18, 0, 27], [38, 0, -6],
    [18, 0, -40], [-23, 0, -48], [-42, 0, -16], [-24, 0, 12],
    [4, 0, 1], [12, 0, -30], [8, 0, -72],
  ].map(p => new Vector3(...p as [
    number,
    number,
    number
  ])), false, 'catmullrom', 0.4);
}
function timeline() {
  const out: LockOnSpawnEntry<Kind, Data>[] = [];
  const wave = (bar: number, kind: Kind, slots: [
    number,
    number
  ][], size = 1) => {
    slots.forEach(([x, y], i) => out.push({ time: TIME.bar(bar) + TIME.stepSeconds * (i % 3), kind,
      data: { x, y, seed: i + bar * 1.3, size, window: 4.8 } }));
  };
  wave(0.5, 'button-beetle', [[-8, -3], [5, 1], [10, -2]]);
  wave(2, 'button-beetle', [[-11, 2], [-4, -3], [4, 4], [11, -1]]);
  wave(4, 'pencil-skater', [[-10, -2], [9, 2], [-3, 4]]);
  wave(5.5, 'button-beetle', [[-9, 3], [0, -3], [10, 3]]);
  wave(7, 'cardboard-bird', [[-10, 3], [5, 5], [11, -2]]);
  wave(8.5, 'button-beetle', [[-11, -2], [-5, 4], [3, -3], [10, 2]], 1.2);
  wave(10, 'pencil-skater', [[-10, 3], [-3, -3], [9, 1]], 1.15);
  wave(12, 'cardboard-bird', [[-11, 4], [0, 1], [10, 4]], 1.2);
  wave(13, 'button-beetle', [[-9, -3], [5, -3]], 1.3);
  wave(14.5, 'pencil-skater', [[-10, 3], [0, -2], [10, 2]], 1.25);
  wave(16, 'cardboard-bird', [[-11, 4], [0, 5], [10, 1]], 1.25);
  wave(17, 'button-beetle', [[-10, -3], [8, -3]], 1.4);
  wave(18.5, 'pencil-skater', [[-10, 1], [-3, 4], [9, -2]], 1.35);
  wave(20, 'cardboard-bird', [[-10, 4], [4, 4], [11, -1]], 1.3);
  wave(21, 'button-beetle', [[-9, -3], [6, -2]], 1.5);
  // The spill keeps rebuilding: three successive shells, then the bare heart.
  out.push({ time: TIME.bar(23), kind: 'spill-core', hitStages: [3, 4, 5],
    data: { x: 0, y: 1, seed: 0, size: 2.4, window: 14 } });
  wave(24, 'cardboard-bird', [[-11, 4], [11, 4]], 1.25);
  wave(26, 'pencil-skater', [[-11, -2], [10, -2]], 1.2);
  wave(28, 'button-beetle', [[-9, 3], [9, 2]], 1.3);
  return out.sort((a, b) => a.time - b.time);
}
export function createGameplay(bus: EventBus): LockOnRunnerLevel<Kind, Data> {
  let rescued = 0, boss = -1, cleared = false;
  bus.on('runstart', () => { rescued = 0; boss = -1; cleared = false; });
  bus.on('spawn', e => { if (e.kind === 'spill-core')
    boss = e.enemyId; });
  bus.on('kill', e => { if (!e.letter)
    rescued++; if (e.enemyId === boss)
    cleared = true; });
  return {
    duration: DURATION, bpm: BPM, createRail, spawnTimeline: timeline(),
    startWord: 'START',
    easeRunProgress: t => Math.min(1, t / DURATION), lockRadiusNdc: 0.16,
    updateCameraEffects({ camera, curve, runTime }) {
      const u = Math.min(1, runTime / DURATION), s = zoomAt(runTime);
      const p = curve.getPointAt(u), f = curve.getPointAt(Math.min(1, (runTime + 2.4 * s) / DURATION)).sub(p).normalize();
      camera.position.copy(p).add(new Vector3(0, 10 * s, 0));
      camera.lookAt(p.clone().addScaledVector(f, 27 * s).add(new Vector3(0, 5.8 * s, 0)));
      camera.fov = 58;
      camera.updateProjectionMatrix();
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      const p = curve.getPointAt(0), f = curve.getTangentAt(0);
      camera.position.copy(p).add(new Vector3(Math.sin(modeTime * .2) * .25, 10, 0));
      camera.lookAt(p.clone().addScaledVector(f, 27).add(new Vector3(0, 5.8, 0)));
    },
    updateEnemy({ enemy, camera, age, runTime }) {
      const d = enemy.entry.data, bossKind = enemy.kind === 'spill-core', s = zoomAt(runTime);
      let x = d.x, y = d.y;
      if (enemy.kind === 'button-beetle') {
        x += Math.sin(age * 3 + d.seed) * .65;
        y += Math.abs(Math.sin(age * 4 + d.seed)) * .6;
      }
      if (enemy.kind === 'pencil-skater') {
        x += Math.sin(age * 1.65 + d.seed) * 2.8;
        y += Math.sin(age * 3 + d.seed) * .45;
      }
      if (enemy.kind === 'cardboard-bird') {
        x += Math.sin(age * 1.2 + d.seed) * 1.5;
        y += Math.sin(age * 2.4 + d.seed) * 1.6;
      }
      if (bossKind) {
        x = Math.sin(age * .8) * 3.7;
        y = 3 + Math.sin(age * 1.1) * 1.0;
      }
      const depth = bossKind ? 30 : 27 - Math.max(0, age - 3) * 5;
      enemy.mesh.position.set(x * s, y * s, -depth * s).applyQuaternion(camera.quaternion).add(camera.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(bossKind ? Math.sin(age) * .08 : Math.sin(age * 2 + d.seed) * .13);
      enemy.mesh.scale.setScalar(s * d.size * (Math.min(1, age * 6) * .18 + .82));
      enemy.mesh.userData.age = age;
      enemy.mesh.userData.stage = enemy.hitStageIndex;
      return age > d.window;
    },
    scoreForKill: (n, e) => Math.round((e.kind === 'spill-core' ? 2000 : 120) * (1 + (n - 1) * .25)),
    scoreForHit: (_n, e) => e.kind === 'spill-core' ? 100 : 20,
    scoreForVolley: r => r.length === 6 ? 600 : 0,
    rankForRun: (_s, k, total) => k / total > .9 ? 'S' : k / total > .7 ? 'A' : k / total > .45 ? 'B' : 'C',
    detailsForRun: () => [`${rescued} glue creatures dismantled`, cleared ? 'The spill is clean. Everything sticks!' : 'The spill still has a sticky heart.'],
  };
}
