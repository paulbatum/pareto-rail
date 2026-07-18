import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Broadside's kit is a procedural orchestra: timpani and iron snare under
// horn swells, string ostinato, and brass stabs. Everything is built from the
// same few saw/sine stacks so the whole score sits in one hall; the player's
// own guns are pitched into the harmony by the score layer.

export type BroadsideTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type BroadsideVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createBroadsideVoices(environment: BroadsideVoiceEnvironment) {
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

  // Timpani: a pitched skin drop with a felt thump.
  const timpaniTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.5,
    stopPadding: 0.05,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.62, time: time + 0.32 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.07,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 170, time: time + 0.06 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
    ],
  });

  const subPulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.6,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.34 * vel, time: time + 0.02 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
    ],
  });

  // Low-string staccato: the ostinato engine of the whole score.
  const staccatoTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.55, detune: -7 },
      { type: 'sawtooth', gain: 0.55, detune: 7 },
    ],
    duration: 0.16,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'exponentialRamp', value: Math.max(280, cutoff * 0.35), time: time + 0.15 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.055 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // Horn swell: detuned saws behind a slow lowpass — the fleet's voice.
  const hornTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.55, detune: -5 },
      { type: 'sawtooth', gain: 0.55, detune: 5 },
      { type: 'sawtooth', gain: 0.3, octave: -1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    filter: { type: 'lowpass', frequency: 880, Q: 0.8 },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.065 * vel, time: time + Math.min(0.4, duration * 0.35) },
      { type: 'set', value: 0.065 * vel, time: time + duration * 0.7 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // Brass stab: hard attack, brighter filter, quick release.
  const brassTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.6, detune: -8 },
      { type: 'sawtooth', gain: 0.6, detune: 8 },
    ],
    duration: 0.28,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 2100,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 700, time: time + 0.26 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.075 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });

  // Trumpet line: single lead voice for fanfares and the victory theme.
  const trumpetTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.7 },
      { type: 'square', gain: 0.18, octave: 1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 2600, Q: 1.1 },
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.06 * vel, time: time + 0.03 },
      { type: 'set', value: 0.06 * vel, time: time + duration * 0.75 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  // Glass bell / celesta for the eye of the battle.
  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', frequencyRatio: 3.01, gain: 0.12 },
    ],
    duration: 0.8,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.7,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 30, time: time + 0.45 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.48 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const playerToneSpec = voice<{ voice: BroadsideTonalVoice }>({
    oscillators: [{ type: ({ voice: v }) => v.oscillator, gain: ({ voice: v }) => v.gain }],
    duration: ({ voice: v }) => v.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice: v }) => v.cutoff },
    envelope: { decay: ({ voice: v }) => v.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    timpani(context, time, midi, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      timpaniTone.play({ context, time, frequency: midiToFreq(midi), vel, destination: output });
      noiseHit(time, 0.09 * vel, 0.05, 'lowpass', 300, output);
      mix.duckAt(time, 0.55, 0.13);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 0.09, 'bandpass', 1900, output);
      noiseHit(time + 0.01, 0.1 * vel, 0.06, 'highpass', 3600, output);
      snareBody.play({ context, time, frequency: 240, vel, destination: output });
    },

    // Snare roll press: a short crescendo of grains into the next downbeat.
    snareRoll(context, time, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      const grains = Math.max(4, Math.floor(duration / 0.045));
      for (let i = 0; i < grains; i += 1) {
        const at = time + (i / grains) * duration;
        const grow = (i / grains) ** 1.4;
        noiseHit(at, 0.05 * vel * (0.3 + grow), 0.03, 'bandpass', 2000, output);
      }
      void context;
    },

    tick(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.4 * vel, 0.014, 'highpass', 7400, duck);
    },

    subPulse(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subPulseTone.play({ context, time, midi, vel, destination: duck });
    },

    stacc(context, time, midi, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      staccatoTone.play({ context, time, midi, vel, cutoff, destination: mix.duck });
    },

    horns(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        hornTone.play({
          context,
          time,
          midi,
          duration,
          vel: vel / Math.sqrt(midis.length),
          destination: mix.duck,
          sends: [{ destination: mix.reverbSend, gain: 0.55 }],
        });
      }
    },

    brass(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        brassTone.play({
          context,
          time,
          midi,
          vel: vel / Math.sqrt(midis.length),
          destination: mix.duck,
          sends: [{ destination: mix.reverbSend, gain: 0.35 }],
        });
      }
    },

    trumpet(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      trumpetTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.5 }] });
    },

    bell(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      bellTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.6 }] });
    },

    // Strings pad: sustained detuned stack, cutoff = how open the hall is.
    strings(context, time, midis, duration, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-9, 9]) {
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 3.7 + detune) * 2;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(cutoff, time);
          lowpass.frequency.linearRampToValueAtTime(cutoff * 0.72, time + duration);
          const level = (0.05 * vel) / (Math.sqrt(midis.length) * 1.4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.0, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.5;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
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
          frequency: 260,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 6400, time: time + duration }],
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
      noiseHit(time, vel, 0.9, 'highpass', 4800, output);
      noiseHit(time, vel * 0.5, 1.4, 'bandpass', 7400, reverbSend);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 100, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.3, 'lowpass', 360, output);
      noiseHit(time, 0.1 * vel, 0.7, 'highpass', 5200, output);
    },

    // Distant capital guns: a soft low boom with a slow air tail.
    boom(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 64, vel: vel * 0.5, destination: output });
      noiseHit(time + 0.02, 0.06 * vel, 0.5, 'lowpass', 500, output);
    },
  }, {
    timpani: ['midi', 'vel'],
    snare: ['vel'],
    snareRoll: ['duration', 'vel'],
    tick: ['vel'],
    subPulse: ['midi', 'vel'],
    stacc: ['midi', 'vel', 'cutoff'],
    horns: ['midis', 'duration', 'vel'],
    brass: ['midis', 'vel'],
    trumpet: ['midi', 'duration', 'vel'],
    bell: ['midi', 'vel'],
    strings: ['midis', 'duration', 'vel', 'cutoff'],
    riser: ['duration', 'level'],
    crash: ['vel'],
    impact: ['vel'],
    boom: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voiceSpec: BroadsideTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voiceSpec.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: voiceSpec, velocity: vel, weight, destination: output, sends: playerSends(0.3, voiceSpec.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
