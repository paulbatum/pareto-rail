import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Skyhook instrument construction. The kit is built around "air": wide noisy
// wind and breathy pads low in the climb, thinning to pure sines and glass
// bells at altitude. All decisions (which patterns, which gains per section)
// live in audio.ts; this file only builds sound.

export type SkyTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type SkyVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type WindLayer = {
  /** Smoothly retarget the wind bed level; the arrangement calls this per bar. */
  setLevel(level: number, time: number): void;
};

/** Persistent wind bed: looped noise through a slowly wandering bandpass. */
export function installWind(context: AudioContext, mix: MixBus): WindLayer | null {
  if (!mix.noiseBuffer) return null;
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const body = context.createBiquadFilter();
  body.type = 'bandpass';
  body.frequency.value = 420;
  body.Q.value = 0.5;
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.16;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 240;
  lfo.connect(lfoGain).connect(body.frequency);
  // A second, slower swell so gusts never repeat obviously.
  const swell = context.createOscillator();
  swell.frequency.value = 0.071;
  const swellGain = context.createGain();
  swellGain.gain.value = 0.35;
  const swellTarget = context.createGain();
  swellTarget.gain.value = 1;
  swell.connect(swellGain).connect(swellTarget.gain);
  source.connect(body).connect(swellTarget).connect(gain).connect(mix.music);
  source.start();
  lfo.start();
  swell.start();
  return {
    setLevel(level, time) {
      gain.gain.setTargetAtTime(Math.max(0.0001, level), time, 0.8);
    },
  };
}

