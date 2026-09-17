import { CatmullRomCurve3, Vector3, Quaternion } from 'three';
import type { EventBus } from '../../events';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { steerHomingShot, hostileShotAimPoint, updateHostileShotImpact, shotBehindCamera, type HostileShotImpactState } from '../../engine/hostile-shot';

export const SPEEDSOLVE_28FR_BPM = 120;
export const TIME = createMusicTime(SPEEDSOLVE_28FR_BPM, { stepsPerBar: 16 });
export const COLORS = [0xf33e55, 0x2985ef, 0xffac25, 0x26c789, 0xffdf39, 0xfafafa];
export const NAMES = ['ROSE', 'AZURE', 'TANGERINE', 'JADE', 'LEMON', 'PORCELAIN'];
export const NORMALS = [new Vector3(0,0,1), new Vector3(1,0,0), new Vector3(0,0,-1), new Vector3(-1,0,0), new Vector3(0,1,0), new Vector3(0,-1,0)];
export const faceQuaternion = (face: number) => new Quaternion().setFromUnitVectors(new Vector3(0,0,1), NORMALS[face]);
export const facePoint = (face: number, x: number, y: number, z = 4.95) => new Vector3(x,y,z).applyQuaternion(faceQuaternion(face));
export type Kind = 'tile' | 'weakpoint' | 'core' | 'tetra' | 'octa' | 'prism' | 'bolt' | 'conductor';
export type Data = { face?: number; slot?: number; x?: number; y?: number; seed?: number; position?: Vector3 };
export type SolveState = ReturnType<typeof createSolveState>;
export function createSolveState() {
  return { time: 0, rows: Array.from({length:6}, () => [false,false,false]), peeled: Array<boolean>(6).fill(false), conquered: Array<boolean>(6).fill(false), weakSpawned: Array<boolean>(6).fill(false), pending: [] as { at:number; face:number; row:number }[], ids: new Map<number,{kind:Kind; face:number; slot:number}>(), lastSnap: -10, lastPeel: -10, coreDead: false, coreBurst: -10, view: 0, callout: 'HOLD · SWEEP · RELEASE / ANY LIT SQUARE ADVANCES THE SOLVE' };
}
export function createSpeedsolve28frRail() {
  return new CatmullRomCurve3(Array.from({length:49},(_,i)=>new Vector3(Math.sin(i/48*Math.PI*2)*24,2,Math.cos(i/48*Math.PI*2)*24)));
}
const timeline: LockOnSpawnEntry<Kind,Data>[] = [{time:0,kind:'conductor',data:{},lockable:false,countsTowardTotal:false}];
for(let f=0;f<6;f++) {
  for(let slot=0;slot<3;slot++) timeline.push({time:TIME.bar(f*4, 1.75),kind:'tile',data:{face:f,slot}});
  for(const [beat, count] of [[1,3],[6,4],[11,3]] as const) for(let i=0;i<count;i++) {
    const angle = (i/count*Math.PI*2)+f*.7+beat*.13;
    timeline.push({time:TIME.bar(f*4,beat)+i*TIME.stepSeconds,kind:(['tetra','octa','prism'] as const)[(i+f+beat)%3],data:{seed:f*13+i+beat,x:Math.cos(angle)*10.5,y:Math.sin(angle)*5.5}});
  }
}
for(let i=0;i<12;i++) timeline.push({time:TIME.bar(24+Math.floor(i/4),i%4),kind:(['tetra','octa','prism'] as const)[i%3],data:{seed:i,x:Math.cos(i*2.4)*11,y:Math.sin(i*2.4)*6}});
timeline.push({time:TIME.bar(27),kind:'core',hitStages:[6,6,6],data:{}});
timeline.sort((a,b)=>a.time-b.time);

