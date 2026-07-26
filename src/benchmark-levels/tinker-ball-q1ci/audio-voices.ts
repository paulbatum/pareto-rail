import {
  defineInstruments,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

type TinkerVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

const bassVoice = voice<{ velocity: number }>({
  oscillators: [
    { type: 'square', gain: 0.1 },
    { type: 'triangle', gain: 0.13, octave: -1 },
  ],
  duration: 0.3,
  stopPadding: 0.04,
  filter: {
    type: 'lowpass',
    cutoff: 760,
    Q: 2.4,
    frequencyAutomation: (time) => [
      { type: 'set', value: 920, time },
      { type: 'exponentialRamp', value: 190, time: time + 0.26 },
    ],
  },
  envelope: {
    attack: 0.006,
    decay: 0.27,
    peak: ({ velocity }) => velocity * 0.28,
  },
});

const organVoice = voice<{ velocity: number; duration: number; brightness: number }>({
  oscillators: [
    { type: 'square', gain: 0.055 },
    { type: 'sawtooth', gain: 0.025, detune: -7 },
    { type: 'sine', gain: 0.045, octave: 1 },
  ],
  duration: ({ duration }) => duration,
  stopPadding: 0.08,
  filter: {
    type: 'lowpass',
    cutoff: ({ brightness }) => brightness,
    Q: 1.1,
  },
  envelope: {
    attack: 0.018,
    decay: 0.08,
    sustain: ({ velocity }) => velocity * 0.34,
    release: 0.1,
    peak: ({ velocity }) => velocity,
  },
});

const kickVoice = voice({
  oscillators: [{ type: 'sine' }],
  duration: 0.28,
  stopPadding: 0.03,
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency * 2.6, time },
    { type: 'exponentialRamp', value: frequency, time: time + 0.065 },
  ],
  gainAutomation: (time, gain) => [
    { type: 'set', value: gain * 0.66, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.27 },
  ],
});

const woodVoice = voice<{ velocity: number }>({
  oscillators: [
    { type: 'triangle', gain: 0.18 },
    { type: 'sine', gain: 0.08, frequencyRatio: 2.73 },
  ],
  duration: 0.085,
  stopPadding: 0.02,
  filter: { type: 'bandpass', cutoff: 1450, Q: 1.8 },
  envelope: { decay: 0.08, peak: ({ velocity }) => velocity },
});

const playerPluckVoice = voice<{ velocity: number; decay: number }>({
  oscillators: [
    { type: 'triangle', gain: 0.2 },
    { type: 'sine', gain: 0.09, octave: 1 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.05,
  filter: { type: 'lowpass', cutoff: 4100 },
  envelope: {
    attack: 0.002,
    decay: ({ decay }) => decay,
    peak: ({ velocity }) => velocity,
  },
});

const snapVoice = voice<{ velocity: number }>({
  oscillators: [
    { type: 'square', gain: 0.07 },
    { type: 'triangle', gain: 0.12, octave: -1 },
  ],
  duration: 0.13,
  stopPadding: 0.025,
  filter: {
    type: 'bandpass',
    cutoff: 1250,
    Q: 1.4,
  },
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency * 1.8, time },
    { type: 'exponentialRamp', value: frequency * 0.7, time: time + 0.1 },
  ],
  envelope: { decay: 0.12, peak: ({ velocity }) => velocity },
});

