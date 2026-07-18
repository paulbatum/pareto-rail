import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry, LockOnEnemyUpdate } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createMusicTime } from '../../engine/music-time';
import { createSpeedProfile } from '../../engine/speed-profile';

export const MASS_DRIVER_DETAILED_BE9E_BPM = 128;
export const MASS_DRIVER_DETAILED_BE9E_TIME = createMusicTime(MASS_DRIVER_DETAILED_BE9E_BPM, { stepsPerBar: 16 });
export const MASS_DRIVER_DETAILED_BE9E_RUN_DURATION = MASS_DRIVER_DETAILED_BE9E_TIME.bar(32);
export type MassDriverDetailedBe9eEnemyKind = 'coil'|'threader'|'capacitor'|'interlock'|'arc';
export type MassDriverDetailedBe9eSpawnData = { lead:number; offset:Vector3; phase?:number; firing?:boolean };

const speed = createSpeedProfile([[0,.35],[7.5,.55],[22.5,.8],[37.5,1.05],[52.5,1.35],[MASS_DRIVER_DETAILED_BE9E_RUN_DURATION,1.15]], MASS_DRIVER_DETAILED_BE9E_RUN_DURATION);
export function createMassDriverDetailedBe9eRail() { return new CatmullRomCurve3([
 new Vector3(0,0,0),new Vector3(4,1,-90),new Vector3(-4,-1,-190),new Vector3(3,1,-300),new Vector3(-2,0,-420),new Vector3(0,0,-550),new Vector3(0,5,-690)
 ], false, 'catmullrom', .35); }
const T=(bar:number, beat=0)=>MASS_DRIVER_DETAILED_BE9E_TIME.bar(bar,beat);
const e=(time:number,kind:MassDriverDetailedBe9eEnemyKind,x:number,y:number,lead=4.5,extra:Partial<MassDriverDetailedBe9eSpawnData>={})=>({time,kind,data:{lead,offset:new Vector3(x,y,0),...extra}});
const entries: Array<LockOnSpawnEntry<MassDriverDetailedBe9eEnemyKind,MassDriverDetailedBe9eSpawnData>>=[];
for(let b=1;b<28;b+=2){
 const phase=b*.7;
 if(b<5){ entries.push(e(T(b),'threader',-6,2.5,5,{phase}),e(T(b,.5),'threader',6,4,5,{phase:phase+3.14})); }
 else if(b<12){ for(let i=0;i<4;i++) entries.push(e(T(b)+i*.22,'coil',[-6,6,-4,4][i],[-3,3,4,-1][i],4.3,{phase:i})); if(b===9) entries.push(e(T(b,2),'capacitor',-4,3,5.5)); }
 else if(b<20){ for(let i=0;i<6;i++) entries.push(e(T(b)+i*.18,'coil',Math.cos(i*Math.PI/3)*6,Math.sin(i*Math.PI/3)*4,4,{phase:i,firing:i%2===0})); entries.push(e(T(b,.8),'threader',-7,1,4,{phase}),e(T(b,1.5),'threader',7,4,4,{phase:phase+3.14})); if(b===17) { entries.push(e(T(b,1),'capacitor',-5,3,5),e(T(b,2),'capacitor',5,1,5)); } }
 else if (b===21 || b===25) { for(let i=0;i<3;i++) entries.push({...e(T(b)+i*.35,'interlock',[-6,0,6][i],[-2,4,-1][i],6,{phase:i}), hitStages:[1,1,1]}); for(let i=0;i<2;i++) entries.push(e(T(b+1)+i*.5,'threader',i?6:-6,2+i,4,{phase:i})); }
}
for (const [t,x,y] of [[T(14),-4,2],[T(16),4,3],[T(18),-3,1]] as const) entries.push({...e(t,'arc',x,y,3),countsTowardTotal:false});
export const MASS_DRIVER_DETAILED_BE9E_SPAWN_TIMELINE=entries.sort((a,b)=>a.time-b.time);
export const massDriverDetailedBe9eGameplay: LockOnRunnerLevel<MassDriverDetailedBe9eEnemyKind,MassDriverDetailedBe9eSpawnData>={
 duration:MASS_DRIVER_DETAILED_BE9E_RUN_DURATION,bpm:MASS_DRIVER_DETAILED_BE9E_BPM,createRail:createMassDriverDetailedBe9eRail,spawnTimeline:MASS_DRIVER_DETAILED_BE9E_SPAWN_TIMELINE,
 playerHealth:3,startWord:'CHARGE',replayWord:'RELOAD',easeRunProgress:(t)=>speed.runProgress(t,MASS_DRIVER_DETAILED_BE9E_RUN_DURATION),
 updateEnemy:(c=>{ const d=c.enemy.entry.data; const age=c.runTime-c.enemy.spawnTime; const p=d.phase??0; let o=d.offset.clone(); if(c.enemy.kind==='threader'){o.x+=Math.sin(age*3+p)*3;o.y+=Math.cos(age*2.2+p)*1.5;o.multiplyScalar(1.25);} else if(c.enemy.kind==='coil'){o.multiplyScalar(1.5);o.applyAxisAngle(new Vector3(0,0,1),age*.4+p);} else if(c.enemy.kind==='arc'){o.z=-2+Math.sin(age*4)*1;o.x+=Math.sin(age*2+p)*2;} else if(c.enemy.kind==='interlock'){o.multiplyScalar(1.55+Math.sin(age*.8)*.05);} if(c.enemy.kind==='arc' && age>1.7){const impact=c.enemyState(()=>({done:false}));if(!impact.done){impact.done=true;c.damagePlayer(1);}}
 if(d.firing && age>1.2){const shot=c.enemyState(()=>({done:false}));if(!shot.done){shot.done=true;c.damagePlayer(0.25);}}
 const pos=offsetFromRail(c.curve,c.railAnchor(d.lead),o); c.enemy.mesh.position.copy(pos); c.enemy.mesh.lookAt(c.camera.position); c.enemy.mesh.rotation.z+=age*.5; return age>d.lead+1.5; }),
 scoreForKill:(_volley,enemy)=>enemy.kind==='interlock'?500:enemy.kind==='capacitor'?280:enemy.kind==='threader'?140:90,
 rankForRun:(score,kills,total)=>kills===total&&score>1800?'S':kills>=total*.8?'A':kills>=total*.55?'B':'C',
 detailsForRun:()=>['PAYLOAD SYSTEM: 3-HULL ORBITAL CHAMBER','ACCELERATOR GRID: 128 BPM / 32 BARS','INTERLOCK DEADLINE: BAR 28 — MUZZLE EXIT'],
 updateCameraEffects:({camera,runProgress,dt})=>{camera.fov=60+runProgress*10;camera.rotation.z=Math.sin(runProgress*34)*.012*(1+runProgress*2);camera.position.x=Math.sin(runProgress*90)*.025*(1+runProgress*3);camera.updateProjectionMatrix();}

};
