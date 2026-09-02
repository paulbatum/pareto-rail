import { defineInstruments, playBufferSourceVoice, playOscillatorVoice, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import { midiToFreq } from '../../engine/music';

// Leaf: the level's synth voices. Every drum is built from the same material
// as the cube's snaps — a click transient over a short tuned body — so the kit
// and the puzzle read as one instrument. Nothing here decides *when*; audio.ts
// owns the arrangement and the player's instruments.

export type SpeedsolveVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type SnapSoundKind = 'arm' | 'solve' | 'idle' | 'arrive';

export function createSpeedsolveVoices(environment: SpeedsolveVoiceEnvironment) {
  const musicOut = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const duckOut = () => environment.mix()?.duck ?? environment.mix()?.master ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
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
      loopStart: Math.random(),
      offset: Math.random() * 1.5,
    });
  }

  // A kick that lands like a heavy layer: short sine drop with a click on top.
  const thockTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.16,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 46, time: time + 0.085 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.58 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // The cube's snap body: a hollow plastic "thock" a fifth above the kick.
  const snapBody = voice<{ vel: number; drop: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.09,
    stopPadding: 0.02,
    frequencyAutomation: (time, frequency, { drop }) => [{ type: 'exponentialRamp', value: frequency * drop, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.3 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
    ],
  });

  const woodTick = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.026,
    stopPadding: 0.01,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.026 },
    ],
  });

  const subTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'triangle', octave: 1, gain: 0.14 },
    ],
    duration: 0.24,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 340 },
    gainAutomation: (time, gain) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.36 * gain, time: time + 0.005 },
      { type: 'set', value: 0.36 * gain, time: time + 0.16 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
    ],
  });

  const pluckTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 1 },
      { type: 'square', gain: 0.22 },
    ],
    duration: 0.11,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ vel }) => 1800 + vel * 1400 },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0.12 * vel * gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  const padTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration }) => [
        { type: 'set', value: 380, time },
        { type: 'linearRamp', value: 640, time: time + duration * 0.45 },
        { type: 'linearRamp', value: 380, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.03, time: time + 0.35 },
      { type: 'set', value: 0.03, time: time + duration - 0.4 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'square', gain: 0.6 },
      { type: 'sawtooth', gain: 0.5, detune: 5 },
    ],
    duration: 0.13,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 1900 },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: 0.05 * vel * gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  const chimeTone = voice<{ vel: number; decay: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', octave: 1, gain: 0.35, detune: 4 },
      { type: 'triangle', octave: 2, gain: 0.08 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { vel, decay }) => [
      { type: 'set', value: 0.12 * vel * gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const boomTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.6,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 36, time: time + 0.36 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
    ],
  });

  // Metallic ping for hub chips: a square through a resonant bandpass.
  const pingTone = voice<{ intensity: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 9, cutoff: ({ intensity }) => 1400 + intensity * 2200 },
    gainAutomation: (time, _gain, { intensity }) => [
      { type: 'set', value: 0.16 + intensity * 0.1, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    thock(context, time, vel) {
      const mix = environment.mix();
      const output = musicOut();
      if (!mix || !output) return;
      thockTone.play({ context, time, frequency: 168, vel, destination: output });
      noiseHit(time, 0.11 * vel, 0.004, 'highpass', 2600, output);
      mix.duckAt(time, 0.5, 0.2);
    },

    click(_context, time, vel, decay) {
      const output = duckOut();
      if (!output) return;
      noiseHit(time, vel, decay, 'highpass', 8400, output);
    },

    clack(context, time, vel) {
      const output = duckOut();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 0.03, 'bandpass', 2300, output);
      woodTick.play({ context, time, frequency: 1350, vel: vel * 0.8, destination: output });
    },

    sub(context, time, midi, vel) {
      const output = duckOut();
      if (!output) return;
      subTone.play({ context, time, midi, vel, gain: vel, destination: output });
    },

    pluck(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      pluckTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.22 }] });
    },

    pad(context, time, midis, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      for (const midi of midis) {
        for (const detune of [-6, 6]) {
          padTone.play({ context, time, midi, detune, duration, destination: [mix.duck, mix.delaySend] });
        }
      }
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      for (const midi of midis) {
        stabTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.3 }] });
      }
    },

    tick(context, time, midi, vel) {
      const output = duckOut();
      if (!output) return;
      woodTick.play({ context, time, midi, vel, destination: output });
    },

    // The cube's percussion. Every layer snap is a click transient, a hollow
    // body, and a wooden tick; solves add the second-stage click of a real
    // cube turn landing home.
    snap(context, time, vel, kind) {
      const output = sfxOut();
      if (!output) return;
      const heavy = kind === 'arrive' ? 1.6 : 1;
      noiseHit(time, 0.18 * vel * heavy, 0.006, 'highpass', 5200, output);
      snapBody.play({ context, time, frequency: kind === 'arrive' ? 150 : 236, vel: vel * heavy, drop: 0.45, destination: output });
      woodTick.play({ context, time, frequency: kind === 'arm' ? 2300 : 1900, vel: vel * 0.8, destination: output });
      if (kind === 'solve' || kind === 'arrive') {
        noiseHit(time + 0.014, 0.1 * vel, 0.008, 'highpass', 4200, output);
        woodTick.play({ context, time: time + 0.014, frequency: 1500, vel: vel * 0.55, destination: output });
      }
    },

    boom(context, time, vel) {
      const output = sfxOut();
      if (!output) return;
      boomTone.play({ context, time, frequency: 120, vel, destination: output });
      noiseHit(time, 0.14 * vel, 0.12, 'lowpass', 900, output);
    },

    // Loose cubies clattering away: a burst of little clicks over `spread`.
    cascade(context, time, count, spread) {
      const output = sfxOut();
      if (!output) return;
      for (let i = 0; i < count; i += 1) {
        const at = time + (i / count) * spread + ((i * 7) % 5) * 0.004;
        const vel = 0.7 - (i / count) * 0.5;
        noiseHit(at, 0.12 * vel, 0.005, 'highpass', 4800 + ((i * 13) % 7) * 300, output);
        woodTick.play({ context, time: at, frequency: 1500 + ((i * 11) % 6) * 210, vel, destination: output });
      }
    },

    riser(context, time, duration, level) {
      const output = musicOut();
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
          Q: 1.4,
          frequencyAutomation: [
            { type: 'set', value: 260, time },
            { type: 'exponentialRamp', value: 5600, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.13 * level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    // The rail swinging round the cube: air moving, quiet, under the fill.
    whoosh(context, time, duration) {
      const output = musicOut();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'lowpass',
          Q: 0.8,
          frequencyAutomation: [
            { type: 'set', value: 420, time },
            { type: 'exponentialRamp', value: 2600, time: time + duration * 0.55 },
            { type: 'exponentialRamp', value: 500, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.06, time: time + duration * 0.5 },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
    },

    chime(context, time, midi, vel, decay) {
      const mix = environment.mix();
      const output = sfxOut();
      if (!output) return;
      chimeTone.play({
        context,
        time,
        midi,
        vel,
        decay,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.45 }] : undefined,
      });
    },

    ping(context, time, midi, intensity) {
      const mix = environment.mix();
      const output = sfxOut();
      if (!output) return;
      pingTone.play({
        context,
        time,
        midi,
        intensity,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.35 }] : undefined,
      });
      noiseHit(time, 0.06, 0.02, 'highpass', 6000, output);
    },

    // Core hits: an anvil that grows with the damage dealt. A sine root drop,
    // the chord struck as a metallic face, and a beacon climbing the lead set.
    anvil(context, time, rootMidi, chordMidis, beaconMidi, intensity) {
      const mix = environment.mix();
      const output = sfxOut();
      if (!output) return;
      const rootFreq = midiToFreq(rootMidi + 12);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.45,
        oscillatorType: 'sine',
        frequency: rootFreq * 3,
        frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.09 }],
        gainAutomation: [
          { type: 'set', value: 0.24 + 0.16 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.38 },
        ],
        destination: output,
      });
      for (const midi of chordMidis) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 0.24,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          filter: { type: 'lowpass', frequency: 2000 + 2800 * intensity },
          gainAutomation: [
            { type: 'set', value: 0.04 + 0.02 * intensity, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
          ],
          destination: output,
          sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : undefined,
        });
      }
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.55,
        oscillatorType: 'sine',
        frequency: midiToFreq(beaconMidi + 12),
        gainAutomation: [
          { type: 'set', value: 0.07 + 0.07 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
        ],
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.5 }] : undefined,
      });
      noiseHit(time, 0.12 + 0.08 * intensity, 0.06, 'bandpass', 1400, output);
    },
  }, {
    thock: ['vel'],
    click: ['vel', 'decay'],
    clack: ['vel'],
    sub: ['midi', 'vel'],
    pluck: ['midi', 'vel'],
    pad: ['midis', 'duration'],
    stab: ['midis', 'vel'],
    tick: ['midi', 'vel'],
    snap: ['vel', 'kind'],
    boom: ['vel'],
    cascade: ['count', 'spread'],
    riser: ['duration', 'level'],
    whoosh: ['duration'],
    chime: ['midi', 'vel', 'decay'],
    ping: ['midi', 'intensity'],
    anvil: ['rootMidi', 'chordMidis', 'beaconMidi', 'intensity'],
  });

  return { ...instruments, noiseHit, sfxOut, duckOut, musicOut };
}

export type SpeedsolveVoices = ReturnType<typeof createSpeedsolveVoices>;
