import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Speedsolve's kit is a precision machine: every drum is a click, snap, or
// ratchet a real puzzle cube could make, recorded dry and quantized dead on
// the grid. The cube is the percussion section — the `ratchet` voice IS a
// layer rotation, and everything else (ticks, clacks, snaps) is the same
// mechanism at smaller scales. Tonal material stays clean and toy-bright:
// plucked sequencer lines, music-box bells, tight sub bass.

export type SpeedTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  sparkle: number;
  reverb: number;
};

export type SpeedVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createSpeedsolveVoices(environment: SpeedVoiceEnvironment) {
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
    duration: 0.15,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 44, time: time + 0.09 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  // A dead knuckle of wood/plastic — the metronome of the machine.
  const clickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.6 }, { type: 'square', gain: 0.12 }],
    duration: 0.035,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 2.4, frequency: 1900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.34 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.035 },
    ],
  });

  // Pitched mechanical clack: the sound of a layer seating.
  const clackTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', frequency: 2600 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.55, time: time + 0.07 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.3 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
    ],
  });

  const subPulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.55,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.32 * vel, time: time + 0.02 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
    ],
  });

  const pluckTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [{ type: 'square', gain: 0.32 }, { type: 'triangle', gain: 0.62 }],
    duration: 0.13,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'exponentialRamp', value: Math.max(320, cutoff * 0.28), time: time + 0.12 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.062 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', frequencyRatio: 3.01, gain: 0.12 },
    ],
    duration: 0.85,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.08 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
    ],
  });

  const chimeTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.72 },
      { type: 'sine', frequencyRatio: 2.0, gain: 0.2 },
      { type: 'sine', frequencyRatio: 4.98, gain: 0.05 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -5 },
      { type: 'sawtooth', gain: 0.5, detune: 5 },
    ],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 2100, Q: 0.8 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.028 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.65,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 34, time: time + 0.4 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.44 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.65 },
    ],
  });

  const alarmTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.5 }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 2100, Q: 1.5 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const playerToneSpec = voice<{ voice: SpeedTonalVoice }>({
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
      kickTone.play({ context, time, frequency: 142, vel, destination: output });
      noiseHit(time, 0.04 * vel, 0.006, 'highpass', 3000, output);
      mix.duckAt(time, 0.55, 0.13);
    },

    click(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      clickTone.play({ context, time, frequency: 1750, vel, destination: output });
    },

    tick(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.4 * vel, 0.012, 'bandpass', 4300, duck);
    },

    hat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.028, 'highpass', 8800, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.16, 'highpass', 7400, duck);
    },

    // Rubber-band snap — the backbeat is an elastic band on a solved cube.
    snap(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 0.045, 'bandpass', 1900, output);
      noiseHit(time + 0.011, 0.1 * vel, 0.03, 'bandpass', 3100, output);
      clackTone.play({ context, time, frequency: 640, vel: vel * 0.5, destination: output });
    },

    clack(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      clackTone.play({ context, time, midi, vel, destination: output });
    },

    // THE cube move: a three-click zipper into a seated clack and a low thunk.
    // vel scales the whole gesture; pitch rises with each click.
    ratchet(context, time, vel, midi) {
      const output = sfxDestination();
      if (!output) return;
      for (let i = 0; i < 3; i += 1) {
        noiseHit(time + i * 0.028, (0.16 + i * 0.05) * vel, 0.014, 'bandpass', 2500 + i * 900, output);
      }
      clackTone.play({ context, time: time + 0.085, midi: midi + 12, vel: vel * 0.9, destination: output });
      subPulseTone.play({ context, time: time + 0.085, frequency: midiToFreq(midi - 12), vel: vel * 0.5, destination: output });
    },

    bass(context, time, midi, vel, drive) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.22;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.26 * vel, time + 0.008);
      subGain.gain.setValueAtTime(0.26 * vel, time + dur * 0.6);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      if (drive > 0.01) {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 2.8;
        filter.frequency.setValueAtTime(240 + drive * 900 * vel, time);
        filter.frequency.exponentialRampToValueAtTime(150, time + dur);
        const warmGain = context.createGain();
        warmGain.gain.setValueAtTime(0, time);
        warmGain.gain.linearRampToValueAtTime(0.07 * vel, time + 0.006);
        warmGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        for (const detune of [-7, 7]) {
          const osc = context.createOscillator();
          osc.type = 'square';
          osc.frequency.value = midiToFreq(midi + 12);
          osc.detune.value = detune;
          osc.connect(filter);
          osc.start(time);
          osc.stop(time + dur + 0.02);
        }
        filter.connect(warmGain).connect(duck);
      }
    },

    subPulse(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subPulseTone.play({ context, time, midi, vel, destination: duck });
    },

    // Soft machine-room pad: pale and steady, never in the melody's register.
    pad(context, time, midis, duration, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis as number[]) {
        const osc = context.createOscillator();
        const lowpass = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'triangle';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = Math.sin(midi * 3.7) * 5;
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(cutoff, time);
        lowpass.frequency.linearRampToValueAtTime(cutoff * 0.75, time + duration);
        const level = (0.05 * vel) / Math.sqrt((midis as number[]).length);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + Math.min(0.7, duration * 0.3));
        gain.gain.setValueAtTime(level, time + duration - Math.min(0.9, duration * 0.35));
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(lowpass).connect(gain);
        gain.connect(mix.duck);
        const send = context.createGain();
        send.gain.value = 0.45;
        gain.connect(send).connect(mix.reverbSend);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    },

    pluck(context, time, midi, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      pluckTone.play({ context, time, midi, vel, cutoff, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.34 }] });
    },

    bell(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      bellTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.55 }] });
    },

    chime(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      chimeTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.65 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis as number[]) {
        stabTone.play({ context, time, midi, vel, destination: mix.duck });
      }
    },

    alarm(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      alarmTone.play({ context, time, midi, vel, destination: output });
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
          Q: 1.1,
          frequency: 300,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 6200, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.7, 'highpass', 5400, output);
      noiseHit(time, vel * 0.5, 1.1, 'bandpass', 7800, reverbSend);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 105, vel, destination: output });
      noiseHit(time, 0.2 * vel, 0.24, 'lowpass', 420, output);
      noiseHit(time, 0.09 * vel, 0.6, 'highpass', 5600, output);
    },

    // Pneumatic release — the hatch venting after a face comes off.
    vent(_context, time, vel) {
      const output = sfxDestination();
      if (!output) return;
      noiseHit(time, 0.14 * vel, 0.4, 'lowpass', 1300, output);
      noiseHit(time + 0.05, 0.08 * vel, 0.26, 'bandpass', 2600, output);
    },

    // Confetti in audio form: a pinch of bright, detuned glass.
    glitter(context, time, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (let i = 0; i < 4; i += 1) {
        playOscillatorVoice({
          context,
          time: time + i * 0.03,
          stopTime: time + i * 0.03 + 0.2,
          oscillatorType: 'sine',
          frequency: 2200 + ((i * 977) % 1400),
          gainAutomation: [
            { type: 'set', value: 0.02 * vel, time: time + i * 0.03 },
            { type: 'exponentialRamp', value: 0.001, time: time + i * 0.03 + 0.18 },
          ],
          destination: mix.duck,
          sends: [{ destination: mix.reverbSend, gain: 0.6 }],
        });
      }
    },
  }, {
    kick: ['vel'],
    click: ['vel'],
    tick: ['vel'],
    hat: ['vel'],
    openHat: ['vel'],
    snap: ['vel'],
    clack: ['midi', 'vel'],
    ratchet: ['vel', 'midi'],
    bass: ['midi', 'vel', 'drive'],
    subPulse: ['midi', 'vel'],
    pad: ['midis', 'duration', 'vel', 'cutoff'],
    pluck: ['midi', 'vel', 'cutoff'],
    bell: ['midi', 'vel'],
    chime: ['midi', 'duration', 'vel'],
    stab: ['midis', 'vel'],
    alarm: ['midi', 'vel'],
    riser: ['duration', 'level'],
    crash: ['vel'],
    impact: ['vel'],
    vent: ['vel'],
    glitter: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tonal: SpeedTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonal.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: tonal, velocity: vel, weight, destination: output, sends: playerSends(0.3, tonal.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
