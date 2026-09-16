import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, playNoiseHit, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, type ArrangementTrack } from '../../engine/arrangement';
import { createScore } from '../../engine/score';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { TINKER_BALL_X9A0_BPM as BPM, TIME, DURATION } from './gameplay';

const CHORDS = [
  {bass:48,arp:[72,76,79,83]}, // C major 7
  {bass:45,arp:[72,76,79,81]}, // A minor 7
  {bass:41,arp:[72,77,79,81]}, // F add 9
  {bass:43,arp:[71,74,79,81]}, // G add 9
];
type Chord=typeof CHORDS[number];
const LANES={
  marble:[0,1,2,1,3,2,1,0,1,2,3,4,3,2,1,2],
  tumble:[0,4,1,5,2,6,3,7,6,3,5,2,4,1,3,0],
  spill:[0,1,2,3,4,5,6,7,7,6,5,4,3,2,1,0],
  clean:[4,3,2,1,0,1,2,3,4,3,2,1,0,0,0,0],
};
const mallet=voice({oscillators:[{type:'sine',gain:1},{type:'sine',frequencyRatio:2.76,gain:0.16}],duration:0.28,envelope:{attack:0.002,decay:0.26},stopPadding:0.03});
const reed=voice({oscillators:[{type:'square',gain:0.6},{type:'triangle',octave:1,gain:0.2}],filter:{type:'lowpass',cutoff:1800},duration:0.11,envelope:{attack:0.007,decay:0.1},stopPadding:0.02});
const bassVoice=voice({oscillators:[{type:'triangle'},{type:'sine',octave:-1,gain:0.4}],filter:{type:'lowpass',cutoff:700},duration:0.2,envelope:{attack:0.004,decay:0.19},stopPadding:0.02});
const click=voice({oscillators:[{type:'sine'},{type:'triangle',frequencyRatio:1.49,gain:0.2}],duration:0.045,envelope:{decay:0.04},stopPadding:0.01});
const kickVoice=voice({oscillators:[{type:'sine'}],duration:0.14,envelope:{decay:0.13},frequencyAutomation:(t,f)=>[{type:'set',value:f*2.5,time:t},{type:'exponentialRamp',value:f,time:t+0.09}],stopPadding:0.02});

