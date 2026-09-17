import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { SPEEDSOLVE_28FR_BPM, createGameplay, createSolveState } from './gameplay';
import { createVisuals } from './visuals';

export const speedsolve28frLevel: LevelDefinition = {
  id:'speedsolve-28fr',title:'Speedsolve',
  description:'Six faces. One clockwork giant. Shoot the glowing squares to solve the cube, peel its armor, and silence the machinery.',
  bpm:SPEEDSOLVE_28FR_BPM,
  post:{clearColor:0xe9eef2,bloom:{strength:.22,threshold:.9,radius:.12},vignette:{inner:.4,outer:1.1,strength:.12}},
  createAudio,
  createRuntime({scene,camera,canvas,bus,hud,onPause,onFullscreen}) {
    const state=createSolveState();const visuals=createVisuals(scene,bus,state,camera);const level=createGameplay(bus,state);
    const game=createLockOnRunner({scene,camera,canvas,bus,hud,onPause,onFullscreen,startTip:'Hold to charge · sweep lit squares and orbiters · release to rotate. Six locks earn a precision bonus.',level,visuals:visuals.factories});
    let text='';
    return {
      update(dt){game.update(dt);visuals.update(dt);if(game.state==='running'&&text!==state.callout){text=state.callout;hud.setCallout(text);}},
      dispose(){visuals.dispose();game.dispose();},
    };
  },
};
