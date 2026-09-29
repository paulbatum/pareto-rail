import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { voice, noiseHit } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
export function makeVoices(env:{context():AudioContext|null;mix():MixBus|null;trace?:AudioTraceSink}) {
  const bell=voice({oscillators:[{type:'sine'},{type:'sine',frequencyRatio:2.01,gain:.17},{type:'triangle',gain:.08}],envelope:{attack:.004,decay:.75},duration:.8});
  const pad=voice({oscillators:[{type:'sine'},{type:'triangle',gain:.22,detune:4}],envelope:{attack:.6,decay:.3,sustain:.75,release:.9},duration:3.1,filter:{type:'lowpass',cutoff:1300}});
  const bass=voice({oscillators:[{type:'sine'},{type:'triangle',gain:.1}],envelope:{attack:.018,decay:.5},duration:.55});
  const breath=noiseHit({filterType:'bandpass',frequency:3400,decay:.09});
  const pulse=voice({oscillators:[{type:'sine'}],duration:.23,envelope:{decay:.22},frequencyAutomation:t=>[{type:'exponentialRamp',value:44,time:t+.18}]});
  const player=voice<{decay:number;brightness:number}>({oscillators:[{type:'sine'},{type:'triangle',gain:.25},{type:'sine',frequencyRatio:3,gain:.065}],duration:c=>c.decay,envelope:{attack:.004,decay:c=>c.decay},filter:{type:'lowpass',cutoff:c=>c.brightness}});
  return defineInstruments({context:env.context,trace:env.trace},{
    bell(ctx,time,midi:number,gain:number){const mix=env.mix();if(!mix)return;bell.play({context:ctx,time,midi,gain,destination:mix.music,sends:mix.delaySend?[{destination:mix.delaySend,gain:.38}]:undefined});},
    pad(ctx,time,notes:readonly number[],gain:number){const mix=env.mix();if(!mix)return;for(const midi of notes)pad.play({context:ctx,time,midi,gain,destination:mix.music,sends:mix.reverbSend?[{destination:mix.reverbSend,gain:.45}]:undefined});},
    bass(ctx,time,midi:number,gain:number){const mix=env.mix();if(mix)bass.play({context:ctx,time,midi,gain,destination:mix.music});},
    pulse(ctx,time,gain:number){const mix=env.mix();if(mix)pulse.play({context:ctx,time,frequency:94,gain,destination:mix.music});},
    breath(ctx,time,gain:number,cutoff:number){const mix=env.mix();if(mix?.noiseBuffer)breath.play({context:ctx,time,buffer:mix.noiseBuffer,velocity:gain,frequency:cutoff,destination:mix.music});},
    action(ctx,time,midi:number,gain:number,decay:number,brightness:number){const mix=env.mix();if(!mix)return;player.play({context:ctx,time,midi,gain,decay,brightness,destination:mix.sfx,sends:mix.delaySend?[{destination:mix.delaySend,gain:.25}]:undefined});},
  });
}
