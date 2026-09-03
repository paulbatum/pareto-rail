import { defineInstruments, playOscillatorVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Strandline's kit is water first: a filtered-noise wash that breathes under
// everything, soft low-pulse heartbeat kicks, glassy droplet bells, and pads
// that gain brightness as the jelly comes back to life. The wake act adds a
// dry ticking kit; the parent act adds a low dread pulse; the resolve strips
// everything back to a warm detuned stack through the wash.

export type StrandlineTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  sparkle: number;
  reverb: number;
};

export type StrandlineVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type WaterController = {
  setWater(time: number, level: number, rampSeconds?: number): void;
  setBrightness(time: number, frequency: number, rampSeconds?: number): void;
};

export function installStrandlineWater(context: AudioContext, mix: MixBus): WaterController {
  if (!mix.noiseBuffer) return { setWater: () => {}, setBrightness: () => {} };
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;
  const body = context.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 900;
  body.Q.value = 0.3;
  const shimmer = context.createBiquadFilter();
  shimmer.type = 'highpass';
  shimmer.frequency.value = 5200;
  const shimmerGain = context.createGain();
  shimmerGain.gain.value = 0.05;
  const waterGain = context.createGain();
  waterGain.gain.value = 0;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.11;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 320;
  lfo.connect(lfoGain).connect(body.frequency);
  const swell = context.createOscillator();
  swell.frequency.value = 0.23;
  const swellGain = context.createGain();
  swellGain.gain.value = 0.03;
  swell.connect(swellGain).connect(waterGain.gain);
  source.connect(body).connect(waterGain);
  source.connect(shimmer).connect(shimmerGain).connect(waterGain);
  waterGain.connect(mix.music);
  source.start();
  lfo.start();
  swell.start();
  return {
    setWater(time, level, rampSeconds = 2) {
      waterGain.gain.cancelScheduledValues(time);
      waterGain.gain.setValueAtTime(waterGain.gain.value, time);
      waterGain.gain.linearRampToValueAtTime(level, time + rampSeconds);
    },
    setBrightness(time, frequency, rampSeconds = 2) {
      body.frequency.cancelScheduledValues(time);
      body.frequency.setValueAtTime(body.frequency.value, time);
      body.frequency.linearRampToValueAtTime(frequency, time + rampSeconds);
    },
  };
}

const pulseTone = voice<{ vel: number }>({
  oscillators: [{ type: 'sine' }],
  duration: 0.3,
  stopPadding: 0.04,
  frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 38, time: time + 0.16 }],
  gainAutomation: (time, _gain, { vel }) => [
    { type: 'set', value: 0.5 * vel, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
  ],
});

