import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Strandline's kit obeys one rule: nothing clicks. Everything in the water has
// an attack you can hear arrive — the bell pulse swells before it lands, the
// pads breathe in, even the percussion is a wet knock rather than a stick.
//
// The two structural voices are the `pulse` (the bell contracting, the level's
// kick and its metronome) and the `flow` bed (a live filtered-noise current
// the score opens and closes as the water changes). Everything sour — the
// parasite `groan`, the spore `hiss` — is detuned against the harmony on
// purpose; it is the only thing in the mix that is out of tune with the animal.

export type StrandTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  sparkle: number;
  reverb: number;
};

export type StrandVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type FlowController = {
  setFlow(time: number, level: number, rampSeconds?: number): void;
  setBrightness(time: number, hz: number, rampSeconds?: number): void;
};

/**
 * The water itself: a looping noise bed under a slow bandpass sweep. The score
 * opens it in the thicket and closes it almost to nothing for the last bars.
 */
export function installStrandlineFlow(context: AudioContext, mix: MixBus): FlowController {
  if (!mix.noiseBuffer) return { setFlow: () => {}, setBrightness: () => {} };
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;

  const body = context.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 420;
  body.Q.value = 0.7;

  // A second, higher band gives the water a faint sparkle near the surface.
  const surface = context.createBiquadFilter();
  surface.type = 'bandpass';
  surface.frequency.value = 2400;
  surface.Q.value = 0.9;
  const surfaceGain = context.createGain();
  surfaceGain.gain.value = 0.1;

  const flowGain = context.createGain();
  flowGain.gain.value = 0;

  // Two slow LFOs: the current swells, and the band drifts. Neither is in time
  // with anything, which is what stops the bed sounding like a synth pad.
  const swell = context.createOscillator();
  swell.frequency.value = 0.07;
  const swellGain = context.createGain();
  swellGain.gain.value = 0.03;
  swell.connect(swellGain).connect(flowGain.gain);

  const drift = context.createOscillator();
  drift.frequency.value = 0.043;
  const driftGain = context.createGain();
  driftGain.gain.value = 190;
  drift.connect(driftGain).connect(body.frequency);

  source.connect(body).connect(flowGain);
  source.connect(surface).connect(surfaceGain).connect(flowGain);
  flowGain.connect(mix.music);
  source.start();
  swell.start();
  drift.start();

  return {
    setFlow(time, level, rampSeconds = 2.5) {
      flowGain.gain.cancelScheduledValues(time);
      flowGain.gain.setValueAtTime(flowGain.gain.value, time);
      flowGain.gain.linearRampToValueAtTime(level, time + rampSeconds);
    },
    setBrightness(time, hz, rampSeconds = 3) {
      body.frequency.cancelScheduledValues(time);
      body.frequency.setValueAtTime(body.frequency.value, time);
      body.frequency.linearRampToValueAtTime(hz, time + rampSeconds);
    },
  };
}

