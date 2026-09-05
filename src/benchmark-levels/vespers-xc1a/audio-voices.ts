import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';

// The organ. Every rank is additive sine partials with a pipe's soft attack
// and release; what separates them is the partial recipe, the register, and
// how much wind (chiff) they take. Nothing here decides *what* to play.

export type VespersVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type PipeSpec = {
  partials: ReadonlyArray<readonly [ratio: number, gain: number]>;
  gain: number;
  attack: number;
  release: number;
  cutoff: number;
  chiff: number;
};

export const RANKS = {
  // 16' bourdon plus a 32' shadow: the building's own hum.
  pedal: { partials: [[0.5, 0.55], [1, 1], [2, 0.3], [3, 0.08]], gain: 0.15, attack: 0.09, release: 0.28, cutoff: 900, chiff: 0 },
  // 8' principal: the cantus firmus rank.
  principal: { partials: [[1, 1], [2, 0.42], [3, 0.26], [4, 0.13], [5, 0.05]], gain: 0.075, attack: 0.045, release: 0.14, cutoff: 5200, chiff: 0.03 },
  // 4' flute: round, quiet, few partials.
  flute: { partials: [[1, 1], [2, 0.12], [3, 0.1]], gain: 0.07, attack: 0.06, release: 0.16, cutoff: 3600, chiff: 0.018 },
  // Mixture: the bright upperwork.
  mixture: { partials: [[1, 0.9], [2, 0.6], [3, 0.5], [4, 0.35], [6, 0.18], [8, 0.08]], gain: 0.04, attack: 0.03, release: 0.12, cutoff: 8000, chiff: 0.025 },
  // Trumpet en chamade: the rank held back all night.
  trumpet: { partials: [[1, 1]], gain: 0.06, attack: 0.03, release: 0.12, cutoff: 2600, chiff: 0.04 },
} as const satisfies Record<string, PipeSpec>;

