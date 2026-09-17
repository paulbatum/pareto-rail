import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createScore } from '../../engine/score';
import { createArrangement, fn, hits } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { SPEEDSOLVE_28FR_BPM, TIME } from './gameplay';

const CHORDS=[{bass:36,arp:[72,76,79,83]},{bass:33,arp:[69,72,76,79]},{bass:29,arp:[69,72,77,81]},{bass:31,arp:[71,74,79,81]}];
const SECTIONS=[0,4,8,12,16,20,24,28].map((fromBar,index)=>({fromBar,index}));
const LANES=Object.fromEntries(SECTIONS.map(({index})=>[index,[0,1,2,4,3,2,1,3,4,5,3,2,6,5,4,7]]));
const clickVoice=voice({oscillators:[{type:'triangle',gain:.75},{type:'sine',frequencyRatio:3.01,gain:.16}],duration:.065,envelope:{decay:.058}});
const bassVoice=voice({oscillators:[{type:'sine'},{type:'triangle',gain:.18}],duration:.19,envelope:{attack:.002,decay:.18},filter:{type:'lowpass',cutoff:780}});
const snapVoice=voice({oscillators:[{type:'square',gain:.17},{type:'sine',frequencyRatio:1.49,gain:.25}],duration:.035,envelope:{decay:.028},filter:{type:'bandpass',cutoff:2400,Q:1}});
const bellVoice=voice({oscillators:[{type:'sine'},{type:'sine',frequencyRatio:2,gain:.16}],duration:.25,envelope:{decay:.24}});
const kickVoice=voice({oscillators:[{type:'sine'}],duration:.14,envelope:{decay:.13},frequencyAutomation:(t,f)=>[{type:'set',time:t,value:f*2.8},{type:'exponentialRamp',time:t+.035,value:f}]});
export function createAudio(bus:EventBus){return buildAudio(bus).audio;}
export const traceSpeedsolveAudio=createAudioTraceHarness({level:'speedsolve-28fr',bpm:SPEEDSOLVE_28FR_BPM,stepSeconds:TIME.stepSeconds,defaultSeconds:60,createAudio:buildAudio});
function buildAudio(bus:EventBus,trace?:AudioTraceSink){
  let conquered=0, resolved=false;const kinds=new Map<number,string>();
  const score=createScore({bpm:SPEEDSOLVE_28FR_BPM,stepsPerBar:16,chords:CHORDS,barsPerChord:4,sections:SECTIONS,killLanes:LANES});
  const runtime=createBeatLevelAudio({bus,trace,bpm:SPEEDSOLVE_28FR_BPM,stepSeconds:TIME.stepSeconds,stepsPerBar:16,score,runAlignment:'step',beatNumber:'position',volumeScale:.75,
    mix:{compressor:{threshold:-18,ratio:4,attack:.003,release:.12},delay:{time:.1875,feedback:.13,dampHz:2400}},
    onStep({position,time,mode}){if(mode==='run'){arrangement.schedule(position,time);if(position%16===0)arrangement.recordSectionStart(time,Math.floor(position/16));}else if(position%8===0)instruments.click(time,72+(position%16===0?0:7),.035,false);},
    onRunStart(){conquered=0;resolved=false;kinds.clear();},
    onDispose(){off.forEach(f=>f());},
  });
  const instruments=defineInstruments({context:runtime.context,trace},{
    click(ctx:AudioContext,t:number,midi:number,gain:number,player:boolean){const mix=runtime.mix();if(mix)clickVoice.play({context:ctx,time:t,midi,gain,destination:player?mix.sfx:mix.music});},
    bass(ctx:AudioContext,t:number,midi:number,gain:number){const mix=runtime.mix();if(mix)bassVoice.play({context:ctx,time:t,midi,gain,destination:mix.music});},
    snap(ctx:AudioContext,t:number,midi:number,gain:number,player:boolean){const mix=runtime.mix();if(mix)snapVoice.play({context:ctx,time:t,midi,gain,destination:player?mix.sfx:mix.music});},
    bell(ctx:AudioContext,t:number,midi:number,gain:number,player:boolean){const mix=runtime.mix();if(mix)bellVoice.play({context:ctx,time:t,midi,gain,destination:player?mix.sfx:mix.music});},
    kick(ctx:AudioContext,t:number,gain:number){const mix=runtime.mix();if(mix)kickVoice.play({context:ctx,time:t,frequency:52,gain,destination:mix.music});},
  });
  const arrangement=createArrangement({stepsPerBar:16,chordAt:score.chordAt,trace,emitSections:true,sections:SECTIONS.map(({fromBar,index})=>({fromBar,toBar:index===7?30:undefined,name:['Scramble / ratchet','Blue / bass','Orange / rim','Green / counterweight','Yellow / escapement','White / clockwork','Naked core','Resolution'][index],tracks:[
    hits<typeof CHORDS[number]>('x...x...x...x...', {x:1},({time,step,chord},v)=>{if(resolved)return;instruments.click(time,chord.arp[0]-24,step===0?.13:.085,false);if(index>0)instruments.kick(time,v*.19);}),
    fn<typeof CHORDS[number]>(({time,step,chord,bar})=>{
      if(resolved){if(step===0)for(const n of [48,60,64,67,72])instruments.bell(time,n,.045,false);return;}
      const layers=Math.max(index,conquered);
      if(layers>=1&&[0,6,10].includes(step))instruments.bass(time,chord.bass+(step===10?7:0),.2);
      if(layers>=2&&[4,12].includes(step))instruments.snap(time,60,.18,false);
      if(layers>=3&&step%4===2)instruments.click(time,79,.038,false);
      if(layers>=4&&[3,7,11,15].includes(step))instruments.snap(time,84,.07,false);
      if(layers>=5&&[2,9,14].includes(step))instruments.bell(time,chord.arp[(step+bar)%4]-12,.042,false);
      if(index===6&&step%2===0)instruments.click(time,48+(step%8)*2,.065,false);
      if(step>=14&&bar%4===3)instruments.snap(time,72+step,.12,false);
    }),
  ]}))});
  function action(){const ctx=runtime.context();if(!ctx)return null;const time=score.quantizePlayerAction(ctx.currentTime);return {time,chord:score.chordAt(score.arrangementPositionAt(time))};}
  const off=[
    bus.on('spawn',e=>kinds.set(e.enemyId,e.kind)),
    bus.on('lock',({lockCount})=>{const a=action();if(a)instruments.click(a.time,a.chord.arp[(lockCount-1)%4],.075,true);}),
    bus.on('unlock',()=>{const a=action();if(a)instruments.click(a.time,a.chord.arp[0]-12,.045,true);}),
    bus.on('fire',({indexInVolley,volleySize})=>{const a=action();if(a)instruments.snap(a.time,a.chord.arp[(indexInVolley??0)%4]-12,volleySize===6?.2:.13,true);}),
    bus.on('hit',({enemyId,lethal,hitPointsRemaining})=>{if(lethal)return;const a=action();if(a){instruments.bell(a.time,a.chord.arp[0]+(kinds.get(enemyId)==='core'?12:0),.08+(18-Math.min(18,hitPointsRemaining))*.003,true);}}),
    bus.on('kill',({enemyId})=>{const ctx=runtime.context();if(!ctx)return;const note=score.nextKill(ctx.currentTime);instruments.bell(note.time,note.midi,.14,true);if(kinds.get(enemyId)==='tile')instruments.snap(score.nextGridTime(ctx.currentTime,4),48,.35,true);if(kinds.get(enemyId)==='weakpoint')conquered++;if(kinds.get(enemyId)==='core'){resolved=true;const t=score.nextGridTime(ctx.currentTime,4);runtime.mix()?.duckAt(t,.25,.7);[60,64,67,72,76,79,84].forEach((n,i)=>instruments.bell(t+i*.125,n,.14,true));}kinds.delete(enemyId);}),
    bus.on('bossphase',({phase})=>{if(phase==='exposed'){const a=action();if(a)[0,4,7].forEach((n,i)=>instruments.click(a.time+i*.125,60+n,.16,true));}}),
    bus.on('reject',()=>{const a=action();if(a){instruments.snap(a.time,42,.35,true);instruments.snap(a.time+.0625,41,.2,true);}}),
    bus.on('miss',({enemyId})=>{kinds.delete(enemyId);const a=action();if(a)instruments.click(a.time,a.chord.bass+12,.04,true);}),
    bus.on('playerhit',()=>{const a=action();if(a){instruments.snap(a.time,38,.4,true);instruments.kick(a.time,.2);}}),
  ];
  return runtime;
}
