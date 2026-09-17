import { voice, noiseHit } from '../../engine/audio-voices';

export const strings = voice({
  oscillators:[{type:'sawtooth',gain:0.035,detune:-7},{type:'sawtooth',gain:0.035,detune:7},{type:'triangle',gain:0.055}],
  duration:1.7, filter:{type:'lowpass',frequency:2400,Q:0.5},
  envelope:{attack:0.18,decay:1.65},
});
export const spiccato = voice({
  oscillators:[{type:'sawtooth',gain:0.04},{type:'triangle',gain:0.055,detune:5}],
  duration:0.22,filter:{type:'lowpass',frequency:1850,Q:0.5},envelope:{attack:0.022,decay:0.21},
});
export const brass = voice({
  oscillators:[{type:'sawtooth',gain:0.065},{type:'sawtooth',gain:0.03,detune:9},{type:'triangle',gain:0.08,octave:-1}],
  duration:0.8,filter:{type:'lowpass',frequency:2100,Q:1,frequencyAutomation:t=>[
    {type:'set',time:t,value:450},{type:'linearRamp',time:t+0.11,value:2200},{type:'exponentialRamp',time:t+0.75,value:650},
  ]},envelope:{attack:0.045,decay:0.78},
});
export const timpani=voice({
  oscillators:[{type:'sine',gain:0.26},{type:'triangle',gain:0.06,frequencyRatio:1.5}],
  duration:0.7,envelope:{attack:0.004,decay:0.69},
  frequencyAutomation:(t,f)=>[{type:'set',time:t,value:f*1.45},{type:'exponentialRamp',time:t+0.055,value:f}],
});
export const celesta=voice({
  oscillators:[{type:'sine',gain:0.12},{type:'triangle',gain:0.045,octave:1},{type:'sine',gain:0.017,frequencyRatio:3}],
  duration:0.5,envelope:{attack:0.003,decay:0.48},
});
export const cannon=voice({
  oscillators:[{type:'sine',gain:0.24},{type:'triangle',gain:0.08,frequencyRatio:1.48}],
  duration:0.6,filter:{type:'lowpass',frequency:650},envelope:{attack:0.003,decay:0.59},
  frequencyAutomation:(t,f)=>[{type:'set',time:t,value:f*2.2},{type:'exponentialRamp',time:t+0.28,value:f*0.6}],
});
export const air=noiseHit({filterType:'highpass',frequency:4800,decay:0.6});