export function createStrandlineVoices(environment: StrandVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;
  const delaySend = () => environment.mix()?.delaySend ?? null;
  const reverbSend = () => environment.mix()?.reverbSend ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'lowpass', frequency: 900, velocity: 1, decay: 0.08 });

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
      offset: Math.random() * 1.4,
    });
  }

  function sends(delay: number, reverb: number) {
    const list: Array<{ destination: AudioNode; gain: number }> = [];
    const delayNode = delaySend();
    const reverbNode = reverbSend();
    if (delayNode && delay > 0) list.push({ destination: delayNode, gain: delay });
    if (reverbNode && reverb > 0) list.push({ destination: reverbNode, gain: reverb });
    return list.length > 0 ? list : undefined;
  }

  // ---- structural voices ---------------------------------------------------

  // The bell contracting. A swell up into the strike, then a long soft body —
  // the opposite shape to a kick drum, and the reason the level never feels
  // like it has a drum machine in it.
  const pulseVoice = voice<{ vel: number; root: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.62,
    stopPadding: 0.06,
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.7, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.09 },
      { type: 'exponentialRamp', value: frequency * 0.82, time: time + 0.55 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0015, time },
      { type: 'linearRamp', value: 0.62 * vel, time: time + 0.035 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
    ],
  });

  const subVoice = voice<{ vel: number; length: number }>({
    oscillators: [{ type: 'sine', gain: 0.34 }, { type: 'triangle', gain: 0.07, detune: 6 }],
    duration: ({ length }) => length,
    stopPadding: 0.08,
    envelope: {
      attack: 0.5,
      decay: 0.9,
      sustain: 0.62,
      release: 1.2,
      attackCurve: 'linear',
    },
  });

  // Water knock: a soft wooden tick with no top end. Marine crackle.
  const knockVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 1700, Q: 1.4 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.45, time: time + 0.055 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.11 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
    ],
  });

  // Pads take a voice count and a cutoff so the arrangement can grow the animal
  // back to life one layer at a time rather than by turning a fader up.
  const padVoice = voice<{ length: number; cutoff: number; weight: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.06 },
      { type: 'sawtooth', gain: 0.05, detune: 9 },
      { type: 'sine', gain: 0.05, octave: -1 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.15,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 0.8 },
    envelope: { attack: 1.1, decay: 1.6, sustain: 0.72, release: 1.6, attackCurve: 'linear' },
  });

  // Glass: the animal's photophores. Two detuned sines plus a fifth partial —
  // a bell without the metal.
  const glassVoice = voice<{ vel: number; decay: number }>({
    oscillators: [
      { type: 'sine', gain: 0.5 },
      { type: 'sine', gain: 0.16, frequencyRatio: 2.02 },
      { type: 'sine', gain: 0.07, frequencyRatio: 3.01 },
    ],
    duration: ({ decay }) => decay,
    stopPadding: 0.08,
    gainAutomation: (time, gain, { vel, decay }) => [
      { type: 'set', value: 0.0015, time },
      { type: 'linearRamp', value: gain * vel, time: time + 0.012 },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const shimmerVoice = voice<{ vel: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: 0.2 }, { type: 'sine', gain: 0.09, octave: 1 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.1,
    envelope: { attack: 0.02, decay: ({ decay }) => decay },
  });

  const arpVoice = voice<{ vel: number; cutoff: number }>({
    oscillators: [{ type: 'triangle', gain: 0.16 }, { type: 'sine', gain: 0.09, octave: 1 }],
    duration: 0.34,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: 0.015, decay: 0.32 },
  });

  const choirVoice = voice<{ vel: number; length: number; cutoff: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.05 },
      { type: 'sawtooth', gain: 0.04, detune: -11 },
      { type: 'sawtooth', gain: 0.035, octave: 1, detune: 7 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.12,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 1.1 },
    envelope: { attack: 0.35, decay: 0.6, sustain: 0.6, release: 0.7, attackCurve: 'linear' },
  });

  // The whale call: the level's biggest single gesture, saved for the two
  // moments the rail swings clear and the whole animal is visible.
  const whaleVoice = voice<{ vel: number; length: number; rise: number }>({
    oscillators: [{ type: 'sine', gain: 0.4 }, { type: 'triangle', gain: 0.1, detune: -8 }],
    duration: ({ length }) => length,
    stopPadding: 0.3,
    filter: { type: 'lowpass', cutoff: 900, Q: 1.6 },
    frequencyAutomation: (time, frequency, { length, rise }) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: frequency * rise, time: time + length * 0.42 },
      { type: 'exponentialRamp', value: frequency * 0.86, time: time + length },
    ],
    envelope: { attack: 0.7, decay: 1.0, sustain: 0.7, release: 1.4, attackCurve: 'linear' },
  });

  // The parasite. Detuned sawtooths a tritone apart, filtered dark — the only
  // interval in the level that fights the harmony instead of joining it.
  const groanVoice = voice<{ vel: number; length: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.09 },
      { type: 'sawtooth', gain: 0.07, midiOffset: 6, detune: -14 },
      { type: 'sine', gain: 0.12, octave: -1 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.15,
    filter: { type: 'lowpass', cutoff: 620, Q: 2.6 },
    envelope: { attack: 0.4, decay: 0.9, sustain: 0.55, release: 1.0, attackCurve: 'linear' },
  });

  const riserVoice = voice<{ length: number; vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.05 }, { type: 'sawtooth', gain: 0.04, detune: 17 }],
    duration: ({ length }) => length,
    stopPadding: 0.1,
    filter: {
      type: 'bandpass',
      Q: 5,
      frequency: 240,
      frequencyAutomation: (time, { length }) => [
        { type: 'set', value: 240, time },
        { type: 'exponentialRamp', value: 3400, time: time + length },
      ],
    },
    gainAutomation: (time, _gain, { length, vel }) => [
      { type: 'set', value: 0.0015, time },
      { type: 'linearRamp', value: vel, time: time + length * 0.86 },
      { type: 'exponentialRamp', value: 0.001, time: time + length },
    ],
  });

  const swellVoice = voice<{ vel: number; length: number }>({
    oscillators: [{ type: 'sine', gain: 0.3 }],
    duration: ({ length }) => length,
    stopPadding: 0.2,
    frequencyAutomation: (time, frequency, { length }) => [
      { type: 'set', value: frequency * 0.55, time },
      { type: 'exponentialRamp', value: frequency, time: time + length * 0.8 },
    ],
    envelope: { attack: ({ length }) => length * 0.7, decay: ({ length }) => length * 0.3, attackCurve: 'linear' },
  });

  return defineInstruments(environment, {
    /** The bell contracting. Half notes through most of the level. */
    pulse(context: AudioContext, time: number, midi: number, vel: number) {
      const destination = musicDestination();
      if (!destination) return;
      pulseVoice.play({ context, time, midi, vel, root: midi, destination });
    },
    sub(context: AudioContext, time: number, midi: number, vel: number, length: number) {
      const destination = musicDestination();
      if (!destination) return;
      subVoice.play({ context, time, midi, vel, velocity: vel, length, destination });
    },
    knock(context: AudioContext, time: number, vel: number, midi: number) {
      const destination = musicDestination();
      if (!destination) return;
      knockVoice.play({ context, time, midi, vel, destination, sends: sends(0.14, 0.2) });
    },
    pad(context: AudioContext, time: number, midis: number[], length: number, weight: number, cutoff: number) {
      const destination = environment.mix()?.duck ?? musicDestination();
      if (!destination) return;
      for (const midi of midis) {
        padVoice.play({ context, time, midi, length, cutoff, weight, velocity: weight, destination, sends: sends(0.1, 0.4) });
      }
    },
    glass(context: AudioContext, time: number, midi: number, vel: number, decay: number) {
      const destination = musicDestination();
      if (!destination) return;
      glassVoice.play({ context, time, midi, vel, decay, gain: 0.2, destination, sends: sends(0.3, 0.42) });
    },
    shimmer(context: AudioContext, time: number, midi: number, vel: number, decay: number) {
      const destination = musicDestination();
      if (!destination) return;
      shimmerVoice.play({ context, time, midi, vel, velocity: vel, decay, destination, sends: sends(0.36, 0.5) });
    },
    arp(context: AudioContext, time: number, midi: number, vel: number, cutoff: number) {
      const destination = musicDestination();
      if (!destination) return;
      arpVoice.play({ context, time, midi, vel, velocity: vel, cutoff, destination, sends: sends(0.26, 0.3) });
    },
    choir(context: AudioContext, time: number, midis: number[], length: number, vel: number, cutoff: number) {
      const destination = environment.mix()?.duck ?? musicDestination();
      if (!destination) return;
      for (const midi of midis) {
        choirVoice.play({ context, time, midi, vel, velocity: vel, length, cutoff, destination, sends: sends(0.16, 0.46) });
      }
    },
    whale(context: AudioContext, time: number, midi: number, vel: number, length: number, rise: number) {
      const destination = musicDestination();
      if (!destination) return;
      whaleVoice.play({ context, time, midi, vel, velocity: vel, length, rise, destination, sends: sends(0.3, 0.6) });
    },
    groan(context: AudioContext, time: number, midi: number, vel: number, length: number) {
      const destination = musicDestination();
      if (!destination) return;
      groanVoice.play({ context, time, midi, vel, velocity: vel, length, destination, sends: sends(0.2, 0.35) });
    },
    riser(context: AudioContext, time: number, length: number, vel: number) {
      const destination = musicDestination();
      if (!destination) return;
      riserVoice.play({ context, time, frequency: 240, length, vel, destination, sends: sends(0.2, 0.4) });
    },
    swell(context: AudioContext, time: number, midi: number, vel: number, length: number) {
      const destination = musicDestination();
      if (!destination) return;
      swellVoice.play({ context, time, midi, vel, velocity: vel, length, destination, sends: sends(0.2, 0.5) });
    },
    /** Water movement under a big event: a filtered surge, not a crash. */
    surge(context: AudioContext, time: number, vel: number) {
      const destination = musicDestination();
      if (!destination) return;
      noiseHit(time, vel * 0.55, 0.9, 'lowpass', 700, destination);
      noiseHit(time + 0.02, vel * 0.2, 0.5, 'bandpass', 2000, destination);
    },

    // ---- player instruments -------------------------------------------------

    /** The player's own light. One timbre spec per section, blended by weight. */
    playerTone(context: AudioContext, time: number, midi: number, spec: StrandTonalVoice, vel: number, weight: number) {
      const destination = sfxDestination();
      if (!destination) return;
      playerToneVoice.play({
        context,
        time,
        midi,
        oscillator: spec.oscillator,
        decayTime: spec.decay,
        gainValue: spec.gain,
        cutoff: spec.cutoff,
        velocity: vel,
        weight,
        destination,
        sends: sends(0.22, spec.reverb),
      });
      if (spec.sparkle > 0.01) {
        sparkleVoice.play({
          context,
          time: time + 0.008,
          midi: midi + 12,
          gainValue: spec.gain * spec.sparkle * 0.45,
          velocity: vel,
          weight,
          destination,
          sends: sends(0.3, spec.reverb * 0.8),
        });
      }
    },
    /** A short breath of water alongside player actions — the physical part. */
    playerWater(context: AudioContext, time: number, vel: number, decay: number, frequency: number) {
      const destination = sfxDestination();
      if (!destination) return;
      noiseHit(time, vel, decay, 'bandpass', frequency, destination);
    },
    playerPluck(context: AudioContext, time: number, midi: number, oscillator: OscillatorType, cutoff: number, gainValue: number, fall: number, weight: number) {
      const destination = sfxDestination();
      if (!destination) return;
      pluckVoice.play({
        context,
        time,
        midi,
        oscillator,
        cutoff,
        gainValue,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - fall), time: time + 0.075 }],
        destination,
        sends: sends(0.18, 0.16),
      });
    },
    /** Chipping something armoured: a wet knock with a tuned tail. */
    chip(context: AudioContext, time: number, midi: number, vel: number) {
      const destination = sfxDestination();
      if (!destination) return;
      chipVoice.play({ context, time, midi, velocity: vel, destination, sends: sends(0.2, 0.28) });
      noiseHit(time, vel * 0.35, 0.05, 'bandpass', 1500, destination);
    },
    /** Something tears loose. */
    tear(context: AudioContext, time: number, midi: number, vel: number) {
      const destination = sfxDestination();
      if (!destination) return;
      tearVoice.play({ context, time, midi, velocity: vel, destination, sends: sends(0.26, 0.55) });
      noiseHit(time, vel * 0.4, 0.32, 'bandpass', 800, destination);
    },
    /** The refusal: a dull closed thud with a detuned pair underneath. */
    refuse(context: AudioContext, time: number, midi: number) {
      const destination = sfxDestination();
      if (!destination) return;
      for (const [offset, at, vel] of [[0, 0, 0.14], [6, 0.085, 0.1]] as const) {
        refuseVoice.play({ context, time: time + at, midi: midi + offset, vel, destination });
      }
      noiseHit(time, 0.13, 0.14, 'lowpass', 380, destination);
    },
    hull(context: AudioContext, time: number, midi: number) {
      const destination = sfxDestination();
      if (!destination) return;
      hullVoice.play({ context, time, midi, destination, sends: sends(0.1, 0.4) });
      noiseHit(time, 0.22, 0.3, 'lowpass', 500, destination);
    },
    slip(context: AudioContext, time: number, midi: number) {
      const destination = sfxDestination();
      if (!destination) return;
      slipVoice.play({
        context,
        time,
        midi,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - 9), time: time + 0.16 }],
        destination,
        sends: sends(0.14, 0.2),
      });
    },
  }, {
    pulse: ['midi', 'vel'],
    sub: ['midi', 'vel', 'length'],
    knock: ['vel', 'midi'],
    pad: ['midis', 'length', 'weight', 'cutoff'],
    glass: ['midi', 'vel', 'decay'],
    shimmer: ['midi', 'vel', 'decay'],
    arp: ['midi', 'vel', 'cutoff'],
    choir: ['midis', 'length', 'vel', 'cutoff'],
    whale: ['midi', 'vel', 'length', 'rise'],
    groan: ['midi', 'vel', 'length'],
    riser: ['length', 'vel'],
    swell: ['midi', 'vel', 'length'],
    surge: ['vel'],
    playerTone: ['midi', 'spec', 'vel', 'weight'],
    playerWater: ['vel', 'decay', 'frequency'],
    playerPluck: ['midi', 'oscillator', 'cutoff', 'gainValue', 'fall', 'weight'],
    chip: ['midi', 'vel'],
    tear: ['midi', 'vel'],
    refuse: ['midi'],
    hull: ['midi'],
    slip: ['midi'],
  });
}

