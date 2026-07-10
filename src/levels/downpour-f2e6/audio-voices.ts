import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type DownpourTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type DownpourVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

// A constant bed of filtered noise: the rain itself, always present, rising
// with the mix as the storm intensifies.
export function installRainBed(context: AudioContext, mix: MixBus) {
  if (!mix.noiseBuffer) return;
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 3400;
  filter.Q.value = 0.5;
  const lowFilter = context.createBiquadFilter();
  lowFilter.type = 'lowpass';
  lowFilter.frequency.value = 5200;
  const gain = context.createGain();
  gain.gain.value = 0.05;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 0.015;
  lfo.connect(lfoGain).connect(gain.gain);
  source.connect(filter).connect(lowFilter).connect(gain).connect(mix.music);
  source.start();
  lfo.start();
  return gain;
}

export function createDownpourVoices(environment: DownpourVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1200, velocity: 1, decay: 0.05 });

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const noiseBuffer = environment.mix()?.noiseBuffer;
    if (!context || !noiseBuffer) return;
    noiseHitVoice.play({ context, buffer: noiseBuffer, time, velocity: vel, decay, filterType, frequency, destination, offset: Math.random() * 1.5 });
  }

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.15,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 40, time: time + 0.09 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.56 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.065,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 150, time: time + 0.045 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.15 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.065 },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.095,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 3100,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 850, time: time + 0.085 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.095 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.24,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 3400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 460, time: time + 0.2 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.048 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.7,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.46 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.48 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const thunderTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 1.1,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      frequency: 900,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 60, time: time + 1.0 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.4 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.1 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 165, vel, destination: output });
      noiseHit(time, 0.08 * vel, 0.004, 'highpass', 1500, output);
      mix.duckAt(time, 0.38, 0.15);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.22 * vel, 0.08, 'bandpass', 1900, output);
      noiseHit(time, 0.1 * vel, 0.03, 'highpass', 5600, output);
      snareBody.play({ context, time, frequency: 210, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8600, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.16, 'highpass', 7600, duck);
    },

    ride(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.13, 'bandpass', 10200, duck);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.85, 'highpass', 4800, output);
      noiseHit(time, vel * 0.5, 1.3, 'bandpass', 7400, reverbSend);
    },

    bass(context, time, midi, vel, growl) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.2;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.27 * vel, time + 0.007);
      subGain.gain.setValueAtTime(0.27 * vel, time + dur * 0.7);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 8;
      filter.frequency.setValueAtTime(280 + growl * 950 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(160, time + dur);
      const growlGain = context.createGain();
      growlGain.gain.setValueAtTime(0, time);
      growlGain.gain.linearRampToValueAtTime(0.1 * vel, time + 0.005);
      growlGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-15, 15]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
      filter.connect(growlGain).connect(duck);
    },

    // A slower, wobbling bass for the canal's half-time menace.
    wobble(context, time, midi, vel, duration) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 9;
      const lfo = context.createOscillator();
      lfo.frequency.value = 3.2;
      const lfoGain = context.createGain();
      lfoGain.gain.value = 700;
      filter.frequency.value = 320;
      lfo.connect(lfoGain).connect(filter.frequency);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.16 * vel, time + 0.03);
      gain.gain.setValueAtTime(0.16 * vel, time + duration - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      for (const [type, detune] of [['sawtooth', -6], ['square', 6]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      lfo.start(time);
      lfo.stop(time + duration + 0.05);
      filter.connect(gain).connect(duck);
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-9, 9]) {
          const osc = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 7.3) * 4;
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(900, time);
          filter.frequency.linearRampToValueAtTime(1900, time + duration * 0.5);
          filter.frequency.linearRampToValueAtTime(900, time + duration);
          const level = (0.045 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(0.9, duration * 0.3));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(filter).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.55;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.4 }] });
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

    lead(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2500, time);
      filter.frequency.linearRampToValueAtTime(1500, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.08 * vel, time + 0.02);
      gain.gain.setValueAtTime(0.08 * vel, time + Math.max(0.02, duration - 0.08));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);
      for (const [type, detune] of [['sawtooth', -7], ['square', 7]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      filter.connect(gain);
      gain.connect(mix.duck);
      const delaySendGain = context.createGain();
      delaySendGain.gain.value = 0.3;
      gain.connect(delaySendGain).connect(mix.delaySend);
      const reverbSendGain = context.createGain();
      reverbSendGain.gain.value = 0.25;
      gain.connect(reverbSendGain).connect(mix.reverbSend);
    },

    riser(context, time, duration, gainValue) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const osc = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, time);
      osc.frequency.exponentialRampToValueAtTime(720, time + duration);
      filter.type = 'bandpass';
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(300, time);
      filter.frequency.exponentialRampToValueAtTime(3200, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(gainValue, time + duration * 0.85);
      gain.gain.linearRampToValueAtTime(0, time + duration);
      osc.connect(filter).connect(gain).connect(mix.duck);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output) return;
      impactTone.play({ context, time, frequency: 45, vel, destination: output });
      noiseHit(time, 0.35 * vel, 0.4, 'lowpass', 1600, output);
      if (reverbSend) noiseHit(time, 0.2 * vel, 0.9, 'bandpass', 2200, reverbSend);
    },

    thunder(context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output) return;
      thunderTone.play({ context, time, frequency: 55, vel, destination: output });
      noiseHit(time, 0.3 * vel, 0.8, 'lowpass', 900, output);
      if (reverbSend) noiseHit(time, 0.22 * vel, 1.4, 'bandpass', 1400, reverbSend);
    },

    noiseHit(_context, time, vel, decay, filterType, frequency) {
      const output = sfxDestination();
      if (!output) return;
      noiseHit(time, vel, decay, filterType, frequency, output);
    },
  });

  const playerSends = (delayGain: number, reverbGain: number) => {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  };

  const playerToneSpec = voice<{ voice: DownpourTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  function playerTone(time: number, midi: number, tonal: DownpourTonalVoice, vel: number, weight: number) {
    const output = sfxDestination();
    const context = environment.context();
    if (!output || !context) return;
    playerToneSpec.play({
      context,
      time,
      midi,
      voice: tonal,
      velocity: vel,
      weight,
      destination: output,
      sends: playerSends(tonal.reverb * 0.5, tonal.reverb),
    });
  }

  const playerNoiseVoice = noiseHitSpec<{ frequency: number }>({ filterType: 'bandpass', frequency: ({ frequency }) => frequency, velocity: 1, decay: 0.05 });
  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!output || !context || !buffer) return;
    playerNoiseVoice.play({ context, buffer, time, velocity: vel, decay, frequency, destination: output });
  }

  return { ...instruments, playerSends, playerTone, playerNoise };
}