export function createAudio(bus:EventBus) {return buildAudio(bus).audio;}
export const traceTinkerBallAudio=createAudioTraceHarness({level:'tinker-ball-x9a0',bpm:BPM,stepSeconds:TIME.stepSeconds,defaultSeconds:DURATION,createAudio:buildAudio});
function buildAudio(bus:EventBus,trace?:AudioTraceSink) {
  const score=createScore({bpm:BPM,stepsPerBar:16,chords:CHORDS,barsPerChord:2,
    sections:[{index:'marble',fromBar:0},{index:'tumble',fromBar:8},{index:'spill',fromBar:22},{index:'clean',fromBar:28}],killLanes:LANES});
  const runtime=createBeatLevelAudio({bus,trace,bpm:BPM,stepSeconds:TIME.stepSeconds,stepsPerBar:16,score,runAlignment:'step',beatNumber:'position',volumeScale:0.8,
    mix:{compressor:{threshold:-19,ratio:3,attack:0.004,release:0.16},delay:{time:TIME.stepSeconds*3,feedback:0.18,dampHz:3200,sendGain:0.12},noiseSeconds:1},
    onStep:({mode,position,step,time}:BeatLevelAudioStep)=>{
      if(mode==='run'){arrangement.recordSectionStart(time,Math.floor(position/16));arrangement.schedule(position,time);}
      else if(step===0||step===10)instruments.bell(time,CHORDS[0].arp[step===0?0:2]-12,0.035,false);
    },
    onRunEnd:()=>{
      const ctx=runtime.context();if(ctx)for(let i=0;i<4;i++)instruments.bell(ctx.currentTime+i*TIME.stepSeconds,[72,76,79,84][i],0.07,true);
    },
    onDispose:()=>off.forEach(f=>f()),
  });
  const instruments=defineInstruments({trace,context:runtime.context},{
    bell(ctx,time,midi:number,gain:number,player:boolean){const mix=runtime.mix();if(!mix)return;mallet.play({context:ctx,time,midi,gain,destination:player?mix.sfx:mix.music,sends:mix.delaySend?[{destination:mix.delaySend,gain:0.2}]:[]});},
    organ(ctx,time,notes:number[],gain:number){const mix=runtime.mix();if(!mix)return;for(const midi of notes)reed.play({context:ctx,time,midi,gain,destination:mix.music});},
    bass(ctx,time,midi:number,gain:number){const mix=runtime.mix();if(mix)bassVoice.play({context:ctx,time,midi,gain,destination:mix.music});},
    tap(ctx,time,midi:number,gain:number,player=false){const mix=runtime.mix();if(mix)click.play({context:ctx,time,midi,gain,destination:player?mix.sfx:mix.music});},
    kick(ctx,time,gain:number){const mix=runtime.mix();if(mix)kickVoice.play({context:ctx,time,frequency:58,gain,destination:mix.music});},
    clap(ctx,time,gain:number){const mix=runtime.mix();if(!mix?.noiseBuffer)return;for(let i=0;i<3;i++)playNoiseHit({context:ctx,buffer:mix.noiseBuffer,time:time+i*0.012,velocity:gain*(1-i*0.18),decay:0.065,filterType:'bandpass',frequency:1700+i*350,destination:mix.music});},
    scrape(ctx,time,gain:number){const mix=runtime.mix();if(!mix?.noiseBuffer)return;playNoiseHit({context:ctx,buffer:mix.noiseBuffer,time,velocity:gain,decay:0.11,filterType:'highpass',frequency:2800,destination:mix.sfx});},
  });
  function tracks(act:number):ArrangementTrack<Chord>[] {
    return [
      hits<Chord>(act===3?'x.......x.......':act===0?'x.......x..x....':'x.....x.x..x..x.',{x:0.17},(c,v)=>instruments.kick(c.time,v)),
      hits<Chord>(act===0?'....x.......x...':act===3?'............x...':'....x.......x..x',{x:0.055},(c,v)=>instruments.clap(c.time,v)),
      hits<Chord>(act===0?'..x...x...x...x.':act===3?'..x.......x.....':'..x.x.x...x.x.xx',{x:0.035},(c,v)=>instruments.tap(c.time,act===2?91:86,v)),
      fn<Chord>(c=>{
        const bassSteps=act===3?[0,8]:[0,3,6,8,11,14];
        if(bassSteps.includes(c.step))instruments.bass(c.time,c.chord.bass-12+(c.step===6||c.step===14?12:0),0.14);
        if([2,7,10,15].includes(c.step)&&act!==3)instruments.organ(c.time,c.chord.arp.slice(0,3).map(n=>n-24),act===2?0.022:0.018);
        if((act===0&&[0,6,10].includes(c.step))||(act===1&&[1,7,11].includes(c.step))||(act===2&&c.step===0)||act===3&&[0,4,8,12].includes(c.step)) {
          const motif=[0,2,1,3,2,1,0,2];const n=motif[(c.barInSection*3+Math.floor(c.step/4))%8];
          instruments.bell(c.time,c.chord.arp[n]-12,0.05,false);
        }
        if(act===2&&c.barInSection%2===1&&c.step>=12)instruments.tap(c.time,79+c.step,0.05);
      }),
    ];
  }
  const arrangement=createArrangement({stepsPerBar:16,chordAt:score.chordAt,trace,emitSections:true,sections:[
    {fromBar:0,name:'Marble / button dance',tracks:tracks(0)},
    {fromBar:8,name:'Tennis ball / peg-bird chorus',tracks:tracks(1)},
    {fromBar:22,name:'Melon / recycled glue shells',tracks:tracks(2)},
    {fromBar:28,name:'Clean tabletop / cadence',tracks:tracks(3)},
  ]});
  function action(){const ctx=runtime.context();if(!ctx)return null;const time=score.quantizePlayerAction(ctx.currentTime);const position=score.arrangementPositionAt(time);return {time,position,chord:score.chordAt(position)};}
  const off=[
    bus.on('lock',e=>{const a=action();if(a)instruments.tap(a.time,a.chord.arp[(e.lockCount-1)%4]+12,0.07,true);}),
    bus.on('unlock',()=>{const a=action();if(a)instruments.tap(a.time,a.chord.arp[0],0.035,true);}),
    bus.on('fire',e=>{const a=action();if(a){instruments.tap(a.time,a.chord.arp[(e.indexInVolley??0)%4]-12,0.09,true);if(e.volleySize===6&&(e.indexInVolley??0)===0){runtime.mix()?.duckAt(a.time,0.5,0.2);instruments.clap(a.time,0.065);}}}),
    bus.on('hit',e=>{if(e.lethal)return;const a=action();if(a){instruments.bell(a.time,a.chord.arp[e.hitStageIndex%4]+e.hitStageIndex*12,0.07+e.hitStageIndex*0.02,true);instruments.scrape(a.time,0.035);}}),
    bus.on('kill',e=>{const ctx=runtime.context();if(!ctx)return;const note=score.nextKill(ctx.currentTime);instruments.bell(note.time,note.midi,e.letter?0.06:0.11,true);instruments.scrape(note.time,0.025);}),
    bus.on('stage',()=>{const a=action();if(a){runtime.mix()?.duckAt(a.time,0.65,0.25);for(let i=0;i<3;i++)instruments.bell(a.time+i*TIME.stepSeconds,a.chord.arp[i]+12,0.08,true);}}),
    bus.on('miss',()=>{const a=action();if(a)instruments.tap(a.time,a.chord.bass,0.05,true);}),
    bus.on('reject',()=>{const a=action();if(a){instruments.scrape(a.time,0.09);instruments.tap(a.time,48,0.08,true);instruments.tap(a.time+0.09,43,0.07,true);}}),
  ];
  return runtime;
}
