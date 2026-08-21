import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import { midiToFreq } from '../../engine/music';
import type { AudioTraceSink } from '../../engine/audio-trace';

// Thermal Ink's instruments: a slow industrial pulse. Kick and tom are heavy
// rubber thuds; clank is inharmonic harbor metal; the bass bounces on soft
// sub with a saw growl; the pad is a distant foghorn choir; the melody is a
// haunting plucked line that turns bright and sharply focused in thermal.

export type PlayerVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; reverb: number };

export type InkVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function installHarborRumble(context: AudioContext, mix: MixBus) {
  if (!mix.noiseBuffer) return;
  // Water pressure: a slow brown-noise swell under everything.
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 110;
  filter.Q.value = 0.5;
  const gain = context.createGain();
  gain.gain.value = 0.14;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.09;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 0.05;
  lfo.connect(lfoGain).connect(gain.gain);
  source.connect(filter).connect(gain).connect(mix.music);
  source.start();
  lfo.start();
}

export function createInkVoices(environment: InkVoiceEnvironment) {
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
    duration: 0.19,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 41, time: time + 0.12 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const tomTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.3,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 52, time: time + 0.22 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.34 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.08,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 120, time: time + 0.06 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
    ],
  });

  const clankPartial = voice<{ vel: number; frequency: number; decay: number }>({
    oscillators: [{ type: 'square' }],
    duration: ({ decay }) => decay,
    stopPadding: 0.03,
    filter: {
      type: 'bandpass',
      Q: 9,
      frequency: ({ frequency }) => frequency,
    },
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.8,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.55 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
    ],
  });

  const sonarTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.5,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 300, time: time + 0.4 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: 0.07 * vel, time: time + 0.02 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
    ],
  });

  const playerToneSpec = voice<{ voice: PlayerVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const rejectClank = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 780 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const playerHitBoom = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const missDrip = voice({
    oscillators: [{ type: 'sine', gain: 0.05 }],
    duration: 0.13,
    stopPadding: 0.02,
    envelope: { decay: 0.13 },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.005, 'highpass', 1400, output);
      mix.duckAt(time, 0.42, 0.18);
    },

    tom(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      tomTone.play({ context, time, frequency: 96, vel, destination: output });
      noiseHit(time, 0.1 * vel, 0.09, 'lowpass', 380, output);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.17 * vel, 0.085, 'bandpass', 1500, output);
      noiseHit(time, 0.08 * vel, 0.03, 'highpass', 4800, output);
      snareBody.play({ context, time, frequency: 195, vel, destination: output });
    },

    // Inharmonic harbor metal: two detuned partials and a spark of noise.
    clank(context, time, vel, pitch) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      const decay = 0.16 + pitch * 0.05;
      clankPartial.play({ context, time, frequency: 320 * pitch, vel: vel * 0.9, decay, destination: output });
      clankPartial.play({ context, time: time + 0.004, frequency: 320 * pitch * 2.71, vel: vel * 0.6, decay: decay * 0.8, destination: output, sends: [{ destination: mix.delaySend ?? output, gain: 0.2 }] });
      noiseHit(time, 0.05 * vel, 0.02, 'highpass', 5200, output);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8000, duck);
    },

    // The bouncing synth bass: soft sub under a growling detuned saw.
    bass(context, time, midi, vel, growl) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.2;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.24 * vel, time + 0.01);
      subGain.gain.setValueAtTime(0.24 * vel, time + dur * 0.6);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(240 + growl * 700 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(140, time + dur);
      const growlGain = context.createGain();
      growlGain.gain.setValueAtTime(0, time);
      growlGain.gain.linearRampToValueAtTime(0.09 * vel, time + 0.007);
      growlGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-12, 12]) {
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

    // Distant foghorn choir: detuned saws through a slow vowel sweep.
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
          vowel.frequency.setValueAtTime(480, time);
          vowel.frequency.linearRampToValueAtTime(720, time + duration * 0.5);
          vowel.frequency.linearRampToValueAtTime(480, time + duration);
          vowel.Q.value = 0.8;
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 1700;
          const level = (0.045 * vel) / Math.sqrt(midis.length / 3);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(1.1, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.2, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(vowel).connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.65;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    // The haunting melody voice; bright=true is the thermal variant — same
    // notes an octave up, square+saw, sharply focused.
    pluck(context, time, midi, duration, vel, bright) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      if (bright) {
        filter.frequency.setValueAtTime(4200, time);
        filter.frequency.linearRampToValueAtTime(2400, time + duration);
      } else {
        filter.frequency.setValueAtTime(2100, time);
        filter.frequency.linearRampToValueAtTime(1200, time + duration);
      }
      const peak = (bright ? 0.085 : 0.075) * vel;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(peak, time + 0.015);
      gain.gain.setValueAtTime(peak, time + Math.max(0.015, duration - 0.09));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);

      const vibrato = context.createOscillator();
      const vibratoGain = context.createGain();
      vibrato.frequency.value = 5.1;
      vibratoGain.gain.setValueAtTime(0, time);
      vibratoGain.gain.linearRampToValueAtTime(5, time + Math.min(0.5, duration * 0.6));
      const pairs: Array<[OscillatorType, number, number]> = bright
        ? [['square', -6, 1], ['sawtooth', 6, 0.5]]
        : [['triangle', -5, 1], ['sine', 5, 0.6]];
      for (const [type, detune, oscGain] of pairs) {
        const osc = context.createOscillator();
        const level = context.createGain();
        level.gain.value = oscGain;
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        vibrato.connect(vibratoGain).connect(osc.detune);
        osc.connect(level).connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      vibrato.start(time);
      vibrato.stop(time + duration + 0.05);
      filter.connect(gain);
      gain.connect(mix.duck);
      const echo = context.createGain();
      echo.gain.value = bright ? 0.34 : 0.52;
      gain.connect(echo).connect(mix.delaySend);
      const hall = context.createGain();
      hall.gain.value = bright ? 0.2 : 0.38;
      gain.connect(hall).connect(mix.reverbSend);
    },

    sonar(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      sonarTone.play({
        context,
        time,
        midi,
        vel,
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.6 }],
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
          frequency: 200,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 5200, time: time + duration }],
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
      noiseHit(time, 0.24 * vel, 0.32, 'lowpass', 380, output);
    },

    // Ink eject: a deep pressure whoosh and a sub drop — the cloud, not a blast.
    whoosh(context, time, level) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + 1.1,
        filter: {
          type: 'bandpass',
          Q: 0.8,
          frequency: 1900,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 160, time: time + 0.9 }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'linearRamp', value: 0.16 * level, time: time + 0.08 },
          { type: 'exponentialRamp', value: 0.001, time: time + 1.0 },
        ],
        destination: output,
      });
      const drop = context.createOscillator();
      const dropGain = context.createGain();
      drop.type = 'sine';
      drop.frequency.setValueAtTime(90, time);
      drop.frequency.exponentialRampToValueAtTime(34, time + 0.7);
      dropGain.gain.setValueAtTime(0.001, time);
      dropGain.gain.linearRampToValueAtTime(0.2 * level, time + 0.06);
      dropGain.gain.exponentialRampToValueAtTime(0.001, time + 0.8);
      drop.connect(dropGain).connect(output);
      drop.start(time);
      drop.stop(time + 0.85);
    },

    // Thermal switch: the noise floor falls away, a clean chime marks the new sense.
    modeSwitch(context, time, turningOn) {
      const mix = environment.mix();
      const output = sfxDestination();
      if (!mix || !output) return;
      if (turningOn) mix.duckAt(time, 0.5, 0.35);
      const chime = context.createOscillator();
      const chimeGain = context.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(turningOn ? 1240 : 620, time);
      chime.frequency.exponentialRampToValueAtTime(turningOn ? 2480 : 310, time + 0.16);
      chimeGain.gain.setValueAtTime(0.001, time);
      chimeGain.gain.linearRampToValueAtTime(0.09, time + 0.012);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, time + 0.34);
      chime.connect(chimeGain).connect(output);
      if (mix.reverbSend) {
        const send = context.createGain();
        send.gain.value = 0.5;
        chimeGain.connect(send).connect(mix.reverbSend);
      }
      chime.start(time);
      chime.stop(time + 0.38);
    },

    // Boss stings: low horn stabs for the engage, a shrieking alarm for exposure.
    sting(context, time, midis, vel, shriek) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        const osc = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(shriek ? 900 : 420, time);
        filter.frequency.linearRampToValueAtTime(shriek ? 2600 : 1100, time + 0.5);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.13 * vel, time + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 1.3);
        osc.connect(filter).connect(gain);
        gain.connect(mix.duck);
        const send = context.createGain();
        send.gain.value = 0.55;
        gain.connect(send).connect(mix.reverbSend);
        osc.start(time);
        osc.stop(time + 1.35);
      }
    },
  }, {
    kick: ['vel'],
    tom: ['vel'],
    snare: ['vel'],
    clank: ['vel', 'pitch'],
    hat: ['vel', 'decay'],
    bass: ['midi', 'vel', 'growl'],
    pad: ['midis', 'duration', 'vel'],
    pluck: ['midi', 'duration', 'vel', 'bright'],
    sonar: ['midi', 'vel'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    whoosh: ['level'],
    modeSwitch: ['turningOn'],
    sting: ['midis', 'vel', 'shriek'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, playerVoice: PlayerVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: playerVoice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: playerVoice, velocity: vel, weight, destination: output, sends: playerSends(0.42, playerVoice.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return {
    ...instruments,
    noiseHit,
    playerSends,
    playerTone,
    playerNoise,
    rejectVoice: rejectClank,
    playerHitBoomVoice: playerHitBoom,
    missVoice: missDrip,
  };
}