// ---- player voice specs (module scope so the registry closure stays small) ----

const playerToneVoice = voice<{ oscillator: OscillatorType; decayTime: number; gainValue: number; cutoff: number }>({
  oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
  duration: ({ decayTime }) => decayTime,
  stopPadding: 0.06,
  filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff, Q: 1.2 },
  gainAutomation: (time, gain, { decayTime }) => [
    { type: 'set', value: 0.0015, time },
    { type: 'linearRamp', value: gain, time: time + 0.01 },
    { type: 'exponentialRamp', value: 0.001, time: time + decayTime },
  ],
});

const sparkleVoice = voice<{ gainValue: number }>({
  oscillators: [{ type: 'sine', gain: ({ gainValue }) => gainValue }],
  duration: 0.16,
  stopPadding: 0.03,
  envelope: { decay: 0.16 },
});

const pluckVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
  oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
  duration: 0.1,
  stopPadding: 0.03,
  filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
  envelope: { attack: 0.006, decay: 0.09 },
});

const chipVoice = voice({
  oscillators: [{ type: 'triangle', gain: 0.075 }, { type: 'sine', gain: 0.03, octave: 1 }],
  duration: 0.12,
  stopPadding: 0.03,
  filter: { type: 'lowpass', cutoff: 2400 },
  envelope: { attack: 0.005, decay: 0.11 },
});

