import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice } from '../../engine/audio-kit';
import { midiToFreq, secondsPerStep } from '../../engine/music';
import { MASS_DRIVER_DETAILED_BE9E_BPM } from './gameplay';
const STEP=secondsPerStep(MASS_DRIVER_DETAILED_BE9E_BPM,1);
export function createAudio(bus:EventBus){
 let runtime:any;
 runtime=createBeatLevelAudio({bus,bpm:MASS_DRIVER_DETAILED_BE9E_BPM,stepSeconds:STEP,stepsPerBar:16,volumeScale:.8,runAlignment:'bar',mix:{compressor:{threshold:-18,ratio:6,attack:.004,release:.2},delay:{time:STEP*3,feedback:.3,dampHz:2400}},onStep:(event:any)=>{const {time,step,bar,mode}=event; const c=runtime.context(),m=runtime.mix();if(!c||!m)return;if(mode!=='run')return; if(step%4===0) tone(c,m.music,time,24,bar>20 ? .22 : .16,.12); if(step%2===1) tone(c,m.music,time,350+bar*12,.035,.045); if(step%4===0) { tone(c,m.music,time,[40,40,36,38][Math.floor(bar/2)%4],.12,.2); if(step===0) tone(c,m.music,time,[52,52,48,50][Math.floor(bar/2)%4],.035,.7); }},onRunEnd:()=>{const c=runtime.context(),m=runtime.mix();if(c&&m)tone(c,m.music,c.currentTime,164,.2,3);}});
 const act=(fn:(c:AudioContext,m:any,t:number,n:number)=>void)=>()=>{const c=runtime.context(),m=runtime.mix();if(c&&m)fn(c,m,c.currentTime,0);};
 bus.on('spawn',({kind}:any)=>{if(kind==='interlock')act((c,m,t)=>{tone(c,m.sfx,t,56,.18,.32);tone(c,m.sfx,t+.12,63,.14,.28);});});
 bus.on('lock',({lockCount})=>act((c,m,t)=>tone(c,m.sfx,t,520+lockCount*110,.05,.08)));
 bus.on('fire',({volleySize})=>act((c,m,t)=>{tone(c,m.sfx,t,150,.1,.12+volleySize*.02);m.duckAt(t,.7,.12);}));
 bus.on('hit',({lethal}:any)=>act((c,m,t)=>tone(c,m.sfx,t,lethal?940:610,lethal?.12:.06,lethal?.18:.08)));
 bus.on('playerhit',()=>act((c,m,t)=>{tone(c,m.sfx,t,42,.2,.35);tone(c,m.sfx,t,78,.09,.18);}));
 bus.on('kill',({enemyId}:any)=>act((c,m,t)=>tone(c,m.sfx,t,700+(enemyId%6)*90,.16,.15)));
 bus.on('reject',()=>act((c,m,t)=>tone(c,m.sfx,t,78,.12,.12)));
 bus.on('miss',()=>act((c,m,t)=>tone(c,m.sfx,t,96,.08,.06)));
 return runtime.audio;
}
function tone(c:AudioContext,d:AudioNode,t:number,midi:number,gain:number,duration:number){playOscillatorVoice({context:c,time:t,stopTime:t+duration,oscillatorType:'sawtooth',frequency:midiToFreq(midi),filter:{type:'lowpass',frequency:1800},gainAutomation:[{type:'set',value:gain,time:t},{type:'exponentialRamp',value:.001,time:t+duration}],destination:d});}
