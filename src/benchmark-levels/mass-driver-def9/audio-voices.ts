import {
  defineInstruments,
  playNoiseHit,
  playOscillatorVoice,
  type BeatLevelAudioRuntime,
  type MixBus,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

type VoiceOptions = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

type ContinuousHum = {
  output: GainNode;
  oscillators: OscillatorNode[];
};

const pulseVoice = voice<{ heat: number; decay: number }>({
  oscillators: [
    { type: 'triangle', gain: 0.16 },
    { type: 'sine', octave: -1, gain: 0.28 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.04,
  filter: {
    type: 'lowpass',
    cutoff: ({ heat }) => 520 + heat * 2600,
    Q: 1.4,
  },
  envelope: { attack: 0.004, decay: ({ decay }) => decay, peak: 1 },
});

const bassVoice = voice<{ cutoff: number; decay: number }>({
  oscillators: [
    { type: 'sawtooth', gain: 0.09 },
    { type: 'square', octave: -1, gain: 0.045 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.05,
  filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 2.2 },
  envelope: { attack: 0.006, decay: ({ decay }) => decay, peak: 1 },
});

const arpVoice = voice<{ brightness: number; decay: number }>({
  oscillators: [
    { type: 'triangle', gain: 0.075 },
    { type: 'sine', octave: 1, gain: 0.025, detune: 7 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.05,
  filter: { type: 'bandpass', cutoff: ({ brightness }) => 1200 + brightness * 5200, Q: 1.1 },
  envelope: { attack: 0.003, decay: ({ decay }) => decay, peak: 1 },
});

const playerVoice = voice<{ oscillator: OscillatorType; brightness: number; decay: number }>({
  oscillators: [
    { type: ({ oscillator }) => oscillator, gain: 0.12 },
    { type: 'sine', octave: 1, gain: 0.035 },
  ],
  duration: ({ decay }) => decay,
  stopPadding: 0.04,
  filter: { type: 'lowpass', cutoff: ({ brightness }) => brightness, Q: 1.8 },
  envelope: { attack: 0.002, decay: ({ decay }) => decay, peak: 1 },
});

export function createMassDriverVoices(options: VoiceOptions) {
  let hum: ContinuousHum | null = null;

  const musicDestination = () => options.mix()?.music ?? options.mix()?.master ?? null;
  const sfxDestination = () => options.mix()?.sfx ?? options.mix()?.master ?? null;
  const sends = (delay: number, reverb: number) => {
    const mix = options.mix();
    return [
      ...(mix?.delaySend ? [{ destination: mix.delaySend, gain: delay }] : []),
      ...(mix?.reverbSend ? [{ destination: mix.reverbSend, gain: reverb }] : []),
    ];
  };

  const inst = defineInstruments({ trace: options.trace, context: options.context }, {
    startHum(context, time, duration) {
      stopContinuousHum(time, 0.03);
      const destination = musicDestination();
      if (!destination) return;
      const output = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(240, time);
      filter.frequency.exponentialRampToValueAtTime(2100, time + duration);
      output.gain.setValueAtTime(0.001, time);
      output.gain.exponentialRampToValueAtTime(0.055, time + 0.8);
      output.gain.linearRampToValueAtTime(0.12, time + Math.max(1, duration - 2.2));
      output.gain.exponentialRampToValueAtTime(0.001, time + duration);
      filter.connect(output).connect(destination);

      const specifications: Array<[OscillatorType, number, number, number]> = [
        ['sine', 27.5, 104, 0.78],
        ['triangle', 41.2, 156, 0.28],
        ['sawtooth', 82.4, 390, 0.055],
      ];
      const oscillators: OscillatorNode[] = [];
      for (const [type, from, to, gainValue] of specifications) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(from, time);
        oscillator.frequency.exponentialRampToValueAtTime(to, time + duration);
        gain.gain.value = gainValue;
        oscillator.connect(gain).connect(filter);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.08);
        oscillators.push(oscillator);
      }
      hum = { output, oscillators };
    },
    stopHum(_context, time, fade) {
      stopContinuousHum(time, fade);
    },
    pulse(context, time, midi, velocity, heat) {
      const destination = musicDestination();
      if (!destination) return;
      pulseVoice.play({
        context,
        time,
        midi,
        velocity,
        heat,
        decay: 0.17 + heat * 0.08,
        destination,
        sends: sends(0.06, 0.05),
      });
    },
    kick(context, time, velocity) {
      const destination = musicDestination();
      if (!destination) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.34,
        oscillatorType: 'sine',
        frequency: 118,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 38, time: time + 0.16 }],
        gainAutomation: [
          { type: 'set', value: 0.34 * velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.31 },
        ],
        destination,
      });
      noise(context, time, 0.045 * velocity, 0.028, 2800, destination);
    },
    railTick(context, time, velocity, heat) {
      const destination = musicDestination();
      if (!destination) return;
      noise(context, time, velocity, 0.025 + heat * 0.018, 4400 + heat * 6200, destination);
    },
    bass(context, time, midi, velocity, heat) {
      const destination = musicDestination();
      if (!destination) return;
      bassVoice.play({
        context,
        time,
        midi,
        velocity,
        cutoff: 420 + heat * 1700,
        decay: 0.34 + heat * 0.13,
        destination,
        sends: sends(0.04, 0.03),
      });
    },
    arp(context, time, midi, velocity, heat) {
      const destination = musicDestination();
      if (!destination) return;
      arpVoice.play({
        context,
        time,
        midi,
        velocity,
        brightness: heat,
        decay: 0.12 + heat * 0.11,
        destination,
        sends: sends(0.28, 0.14),
      });
    },
    alarm(context, time, midi, velocity, rise) {
      const destination = musicDestination();
      if (!destination) return;
      const frequency = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.48,
        oscillatorType: 'square',
        frequency,
        frequencyAutomation: [{ type: 'linearRamp', value: frequency * (1 + rise * 0.12), time: time + 0.36 }],
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'linearRamp', value: 0.065 * velocity, time: time + 0.08 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.44 },
        ],
        filter: { type: 'bandpass', frequency: 900 + rise * 2400, Q: 4 },
        destination,
        sends: sends(0.14, 0.18),
      });
    },
    riser(context, time, duration, velocity) {
      const destination = musicDestination();
      if (!destination) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.05,
        oscillatorType: 'sawtooth',
        frequency: 52,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 880, time: time + duration }],
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.06 * velocity, time: time + duration * 0.82 },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        filter: { type: 'bandpass', frequency: 1200, Q: 1.2 },
        destination,
        sends: sends(0.1, 0.25),
      });
    },
    impact(context, time, velocity) {
      const destination = options.mix()?.duck ?? musicDestination();
      if (!destination) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 1.3,
        oscillatorType: 'sine',
        frequency: 62,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 19, time: time + 0.72 }],
        gainAutomation: [
          { type: 'set', value: 0.45 * velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 1.2 },
        ],
        destination,
      });
      noise(context, time, 0.18 * velocity, 0.52, 780, destination);
    },
    playerTone(context, time, midi, velocity, brightness, decay, oscillator) {
      const destination = sfxDestination();
      if (!destination) return;
      playerVoice.play({
        context,
        time,
        midi,
        velocity,
        brightness,
        decay,
        oscillator,
        destination,
        sends: sends(0.2, 0.18),
      });
    },
    fireZap(context, time, midi, velocity) {
      const destination = sfxDestination();
      if (!destination) return;
      const frequency = midiToFreq(midi);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.11,
        oscillatorType: 'sawtooth',
        frequency: frequency * 2,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.55, time: time + 0.085 }],
        gainAutomation: [
          { type: 'set', value: 0.085 * velocity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
        ],
        filter: { type: 'lowpass', frequency: 4800, Q: 1.3 },
        destination,
        sends: sends(0.12, 0.05),
      });
      noise(context, time, 0.035 * velocity, 0.035, 6200, destination);
    },
    reject(context, time, velocity) {
      const destination = sfxDestination();
      if (!destination) return;
      for (const [frequency, offset] of [[246, 0], [261, 0.018]] as const) {
        playOscillatorVoice({
          context,
          time: time + offset,
          stopTime: time + offset + 0.22,
          oscillatorType: 'square',
          frequency,
          frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.36, time: time + offset + 0.19 }],
          gainAutomation: [
            { type: 'set', value: 0.08 * velocity, time: time + offset },
            { type: 'exponentialRamp', value: 0.001, time: time + offset + 0.2 },
          ],
          filter: { type: 'bandpass', frequency: 740, Q: 5 },
          destination,
        });
      }
      noise(context, time, 0.11 * velocity, 0.08, 680, destination);
    },
    staticHit(context, time, velocity, decay, cutoff) {
      const destination = sfxDestination();
      if (!destination) return;
      noise(context, time, velocity, decay, cutoff, destination);
    },
  });

  function noise(context: AudioContext, time: number, velocity: number, decay: number, frequency: number, destination: AudioNode) {
    const buffer = options.mix()?.noiseBuffer;
    if (!buffer) return;
    playNoiseHit({
      context,
      buffer,
      time,
      velocity,
      decay,
      filterType: frequency < 1000 ? 'lowpass' : 'highpass',
      frequency,
      destination,
      offset: (time * 0.371) % Math.max(0.01, buffer.duration - decay),
    });
  }

  function stopContinuousHum(time: number, fade: number) {
    if (!hum) return;
    const end = time + Math.max(0.02, fade);
    hum.output.gain.cancelScheduledValues(time);
    hum.output.gain.setValueAtTime(Math.max(0.001, hum.output.gain.value), time);
    hum.output.gain.exponentialRampToValueAtTime(0.001, end);
    for (const oscillator of hum.oscillators) {
      try {
        oscillator.stop(end + 0.04);
      } catch {
        // A scheduled oscillator may already have ended at the natural run boundary.
      }
    }
    hum = null;
  }

  function dispose() {
    const context = options.context();
    if (context) stopContinuousHum(context.currentTime, 0.02);
    hum = null;
  }

  return { ...inst, dispose };
}

export function stopDriverHum(runtime: BeatLevelAudioRuntime, voices: ReturnType<typeof createMassDriverVoices>, fade = 0.12) {
  const context = runtime.context();
  if (context) voices.stopHum(context.currentTime, fade);
}

