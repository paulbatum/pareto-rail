import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Strandline's kit is built for water: nothing has a hard edge. The bell's
// pulse is the lowest thing in the mix, the pad is a stack of soft
// triangles under a lowpass that opens as the animal wakes, and every
// percussive sound is a click or a bubble rather than a drum. The water bed
// and the high shimmer are live layers the score fades in with life.

export type StrandTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type StrandVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type WaterController = {
  setBed(time: number, level: number, rampSeconds?: number): void;
  setShimmer(time: number, level: number, rampSeconds?: number): void;
};

export function installStrandlineWater(context: AudioContext, mix: MixBus): WaterController {
  if (!mix.noiseBuffer) return { setBed: () => {}, setShimmer: () => {} };
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;

  // The bed: a slow, deep wash.
  const body = context.createBiquadFilter();
  body.type = 'bandpass';
  body.frequency.value = 240;
  body.Q.value = 0.45;
  const bedGain = context.createGain();
  bedGain.gain.value = 0;
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 110;
  lfo.connect(lfoGain).connect(body.frequency);
  const swellLfo = context.createOscillator();
  swellLfo.frequency.value = 0.19;
  const swellGain = context.createGain();
  swellGain.gain.value = 0.025;
  swellLfo.connect(swellGain).connect(bedGain.gain);
  source.connect(body).connect(bedGain);
  bedGain.connect(mix.music);

  // The shimmer: sunlight on the water, very quiet, only when the animal is bright.
  const hiss = context.createBiquadFilter();
  hiss.type = 'highpass';
  hiss.frequency.value = 6200;
  const shimmerGain = context.createGain();
  shimmerGain.gain.value = 0;
  const shimmerLfo = context.createOscillator();
  shimmerLfo.frequency.value = 0.27;
  const shimmerLfoGain = context.createGain();
  shimmerLfoGain.gain.value = 0.01;
  shimmerLfo.connect(shimmerLfoGain).connect(shimmerGain.gain);
  source.connect(hiss).connect(shimmerGain);
  shimmerGain.connect(mix.music);

  source.start();
  lfo.start();
  swellLfo.start();
  shimmerLfo.start();
  const ramp = (param: AudioParam, time: number, level: number, seconds: number) => {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
    param.linearRampToValueAtTime(level, time + seconds);
  };
  return {
    setBed(time, level, rampSeconds = 2) {
      ramp(bedGain.gain, time, level, rampSeconds);
    },
    setShimmer(time, level, rampSeconds = 2) {
      ramp(shimmerGain.gain, time, level, rampSeconds);
    },
  };
}

