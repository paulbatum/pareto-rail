import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn } from '../../engine/arrangement';
import { voice, noiseHit } from '../../engine/audio-voices';
import { createScore } from '../../engine/score';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { STRANDLINE_U4WM_BPM as BPM, TIME, DURATION } from './gameplay';

const STEP=TIME.stepSeconds;
const CHORDS=[
  {bass:38,pad:[50,57,60,64],lead:[74,76,77,81,84,86,88,89]},
  {bass:34,pad:[46,53,57,60],lead:[72,74,77,81,84,86,89,93]},
  {bass:41,pad:[53,57,60,64],lead:[72,76,77,81,84,88,89,93]},
  {bass:36,pad:[48,55,62,65],lead:[74,76,79,81,86,88,91,93]},
];
const SERENE={bass:38,pad:[50,57,61,64],lead:[73,76,78,81,85,88,90,93]};
type Section='sleep'|'light'|'bloom'|'crown'|'free';
export function createAudio(bus:EventBus){return makeAudio(bus).audio;}
export const traceStrandlineAudio=createAudioTraceHarness({level:'strandline-u4wm',bpm:BPM,stepSeconds:STEP,defaultSeconds:DURATION,createAudio:makeAudio});
function makeAudio(bus:EventBus,trace?:AudioTraceSink){
  let liberated=false,cleansed=0,parent=-1;
  const score=createScore<typeof SERENE,Section>({bpm:BPM,stepsPerBar:16,chords:CHORDS,barsPerChord:2,
    alternateChordSets:[{fromBar:22,chords:[SERENE]}],
    leadSet:c=>c.lead,
    sections:[{index:'sleep',fromBar:0},{index:'light',fromBar:6},{index:'bloom',fromBar:10},{index:'crown',fromBar:15},{index:'free',fromBar:22}],
    killLanes:{sleep:[0,1,2,4,3,2,1,0,2,3,4,5,4,2,1,0],light:[0,2,3,4,6,5,4,2,1,3,4,5,7,6,4,3],bloom:[0,3,1,4,2,5,3,6,4,7,6,5,4,3,2,1],crown:[7,6,4,5,3,4,2,3,1,2,0,2,3,4,5,7],free:[7,6,5,4,3,2,1,0]},
  });
  const runtime=createBeatLevelAudio({bus,trace,score,stepSeconds:STEP,runAlignment:'step',beatNumber:'position',volumeScale:.8,
    mix:{compressor:{threshold:-20,ratio:3.5,attack:.015,release:.35},delay:{time:STEP*3,feedback:.29,dampHz:3200},reverb:{seconds:3.6,decay:2.6,level:.34},noiseSeconds:2},
    onBeforeBeat({step,bar,time,mode}){if(mode==='run'&&step===0)arrangement.recordSectionStart(time,bar);},
    onStep:schedule,
    onRunStart(){liberated=false;cleansed=0;parent=-1;score.clearOverride();},
  });
  const bell=voice({oscillators:[{type:'sine'},{type:'sine',octave:1,gain:.2},{type:'triangle',gain:.12}],duration:.85,filter:{type:'lowpass',frequency:4800},envelope:{attack:.006,decay:.83,peak:.15}});
  const pluck=voice({oscillators:[{type:'sine'},{type:'triangle',gain:.2}],duration:.16,envelope:{attack:.004,decay:.15,peak:.065}});
  const pulse=voice({oscillators:[{type:'sine'}],duration:.75,envelope:{attack:.016,decay:.72,peak:.19}});
  const air=noiseHit({filterType:'bandpass',frequency:2200,decay:.15});
  const inst=defineInstruments({trace,context:runtime.context},{
    pulse(ctx,time,midi,velocity=1){const destination=runtime.mix()?.master;if(destination)pulse.play({context:ctx,time,midi,velocity,destination});},
    bell(ctx,time,midi,velocity=1,player=false){const mix=runtime.mix();const destination=player?mix?.sfx:mix?.master;if(!destination)return;bell.play({context:ctx,time,midi,velocity,destination,sends:mix?.reverbSend?[{destination:mix.reverbSend,gain:.3}]:[]});},
    lock(ctx,time,midi,velocity=1){const destination=runtime.mix()?.sfx;if(destination)pluck.play({context:ctx,time,midi,velocity,destination});},
    air(ctx,time,velocity=.06){const mix=runtime.mix();if(mix?.noiseBuffer&&mix.master)air.play({context:ctx,buffer:mix.noiseBuffer,time,velocity,destination:mix.master});},
    pad(ctx,time,notes:readonly number[],gain=.04,duration=5){const mix=runtime.mix();if(!mix?.master)return;for(const note of notes){const osc=ctx.createOscillator(),env=ctx.createGain();osc.type='sine';osc.frequency.value=midiToFreq(note);env.gain.setValueAtTime(.0001,time);env.gain.linearRampToValueAtTime(gain,time+.7);env.gain.exponentialRampToValueAtTime(.0001,time+duration);osc.connect(env).connect(mix.master);if(mix.reverbSend)env.connect(mix.reverbSend);osc.start(time);osc.stop(time+duration+.05);}},
  });
  const arrangement=createArrangement<typeof SERENE>({stepsPerBar:16,chordAt:score.chordAt,trace,emitSections:true,sections:[
    {name:'Suspended',fromBar:0,toBar:6,tracks:[fn(({time,step,bar,chord})=>{if(step===0&&bar%2===0)inst.pad(time,chord.pad,.033,5.3);if(step===0)inst.pulse(time,chord.bass,.75);if(bar>=2&&step===10)inst.pulse(time,chord.bass+12,.24);})]},
    {name:'Sunward',fromBar:6,toBar:10,tracks:[fn(({time,step,bar,chord})=>{if(step===0&&bar%2===0)inst.pad(time,chord.pad,.042,5.5);if(step===0||step===8)inst.pulse(time,chord.bass,.65);if(step===6||step===14)inst.bell(time,chord.pad[(bar+step/2)%4]+12,.23);if(step===12)inst.air(time,.025);})]},
    {name:'Living current',fromBar:10,toBar:15,tracks:[fn(({time,step,bar,chord})=>{if(step===0&&bar%2===0)inst.pad(time,chord.pad,.045,5.1);if(step%8===0)inst.pulse(time,chord.bass,.75);if(step%4===2)inst.bell(time,chord.pad[(step/4|0)%4]+12,.22+cleansed*.05);if(step===4||step===12)inst.air(time,.04);})]},
    {name:'The crown',fromBar:15,toBar:22,tracks:[fn(({time,step,bar,chord})=>{if(liberated){if(step===0&&bar%2===0)inst.pad(time,SERENE.pad,.045,6);return;}if(step%8===0)inst.pulse(time,chord.bass-12,.8);if(step===0&&bar%2===1)inst.pad(time,chord.pad,.033,5);if(step%4===2)inst.air(time,.025);if(step===14)inst.bell(time,chord.pad[2],.25);})]},
    {name:'Drift',fromBar:22,toBar:24,tracks:[fn(({time,step,bar})=>{if(step===0)inst.pad(time,liberated?SERENE.pad:CHORDS[0].pad,.042,6);if(step===0&&bar===22)inst.bell(time,liberated?85:84,.32);})]},
  ]});
  function schedule({position,time,mode}:BeatLevelAudioStep){if(mode==='run')arrangement.schedule(position,time);else if(position%32===0)inst.pad(time,[50,57,64],.025,6);}
  function action(){const ctx=runtime.context();if(!ctx)return;const time=score.quantizePlayerAction(ctx.currentTime);return{time,chord:score.chordAt(score.arrangementPositionAt(time))};}
  bus.on('lock',e=>{const a=action();if(a)inst.lock(a.time,a.chord.lead[(e.lockCount-1)%8],.7+e.lockCount*.045);});
  bus.on('unlock',()=>{const a=action();if(a)inst.lock(a.time,a.chord.pad[2],.45);});
  bus.on('fire',e=>{const a=action();if(!a)return;inst.lock(a.time,a.chord.pad[(e.indexInVolley??0)%4]+12,.75);if((e.indexInVolley??0)===0)inst.pulse(a.time,a.chord.bass+12,e.volleySize>=6?1:.45);});
  bus.on('spawn',e=>{if(e.kind==='parent')parent=e.enemyId;});
  bus.on('hit',e=>{if(e.lethal)return;const a=action();if(a){const progress=e.enemyId===parent?(6-e.hitPointsRemaining)/6:.1;inst.bell(a.time,a.chord.lead[Math.min(7,Math.floor(progress*7))],.4+progress*.35,true);}});
  bus.on('kill',e=>{if(e.letter)return;cleansed+=.018;const ctx=runtime.context();if(!ctx)return;const note=score.nextKill(ctx.currentTime);inst.bell(note.time,note.midi,.82,true);if(e.enemyId===parent){liberated=true;score.overrideSection('free');inst.pad(note.time+.3,[50,57,61,64,69],.055,9);[74,78,81,85].forEach((n,i)=>inst.bell(note.time+.3+i*STEP*2,n,.55,true));}});
  bus.on('miss',()=>{const a=action();if(a)inst.lock(a.time,a.chord.bass+12,.6);});
  bus.on('reject',()=>{const a=action();if(a){inst.lock(a.time,46,.8);inst.lock(a.time+.09,45,.7);}});
  return runtime;
}
