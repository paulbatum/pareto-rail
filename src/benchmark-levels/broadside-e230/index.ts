import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BPM, MARKERS, createGameplay, type BattleState } from './gameplay';
import { createVisuals,createEnemyMesh,setEnemyLocked,setEnemyDenied,createProjectileMesh,createReticle,setReticleActive } from './visuals';
export const broadsideLevel:LevelDefinition={
  id:'broadside-e230',title:'Broadside',description:'Launch into a fleet engagement. Cut the shields, dive the flagship trench, and bring the enemy line down.',
  bpm:BPM,markers:MARKERS,sections:Object.entries(MARKERS).map(([name,time])=>({name,time})),
  post:{clearColor:0x090814,bloom:{strength:.65,threshold:.85,radius:.15},vignette:{inner:.45,outer:1.2,strength:.45}},
  createAudio,
  createRuntime({scene,camera,canvas,bus,hud,onPause,onFullscreen,startTip}) {
    camera.far=30000;camera.updateProjectionMatrix();
    const state:BattleState={shields:0,cores:0,won:false,time:0};
    const gameplay=createGameplay(bus,state);
    const visuals=createVisuals(bus,scene,state);
    const calls=[{at:0,text:'CAST OFF • CLEAR THE FLIGHT DECK'},{at:7.5,text:'FLEET ENGAGEMENT'},{at:15,text:'FRIENDLY BROADSIDE • STAY LOW'},{at:22.5,text:'ENEMY BELLY • RAKE THE BATTERIES'},{at:30,text:'THE EYE OF THE BATTLE'},{at:33.75,text:'FLAGSHIP • DESTROY THREE SHIELD GENERATORS'},{at:41.25,text:'ESCORTS INBOUND • COMING AROUND'},{at:46.875,text:'TRENCH DIVE • DESTROY THREE POWER SYSTEMS'}];
    let next=0,until=0,now=0;
    const say=(s:string,hold=2.8)=>{hud.setCallout(s);until=now+hold;};
    const subscriptions=[bus.on('runstart',()=>{next=0;state.time=0;}),bus.on('bossphase',e=>{if(e.phase==='exposed')say('SHIELD COLLAPSE • CORE ROUTE OPEN');if(e.phase==='destroyed')say('FLAGSHIP BREAKING • VICTORY',8);})];
    const game=createLockOnRunner({scene,camera,canvas,bus,hud,onPause,onFullscreen,startTip:startTip+'  Bombers and crimson shells damage your hull if they pass.',level:gameplay,
      visuals:{createEnemyMesh,setEnemyLocked,setEnemyDenied,createProjectileMesh,createReticle,setReticleActive}});
    return {update(dt,elapsed){now=elapsed;game.update(dt);if(game.state==='running'){while(next<calls.length&&state.time>=calls[next].at){say(calls[next].text);next++;}if(now>until)hud.setCallout('');}visuals.update(dt,elapsed,camera);},
      dispose(){subscriptions.forEach(f=>f());state.dispose?.();visuals.dispose();game.dispose();}};
  },
};