export function createStrandlineVoices(environment: StrandVoiceEnvironment) {
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

  // The bell's heartbeat: a slow, soft sub thump.
  const pulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.9,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 36, time: time + 0.5 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.5 * vel, time: time + 0.03 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.19,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 44, time: time + 0.11 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.42 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const clickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.03,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 700, time: time + 0.025 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.03 },
    ],
  });

  const subTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.7,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.32 * vel, time: time + 0.03 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.7 },
    ],
  });

  const arpTone = voice<{ vel: number; cutoff: number }>({
    oscillators: [{ type: 'triangle', gain: 0.75 }, { type: 'sine', octave: 1, gain: 0.18 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      cutoff: ({ cutoff }) => cutoff,
      frequencyAutomation: (time, { cutoff }) => [{ type: 'exponentialRamp', value: Math.max(300, cutoff * 0.35), time: time + 0.15 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // A glass bowl: sine with two inharmonic partials.
  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', frequencyRatio: 2.76, gain: 0.12 },
      { type: 'sine', frequencyRatio: 5.4, gain: 0.04 },
    ],
    duration: 0.9,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const chimeTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.75 },
      { type: 'sine', frequencyRatio: 2.0, gain: 0.2 },
      { type: 'sine', frequencyRatio: 4.16, gain: 0.05 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.08,
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.085 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const droneTone = voice<{ vel: number; duration: number; offset: number; level: number }>({
    oscillators: [{ type: 'triangle', midiOffset: ({ offset }) => offset }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 820 },
    gainAutomation: (time, _gain, { vel, duration, level }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.05 * vel * level, time: time + duration * 0.55 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.8,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 30, time: time + 0.5 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.44 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
    ],
  });

  // The sour note: a detuned square tritone under a closing lowpass.
  const stingTone = voice<{ vel: number; detune: number }>({
    oscillators: [{ type: 'square', gain: 0.5, detune: ({ detune }) => detune }],
    duration: 0.42,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      Q: 3,
      frequencyAutomation: (time) => [
        { type: 'set', value: 1500, time },
        { type: 'exponentialRamp', value: 260, time: time + 0.4 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.06 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  const bubbleTone = voice<{ vel: number; rise: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.12,
    stopPadding: 0.02,
    frequencyAutomation: (time, frequency, { rise }) => [{ type: 'exponentialRamp', value: frequency * rise, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.05 * vel, time: time + 0.012 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  const playerToneSpec = voice<{ voice: StrandTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    pulse(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      pulseTone.play({ context, time, frequency: 74, vel, destination: output });
      noiseHit(time, 0.06 * vel, 0.12, 'lowpass', 260, output);
      mix.duckAt(time, 0.72, 0.32);
    },

    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 132, vel, destination: output });
      noiseHit(time, 0.04 * vel, 0.006, 'lowpass', 1800, output);
      mix.duckAt(time, 0.58, 0.16);
    },

    // A water click: a tiny bandpass tick with a sine snap.
    click(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.34 * vel, 0.012, 'bandpass', 2900, duck);
      clickTone.play({ context, time, frequency: 2100, vel, destination: duck });
    },

    shaker(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 7800, duck);
    },

    sub(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subTone.play({ context, time, midi, vel, destination: duck });
    },

    bass(context, time, midi, vel, warmth) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.42;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.26 * vel, time + 0.015);
      subGain.gain.setValueAtTime(0.26 * vel, time + dur * 0.6);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      if (warmth > 0.01) {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 2.2;
        filter.frequency.setValueAtTime(220 + warmth * 700 * vel, time);
        filter.frequency.exponentialRampToValueAtTime(140, time + dur);
        const warmGain = context.createGain();
        warmGain.gain.setValueAtTime(0, time);
        warmGain.gain.linearRampToValueAtTime(0.06 * vel * warmth, time + 0.01);
        warmGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        for (const detune of [-7, 7]) {
          const osc = context.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = midiToFreq(midi + 12);
          osc.detune.value = detune;
          osc.connect(filter);
          osc.start(time);
          osc.stop(time + dur + 0.02);
        }
        filter.connect(warmGain).connect(duck);
      }
    },

    // The pad. `voices` counts detuned layers per note and `cutoff` is how
    // awake the animal is: a single soft triangle at the start, a wide, bright
    // stack by the time the strands are glowing.
    pad(context, time, midis, duration, vel, voicesPerNote, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      const layers = Math.max(1, Math.round(voicesPerNote));
      for (const midi of midis) {
        for (let layer = 0; layer < layers; layer += 1) {
          const detune = layers === 1 ? 0 : (layer / (layers - 1) - 0.5) * 18;
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = layers >= 3 && layer % 2 === 1 ? 'sawtooth' : 'triangle';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1 + layer * 2.7) * 3;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(cutoff * 0.8, time);
          lowpass.frequency.linearRampToValueAtTime(cutoff, time + duration * 0.4);
          lowpass.frequency.linearRampToValueAtTime(cutoff * 0.7, time + duration);
          const level = (0.06 * vel) / (Math.sqrt(midis.length) * Math.sqrt(layers)) * (osc.type === 'sawtooth' ? 0.55 : 1);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(1.2, duration * 0.35));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.4, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.55;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arp(context, time, midi, vel, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, cutoff, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.42 }] });
    },

    bell(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      bellTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.55 }] });
    },

    chime(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      chimeTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.7 }] });
    },

    // Crown dread: a minor-second cluster swelling and dying each bar.
    drone(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const [offset, level] of [[0, 1], [1, 0.6], [-12, 0.7]] as const) {
        droneTone.play({ context, time, midi, duration, vel, offset, level, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.6 }] });
      }
    },

    // A long swell: the pad chord rising through an opening filter.
    swell(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-9, 0, 9]) {
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = detune === 0 ? 'triangle' : 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune;
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(300, time);
          lowpass.frequency.exponentialRampToValueAtTime(2600, time + duration * 0.6);
          lowpass.frequency.exponentialRampToValueAtTime(900, time + duration);
          const level = (detune === 0 ? 0.05 : 0.022) * vel / Math.sqrt(midis.length);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + duration * 0.5);
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.7;
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
          Q: 1.1,
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
      impactTone.play({ context, time, frequency: 96, vel, destination: output });
      noiseHit(time, 0.2 * vel, 0.3, 'lowpass', 320, output);
      noiseHit(time, 0.06 * vel, 0.6, 'highpass', 4800, output);
    },

    sting(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      // Root and tritone, each slightly detuned against itself.
      for (const [offset, detune] of [[0, -8], [0, 8], [6, -6], [6, 6]] as const) {
        stingTone.play({ context, time, midi: midi + offset, vel, detune, destination: output });
      }
    },

    // A few rising bubbles: the water is alive.
    bubbles(context, time, vel, seed) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const count = 2 + (Math.floor(seed * 7) % 3);
      for (let i = 0; i < count; i += 1) {
        const at = time + i * (0.06 + ((seed * 13 + i * 7) % 5) * 0.02);
        const frequency = 900 + ((seed * 31 + i * 17) % 11) * 110;
        bubbleTone.play({ context, time: at, frequency, vel: vel * (0.7 + (i % 2) * 0.3), rise: 1.6 + (i % 3) * 0.25, destination: duck });
      }
    },
  }, {
    pulse: ['vel'],
    kick: ['vel'],
    click: ['vel'],
    shaker: ['vel', 'decay'],
    sub: ['midi', 'vel'],
    bass: ['midi', 'vel', 'warmth'],
    pad: ['midis', 'duration', 'vel', 'voicesPerNote', 'cutoff'],
    arp: ['midi', 'vel', 'cutoff'],
    bell: ['midi', 'vel'],
    chime: ['midi', 'duration', 'vel'],
    drone: ['midi', 'duration', 'vel'],
    swell: ['midis', 'duration', 'vel'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    sting: ['midi', 'vel'],
    bubbles: ['vel', 'seed'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voice: StrandTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice, velocity: vel, weight, destination: output, sends: playerSends(0.34, voice.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  function playerBubble(time: number, frequency: number, vel: number, rise: number) {
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    bubbleTone.play({ context, time, frequency, vel, rise, destination: output, sends: playerSends(0.15, 0.2) });
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise, playerBubble };
}
