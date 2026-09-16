import { CatmullRomCurve3, Vector3, MathUtils } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import type { EventBus } from '../../events';

export const STRANDLINE_U4WM_BPM = 96;
export const TIME = createMusicTime(STRANDLINE_U4WM_BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(24);
export const CROWN = new Vector3(0, 38, -150);
export type Kind = 'clasp' | 'ribbon' | 'urchin' | 'brood' | 'parent';
export type Data = { x: number; y: number; phase: number; group?: number };
export type Entry = LockOnSpawnEntry<Kind, Data>;
export type Life = { time: number; clean: number; freed: boolean; freedAt: number; broodKills: number[]; exposed: boolean };
export const newLife = (): Life => ({ time: 0, clean: 0, freed: false, freedAt: 54, broodKills: [0, 0, 0], exposed: false });

export function createStrandlineU4wmRail() {
  return new CatmullRomCurve3([
    [0,-82,-91], [14,-65,-115], [-13,-42,-123], [18,-20,-119],
    [65,-2,-106], [74,12,-133], [36,8,-120], [-15,1,-111],
    [-25,18,-99], [0,25,-89], [0,27,-85],
  ].map(p => new Vector3(...p)), false, 'catmullrom', 0.35);
}

const timeline: Entry[] = [];
function wave(bar: number, kind: Kind, points: number[][], phase = 0) {
  points.forEach(([x, y], i) => timeline.push({ time: TIME.bar(bar, i % 3 * 0.25), kind,
    hitPoints: kind === 'urchin' ? 2 : 1, data: { x, y, phase: phase + i * 1.7 } }));
}
wave(0.6, 'clasp', [[-9,4],[-3,6],[4,5],[10,2]]);
wave(2, 'ribbon', [[-11,-4],[-4,-2],[5,2],[10,5]]);
wave(3.6, 'clasp', [[-11,5],[-7,0],[-2,-5],[3,-5],[8,0],[11,5]]);
wave(5.2, 'urchin', [[-9,-4],[0,5],[9,-3]]);
wave(6.5, 'ribbon', [[-10,4],[-4,-4],[4,4],[10,-4]]);
// Leave the wide curve a little quieter so the bell can be read.
wave(8.1, 'clasp', [[-9,-4],[0,-6],[9,-4]]);
wave(9.5, 'ribbon', [[-11,5],[-6,0],[0,-5],[6,0],[11,5]]);
wave(11, 'urchin', [[-10,3],[0,-5],[10,3]]);
wave(12.2, 'clasp', [[-11,-4],[-7,4],[-2,-2],[3,5],[7,-5],[11,1]]);
wave(13.5, 'ribbon', [[-10,5],[-4,-4],[4,4],[10,-5]]);
for (let group = 0; group < 3; group++) {
  for (let i = 0; i < 3; i++) {
    const angle = (group * 3 + i) / 9 * Math.PI * 2;
    timeline.push({ time: TIME.bar(15 + group * 1.2, i * 0.2), kind: 'brood',
      data: { x: Math.cos(angle) * 10.5, y: Math.sin(angle) * 6, phase: angle, group } });
  }
}
timeline.sort((a,b) => a.time-b.time);

export function createGameplay(bus: EventBus, life: Life = newLife()): LockOnRunnerLevel<Kind, Data> {
  const broods = new Map<number, number>();
  let parent = -1;
  let summoned = false;
  let summon: ((entry: Entry) => number) | undefined;
  bus.on('runstart', () => { Object.assign(life, newLife()); broods.clear(); parent = -1; summoned = false; });
  bus.on('spawn', e => {
    if (e.kind === 'parent') parent = e.enemyId;
    if (e.kind === 'brood' && !summoned) { summoned = true; bus.emit('bossphase', { phase: 'summoned' }); }
  });
  bus.on('kill', e => {
    if (e.letter) return;
    life.clean = Math.min(1, life.clean + 0.018);
    const group = broods.get(e.enemyId);
    if (group !== undefined) {
      life.broodKills[group]++; broods.delete(e.enemyId);
      if (!life.exposed && life.broodKills.every(n => n === 3) && summon) {
        life.exposed = true;
        summon({time:life.time,kind:'parent',hitStages:[3,3],data:{x:0,y:0,phase:0}});
        bus.emit('bossphase',{phase:'exposed'});
      }
    }
    if (e.enemyId === parent) {
      life.freed = true; life.freedAt = life.time; life.clean = 1;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });
  return {
    duration: DURATION, bpm: STRANDLINE_U4WM_BPM,
    createRail: createStrandlineU4wmRail, spawnTimeline: timeline.map(e => ({ ...e, data: { ...e.data } })), 
    easeRunProgress: t => Math.min(1, t / 38),
    lockRadiusNdc: 0.095,
    scoreForKill: (n,e) => (e.kind === 'parent' ? 2400 : e.kind === 'brood' ? 240 : 100) * (1 + (n-1)*0.22),
    scoreForHit: n => 30*n,
    scoreForVolley: results => results.length === 6 && results.every(r => r.killed) ? 600 : 0,
    rankForRun: (_s,k,total) => k / total > 0.94 ? 'S' : k / total > 0.75 ? 'A' : k / total > 0.5 ? 'B' : 'C',
    detailsForRun: () => [life.freed ? 'THE JELLYFISH IS FREE' : 'THE COLONY STILL CLINGS', `${life.broodKills.reduce((a,b)=>a+b,0)} / 9 brood anchors removed`],
    updateAttractCamera({ camera, modeTime }) {
      camera.position.set(4 + Math.sin(modeTime*.13)*2, -56, -77);
      camera.lookAt(0, -25, -155);
    },
    updateCameraEffects({ camera, runTime }) {
      life.time = runTime;
      if (runTime >= 37.5) {
        const retreat = life.freed ? MathUtils.smoothstep(runTime, life.freedAt + .4, 60) : MathUtils.smoothstep(runTime, 54, 60);
        camera.position.set(retreat * 68, 26 + retreat * 14, -85 + retreat * 360);
        camera.lookAt(new Vector3(0, 35, -150).lerp(new Vector3(0,-34,-150), retreat));
      } else {
        if (runTime > 12 && runTime < 24) {
          const blend = MathUtils.smoothstep(runTime,12,15) * (1-MathUtils.smoothstep(runTime,21,24));
          const ahead = new Vector3(0,0,-60).applyQuaternion(camera.quaternion).add(camera.position);
          camera.lookAt(ahead.lerp(new Vector3(0,42,-150),blend));
        }
        camera.rotateZ(Math.sin(runTime*.35)*.08);
      }
    },
    updateEnemy({ enemy, age, camera, runTime, spawnEnemy }) {
      const d = enemy.entry.data;
      enemy.mesh.rotation.set(0, 0, 0);
      summon = spawnEnemy;
      let x = d.x, y = d.y;
      let depth = 31 - Math.min(age,5)*2.2;
      if (enemy.kind === 'parent') {
        depth = 34;
        const exposed = life.broodKills.every(n=>n===3);
        enemy.entry.lockable = exposed;
        enemy.mesh.userData.web = life.broodKills.map(n=>1-n/3);
        enemy.mesh.userData.exposed = exposed;
        if (exposed && !life.exposed) { life.exposed = true; bus.emit('bossphase',{phase:'exposed'}); }
        enemy.mesh.rotation.set(0,0,Math.sin(age*.4)*.07);
      } else if (enemy.kind === 'brood') {
        broods.set(enemy.id, d.group ?? 0);
        depth = 28; x += Math.sin(age*1.1+d.phase)*.6; y += Math.cos(age*1.3+d.phase)*.5;
        enemy.mesh.rotation.z = age*.8+d.phase;
      } else if (enemy.kind === 'clasp') {
        const detach = MathUtils.smoothstep(age, .8, 2.5);
        x += Math.sin(age*2 + d.phase)*detach*1.0;
        y += Math.sin(age*1.5+d.phase)*detach*.8;
        enemy.mesh.rotation.z = Math.sin(age*1.4+d.phase)*.2;
        enemy.mesh.userData.detach = detach;
      } else if (enemy.kind === 'ribbon') {
        x += Math.sin(age*1.35+d.phase)*3.1;
        y += Math.sin(age*2.7+d.phase)*1.2;
        enemy.mesh.rotation.z = Math.cos(age*1.35+d.phase)*.65;
      } else {
        x += Math.cos(age*.85+d.phase)*1.6;
        y += Math.sin(age*.85+d.phase)*1.6;
        enemy.mesh.rotation.z = age*.55;
      }
      const screenScale = depth/30;
      enemy.mesh.position.set(x*screenScale, y*screenScale, -depth).applyQuaternion(camera.quaternion).add(camera.position);
      enemy.mesh.quaternion.premultiply(camera.quaternion);
      if (enemy.kind === 'brood' || enemy.kind === 'parent') return runTime > 54 && !life.freed;
      return age > 5.6;
    },
  };
}
