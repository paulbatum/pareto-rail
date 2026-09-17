import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BROADSIDE_86KH_BPM, createBroadsideGameplay, MARKERS, SECTIONS } from './gameplay';
import { createVisuals, createEnemyMesh, createProjectileMesh, createReticle, setEnemyDenied, setEnemyLocked, setReticleActive } from './visuals';

export const broadside86khLevel: LevelDefinition = {
  id: 'broadside-86kh', title: 'Broadside',
  description: 'Launch into a fleet engagement, break the flagship’s shields, and strike its exposed power systems.',
  bpm: BROADSIDE_86KH_BPM, markers: MARKERS, sections: SECTIONS,
  post: { clearColor: 0x080611, bloom: { strength: 0.65, threshold: 0.5, radius: 0.6 }, vignette: { inner: 0.4, outer: 1.15, strength: 0.55 } },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const visuals=createVisuals(scene,camera,bus);
    const gameplay=createBroadsideGameplay(bus);
    let time=0, next=0, until=0;
    const callouts=[
      [0.2,'FLIGHT LEAD // CLEARED TO LAUNCH'],[7.5,'FIGHTERS OFF THE CARRIERS'],
      [13.125,'FRIENDLY BROADSIDE // STAY LOW'],[22.5,'UNDER THEIR ARMOR // RAKE THE TURRETS'],
      [30,'THE EYE OF THE BATTLE'],[35.625,'FLAGSHIP // DESTROY THREE SHIELD GENERATORS'],
      [43.125,'ESCORTS INBOUND // COMING AROUND'],[48.75,'TRENCH ENTRY // STRIKE THE POWER SYSTEMS'],
    ] as const;
    const off=[bus.on('runstart',()=>{time=0;next=0;until=0;}),bus.on('bossphase',({phase})=>{
      hud.setCallout(phase==='exposed'?'SHIELD COLLAPSE // CORE SYSTEMS EXPOSED':phase==='destroyed'?'FLAGSHIP DESTROYED // ALL SHIPS ADVANCE':'');until=time+3;
    })];
    const game=createLockOnRunner({scene,camera,canvas,bus,hud,onPause,onFullscreen,startTip,
      level:{...gameplay,updateCameraEffects(ctx){gameplay.updateCameraEffects?.(ctx);visuals.cameraEffect(ctx.dt,ctx.runTime);}},
      visuals:{createEnemyMesh,setEnemyLocked,setEnemyDenied,createProjectileMesh,createReticle,setReticleActive}});
    return {
      update(dt,elapsed){
        if(game.state==='running') {
          time+=dt;
          if(next<callouts.length && time>=callouts[next][0]) {hud.setCallout(callouts[next][1]);until=time+2.5;next++;}
          if(until>0&&time>until){hud.setCallout('');until=0;}
        }
        game.update(dt);visuals.update(dt,time,elapsed,game.state==='running');
      },
      dispose(){off.forEach(f=>f());visuals.dispose();game.dispose();},
    };
  },
};