const tearVoice = voice({
  oscillators: [{ type: 'triangle', gain: 0.13 }, { type: 'sawtooth', gain: 0.045, detune: -12 }],
  duration: 0.6,
  stopPadding: 0.08,
  filter: { type: 'lowpass', cutoff: 1900 },
  envelope: { attack: 0.02, decay: 0.58 },
});

const refuseVoice = voice<{ vel: number }>({
  oscillators: [{ type: 'sawtooth' }, { type: 'sine', gain: 0.5, octave: -1 }],
  duration: 0.24,
  stopPadding: 0.05,
  filter: { type: 'lowpass', cutoff: 420, Q: 3.2 },
  gainAutomation: (time, _gain, { vel }) => [
    { type: 'set', value: vel, time },
    { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
  ],
});

const hullVoice = voice({
  oscillators: [{ type: 'sine', gain: 0.4 }, { type: 'sawtooth', gain: 0.05, midiOffset: 6 }],
  duration: 0.6,
  stopPadding: 0.06,
  filter: { type: 'lowpass', cutoff: 700 },
  envelope: { attack: 0.008, decay: 0.58 },
});

const slipVoice = voice({
  oscillators: [{ type: 'sine', gain: 0.05 }],
  duration: 0.2,
  stopPadding: 0.03,
  envelope: { decay: 0.2 },
});
