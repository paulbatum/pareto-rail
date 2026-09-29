import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { STRANDLINE_2JV4_BPM, createGameState } from './gameplay';
import { createVisuals } from './visuals';

export const strandline2jv4Level: LevelDefinition = {
  id: 'strandline-2jv4', title: 'Strandline',
  description: 'Follow the living light through a giant jellyfish, sever its violet infestation, and set it drifting free.',
  bpm: STRANDLINE_2JV4_BPM,
  markers: { forest: 5, moon: 22, return: 28, crown: 40, release: 54 },
  sections: [{name:'Sleeping strands',time:0},{name:'Living current',time:10},{name:'Green moon',time:20},{name:'The crown',time:40},{name:'Drift',time:54}],
  post: { clearColor:0x073d59, bloom:{strength:.55,threshold:.8,radius:.32},vignette:{inner:.42,outer:1.2,strength:.3} },
  createAudio,
  createRuntime({scene,camera,canvas,bus,hud,onPause,onFullscreen}) {
    const gameplay=createGameState(bus);const visuals=createVisuals(scene,bus);
    let runTime=0,calloutUntil=0,elapsed=0,next=0,endedAt=0;
    const say=(text:string,seconds=2.2)=>{hud.setCallout(text);calloutUntil=elapsed+seconds;};
    const cues=[{at:1,text:'SEVER THE VIOLET COLONY'},{at:19.8,text:'A HEART THE SIZE OF A MOON'},{at:28,text:'FOLLOW THE LIVING LIGHT'},{at:38.5,text:'THE CROWN · CLEAR ITS BROODS'}];
    const off=[bus.on('runend',()=>{endedAt=elapsed;}),bus.on('runstart',()=>{runTime=0;next=0;hud.setCallout('');}),
      bus.on('bossphase',e=>say(e.phase==='summoned'?'BROODS FEED THE WEB · CUT THEM AWAY':e.phase==='exposed'?'WEB SEVERED · TEAR THE PARENT LOOSE':'STRANDLINE RESTORED',e.phase==='destroyed'?5:2.6))];
    const game=createLockOnRunner({scene,camera,canvas,bus,hud,onPause,onFullscreen,
      startTip:'Hold to gather light · sweep up to six parasites · release to sever · right click to undo',level:gameplay.level,visuals:visuals.factories});
    return {update(dt,time){elapsed=time;if(game.state==='running'){runTime=Math.min(60,runTime+dt);while(next<cues.length&&runTime>=cues[next].at)say(cues[next++].text);}
      if(time>calloutUntil)hud.setCallout('');game.update(dt);visuals.update(dt,game.state==='attract'?time:game.state==='ended'?runTime+time-endedAt:runTime,camera,Math.min(1,gameplay.state.killed/48),gameplay.state.parentDead);},
      dispose(){off.forEach(f=>f());gameplay.dispose();visuals.dispose();game.dispose();}};
  },
};