export function createVespersVoices(environment: VespersVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.duck ?? environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

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

  function roomSends(reverb: number, delay = 0) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.reverbSend && reverb > 0) sends.push({ destination: mix.reverbSend, gain: reverb });
    if (mix?.delaySend && delay > 0) sends.push({ destination: mix.delaySend, gain: delay });
    return sends;
  }

  // One pipe: every partial is its own sine with the shared envelope.
  type PipeCall = { spec: PipeSpec; partialGain: number; ratio: number; duration: number; vel: number };
  const partialVoice = voice<PipeCall>({
    oscillators: [{ type: 'sine', frequencyRatio: ({ ratio }) => ratio, gain: ({ partialGain, spec, vel }) => partialGain * spec.gain * vel }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ spec }) => spec.cutoff },
    envelope: {
      attack: ({ spec }) => spec.attack,
      decay: 0.05,
      sustain: 0.9,
      release: ({ spec }) => spec.release,
      releaseCurve: 'linear',
    },
  });

  function pipe(context: AudioContext, time: number, midi: number, duration: number, vel: number, spec: PipeSpec, destination: AudioNode, reverb: number) {
    const sends = roomSends(reverb);
    for (const [ratio, partialGain] of spec.partials) {
      partialVoice.play({ context, time, midi, spec, partialGain, ratio, duration, vel, destination, sends });
    }
    if (spec.chiff > 0) noiseHit(time, spec.chiff * vel, 0.03, 'bandpass', 2400, destination);
  }

  // Trumpet: a sawtooth with a formant, not sines.
  const trumpetVoice = voice<{ duration: number; vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: ({ vel }) => RANKS.trumpet.gain * vel }, { type: 'square', gain: ({ vel }) => RANKS.trumpet.gain * 0.35 * vel, detune: 4 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: { type: 'lowpass', cutoff: RANKS.trumpet.cutoff, Q: 1.6 },
    envelope: { attack: RANKS.trumpet.attack, decay: 0.08, sustain: 0.85, release: RANKS.trumpet.release, releaseCurve: 'linear' },
  });

  // Vox humana: two detuned triangles per note beat slowly against each
  // other, the organ's tremulant.
  const choirVoice = voice<{ duration: number; vel: number }>({
    oscillators: [
      { type: 'triangle', gain: ({ vel }) => 0.03 * vel, detune: -7 },
      { type: 'triangle', gain: ({ vel }) => 0.03 * vel, detune: 7 },
      { type: 'sine', gain: ({ vel }) => 0.02 * vel, octave: 1 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.3,
    filter: { type: 'lowpass', cutoff: 1900 },
    envelope: { attack: 0.35, decay: 0.2, sustain: 0.9, release: 0.35, releaseCurve: 'linear' },
  });

  // Tubular bell: inharmonic partials with one long exponential decay.
  const BELL_PARTIALS: ReadonlyArray<readonly [number, number]> = [[0.5, 0.35], [1, 1], [1.183, 0.5], [1.506, 0.55], [2.0, 0.4], [2.514, 0.3], [2.662, 0.2], [3.011, 0.18], [4.166, 0.09]];
  const bellPartial = voice<{ ratio: number; partialGain: number; vel: number; decay: number }>({
    oscillators: [{ type: 'sine', frequencyRatio: ({ ratio }) => ratio, gain: ({ partialGain, vel }) => 0.11 * partialGain * vel }],
    duration: ({ decay }) => decay,
    stopPadding: 0.1,
    gainAutomation: (time, gain, { decay, ratio }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain, time: time + 0.006 },
      { type: 'exponentialRamp', value: 0.0001, time: time + decay / (0.6 + ratio * 0.5) },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    pedal(context, time, midi, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      pipe(context, time, midi, duration, vel, RANKS.pedal, output, 0.35);
    },
    principal(context, time, midi, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      pipe(context, time, midi, duration, vel, RANKS.principal, output, 0.55);
    },
    flute(context, time, midi, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      pipe(context, time, midi, duration, vel, RANKS.flute, output, 0.5);
    },
    mixture(context, time, midi, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      pipe(context, time, midi, duration, vel, RANKS.mixture, output, 0.6);
    },
    trumpet(context, time, midi, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      trumpetVoice.play({ context, time, midi, duration, vel, destination: output, sends: roomSends(0.55) });
      noiseHit(time, RANKS.trumpet.chiff * vel, 0.025, 'bandpass', 3200, output);
    },
    choir(context, time, midis, duration, vel) {
      const output = musicDestination();
      if (!output) return;
      for (const midi of midis) choirVoice.play({ context, time, midi, duration, vel, destination: output, sends: roomSends(0.7) });
    },
    bell(context, time, midi, vel, decay) {
      const output = musicDestination();
      if (!output) return;
      const sends = roomSends(0.75);
      for (const [ratio, partialGain] of BELL_PARTIALS) {
        bellPartial.play({ context, time, midi, ratio, partialGain, vel, decay, destination: output, sends });
      }
      noiseHit(time, 0.05 * vel, 0.02, 'highpass', 4200, output);
    },
    // The wind: a slow filtered noise swell under the pedal.
    breath(context, time, duration, vel) {
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
          Q: 0.8,
          frequencyAutomation: [
            { type: 'set', value: 220, time },
            { type: 'exponentialRamp', value: 640, time: time + duration * 0.6 },
            { type: 'exponentialRamp', value: 240, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'exponentialRamp', value: 0.05 * vel, time: time + duration * 0.55 },
          { type: 'exponentialRamp', value: 0.0001, time: time + duration },
        ],
        destination: output,
      });
    },
  }, {
    pedal: ['midi', 'duration', 'vel'],
    principal: ['midi', 'duration', 'vel'],
    flute: ['midi', 'duration', 'vel'],
    mixture: ['midi', 'duration', 'vel'],
    trumpet: ['midi', 'duration', 'vel'],
    choir: ['midis', 'duration', 'vel'],
    bell: ['midi', 'vel', 'decay'],
    breath: ['duration', 'vel'],
  });

  // Player-side pipe: same construction, routed to the sfx bus so the
  // player's volume slider owns it.
  function playerPipe(time: number, midi: number, duration: number, vel: number, spec: PipeSpec, reverb = 0.45, delay = 0) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    const sends = roomSends(reverb, delay);
    for (const [ratio, partialGain] of spec.partials) {
      partialVoice.play({ context, time, midi, spec, partialGain, ratio, duration, vel, destination: output, sends });
    }
    if (spec.chiff > 0) noiseHit(time, spec.chiff * vel, 0.03, 'bandpass', 2400, output);
  }

  function playerTrumpet(time: number, midi: number, duration: number, vel: number) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    trumpetVoice.play({ context, time, midi, duration, vel, destination: output, sends: roomSends(0.5, 0.2) });
  }

  function playerBell(time: number, midi: number, vel: number, decay: number) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    const sends = roomSends(0.7);
    for (const [ratio, partialGain] of BELL_PARTIALS) {
      bellPartial.play({ context, time, midi, ratio, partialGain, vel, decay, destination: output, sends });
    }
  }

  function playerChoir(time: number, midis: number[], duration: number, vel: number) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    for (const midi of midis) choirVoice.play({ context, time, midi, duration, vel, destination: output, sends: roomSends(0.7) });
  }

  return {
    ...instruments,
    noiseHit,
    roomSends,
    playerPipe,
    playerTrumpet,
    playerBell,
    playerChoir,
    sfxDestination,
    musicDestination,
  };
}

export type VespersVoices = ReturnType<typeof createVespersVoices>;
