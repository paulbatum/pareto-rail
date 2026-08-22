import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// SPEEDSOLVE voice construction. The design rule: the cube is the percussion
// section. Every strike in the kit is a mechanism — woodblock snaps, clock
// ticks, metal clanks — and the player's own actions use the same timbres so
// solving reads as one instrument being played.

export type SpeedsolveVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createSpeedsolveVoices(environment: SpeedsolveVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const noiseBuffer = environment.mix()?.noiseBuffer;
    if (!context || !noiseBuffer) return;
    noiseHitVoice.play({ context, buffer: noiseBuffer, time, velocity: vel, decay, filterType, frequency, destination, offset: Math.random() * 2 });
  }

  function reverbSend(gain: number) {
    const send = environment.mix()?.reverbSend;
    return send && gain > 0 ? [{ destination: send, gain }] : [];
  }

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    // Soft mechanical kick: a short sine drop with a felt click.
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(44, time + 0.09);
      gain.gain.setValueAtTime(0.42 * vel, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
      osc.connect(gain).connect(output);
      osc.start(time);
      osc.stop(time + 0.2);
      noiseHit(time, 0.05 * vel, 0.006, 'highpass', 1600, output);
      mix.duckAt(time, 0.8, 0.11);
    },

    // Tight cross-stick snare — precise, not washy.
    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.14 * vel, 0.055, 'bandpass', 1900, output);
      noiseHit(time, 0.06 * vel, 0.02, 'highpass', 5600, output);
    },

    // The puzzle's clock: a tiny dry tick that keeps 8ths under everything.
    tick(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, vel, 0.012, 'bandpass', 3400, output);
      noiseHit(time, vel * 0.5, 0.006, 'highpass', 7800, output);
    },

    // THE instrument: a woodblock snap — two detuned sine partials plus a 3ms
    // noise transient. The backbeat plays it quiet; kills play it pitched.
    snap(context, time, vel, pitch = 1) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output) return;
      const base = 1180 * pitch;
      for (const [ratio, level, decay] of [[1, 0.24, 0.075], [2.53, 0.13, 0.05]] as const) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.value = base * ratio;
        gain.gain.setValueAtTime(level * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        osc.connect(gain).connect(output);
        osc.start(time);
        osc.stop(time + decay + 0.03);
      }
      noiseHit(time, 0.1 * vel, 0.004, 'bandpass', 2600 * pitch, output);
      if (mix?.duck && vel > 0.7) mix.duckAt(time, 0.88, 0.06);
    },

    shaker(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.03, 'highpass', 8800, duck);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8200, duck);
    },

    // Round sub bass, one octave of punch.
    sub(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.32;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = midiToFreq(midi);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.28 * vel, time + 0.012);
      gain.gain.setValueAtTime(0.28 * vel, time + dur * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(gain).connect(duck);
      osc.start(time);
      osc.stop(time + dur + 0.03);
    },

    // Steady detuned-saw pad, lowpassed — the hum of the machinery hall.
    pad(context, time, midis, duration, vel, cutoff, reverb) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        for (const detune of [-6, 6]) {
          const osc = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 4.3) * 3;
          filter.type = 'lowpass';
          filter.frequency.value = cutoff;
          const level = (0.032 * vel) / Math.sqrt(midis.length / 3);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(filter).connect(gain).connect(mix.duck);
          if (reverb > 0 && mix.reverbSend) {
            const wet = context.createGain();
            wet.gain.value = reverb;
            gain.connect(wet).connect(mix.reverbSend);
          }
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    // Machine-pluck arpeggio: tight, quantized, slightly wet.
    arp(context, time, midi, vel, reverb) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const dur = 0.16;
      const osc = context.createOscillator();
      const osc2 = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      osc.type = 'square';
      osc2.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      osc2.frequency.value = midiToFreq(midi);
      osc2.detune.value = 7;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3400, time);
      filter.frequency.exponentialRampToValueAtTime(900, time + dur);
      gain.gain.setValueAtTime(0.055 * vel, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(mix.duck);
      if (mix.delaySend) {
        const echo = context.createGain();
        echo.gain.value = 0.3;
        gain.connect(echo).connect(mix.delaySend);
      }
      if (reverb > 0 && mix.reverbSend) {
        const wet = context.createGain();
        wet.gain.value = reverb;
        gain.connect(wet).connect(mix.reverbSend);
      }
      osc.start(time);
      osc.stop(time + dur + 0.03);
      osc2.start(time);
      osc2.stop(time + dur + 0.03);
    },

    stab(context, time, midis, vel, reverb) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        const osc = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3000, time);
        filter.frequency.exponentialRampToValueAtTime(600, time + 0.24);
        gain.gain.setValueAtTime(0.045 * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
        osc.connect(filter).connect(gain).connect(mix.duck);
        if (reverb > 0 && mix.reverbSend) {
          const wet = context.createGain();
          wet.gain.value = reverb;
          gain.connect(wet).connect(mix.reverbSend);
        }
        osc.start(time);
        osc.stop(time + 0.32);
      }
    },

    bell(context, time, midi, vel, reverb) {
      const output = sfxDestination();
      if (!output) return;
      for (const [ratio, level, decay] of [[1, 0.08, 0.9], [1.5, 0.028, 0.7]] as const) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.value = midiToFreq(midi) * ratio;
        gain.gain.setValueAtTime(level * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        osc.connect(gain).connect(output);
        if (reverb > 0) {
          const send = environment.mix()?.reverbSend;
          if (send) {
            const wet = context.createGain();
            wet.gain.value = reverb;
            gain.connect(wet).connect(send);
          }
        }
        osc.start(time);
        osc.stop(time + decay + 0.1);
      }
    },

    // Warm resolved swell — the final phrase.
    swell(context, time, midis, duration, vel, reverb) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        const osc = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = Math.sin(midi * 3.7) * 5;
        filter.type = 'lowpass';
        filter.frequency.value = 1500;
        const level = (0.04 * vel) / Math.sqrt(midis.length / 3);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + duration * 0.4);
        gain.gain.setValueAtTime(level, time + duration * 0.62);
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(filter).connect(gain).connect(mix.duck);
        if (reverb > 0 && mix.reverbSend) {
          const wet = context.createGain();
          wet.gain.value = reverb;
          gain.connect(wet).connect(mix.reverbSend);
        }
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    },

    // Metallic clank — weakpoint shells and the core.
    clank(context, time, vel) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix) return;
      const base = 196;
      for (const [ratio, level, decay] of [[1, 0.22, 0.5], [2.76, 0.14, 0.34], [5.42, 0.09, 0.22], [8.9, 0.05, 0.14]] as const) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'square';
        osc.frequency.value = base * ratio;
        gain.gain.setValueAtTime(level * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        osc.connect(gain).connect(output);
        if (mix.reverbSend) {
          const wet = context.createGain();
          wet.gain.value = 0.4;
          gain.connect(wet).connect(mix.reverbSend);
        }
        osc.start(time);
        osc.stop(time + decay + 0.05);
      }
      noiseHit(time, 0.24 * vel, 0.1, 'bandpass', 1700, output);
    },

    // Airy whoosh — the rail swinging you to the next face.
    whoosh(context, time, vel, duration = 0.7) {
      const noiseBuffer = environment.mix()?.noiseBuffer;
      const output = musicDestination();
      if (!noiseBuffer || !output) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.1,
          frequency: 500,
          frequencyAutomation: [
            { type: 'exponentialRamp', value: 3200, time: time + duration * 0.55 },
            { type: 'exponentialRamp', value: 420, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'linearRamp', value: 0.11 * vel, time: time + duration * 0.4 },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
    },

    riser(context, time, duration, level) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.2,
          frequency: 220,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 5600, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },
  }, {
    kick: ['vel'],
    snare: ['vel'],
    tick: ['vel'],
    snap: ['vel', 'pitch'],
    shaker: ['vel'],
    hat: ['vel', 'decay'],
    sub: ['midi', 'vel'],
    pad: ['midis', 'duration', 'vel', 'cutoff', 'reverb'],
    arp: ['midi', 'vel', 'reverb'],
    stab: ['midis', 'vel', 'reverb'],
    bell: ['midi', 'vel', 'reverb'],
    swell: ['midis', 'duration', 'vel', 'reverb'],
    clank: ['vel'],
    whoosh: ['vel', 'duration'],
    riser: ['duration', 'level'],
  });

  return { ...instruments, noiseHit, reverbSend, musicDestination, sfxDestination };
}