const impactVoice = voice<{ velocity: number; decay: number }>({
  oscillators: [
    { type: 'triangle', gain: 0.17 },
    { type: 'sine', gain: 0.12, octave: -1 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.04,
  filter: { type: 'lowpass', cutoff: 920 },
  envelope: { decay: ({ decay }) => decay, peak: ({ velocity }) => velocity },
});

const glueVoice = voice<{ velocity: number; decay: number; brightness: number }>({
  oscillators: [
    { type: 'sawtooth', gain: 0.055 },
    { type: 'triangle', gain: 0.1, octave: -1 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.06,
  filter: {
    type: 'lowpass',
    cutoff: ({ brightness }) => brightness,
    Q: 3.2,
    frequencyAutomation: (time, { brightness, decay }) => [
      { type: 'set', value: brightness, time },
      { type: 'exponentialRamp', value: 120, time: time + decay },
    ],
  },
  envelope: { decay: ({ decay }) => decay, peak: ({ velocity }) => velocity },
});

const rejectVoice = voice<{ velocity: number }>({
  oscillators: [
    { type: 'square', gain: 0.08 },
    { type: 'sawtooth', gain: 0.045, detune: 37 },
  ],
  duration: 0.24,
  stopPadding: 0.03,
  filter: { type: 'bandpass', cutoff: 540, Q: 4.5 },
  frequencyAutomation: (time, frequency) => [
    { type: 'set', value: frequency, time },
    { type: 'exponentialRamp', value: frequency * 0.36, time: time + 0.2 },
  ],
  envelope: { decay: 0.22, peak: ({ velocity }) => velocity },
});

const clapNoise = noiseHit({
  filterType: 'bandpass',
  frequency: 1850,
  decay: 0.085,
});

const metalNoise = noiseHit<{ pitch: number }>({
  filterType: 'highpass',
  frequency: ({ pitch }) => pitch,
  decay: 0.035,
});

const glueNoise = noiseHit({
  filterType: 'lowpass',
  frequency: 520,
  decay: 0.16,
});

export function createTinkerVoices(environment: TinkerVoiceEnvironment) {
  const musicDestination = () => {
    const mix = environment.mix();
    return mix?.duck ?? mix?.music ?? mix?.master ?? null;
  };
  const sfxDestination = () => {
    const mix = environment.mix();
    return mix?.sfx ?? mix?.master ?? null;
  };

  const playMallet = (
    context: AudioContext,
    time: number,
    midi: number,
    velocity: number,
    decay: number,
    destination: AudioNode,
    delaySend: AudioNode | undefined,
    delayGain: number,
  ) => {
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modGain = context.createGain();
    const bodyGain = context.createGain();
    const click = context.createOscillator();
    const clickGain = context.createGain();

    carrier.type = 'sine';
    modulator.type = 'sine';
    click.type = 'triangle';
    carrier.frequency.value = midiToFreq(midi);
    modulator.frequency.value = midiToFreq(midi + 12.04);
    click.frequency.value = midiToFreq(midi + 24);

    modGain.gain.setValueAtTime(125, time);
    modGain.gain.exponentialRampToValueAtTime(0.1, time + Math.min(0.28, decay * 0.65));
    bodyGain.gain.setValueAtTime(Math.max(0.001, velocity), time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    clickGain.gain.setValueAtTime(Math.max(0.001, velocity * 0.36), time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + Math.min(0.055, decay));

    modulator.connect(modGain).connect(carrier.frequency);
    carrier.connect(bodyGain).connect(destination);
    click.connect(clickGain).connect(destination);
    if (delaySend) {
      const send = context.createGain();
      send.gain.value = delayGain;
      bodyGain.connect(send).connect(delaySend);
    }

    carrier.start(time);
    modulator.start(time);
    click.start(time);
    carrier.stop(time + decay + 0.05);
    modulator.stop(time + decay + 0.05);
    click.stop(time + Math.min(0.07, decay) + 0.02);
  };

  return defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, velocity) {
      const output = musicDestination();
      if (!output) return;
      kickVoice.play({
        context,
        time,
        frequency: 54,
        gain: velocity,
        destination: output,
      });
    },
    bass(context, time, midi, velocity) {
      const output = musicDestination();
      if (!output) return;
      bassVoice.play({
        context,
        time,
        midi,
        velocity,
        destination: output,
      });
    },
    mallet(context, time, midi, velocity, decay) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      playMallet(context, time, midi, velocity, decay, output, mix.delaySend, 0.32);
    },
    organ(context, time, midis: readonly number[], velocity, duration, brightness) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output) return;
      for (const midi of midis) {
        organVoice.play({
          context,
          time,
          midi,
          velocity,
          duration,
          brightness,
          destination: output,
          sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.22 }] : undefined,
        });
      }
    },
    clap(context, time, velocity) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix?.noiseBuffer || !output) return;
      for (let index = 0; index < 3; index += 1) {
        clapNoise.play({
          context,
          buffer: mix.noiseBuffer,
          time: time + index * 0.014,
          velocity: velocity * (1 - index * 0.18),
          decay: 0.055 + index * 0.02,
          destination: output,
          offset: (index * 0.37) % 1.5,
        });
      }
    },
    workshopClick(context, time, velocity, pitch) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix?.noiseBuffer || !output) return;
      metalNoise.play({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        pitch,
        destination: output,
        offset: (time * 0.37) % 1.5,
      });
    },
    wood(context, time, midi, velocity) {
      const output = musicDestination();
      if (!output) return;
      woodVoice.play({ context, time, midi, velocity, destination: output });
    },
    gluePulse(context, time, midi, velocity, decay, brightness) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!output) return;
      glueVoice.play({
        context,
        time,
        midi,
        velocity,
        decay,
        brightness,
        destination: output,
        sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.28 }] : undefined,
      });
      if (mix?.noiseBuffer) {
        glueNoise.play({
          context,
          buffer: mix.noiseBuffer,
          time,
          velocity: velocity * 0.22,
          destination: output,
          offset: (time * 0.19) % 1.5,
        });
      }
    },
    playerNote(context, time, midi, velocity, decay) {
      const mix = environment.mix();
      const output = sfxDestination();
      if (!output) return;
      playerPluckVoice.play({
        context,
        time,
        midi,
        velocity,
        decay,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.42 }] : undefined,
      });
    },
    fireSnap(context, time, midi, velocity) {
      const mix = environment.mix();
      const output = sfxDestination();
      if (!output) return;
      snapVoice.play({
        context,
        time,
        midi,
        velocity,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.16 }] : undefined,
      });
      if (mix?.noiseBuffer) {
        metalNoise.play({
          context,
          buffer: mix.noiseBuffer,
          time,
          velocity: velocity * 0.32,
          pitch: 3200,
          decay: 0.025,
          destination: output,
          offset: (time * 0.53) % 1.5,
        });
      }
    },
    impact(context, time, midi, velocity, decay) {
      const output = sfxDestination();
      const mix = environment.mix();
      if (!output) return;
      impactVoice.play({
        context,
        time,
        midi,
        velocity,
        decay,
        destination: output,
      });
      if (mix?.noiseBuffer) {
        metalNoise.play({
          context,
          buffer: mix.noiseBuffer,
          time,
          velocity: velocity * 0.36,
          pitch: 2100,
          decay: Math.min(0.09, decay),
          destination: output,
          offset: (time * 0.71) % 1.5,
        });
      }
    },
    reject(context, time, velocity) {
      const output = sfxDestination();
      const mix = environment.mix();
      if (!output) return;
      rejectVoice.play({
        context,
        time,
        frequency: 310,
        velocity,
        destination: output,
      });
      if (mix?.noiseBuffer) {
        glueNoise.play({
          context,
          buffer: mix.noiseBuffer,
          time: time + 0.018,
          velocity: velocity * 0.7,
          decay: 0.12,
          frequency: 390,
          destination: output,
          offset: (time * 0.29) % 1.5,
        });
      }
    },
  });
}
