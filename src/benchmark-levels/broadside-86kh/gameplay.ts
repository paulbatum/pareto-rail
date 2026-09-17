import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { offsetFromRail } from '../../engine/rail';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import type { EventBus } from '../../events';

export const BROADSIDE_86KH_BPM = 128;
export const TIME = createMusicTime(BROADSIDE_86KH_BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(32);
export const MARKERS = TIME.markers({ launch: 0, crossfire: 4, broadside: 7, belly: 12, eye: 16, shields: 19, escorts: 23, trench: 26, victory: 30 });
export const SECTIONS = Object.entries(MARKERS).map(([name, time]) => ({ name, time }));
export const progress = (t: number) => MathUtils.clamp(t / DURATION, 0, 1);
export function createBroadside86khRail() {
  return new CatmullRomCurve3([
    [0,0,0], [0,20,-200], [90,70,-420], [-80,20,-640],
    [-100,0,-950], [-75,-10,-1250], [100,-60,-1530], [140,25,-1770],
    [0,100,-1950], [-110,35,-2200], [-80,0,-2470], [70,25,-2660],
    [85,100,-2830], [0,0,-3040], [0,-15,-3280], [0,0,-3540], [0,150,-3780],
  ].map(p => new Vector3(...p)), false, 'catmullrom', 0.32);
}
export type Kind = 'interceptor' | 'helix' | 'bomber' | 'turret' | 'generator' | 'core' | 'shell';
export type Data = { x: number; y: number; phase: number; engagement: RailLead; socket?: number };
type Entry = LockOnSpawnEntry<Kind, Data>;
const curve = createBroadside86khRail();
const pacer = createRailPacer({ curve, duration: DURATION, runProgress: progress, spawnAheadUnits: 73, defaultLeadSeconds: 4.2 });
function entry(time: number, kind: Kind, x: number, y: number, phase = 0, lead = 4.2): Entry {
  return { time, kind, hitPoints: kind === 'bomber' || kind === 'turret' ? 2 : 1,
    data: { x, y, phase, engagement: pacer.resolve(time, lead) } };
}
export function createTimeline() {
  const entries: Entry[] = [];
  const wave = (bar: number, kinds: Kind[], points: number[][]) => kinds.forEach((kind, i) => {
    entries.push(entry(TIME.bar(bar) + i * TIME.stepSeconds, kind, points[i][0], points[i][1], i * 1.7));
  });
  const fan = [[-25,12],[-14,-13],[0,18],[13,-18],[26,8],[-17,-8]];
  const wings: Kind[] = ['interceptor','helix','interceptor','bomber','helix','interceptor'];
  wave(1, ['interceptor','helix','bomber','interceptor','helix','interceptor'], fan);
  wave(3.5, wings, fan.map(([x,y])=>[-x,-y]));
  wave(5.5, wings, fan);
  wave(7.5, wings, fan.map(([x,y])=>[x,y+2]));
  wave(10, ['helix','helix','bomber','interceptor','interceptor','helix'], fan);
  wave(12.3, ['turret','interceptor','turret','helix','turret','bomber'], fan);
  wave(14.5, ['turret','helix','turret','interceptor','bomber','helix'], fan.map(([x,y])=>[-x,-y]));
  wave(17, ['bomber','helix','interceptor'], [[-22,10],[20,-13],[4,16]]);
  for (let i=0;i<3;i++) {
    const e = entry(TIME.bar(19+i*1.2), 'generator', i%2 ? 20 : -22, i===1 ? -13 : 12, i, 6);
    e.hitStages = [2,2]; e.data.socket = i; entries.push(e);
  }
  wave(22, ['interceptor','helix','interceptor','helix'], [[-24,15],[23,-14],[-12,-14],[13,16]]);
  wave(23.8, wings, fan);
  wave(25.4, ['bomber','helix','interceptor'], [[-23,12],[23,-10],[0,18]]);
  for(let i=0;i<3;i++) {
    const e=entry(TIME.bar(26+i*0.65), 'core', (i-1)*17, i===1 ? 11 : -9, i, 5.8);
    e.hitStages=[2,2]; e.lockable=false; e.data.socket=i; entries.push(e);
  }
  return entries.sort((a,b)=>a.time-b.time);
}

export function createBroadsideGameplay(bus: EventBus): LockOnRunnerLevel<Kind, Data> {
  const timeline=createTimeline();
  const ids=new Map<number,Kind>();
  let generators=0, cores=0, failed=false;
  bus.on('runstart',()=>{ generators=0; cores=0; failed=false; ids.clear(); timeline.forEach(e=>{if(e.kind==='core') e.lockable=false;}); });
  bus.on('spawn',({enemyId,kind})=>{ ids.set(enemyId,kind as Kind); });
  bus.on('kill',({enemyId})=>{
    const kind=ids.get(enemyId); ids.delete(enemyId);
    if(kind==='generator' && ++generators===3) bus.emit('bossphase',{phase:'exposed'});
    if(kind==='core' && ++cores===3) bus.emit('bossphase',{phase:'destroyed'});
  });
  bus.on('miss',({enemyId})=>ids.delete(enemyId));
  return {
    duration:DURATION, bpm:BROADSIDE_86KH_BPM, playerHealth:5,
    createRail:createBroadside86khRail, easeRunProgress:progress, spawnTimeline:timeline,
    lockRadiusNdc:0.15,
    timing:{shotDelay:{maxGridSeconds:0.11}},
    updateEnemy({enemy,runTime,age,camera,curve,enemyState,spawnEnemy,damagePlayer}) {
      const d=enemy.entry.data;
      const state=enemyState(()=>({fired:false, damaged:false}));
      if(enemy.kind==='core') {
        enemy.entry.lockable=generators===3;
        enemy.mesh.userData.shielded=generators<3;
        if(runTime>TIME.bar(30) && !failed && cores<3) {failed=true; damagePlayer(5);}
      }
      const sample=pacer.sample(enemy.spawnTime,runTime,d.engagement);
      const closing = Math.min(1, Math.max(0.08, sample.distanceAheadUnits / 73));
      let x=d.x * closing, y=d.y * closing;
      if(enemy.kind==='interceptor') { x+=Math.sin(age*1.7+d.phase)*7; y+=Math.sin(age*0.9+d.phase)*2; }
      if(enemy.kind==='helix') { x+=Math.cos(age*2+d.phase)*5; y+=Math.sin(age*2+d.phase)*5; }
      if(enemy.kind==='bomber') { x+=Math.sin(age*0.7+d.phase)*2; y+=Math.sin(age*1.1)*1.5; }
      if(enemy.kind==='shell') {
        const distance=Math.max(5,65-age*24);
        enemy.mesh.position.set(d.x*(1-age/3)*0.5,d.y*(1-age/3)*0.5,-distance).applyQuaternion(camera.quaternion).add(camera.position);
        enemy.mesh.quaternion.copy(camera.quaternion);
        if(age>2.7) {damagePlayer(); return true;}
        return false;
      }
      if(enemy.kind==='generator' || enemy.kind==='core') {
        x=d.x; y=d.y;
        const z= Math.max(44,68-age*4);
        enemy.mesh.position.set(x,y,-z).applyQuaternion(camera.quaternion).add(camera.position);
      } else enemy.mesh.position.copy(offsetFromRail(curve,sample.anchorU,new Vector3(x,y,0)));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(enemy.kind==='helix' ? age*1.7+d.phase : enemy.kind==='interceptor' ? Math.cos(age*1.7+d.phase)*0.55 : Math.sin(age)*0.08);
      enemy.mesh.userData.charge=Math.max(0,Math.min(1,(age-1.3)/1.1));
      if((enemy.kind==='bomber'||enemy.kind==='turret'||enemy.kind==='generator') && age>2.4 && !state.fired) {
        state.fired=true;
        const shot=entry(runTime,'shell',x,y); shot.countsTowardTotal=false; spawnEnemy(shot);
      }
      return enemy.kind==='generator' ? runTime>TIME.bar(25.5) : enemy.kind!=='core' && runTime>d.engagement.passTime+0.25;
    },
    updateCameraEffects({camera,runTime}) {
      const roll=(runTime<34 ? Math.sin(runTime*0.58)*0.28+Math.sin(runTime*0.27)*0.12 : Math.sin(runTime*0.8)*0.15);
      camera.rotateZ(roll);
      camera.fov=runTime>13 && runTime<23 ? 78 : 68;
      if(runTime>56.25 && cores===3) {
        const t=(runTime-56.25)/3.75;
        const start=curve.getPointAt(56.25/60);
        camera.position.copy(start).lerp(new Vector3(950,1050,-1450),t*t*(3-2*t));
        camera.lookAt(new Vector3(0,0,-2350));
        camera.fov=68+12*t;
      }
      camera.updateProjectionMatrix();
    },
    scoreForKill:(n,e)=>Math.round((e.kind==='core'?900:e.kind==='generator'?600:e.kind==='shell'?40:120)*(1+0.22*(n-1))),
    scoreForHit:()=>35,
    scoreForVolley:r=>r.length===6 && r.every(v=>v.killed)?600:0,
    rankForRun:(_score,kills,total)=>cores===3 ? kills/total>0.9?'ADMIRAL':kills/total>0.65?'CAPTAIN':'VICTOR' : 'CADET',
    detailsForRun:()=>[`${generators}/3 shield generators destroyed`,`${cores}/3 power systems destroyed`,cores===3?'Enemy flagship neutralized — fleet victorious':'Flagship survived the strike'],
  };
}