export function createSkyhookVoices(environment: SkyVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(
    time: number,
    vel: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    destination: AudioNode,
  ) {
    const context = environment.context();
    const noiseBuffer = environment.mix()?.noiseBuffer;
    if (!context || !noiseBuffer) return;
    noiseHitVoice.play({
      context,
      buffer: noiseBuffer,
      time,
      velocity: vel,
      decay,
      filterType,
      frequency,
      destination,
      offset: Math.random() * 1.5,
    });
  }

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.16,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 46, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.08,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 145, time: time + 0.06 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.13 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
    ],
  });

  const pluckTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.12,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 3400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 800, time: time + 0.11 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.24,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 3200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 480, time: time + 0.2 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.7,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 32, time: time + 0.46 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.48 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const thunderTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 1.3,
    stopPadding: 0.08,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 26, time: time + 0.9 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.3 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.3 },
    ],
  });

  const playerToneSpec = voice<{ voice: SkyTonalVoice }>({
    oscillators: [{ type: ({ voice: v }) => v.oscillator, gain: ({ voice: v }) => v.gain }],
    duration: ({ voice: v }) => v.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice: v }) => v.cutoff },
    envelope: { decay: ({ voice: v }) => v.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.005, 'highpass', 1600, output);
      mix.duckAt(time, 0.5, 0.14);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.19 * vel, 0.09, 'bandpass', 1500, output);
      noiseHit(time, 0.08 * vel, 0.035, 'highpass', 4800, output);
      snareBody.play({ context, time, frequency: 200, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8600, duck);
    },

    shaker(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.045, 'bandpass', 6200, duck);
    },

    ride(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.16, 'bandpass', 9600, duck);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.8, 'highpass', 4400, output);
      noiseHit(time, vel * 0.5, 1.3, 'bandpass', 7000, reverbSend);
    },

    // Warm low-altitude bass: sub sine plus a gentle saw layer whose openness
    // dies with the air. warmth 1 = storm, 0 = vacuum (pure sub).
    bass(context, time, midi, vel, warmth) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.24;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.24 * vel, time + 0.01);
      subGain.gain.setValueAtTime(0.24 * vel, time + dur * 0.65);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      if (warmth > 0.05) {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 4;
        filter.frequency.setValueAtTime(240 + warmth * 720 * vel, time);
        filter.frequency.exponentialRampToValueAtTime(150, time + dur);
        const sawGain = context.createGain();
        sawGain.gain.setValueAtTime(0, time);
        sawGain.gain.linearRampToValueAtTime(0.08 * vel * warmth, time + 0.008);
        sawGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        for (const detune of [-11, 11]) {
          const osc = context.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi + 12);
          osc.detune.value = detune;
          osc.connect(filter);
          osc.start(time);
          osc.stop(time + dur + 0.02);
        }
        filter.connect(sawGain).connect(duck);
      }
    },

    // The "air" pad: breathy detuned saws through a wandering vowel filter.
    // openness 1 = wide storm air, 0 = a hairline whisper up in the vacuum.
    pad(context, time, midis, duration, vel, openness) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-8, 8]) {
          const osc = context.createOscillator();
          const vowel = context.createBiquadFilter();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.7) * 3;
          vowel.type = 'bandpass';
          vowel.frequency.setValueAtTime(500 + openness * 260, time);
          vowel.frequency.linearRampToValueAtTime(760 + openness * 320, time + duration * 0.5);
          vowel.frequency.linearRampToValueAtTime(500 + openness * 260, time + duration);
          vowel.Q.value = 0.8;
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 900 + openness * 1500;
          const level = (0.055 * vel * (0.35 + openness * 0.65)) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.25));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.0, duration * 0.3));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(vowel).connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.55;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    pluck(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      pluckTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.4 }] });
    },

    // Glass bell for the top of the climb: pure sine plus an inharmonic
    // partial, long tail, mostly reverb.
    bell(context, time, midi, vel, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const [ratio, level, decayScale] of [
        [1, 0.16, 1],
        [2.76, 0.045, 0.55],
        [5.4, 0.014, 0.3],
      ] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + duration * decayScale + 0.08,
          oscillatorType: 'sine',
          frequency: midiToFreq(midi) * ratio,
          gainAutomation: [
            { type: 'set', value: level * vel, time },
            { type: 'exponentialRamp', value: 0.001, time: time + duration * decayScale },
          ],
          destination: mix.duck,
          sends: [{ destination: mix.reverbSend, gain: 0.7 }],
        });
      }
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.32 }] });
        }
      }
    },

    // The Tetherjack's voice: a low metallic groan that gets brighter and
    // louder as the fight escalates. rage 0..1 drives cutoff and gain.
    bossGroan(context, time, midi, duration, rage) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 3.5;
      filter.frequency.setValueAtTime(160 + rage * 260, time);
      filter.frequency.linearRampToValueAtTime(340 + rage * 1400, time + duration * 0.6);
      filter.frequency.linearRampToValueAtTime(180 + rage * 300, time + duration);
      const gain = context.createGain();
      const level = 0.09 + rage * 0.1;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(level, time + duration * 0.2);
      gain.gain.setValueAtTime(level, time + duration * 0.7);
      gain.gain.linearRampToValueAtTime(0, time + duration);
      for (const [type, detune] of [['sawtooth', -16], ['square', 12]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      filter.connect(gain).connect(mix.duck);
      const send = context.createGain();
      send.gain.value = 0.4;
      gain.connect(send).connect(mix.reverbSend);
    },

    thunder(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      thunderTone.play({ context, time, frequency: 70, vel, destination: output });
      noiseHit(time, 0.22 * vel, 0.55, 'lowpass', 340, output);
      noiseHit(time + 0.06, 0.1 * vel, 0.9, 'lowpass', 210, output);
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
          Q: 1.0,
          frequency: 300,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 6800, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.28, 'lowpass', 400, output);
      instruments.crash(time, 0.14 * vel);
    },

    // Dock hiss: the station pressurizing around the car.
    hiss(context, time, duration, level) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: { type: 'highpass', frequency: 3200 },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration * 0.3 },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
    },
  }, {
    kick: ['vel'],
    snare: ['vel'],
    hat: ['vel', 'decay'],
    shaker: ['vel'],
    ride: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel', 'warmth'],
    pad: ['midis', 'duration', 'vel', 'openness'],
    pluck: ['midi', 'vel'],
    bell: ['midi', 'vel', 'duration'],
    stab: ['midis', 'vel'],
    bossGroan: ['midi', 'duration', 'rage'],
    thunder: ['vel'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    hiss: ['duration', 'level'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tonal: SkyTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonal.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: tonal, velocity: vel, weight, destination: output, sends: playerSends(0.4, tonal.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