export function createGameplay(bus:EventBus, state:SolveState = createSolveState()): LockOnRunnerLevel<Kind,Data> {
  bus.on('runstart',()=>Object.assign(state,createSolveState()));
  bus.on('kill',({enemyId})=>{
    const info=state.ids.get(enemyId); if(!info) return;
    if(info.kind==='tile') {
      const previous=state.pending.filter(p=>p.face===info.face).at(-1)?.at ?? state.time;
      state.pending.push({at:(Math.floor(Math.max(state.time,previous)/.5)+1)*.5,face:info.face,row:info.slot});
    }
    if(info.kind==='weakpoint') {state.conquered[info.face]=true; state.view=Math.min(5,info.face+1); state.callout=`${NAMES[info.face]} / CONQUERED`;}
    if(info.kind==='core') {state.coreDead=true;state.coreBurst=Math.ceil(state.time/.5)*.5;state.callout='SOLVED / SIX FACES · ONE PERFECT MACHINE';bus.emit('bossphase',{phase:'destroyed'});}
    state.ids.delete(enemyId);
  });
  bus.on('miss',({enemyId})=>state.ids.delete(enemyId));
  let cameraNormal = NORMALS[0].clone();
  const cameraRotation = new Quaternion();
  return {
    duration:TIME.bar(30), bpm:SPEEDSOLVE_28FR_BPM, createRail:createSpeedsolve28frRail, spawnTimeline:timeline,
    playerHealth:5, lockRadiusNdc:.095,
    timing:{actionSfx:{enabled:true,gridThirtyseconds:1},shotDelay:{maxGridSeconds:.125}},
    scoreForKill:(size,e)=> (e.kind==='core'?4000:e.kind==='weakpoint'?1000:e.kind==='tile'?300:100)*(1+(size-1)*.2),
    scoreForHit:(size)=>40*size,
    scoreForVolley:results=>results.length===6?600:0,
    rankForRun:(_score,kills,total)=>kills/total>.9?'S':kills/total>.7?'A':kills/total>.45?'B':'C',
    detailsForRun:()=>[`${state.conquered.filter(Boolean).length} / 6 faces conquered`,state.coreDead?'CORE DISASSEMBLED':'CORE STILL ACTIVE','Six-lock volleys: +600 precision bonus'],
    updateAttractCamera({camera,modeTime}) {camera.position.set(10+Math.sin(modeTime*.25),7,26);camera.up.set(0,1,0);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);cameraNormal.copy(NORMALS[0]);cameraRotation.identity();},
    updateCameraEffects({camera,runTime,dt}) {
      state.time=runTime;
      const face=Math.max(state.view,Math.min(5,Math.floor(runTime/8)));
      cameraRotation.rotateTowards(faceQuaternion(face),dt*5);
      cameraNormal.set(0,0,1).applyQuaternion(cameraRotation);
      const aim=cameraNormal.clone().multiplyScalar(runTime>49?22:25);
      aim.add(new Vector3(5,3,2)); camera.position.copy(aim);
      camera.up.set(0,1,Math.abs(cameraNormal.y)>.65 ? -.65*Math.sign(cameraNormal.y):0).normalize();camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
      while(state.pending.length && state.pending[0].at<=runTime) {
        const p=state.pending.shift()!;state.rows[p.face][p.row]=true;state.lastSnap=p.at;
        if(state.rows[p.face].every(Boolean)) {state.peeled[p.face]=true;state.lastPeel=p.at;state.callout=`${NAMES[p.face]} / SOLVED — BREAK THE AXLE`;bus.emit('bossphase',{phase:'exposed'});}
      }
      if(runTime>48&&!state.coreDead) state.callout=state.conquered.every(Boolean)?'NAKED CORE / CHARGE SIX · RELEASE · REPEAT':'INCOMPLETE SOLVE / CORE SHIELDED';
    },
    updateEnemy(c) {
      const {enemy,age,runTime,camera,enemyState}=c; const d=enemy.entry.data;
      state.ids.set(enemy.id,{kind:enemy.kind,face:d.face??0,slot:d.slot??0});
      const local=enemyState(()=>({lastAge:age,fired:false,velocity:new Vector3(),impact:{} as HostileShotImpactState,position:d.position?.clone()??new Vector3()}));
      const dt=Math.max(0,age-local.lastAge);local.lastAge=age;
      if(enemy.kind==='conductor') {
        enemy.mesh.visible=false;enemy.mesh.position.set(0,10000,0);
        for(let f=0;f<6;f++) if(state.peeled[f]&&!state.weakSpawned[f]) {state.weakSpawned[f]=true;c.spawnEnemy({time:runTime,kind:'weakpoint',hitPoints:1,data:{face:f}});}
        return false;
      }
      if(enemy.kind==='tile') {
        const f=d.face!,slot=d.slot!;
        enemy.mesh.position.copy(facePoint(f,(slot-1)*3.2,(1-slot)*3.2,5.15));enemy.mesh.quaternion.copy(faceQuaternion(f));
        enemy.mesh.userData.face=f;
        return runTime>(f+1)*8-.3;
      }
      if(enemy.kind==='weakpoint') {
        enemy.mesh.position.copy(facePoint(d.face!,0,0,5.35));enemy.mesh.quaternion.copy(faceQuaternion(d.face!));enemy.mesh.rotateZ(age*.7);
        return runTime>(d.face!+1)*8+.2;
      }
      if(enemy.kind==='core') {enemy.entry.lockable=state.conquered.every(Boolean);enemy.mesh.visible=enemy.entry.lockable;enemy.mesh.position.set(0,0,0);enemy.mesh.rotation.set(age*.6,age*(1+(18-enemy.hitPointsRemaining)*.18),age*.2);return false;}
      if(enemy.kind==='bolt') {
        steerHomingShot(local.position,local.velocity,hostileShotAimPoint(camera,local.position),age,dt,{baseSpeed:6,maxSpeed:15,accel:2,turnRate:2.5});
        const impact=updateHostileShotImpact({age,camera,position:local.position,velocity:local.velocity,state:local.impact});
        const outward=camera.position.clone().normalize();
        const nearSide=local.position.dot(outward);
        if(nearSide<7)local.position.addScaledVector(outward,7-nearSide);
        enemy.mesh.position.copy(local.position);enemy.mesh.rotation.y=age*5;
        if(impact.phase==='braking'&&impact.damaged){c.damagePlayer();return true;}
        return age>7||shotBehindCamera(camera,local.position);
      }
      let x=d.x!,y=d.y!; const seed=d.seed!;
      if(enemy.kind==='tetra'){x+=Math.sin(age*2.3+seed)*1.2;y+=Math.cos(age*2.3+seed)*.7;}
      if(enemy.kind==='octa'){x+=Math.sin(age*1.1+seed)*2.4;y+=Math.sin(age*2+seed)*1.2;}
      if(enemy.kind==='prism'){x+=Math.sin(age*.8+seed)*3;y+=Math.sin(age*4)*.25;}
      enemy.mesh.position.set(x,y,-16+Math.min(age,4)*.5).applyQuaternion(camera.quaternion).add(camera.position);
      const outward=camera.position.clone().normalize();
      const depth=enemy.mesh.position.dot(outward);
      if(depth<8)enemy.mesh.position.addScaledVector(outward,8-depth);
      enemy.mesh.rotation.set(age*(enemy.kind==='tetra'?2:.4),age*.8+seed,enemy.kind==='prism'?Math.sin(age*2)*.5:age);
      enemy.mesh.userData.face=seed%6;
      if(age>2.5&&seed%3===0&&!local.fired){local.fired=true;c.spawnEnemy({time:runTime,kind:'bolt',countsTowardTotal:false,data:{position:enemy.mesh.position.clone(),seed}});}
      return age>4.8;
    },
  };
}
