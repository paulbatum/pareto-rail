import { CatmullRomCurve3, Vector3, MathUtils } from 'three';
import type { EventBus } from '../../events';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';

export const BPM = 128;
export const TIME = createMusicTime(BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(32);
export const MARKERS = { launch: 0, crossfire: 7.5, broadside: 15, belly: 22.5, eye: 30, shields: 33.75, escorts: 41.25, trench: 46.875, victory: 56.25 };
// Authored seconds and positions keep each musical passage tied to a physical place.
const KEYS = [
  [0,0,8,180], [3.75,0,15,-100], [7.5,55,35,-380], [11.25,-65,-10,-620],
  [15,20,0,-850], [18.75,20,0,-1170], [22.5,-5,-30,-1480], [26.25,-45,-38,-1760],
  [30,20,55,-2010], [33.75,145,22,-2210], [37.5,145,22,-2500], [41.25,145,40,-2800],
  [45,50,105,-3030], [46.875,0,43,-2950], [50.625,0,43,-2660], [54.375,0,43,-2360],
  [56.25,10,80,-2160], [60,850,1300,-850],
];
export function createRail() {
  const curve = new CatmullRomCurve3(KEYS.map(k => new Vector3(k[1],k[2],k[3])), false, 'centripetal');
  curve.arcLengthDivisions = 2400;
  return curve;
}
const rail = createRail();
const lengths = rail.getLengths(2400);
export function progress(time: number) {
  let i = 0;
  while (i < KEYS.length - 2 && time > KEYS[i+1][0]) i++;
  const f = MathUtils.clamp((time-KEYS[i][0])/(KEYS[i+1][0]-KEYS[i][0]),0,1);
  const t = (i+f)/(KEYS.length-1)*2400;
  const a = Math.floor(t);
  return MathUtils.lerp(lengths[a], lengths[Math.min(2400,a+1)],t-a)/lengths[2400];
}
export type Kind = 'interceptor' | 'bomber' | 'spiral' | 'turret' | 'generator' | 'core' | 'shell';
type Data = { x: number; y: number; phase: number; life: number; slot?: number };
type Entry = LockOnSpawnEntry<Kind, Data>;
export type BattleState = { shields: number; cores: number; won: boolean; time: number; dispose?:()=>void };
export function createGameplay(bus: EventBus, state: BattleState = {shields:0,cores:0,won:false,time:0}): LockOnRunnerLevel<Kind,Data> {
  const timeline: Entry[] = [];
  const wave = (bar: number, kind: Kind, count: number, pattern = 0) => {
    for (let i=0;i<count;i++) timeline.push({ time: TIME.bar(bar)+i*TIME.stepSeconds*(pattern===2?2:0.5), kind,
      data: { x: (i-(count-1)/2)*10.5, y: (i%2===0?1:-1)*(9+pattern*2), phase:i*1.7, life:4.8 } });
  };
  wave(1,'interceptor',4); wave(3,'spiral',5); wave(5,'interceptor',6,1);
  wave(7,'bomber',3,2); wave(8,'spiral',5); wave(10,'interceptor',6,1);
  wave(12,'turret',4); wave(13.5,'spiral',5); wave(15,'interceptor',4);
  for(let i=0;i<3;i++) timeline.push({ time:TIME.bar(18+i),kind:'generator',hitPoints:2,data:{x:(i-1)*22,y:8,phase:i,life:9,slot:i} });
  wave(18.5,'shell',3); wave(20,'shell',3); wave(22,'interceptor',6,1); wave(23,'spiral',6,1);
  for(let i=0;i<3;i++) timeline.push({time:TIME.bar(25.5+i*.9),kind:'core',hitStages:[2,2],data:{x:(i-1)*17,y:i===1?15:6,phase:i,life:10,slot:i}});
  wave(25.5,'shell',3); wave(27,'shell',3);
  timeline.sort((a,b)=>a.time-b.time);
  const kinds = new Map<number,string>();
  const off = [bus.on('runstart',()=>{ state.shields=0;state.cores=0;state.won=false;state.time=0;kinds.clear(); }),
    bus.on('spawn',e=>{kinds.set(e.enemyId,e.kind);if(e.kind==='generator'&&state.shields===0)bus.emit('bossphase',{phase:'summoned'});}),
    bus.on('kill',e=>{const k=kinds.get(e.enemyId);kinds.delete(e.enemyId);if(k==='generator'&&++state.shields===3)bus.emit('bossphase',{phase:'exposed'});if(k==='core'&&++state.cores===3){state.won=true;bus.emit('bossphase',{phase:'destroyed'});}}),bus.on('miss',e=>kinds.delete(e.enemyId))];
  // Subscriptions belong to this runtime and are removed by the visual/runtime owner.
  state.dispose=()=>off.forEach(f=>f());
  return {
    bpm:BPM,duration:DURATION,createRail,spawnTimeline:timeline,easeRunProgress:progress,
    playerHealth:5,lockRadiusNdc:0.15,
    timing:{shotDelay:{maxGridSeconds:0.12}},
    scoreForKill:(n,e)=>(e.kind==='core'?600:e.kind==='generator'?400:100)*(1+(n-1)*0.3),
    scoreForHit:(_,e)=>e.kind==='core'?120:50,
    scoreForVolley:r=>r.length===6&&r.every(x=>x.killed)?1200:0,
    rankForRun:(_,k,total)=>state.won?(k/total>.85?'ADMIRAL':'ACE'):'SURVIVOR',
    detailsForRun:()=>[`${state.shields}/3 shield generators • ${state.cores}/3 power systems`,state.won?'Enemy flagship destroyed — fleet victorious':'Flagship survived — strike incomplete'],
    updateEnemy({enemy,age,runTime,camera,damagePlayer,enemyState}) {
      const d=enemy.entry.data;
      const boss=enemy.kind==='generator'||enemy.kind==='core';
      const s=enemyState(()=>({damaged:false}));
      enemy.entry.lockable=enemy.kind!=='core'||state.shields===3;
      let x=d.x, y=d.y;
      let distance=boss?36:44-age*4;
      if(enemy.kind==='interceptor') {x+=Math.sin(age*2.6+d.phase)*8;y+=Math.sin(age*1.6+d.phase)*2;}
      if(enemy.kind==='spiral') {x+=Math.cos(age*2+d.phase)*6;y+=Math.sin(age*2+d.phase)*6;}
      if(enemy.kind==='bomber') {y+=Math.sin(age*1.4+d.phase)*3;x+=Math.sin(age*.6)*3;distance+=4;}
      if(enemy.kind==='turret') {y=-12+Math.min(age,1)*6; x+=Math.sin(age*.7+d.phase);}
      if(enemy.kind==='shell') {x*=Math.max(.05,1-age/4.2);y*=Math.max(.05,1-age/4.2);distance=48-age*10;}
      if(boss) {const exit=enemy.kind==='generator'?46:56.25; if(runTime>exit)return true;}
      else if(age>d.life){if(!s.damaged&&(enemy.kind==='bomber'||enemy.kind==='shell')){damagePlayer();s.damaged=true;}return true;}
      if(!boss&&enemy.kind!=='shell'){x*=distance/44;y*=distance/44;}
      enemy.mesh.position.set(x,y,-Math.max(4,distance)).applyQuaternion(camera.quaternion).add(camera.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      if(enemy.kind==='spiral')enemy.mesh.rotateZ(age*1.6+d.phase);
      else if(enemy.kind==='interceptor')enemy.mesh.rotateZ(Math.cos(age*2.6+d.phase)*.45);
      else if(enemy.kind==='bomber')enemy.mesh.rotateZ(Math.sin(age)*.12);
      enemy.mesh.userData.shielded=enemy.entry.lockable===false;
      if(enemy.kind==='core')for(let i=0;i<4;i++) {const shutter=enemy.mesh.getObjectByName(`shutter-${i}`);if(shutter){const a=i*Math.PI/2;const r=enemy.entry.lockable?(enemy.hitStageIndex>0?3.5:2.5):1.1;shutter.position.set(Math.cos(a)*r,Math.sin(a)*r,1);shutter.rotation.z=enemy.hitStageIndex*.3;}}
    },
    updateCameraEffects({camera,runTime}) {
      state.time=runTime;
      const roll=runTime<30?Math.sin(runTime*.68)*.23+Math.sin(runTime*.27)*.13:runTime<46?Math.sin((runTime-33)*.4)*.2:0;
      const corkscrew=MathUtils.smoothstep(runTime,9.5,13.5)*Math.PI*2;
      camera.rotateZ(roll+corkscrew);
      camera.fov=runTime>=56.25?76:68+Math.sin(Math.min(1,runTime/3)*Math.PI/2)*6;
      if(runTime>56.25){const q=camera.quaternion.clone();camera.lookAt(0,-30,-1760);const target=camera.quaternion.clone();camera.quaternion.copy(q).slerp(target,MathUtils.smoothstep(runTime,56.25,57.5));}
      camera.updateProjectionMatrix();
    },
  };
}
