import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createArrangement, fn } from '../../engine/arrangement';
import { BROADSIDE_86KH_BPM, DURATION, TIME } from './gameplay';
import { strings, spiccato, brass, timpani, celesta, cannon, air } from './audio-voices';

const CHORDS=[
  {root:38,tones:[50,53,57],lead:[74,77,81,84,86,89,93,96]},
  {root:34,tones:[46,50,53],lead:[74,77,82,86,89,94,98,101]},
  {root:41,tones:[53,57,60],lead:[72,77,81,84,89,93,96,101]},
  {root:36,tones:[48,52,55],lead:[72,76,79,84,88,91,96,100]},
];
type Chord=typeof CHORDS[number];
const SECTIONS=[{index:0,fromBar:0},{index:1,fromBar:7},{index:2,fromBar:16},{index:3,fromBar:19},{index:4,fromBar:26},{index:5,fromBar:30}] as const;
// The horn phrase returns in major after the flagship breaks.
const THEME=[0,0,4,2, 3,2,1,0, 2,4,3,2, 1,2,0,0];
export function createAudio(bus:EventBus){return createBroadsideAudio(bus).audio;}
export const traceBroadsideAudio=createAudioTraceHarness({level:'broadside-86kh',bpm:BROADSIDE_86KH_BPM,stepSeconds:TIME.stepSeconds,defaultSeconds:DURATION,createAudio:createBroadsideAudio});
function createBroadsideAudio(bus:EventBus,trace?:AudioTraceSink) {
  let won=false;
  const score=createScore<Chord,number>({bpm:BROADSIDE_86KH_BPM,stepsPerBar:16,chords:CHORDS,barsPerChord:2,sections:SECTIONS,leadSet:c=>c.lead,
    killLanes:{0:[0,1,2,4,3,2,1,0,2,3,4,5,4,2,3,1],1:[0,2,4,3,5,4,6,5,3,4,2,3,1,2,4,0],2:[0,0,1,2,1,0,2,3,2,1,0,1,2,0,1,0],3:[4,3,2,4,5,4,3,5,6,5,4,6,7,6,5,7],4:[0,4,1,5,2,6,3,7,4,3,5,4,6,5,7,6],5:[0,1,2,3,4,5,6,7,7,6,5,4,3,2,1,0]}});
  const runtime=createBeatLevelAudio({bus,trace,score,bpm:BROADSIDE_86KH_BPM,stepSeconds:TIME.stepSeconds,stepsPerBar:16,runAlignment:'bar',beatNumber:'position',volumeScale:0.76,
    mix:{compressor:{threshold:-17,ratio:4,attack:0.008,release:0.25},noiseSeconds:2,reverb:{seconds:2.1,decay:2.4,level:0.25,returnTo:'master'}},
    onStep:schedule,onRunStart(){won=false;},
    onRunEnd(){const c=runtime.context();if(c){const t=c.currentTime;inst.string(t,won?62:50,0.5);inst.string(t,won?66:53,0.35);inst.string(t,69,0.3);}},
  });
  const inst=defineInstruments({trace,context:runtime.context},{
    string(ctx,t,midi,v=1){const m=runtime.mix();if(m)strings.play({context:ctx,time:t,midi,velocity:v,destination:m.music,sends:m.reverbSend?[{destination:m.reverbSend,gain:0.35}]:undefined});},
    short(ctx,t,midi,v=1){const m=runtime.mix();if(m)spiccato.play({context:ctx,time:t,midi,velocity:v,destination:m.music});},
    horn(ctx,t,midi,v=1){const m=runtime.mix();if(m)brass.play({context:ctx,time:t,midi,velocity:v,destination:m.music,sends:m.reverbSend?[{destination:m.reverbSend,gain:0.5}]:undefined});},
    drum(ctx,t,midi=38,v=1){const m=runtime.mix();if(m)timpani.play({context:ctx,time:t,midi,velocity:v,destination:m.music});},
    cymbal(ctx,t,v=1){const m=runtime.mix();if(m?.noiseBuffer)air.play({context:ctx,time:t,buffer:m.noiseBuffer,velocity:v*0.13,destination:m.music});},
    player(ctx,t,midi,v=1){const m=runtime.mix();if(m)celesta.play({context:ctx,time:t,midi,velocity:v,destination:m.sfx,sends:m.reverbSend?[{destination:m.reverbSend,gain:0.24}]:undefined});},
    boom(ctx,t,midi=33,v=1){const m=runtime.mix();if(m)cannon.play({context:ctx,time:t,midi,velocity:v,destination:m.sfx});},
  });
  const arrangement=createArrangement<Chord>({stepsPerBar:16,chordAt:p=>score.chordAt(p),trace,emitSections:true,
    sections:[
      {name:'Launch fanfare',fromBar:0,toBar:7,tracks:[fn(c=>orchestra(c.time,c.bar,c.step,c.chord,0.72))]},
      {name:'Broadside and belly strike',fromBar:7,toBar:16,tracks:[fn(c=>orchestra(c.time,c.bar,c.step,c.chord,1))]},
      {name:'Eye of the battle',fromBar:16,toBar:19,tracks:[fn(({time,step,chord})=>{if(step===0){inst.string(time,chord.tones[1],0.22);inst.string(time,chord.tones[2],0.16);}if(step===10)inst.player(time,chord.lead[0]-12,0.22);})]},
      {name:'Flagship shields',fromBar:19,toBar:26,tracks:[fn(c=>orchestra(c.time,c.bar,c.step,c.chord,0.85))]},
      {name:'Trench assault',fromBar:26,toBar:30,tracks:[fn(c=>orchestra(c.time,c.bar,c.step,c.chord,1.1))]},
      {name:'Victory',fromBar:30,toBar:32,tracks:[fn(({time,step,bar})=>{
        if(step===0){[50,57,62,66].forEach(n=>inst.string(time,n,0.75));inst.cymbal(time,0.65);}
        if(step%4===0){const melody=[62,66,69,74,73,69,66,62];inst.horn(time,melody[(bar-30)*4+step/4],0.95);}
      })]},
    ]});
  function orchestra(t:number,bar:number,step:number,chord:Chord,energy:number) {
    if(step===0){chord.tones.forEach(n=>inst.string(t,n,0.55*energy));inst.drum(t,chord.root,0.85*energy);}
    if(step===6||step===10||step===14)inst.drum(t,chord.root+(step===14?7:0),energy*(step===14?0.48:0.32));
    if(step%2===0)inst.short(t,chord.tones[(step/2+bar)%3],energy*(step%4===0?0.8:0.46));
    if(step%4===0 && (bar<4||bar>=7)) {
      const degree=THEME[(bar%4)*4+step/4];const scale=[0,2,3,5,7];
      inst.horn(t,chord.root+24+scale[degree],0.68*energy);
      if(bar>=26)inst.horn(t,chord.root+12+scale[degree],0.25*energy);
    }
    if(step===0 && (bar%4===0||bar===7||bar===19||bar===26))inst.cymbal(t,energy);
    if(bar%4===3 && step>=12)inst.drum(t,chord.root,0.15+(step-12)*0.07);
  }
  function schedule({time,step,position,mode}:BeatLevelAudioStep) {
    if(mode==='ambient'){if(step===0){inst.string(time,50,0.23);inst.horn(time,57,0.2);}return;}
    arrangement.schedule(position,time);
  }
  const action=(f:(t:number,p:number)=>void)=>{const c=runtime.context();if(c){const t=score.quantizePlayerAction(c.currentTime);f(t,score.arrangementPositionAt(t));}};
  bus.on('lock',({lockCount})=>action((t,p)=>inst.player(t,score.leadSetAt(p)[Math.min(7,lockCount)],0.42)));
  bus.on('unlock',()=>action((t,p)=>inst.player(t,score.leadSetAt(p)[0]-12,0.23)));
  bus.on('fire',e=>{if((e.indexInVolley??0)===0)action((t,p)=>{inst.boom(t,score.chordAt(p).root,e.volleySize===6?0.95:0.42);inst.player(t,score.leadSetAt(p)[0],0.45);if(e.volleySize===6)runtime.mix()?.duckAt(t,0.65,0.2);});});
  bus.on('hit',e=>{if(!e.lethal)action((t,p)=>{inst.boom(t,score.chordAt(p).root+12,0.27);inst.player(t,score.leadSetAt(p)[Math.min(7,2+e.hitStageIndex)],0.65);});});
  bus.on('kill',()=>{const c=runtime.context();if(c){const k=score.nextKill(c.currentTime);inst.player(k.time,k.midi,0.9);inst.boom(k.time,38,0.28);}});
  bus.on('stage',e=>action((t,p)=>{inst.horn(t,score.leadSetAt(p)[e.stageIndex+2]-12,0.7);inst.boom(t,31,0.8);}));
  bus.on('miss',()=>action((t,p)=>inst.player(t,score.chordAt(p).root+12,0.28)));
  bus.on('reject',()=>action(t=>{inst.boom(t,30,0.4);inst.player(t,49,0.4);inst.player(t+0.08,48,0.4);}));
  bus.on('bossphase',({phase})=>action(t=>{runtime.mix()?.duckAt(t,0.3,0.5);inst.boom(t,26,1.2);inst.cymbal(t,1);if(phase==='destroyed'){won=true;[62,66,69,74].forEach((n,i)=>inst.horn(t+i*TIME.stepSeconds*2,n,0.9));}}));
  bus.on('playerhit',()=>action(t=>{runtime.mix()?.duckAt(t,0.35,0.4);inst.boom(t,23,1);}));
  return runtime;
}
