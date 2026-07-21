import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type SkyhookTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type SkyhookVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

// A slow-moving wind bed under the whole run: filtered noise with a lazy LFO on
// its cutoff, so the air is always breathing. It thins with altitude via the
// returned gain node, which the score fades down as the climb goes high.
export function installSkyhookWind(context: AudioContext, mix: MixBus) {
  if (!mix.noiseBuffer) return null;
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 520;
  band.Q.value = 0.7;
  const gain = context.createGain();
  gain.gain.value = 0.09;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 260;
  lfo.connect(lfoGain).connect(band.frequency);
  source.connect(band).connect(gain).connect(mix.music);
  source.start();
  lfo.start();
  return gain;
}

export function createSkyhookVoices(environment: SkyhookVoiceEnvironment) {
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
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 150, time: time + 0.06 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.24,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      frequency: 3200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 1100, time: time + 0.2 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', octave: 1, gain: 0.32 },
    ],
    duration: 0.6,
    stopPadding: 0.05,
    gainAutomation: (time, gain) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
    ],
  });

  const tollTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'triangle', octave: 1, gain: 0.18 },
    ],
    duration: 1.6,
    stopPadding: 0.06,
    filter: { type: 'lowpass', frequency: 900 },
    gainAutomation: (time, gain) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain, time: time + 0.02 },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.6 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.85,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 32, time: time + 0.6 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.48 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
    ],
  });

  const playerToneSpec = voice<{ voice: SkyhookTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 170, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.004, 'highpass', 1700, output);
      mix.duckAt(time, 0.5, 0.15);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.17 * vel, 0.09, 'bandpass', 1700, output);
      noiseHit(time, 0.09 * vel, 0.04, 'highpass', 4800, output);
      snareBody.play({ context, time, frequency: 220, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8600, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.2, 'highpass', 7600, duck);
    },

    ride(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.16, 'bandpass', 10200, duck);
    },

    // Warm airy sub with a soft reese layer — the floor the weather sits on.
    bass(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.28;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.24 * vel, time + 0.01);
      subGain.gain.setValueAtTime(0.24 * vel, time + dur * 0.7);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(420, time);
      filter.frequency.exponentialRampToValueAtTime(180, time + dur);
      const reeseGain = context.createGain();
      reeseGain.gain.setValueAtTime(0, time);
      reeseGain.gain.linearRampToValueAtTime(0.06 * vel, time + 0.01);
      reeseGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-10, 10]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
      filter.connect(reeseGain).connect(duck);
    },

    // Wide open-vowel pad — the sky. Big and airy down low; the score shortens
    // and thins it as the air does.
    pad(context, time, midis, duration, vel) {
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
          osc.detune.value = detune + Math.sin(midi * 5.7) * 4;
          vowel.type = 'bandpass';
          vowel.frequency.setValueAtTime(560, time);
          vowel.frequency.linearRampToValueAtTime(880, time + duration * 0.5);
          vowel.frequency.linearRampToValueAtTime(560, time + duration);
          vowel.Q.value = 0.8;
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 2000;
          const level = (0.045 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.0, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(vowel).connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.7;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.5 }] });
    },

    // Bright bell for the sunlit-blue movement — the sky opening up.
    bell(context, time, midi, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix?.reverbSend || !output) return;
      bellTone.play({
        context,
        time,
        midi,
        gain: 0.09 * vel,
        vel,
        destination: output,
        sends: [{ destination: mix.reverbSend, gain: 0.4 }, ...(mix.delaySend ? [{ destination: mix.delaySend, gain: 0.35 }] : [])],
      });
    },

    // A low tolling bell — the boss's pulse, alone in the thin air.
    toll(context, time, midi, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix?.reverbSend || !output) return;
      tollTone.play({
        context,
        time,
        midi,
        gain: 0.16 * vel,
        vel,
        destination: output,
        sends: [{ destination: mix.reverbSend, gain: 0.6 }],
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
          Q: 1.0,
          frequency: 240,
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

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.9, 'highpass', 5200, output);
      noiseHit(time, vel * 0.5, 1.5, 'bandpass', 7600, reverbSend);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 120, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.35, 'lowpass', 460, output);
      instruments.crash(time, 0.14 * vel);
    },
  }, {
    kick: ['vel'],
    snare: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    ride: ['vel'],
    bass: ['midi', 'vel'],
    pad: ['midis', 'duration', 'vel'],
    arp: ['midi', 'vel'],
    bell: ['midi', 'vel'],
    toll: ['midi', 'vel'],
    riser: ['duration', 'level'],
    crash: ['vel'],
    impact: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voiceSpec: SkyhookTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voiceSpec.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: voiceSpec, velocity: vel, weight, destination: output, sends: playerSends(0.4, voiceSpec.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
