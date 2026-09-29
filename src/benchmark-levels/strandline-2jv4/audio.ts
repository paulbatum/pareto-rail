import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { createScore, blendNumber } from '../../engine/score';
import { createArrangement, fn, hits } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { STRANDLINE_2JV4_BPM, TIME, DURATION } from './gameplay';
import { makeVoices } from './audio-voices';
// D Dorian opens into suspended major colors, keeping the player's bell register free.
const CHORDS=[
  {bass:38,pad:[50,57,60,64],arp:[74,77,81,84]},
  {bass:43,pad:[55,59,62,64],arp:[74,79,81,83]},
  {bass:41,pad:[53,57,60,64],arp:[72,76,77,81]},
  {bass:36,pad:[48,55,59,62],arp:[72,74,79,83]},
];
type Chord=typeof CHORDS[number];type Act=0|1|2|3|4;
const SCORE_SECTIONS=[{index:0 as Act,fromBar:0},{index:1 as Act,fromBar:4,crossfadeBars:2},{index:2 as Act,fromBar:8,crossfadeBars:1},{index:3 as Act,fromBar:16},{index:4 as Act,fromBar:22}];
const LANES:Record<Act,number[]>={0:[0,1,2,1,0,2,3,2,4,3,2,1,2,3,4,2],1:[0,2,1,3,2,4,3,5,4,2,3,5,6,5,3,2],2:[0,1,3,2,4,5,3,2,4,6,5,4,3,2,1,3],3:[0,4,1,5,2,6,3,7,7,6,5,4,3,2,1,0],4:[0,1,2,3,4,3,2,1,0,2,3,4,5,4,3,2]};
export function createAudio(bus:EventBus){return makeAudio(bus).audio;}
export const traceStrandlineAudio=createAudioTraceHarness({level:'strandline-2jv4',bpm:STRANDLINE_2JV4_BPM,stepSeconds:TIME.stepSeconds,defaultSeconds:DURATION,createAudio:makeAudio});
function makeAudio(bus:EventBus,trace?:AudioTraceSink) {
  let victory=false,parent=-1,recovered=0;
  const score=createScore<Chord,Act>({bpm:STRANDLINE_2JV4_BPM,stepsPerBar:16,chords:CHORDS,barsPerChord:2,sections:SCORE_SECTIONS,killLanes:LANES,
    alternateChordSets:[{fromBar:22,chords:[{bass:38,pad:[50,57,61,64],arp:[74,78,81,85]}]}]});
  const runtime=createBeatLevelAudio({bus,trace,score,bpm:STRANDLINE_2JV4_BPM,stepSeconds:TIME.stepSeconds,stepsPerBar:16,runAlignment:'step',beatNumber:'position',volumeScale:.8,
    mix:{compressor:{threshold:-19,ratio:3,attack:.015,release:.3},delay:{time:TIME.stepSeconds*3,feedback:.28,dampHz:3800},reverb:{seconds:2.8,decay:2.4,level:.18},noiseSeconds:2},
    onStep(s){if(s.mode==='ambient'){if(s.step===0)voices.pad(s.time,CHORDS[0].pad,.018);if(s.step===8)voices.bell(s.time,62,.028);return;}
      arrangement.schedule(s.position,s.time);if(s.step===0)arrangement.recordSectionStart(s.time,s.bar);},
    onRunStart(){victory=false;parent=-1;recovered=0;score.clearOverride();},
  });
  const voices=makeVoices({context:runtime.context,mix:runtime.mix,trace});
  const padTrack=fn<Chord>(c=>{if(c.step===0)voices.pad(c.time,c.chord.pad,.025);});
  const slowPulse=hits<Chord>('x.......x.......',{x:.18},(c,v)=>voices.pulse(c.time,v));
  const warmBass=hits<Chord>('x.....x...x.....',{x:.12},(c,v)=>voices.bass(c.time,c.chord.bass,v));
  const livingPad=fn<Chord>(c=>{if(c.step===0)voices.pad(c.time,c.chord.pad,.032);});
  const brightCurrent=fn<Chord>(c=>{if(victory)return;if(c.step%4===2 || recovered>26 && c.step%8===0)voices.bell(c.time,c.chord.pad[(c.step/2|0)%4]+12,.026+.032*Math.min(1,recovered/36));});
  const flowingPulse=hits<Chord>('x...o...x...o...',{x:.22,o:.10},(c,v)=>{if(!victory)voices.pulse(c.time,v);});
  const tide=hits<Chord>('..x...x...x..x..',{x:.024},(c,v)=>{if(!victory)voices.breath(c.time,v,4100);});
  const crown=fn<Chord>(c=>{if(c.step===0){voices.pad(c.time,victory?[50,57,61,64]:[50,57,60,64],.028);voices.bass(c.time,38,.15);}
    if(!victory&&[0,3,8,11].includes(c.step))voices.pulse(c.time,.25);
    if(!victory&&c.step%4===2)voices.bell(c.time,c.chord.pad[c.step%3]-12,.055);});
  const serene=fn<Chord>(c=>{if(c.step===0)voices.pad(c.time,[50,57,61,64],.028);if(c.step===0||c.step===10)voices.bell(c.time,c.step===0?69:74,.05);});
  const arrangement=createArrangement<Chord>({stepsPerBar:16,chordAt:score.chordAt,trace,emitSections:true,sections:[
    {fromBar:0,toBar:4,name:'Sleeping strands',tracks:[padTrack,slowPulse]},
    {fromBar:4,toBar:8,name:'Living current',tracks:[livingPad,slowPulse,warmBass,tide]},
    {fromBar:8,toBar:10,name:'Green moon',tracks:[livingPad,slowPulse,fn(c=>{if(c.step===0)voices.bell(c.time,69,.07);})]},
    {fromBar:10,toBar:16,name:'Light returns',tracks:[livingPad,flowingPulse,warmBass,brightCurrent,tide]},
    {fromBar:16,toBar:22,name:'The crown',tracks:[crown,tide]},
    {fromBar:22,name:'Drift',tracks:[serene]},
  ]});
  const at=()=>{const ctx=runtime.context();if(!ctx)return null;const time=score.quantizePlayerAction(ctx.currentTime);return {time,pos:score.arrangementPositionAt(time)};};
  const off=[
    bus.on('spawn',e=>{if(e.kind==='parent')parent=e.enemyId;}),
    bus.on('lock',e=>{const a=at();if(!a)return;const notes=score.leadSetAt(a.pos);voices.action(a.time,notes[(e.lockCount-1)%notes.length],.048,.13,2400);}),
    bus.on('unlock',()=>{const a=at();if(a)voices.action(a.time,score.chordAt(a.pos).bass+24,.027,.15,1000);}),
    bus.on('fire',e=>{if(e.indexInVolley!==0)return;const a=at();if(!a)return;voices.action(a.time,score.chordAt(a.pos).bass+24,.075+e.volleySize*.007,.23,2200);}),
    bus.on('hit',e=>{if(e.lethal)return;const a=at();if(!a)return;const damage=e.enemyId===parent?1-e.hitPointsRemaining/6:0;
      voices.action(a.time,score.leadSetAt(a.pos)[Math.min(7,2+Math.floor(damage*5))],.055+damage*.065,.27+damage*.17,1800+damage*3600);}),
    bus.on('kill',e=>{if(!e.letter)recovered++;const ctx=runtime.context();if(!ctx)return;const note=score.nextKill(ctx.currentTime);const mix=score.sectionMixAt(score.arrangementPositionAt(note.time));
      const gain=blendNumber(mix,{0:.105,1:.13,2:.13,3:.145,4:.085});voices.action(note.time,note.midi,gain,.58,4000);
      if(e.enemyId===parent){victory=true;score.overrideSection(4);const time=score.nextGridTime(ctx.currentTime,4);runtime.mix()?.duckAt(time,.22,1.5);
        [74,78,81,85,86].forEach((midi,i)=>voices.action(time+i*TIME.stepSeconds,midi,.13-i*.012,1.5,5200));voices.pad(time,[50,57,61,64],.035);}}),
    bus.on('volley',e=>{if(e.size!==6||e.kills<6)return;const a=at();if(!a)return;const notes=score.chordAt(a.pos).pad;notes.forEach((n,i)=>voices.action(a.time+TIME.stepSeconds*i,n+12,.06,.7,3800));}),
    bus.on('reject',()=>{const a=at();if(!a)return;voices.action(a.time,46,.1,.19,700);voices.action(a.time+.035,47,.055,.21,600);}),
    bus.on('miss',()=>{const a=at();if(a)voices.action(a.time,score.chordAt(a.pos).bass+12,.035,.21,900);}),
    bus.on('playerhit',()=>{const a=at();if(a){voices.action(a.time,38,.16,.4,950);voices.action(a.time,44,.085,.3,750);}}),
  ];
  // The kit owns its bus handlers; the level owns action subscriptions.
  const dispose=runtime.audio.dispose;runtime.audio.dispose=()=>{off.forEach(f=>f());dispose();};
  return runtime;
}
