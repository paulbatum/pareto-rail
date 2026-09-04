import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioRuntime } from '../../engine/audio-kit';
import { voice, noiseHit } from '../../engine/audio-voices';
import { createScore } from '../../engine/score';
import { createArrangement, fn } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { BPM, TIME, DURATION } from './gameplay';
const CHORDS=[{bass:38,pad:[50,53,57],arp:[74,77,81,86]},{bass:34,pad:[46,50,53],arp:[74,77,82,86]},{bass:41,pad:[53,57,60],arp:[72,77,81,84]},{bass:36,pad:[48,52,55],arp:[72,76,79,84]}];
const SECTIONS=[{index:0,fromBar:0},{index:1,fromBar:4},{index:2,fromBar:8},{index:3,fromBar:12},{index:4,fromBar:16},{index:5,fromBar:18},{index:6,fromBar:22},{index:7,fromBar:25},{index:8,fromBar:30}];
const LANES=Object.fromEntries(SECTIONS.map(s=>[s.index,s.index===4?[0,0,1,1,2,2,1,0]:s.index>=5?[0,2,1,3,2,4,3,5,4,6,5,7,6,4,3,2]:[0,1,2,3,2,1,2,4,3,2,1,0,1,2,3,4]]));
const horn=voice<{length:number}>({oscillators:[{type:'sawtooth',gain:.55},{type:'square',gain:.12},{type:'sine',gain:.35}],duration:c=>c.length,filter:{type:'lowpass',frequencyAutomation:(t,c)=>[{type:'set',value:480,time:t},{type:'linearRamp',value:2200,time:t+.07},{type:'exponentialRamp',value:650,time:t+c.length}]},envelope:{attack:.05,decay:.15,sustain:.65,release:.16}});
const strings=voice<{length:number}>({oscillators:[{type:'sawtooth',detune:-8,gain:.45},{type:'sawtooth',detune:8,gain:.45}],duration:c=>c.length,filter:{type:'lowpass',cutoff:2100},envelope:{attack:.035,decay:.1,sustain:.55,release:.09}});
const timpani=voice({oscillators:[{type:'sine'},{type:'triangle',gain:.12}],duration:.65,frequencyAutomation:(t,f)=>[{type:'set',value:f*1.7,time:t},{type:'exponentialRamp',value:f,time:t+.04}],envelope:{attack:.002,decay:.58}});
const celesta=voice({oscillators:[{type:'sine'},{type:'triangle',gain:.18,octave:1}],duration:.6,envelope:{attack:.002,decay:.5}});
const noise=noiseHit({filterType:'highpass',frequency:4200,decay:.4});
export function createAudio(bus:EventBus){return buildAudio(bus).audio;}
export const traceBroadsideAudio=createAudioTraceHarness({level:'broadside-e230',bpm:BPM,stepSeconds:TIME.stepSeconds,defaultSeconds:DURATION,createAudio:buildAudio});
function buildAudio(bus:EventBus,trace?:AudioTraceSink) {
  const score=createScore({bpm:BPM,stepsPerBar:16,chords:CHORDS,barsPerChord:2,sections:SECTIONS,killLanes:LANES,
    alternateChordSets:[{fromBar:30,chords:[{bass:38,pad:[50,54,57],arp:[74,78,81,86]}]}]});
  let runtime:BeatLevelAudioRuntime;
  let won=false;
  const instruments=defineInstruments({trace,context:()=>runtime?.context()??null},{
    brass(ctx,t,midi:number,gain:number,length:number){const m=runtime.mix();if(m)horn.play({context:ctx,time:t,midi,gain,length,destination:m.music,sends:m.delaySend?[{destination:m.delaySend,gain:.18}]:[]});},
    strings(ctx,t,midi:number,gain:number,length:number){const m=runtime.mix();if(m)strings.play({context:ctx,time:t,midi,gain,length,destination:m.music});},
    timpani(ctx,t,midi:number,gain:number){const m=runtime.mix();if(m)timpani.play({context:ctx,time:t,midi,gain,destination:m.music});},
    cymbal(ctx,t,gain:number){const m=runtime.mix();if(m?.noiseBuffer)noise.play({context:ctx,time:t,buffer:m.noiseBuffer,velocity:gain,destination:m.music});},
    player(ctx,t,midi:number,gain:number){const m=runtime.mix();if(m)celesta.play({context:ctx,time:t,midi,gain,destination:m.sfx,sends:m.delaySend?[{destination:m.delaySend,gain:.2}]:[]});},
    impact(ctx,t,midi:number,gain:number){const m=runtime.mix();if(m)timpani.play({context:ctx,time:t,midi,gain,destination:m.sfx});},
  });
  const names=['CAST OFF','FLEET ENGAGEMENT','BROADSIDE','UNDER THE GUNS','THE EYE','SHIELD ARRAY','ESCORT SWARM','INTO THE TRENCH','VICTORY'];
  const arrangement=createArrangement({stepsPerBar:16,chordAt:score.chordAt,trace,emitSections:true,sections:SECTIONS.map((s,i)=>({name:names[i],fromBar:s.fromBar,tracks:[fn<typeof CHORDS[number]>(({time,step,chord,bar,position})=>{
    const quiet=i===4,final=i===8;
    if(final&&!won)return;
    const strength=quiet?.12:final?.8:i===0?.55:i>=5?1:.85;
    if(step===0){for(const note of chord.pad)instruments.strings(time,note,.035*strength,quiet?2.8:1.8);if(!quiet)instruments.timpani(time,chord.bass,.22*strength);}
    if(!quiet&&!final&&step%2===0){const note=chord.pad[(step/2+(bar%2)*2)%3];instruments.strings(time,note,.038*strength,TIME.stepSeconds*1.7);}
    if(!quiet&&(step===0||step===6||step===10)){
      const motif=[0,2,1,2,0,1,2,1];const note=chord.pad[motif[Math.floor(position/4)%8]];
      instruments.brass(time,note,.05*strength,step===0?.52:.3);instruments.brass(time,note-12,.03*strength,.42);
    }
    if(!quiet&&(step===8||i>=5&&step===14))instruments.timpani(time,chord.bass+7,.14*strength);
    if(step===0&&bar%4===0&&!quiet)instruments.cymbal(time,.13);
    if(final&&step%4===0)instruments.brass(time,[62,66,69,74][step/4],.075,.72);
  })]}))});
  runtime=createBeatLevelAudio({bus,trace,score,bpm:BPM,stepSeconds:TIME.stepSeconds,runAlignment:'step',volumeScale:.8,
    mix:{compressor:{threshold:-17,ratio:4,attack:.008,release:.22},delay:{time:TIME.stepSeconds*3,feedback:.26,dampHz:2800},noiseSeconds:2},
    onRunStart(){won=false;},onStep(s){if(s.mode==='run'){if(s.step===0)arrangement.recordSectionStart(s.time,s.bar);arrangement.schedule(s.position,s.time);}else if(s.step===0)for(const n of CHORDS[0].pad)instruments.strings(s.time,n,.009,3.5);},
    onDispose(){subscriptions.forEach(f=>f());},
  });
  const action=()=>{const ctx=runtime.context();if(!ctx)return null;const t=score.quantizePlayerAction(ctx.currentTime);return {t,chord:score.chordAt(score.arrangementPositionAt(t))};};
  const subscriptions=[bus.on('lock',e=>{const a=action();if(a)instruments.player(a.t,a.chord.arp[(e.lockCount-1)%4],.06);}),
    bus.on('fire',e=>{const a=action();if(a){instruments.player(a.t,a.chord.pad[e.indexInVolley!%3||0]+12,.045);if(e.indexInVolley===0)instruments.impact(a.t,a.chord.bass,.14+(e.volleySize===6?.1:0));}}),
    bus.on('hit',e=>{const a=action();if(a&&!e.lethal)instruments.player(a.t,a.chord.arp[e.hitPointsRemaining%4],.1+(4-e.hitPointsRemaining)*.015);}),
    bus.on('kill',()=>{const ctx=runtime.context();if(ctx){const n=score.nextKill(ctx.currentTime);instruments.player(n.time,n.midi,.15);}}),
    bus.on('reject',()=>{const a=action();if(a){instruments.impact(a.t,33,.14);instruments.player(a.t+.06,46,.05);}}),
    bus.on('miss',()=>{const a=action();if(a)instruments.impact(a.t,38,.045);}),
    bus.on('bossphase',e=>{const a=action();if(e.phase==='destroyed')won=true;if(a&&e.phase!=='summoned'){runtime.mix()?.duckAt(a.t,.22,.6);for(let i=0;i<4;i++)instruments.player(a.t+i*TIME.stepSeconds,[74,78,81,86][i],.17);instruments.impact(a.t,26,.3);}}),
  ];
  return runtime;
}
