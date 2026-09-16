import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { STRANDLINE_U4WM_BPM, createGameplay, newLife } from './gameplay';
import { createVisuals } from './visuals';

export const strandlineU4wmLevel: LevelDefinition = {
  id:'strandline-u4wm',title:'Strandline',
  description:'Thread a living forest of tentacles. Cut the infestation from a giant jellyfish and let it drift free.',
  bpm:STRANDLINE_U4WM_BPM,
  markers:{strands:8,sunward:21,crown:38,broods:43,drift:57},
  sections:[{name:'Suspended',time:0},{name:'Sunward',time:15},{name:'Living current',time:25},{name:'The crown',time:37.5},{name:'Drift',time:55}],
  post:{clearColor:0x07364d,bloom:{strength:.6,threshold:.8,radius:.25},vignette:{inner:.5,outer:1.2,strength:.3}},
  createAudio,
  createRuntime({scene,camera,canvas,bus,hud,onPause,onFullscreen}) {
    const life=newLife();
    const visuals=createVisuals(scene,camera,bus,life);
    let time=0,hold=0,callout=0;
    const say=(text:string,seconds=2.5)=>{hud.setCallout(text);hold=seconds;};
    const off=[
      bus.on('runstart',()=>{time=0;callout=0;say('STRANDLINE / REMOVE THE VIOLET PARASITES',3.5);}),
      bus.on('bossphase',e=>say(e.phase==='summoned'?'THE PARENT / CLEAR ALL THREE BROODS':e.phase==='exposed'?'WEBBING LOST / TEAR IT LOOSE':'FREE / LET IT DRIFT',e.phase==='destroyed'?5:3)),
    ];
    const game=createLockOnRunner({scene,camera,canvas,bus,hud,onPause,onFullscreen,
      startTip:'Hold • sweep the violet parasites • release to free the strands',
      level:createGameplay(bus,life),visuals:visuals.factories});
    return {
      update(dt,elapsed){
        if(game.state==='running'){
          time+=dt;
          if(time>19&&callout===0){say('ONE ANIMAL. A THOUSAND STRANDS.',3);callout=1;}
          if(time>54&&!life.freed&&callout<2){say('THE COLONY REMAINS / RETURN TO FINISH THE WORK',4);callout=2;}
        }
        if(hold>0){hold-=dt;if(hold<=0)hud.setCallout('');}
        game.update(dt);visuals.update(dt,game.state==='running'?time:elapsed);
      },
      dispose(){off.forEach(f=>f());visuals.dispose();game.dispose();},
    };
  },
};