const dropletTone = voice<{ vel: number; cutoff: number }>({
  oscillators: [
    { type: 'sine', gain: 0.8 },
    { type: 'sine', frequencyRatio: 3.01, gain: 0.12 },
  ],
  duration: 0.7,
  stopPadding: 0.08,
  filter: {
    type: 'lowpass',
    cutoff: ({ cutoff }) => cutoff,
    frequencyAutomation: (time, { cutoff }) => [
      { type: 'exponentialRamp', value: Math.max(400, cutoff * 0.25), time: time + 0.5 },
    ],
  },
  gainAutomation: (time, _gain, { vel }) => [
    { type: 'set', value: 0.11 * vel, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
  ],
});

const bassTone = voice<{ vel: number }>({
  oscillators: [{ type: 'triangle', gain: 0.75 }, { type: 'sine', gain: 0.5 }],
  duration: 0.5,
  stopPadding: 0.05,
  filter: { type: 'lowpass', frequency: 900 },
  gainAutomation: (time, _gain, { vel }) => [
    { type: 'set', value: 0.22 * vel, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
  ],
});

export function createStrandlineVoices(environment: StrandlineVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const washHit = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

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
    washHit.play({
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

  const instruments = defineInstruments(
    { trace: environment.trace, context: environment.context },
    {
      kick(context, time, vel: number) {
        const output = musicDestination();
        if (!output) return;
        pulseTone.play({ context, time, frequency: 120, vel, destination: output });
      },

      hat(context, time, vel: number, open: boolean) {
        const output = musicDestination();
        if (!output) return;
        void context;
        noiseHit(time, (open ? 0.1 : 0.055) * vel, open ? 0.22 : 0.035, 'highpass', 7400, output);
      },

      bass(context, time, midi: number, vel: number) {
        const output = musicDestination();
        if (!output) return;
        bassTone.play({ context, time, midi, vel, destination: output });
      },

      // A glass droplet: the bell that rings the vista reveals and carries
      // the kill lane in the quiet acts.
      droplet(context, time, midi: number, vel: number, cutoff: number) {
        const mix = environment.mix();
        const output = musicDestination();
        if (!output) return;
        dropletTone.play({
          context,
          time,
          midi,
          vel,
          cutoff,
          destination: output,
          sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.5 }] : undefined,
        });
      },

      // The coming-alive pad. `voices` counts detuned layers per note and
      // `cutoff` is the health of the animal: narrow and dim in the drift,
      // wide and bright by the crown.
      pad(context, time, midis: number[], duration: number, vel: number, voicesPerNote: number, cutoff: number) {
        const mix = environment.mix();
        if (!mix?.duck || !mix.reverbSend) return;
        const reverbSend = mix.reverbSend;
        const layers = Math.max(1, Math.round(voicesPerNote));
        for (const midi of midis) {
          for (let layer = 0; layer < layers; layer += 1) {
            const detune = layers === 1 ? 0 : (layer / (layers - 1) - 0.5) * 22;
            const osc = context.createOscillator();
            const lowpass = context.createBiquadFilter();
            const gain = context.createGain();
            osc.type = layers === 1 ? 'sine' : 'sawtooth';
            osc.frequency.value = midiToFreq(midi);
            osc.detune.value = detune + Math.sin(midi * 5.1 + layer * 2.7) * 3;
            lowpass.type = 'lowpass';
            lowpass.frequency.setValueAtTime(cutoff, time);
            lowpass.frequency.linearRampToValueAtTime(cutoff * 0.72, time + duration);
            const level = (0.052 * vel) / (Math.sqrt(midis.length) * Math.sqrt(layers));
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(level, time + Math.min(0.9, duration * 0.3));
            gain.gain.setValueAtTime(level, time + duration - Math.min(1.1, duration * 0.35));
            gain.gain.linearRampToValueAtTime(0, time + duration);
            osc.connect(lowpass).connect(gain);
            gain.connect(mix.duck);
            const send = context.createGain();
            send.gain.value = 0.5;
            gain.connect(send).connect(reverbSend);
            osc.start(time);
            osc.stop(time + duration + 0.05);
          }
        }
      },

      riser(context, time, seconds: number) {
        const output = musicDestination();
        const noiseBuffer = environment.mix()?.noiseBuffer;
        if (!output || !noiseBuffer) return;
        const source = context.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 1.2;
        filter.frequency.setValueAtTime(300, time);
        filter.frequency.exponentialRampToValueAtTime(4200, time + seconds);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.22, time + seconds);
        gain.gain.exponentialRampToValueAtTime(0.001, time + seconds + 0.15);
        source.connect(filter).connect(gain).connect(output);
        source.start(time);
        source.stop(time + seconds + 0.2);
      },
    },
  );

  // Player-instrument tone: one voice spec reused for locks and kills so the
  // gun always sounds like the same instrument as the score.
  const playerTone = voice<{ vel: number; cutoff: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: 0.75 }, { type: 'sine', gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  // A warm detuned resolve stack for the coda and run-end bloom.
  function resolvePad(time: number, midis: number[], seconds: number, vel = 1) {
    const context = environment.context();
    const destination = musicDestination();
    const mix = environment.mix();
    if (!context || !destination) return;
    for (const midi of midis) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + seconds,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 500, time },
              { type: 'linearRamp', value: 1800, time: time + Math.min(1.2, seconds * 0.4) },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.0001, time },
            { type: 'linearRamp', value: 0.03 * vel, time: time + 0.3 },
            { type: 'exponentialRamp', value: 0.001, time: time + seconds },
          ],
          destination,
          sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : undefined,
        });
      }
    }
  }

  return {
    kick: (time: number, vel: number) => instruments.kick(time, vel),
    hat: (time: number, vel: number, open: boolean) => instruments.hat(time, vel, open),
    bass: (time: number, midi: number, vel: number) => instruments.bass(time, midi, vel),
    droplet: (time: number, midi: number, vel: number, cutoff?: number) =>
      instruments.droplet(time, midi, vel, cutoff ?? 3600),
    pad: (time: number, midis: number[], duration: number, vel?: number, voices?: number, cutoff?: number) =>
      instruments.pad(time, midis, duration, vel ?? 1, voices ?? 2, cutoff ?? 1500),
    riser: (time: number, seconds: number) => instruments.riser(time, seconds),
    noiseHit,
    playerTone,
    resolvePad,
    sfxDestination,
    musicDestination,
  };
}

export type StrandlineVoices = ReturnType<typeof createStrandlineVoices>;
