import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

// ---- the climbing hum ---------------------------------------------------------
//
// The gun spooling up: detuned saws over a sine sub through a resonant lowpass.
// It is the one voice in the level that never restarts — it idles low in attract
// mode with a slow wobble, climbs bar by bar across the run, accelerates into the
// firing charge, and is cut dead in a heartbeat by THE SHOT.

export type HumRig = {
  setPitch(midi: number, time: number, smoothing?: number): void;
  setOpen(hz: number, time: number, smoothing?: number): void;
  setLevel(level: number, time: number, smoothing?: number): void;
  cut(time: number): void;
  dispose(): void;
};

export function createHumRig(context: AudioContext, destination: AudioNode): HumRig {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 260;
  filter.Q.value = 3.6;

  const output = context.createGain();
  output.gain.value = 0.0001;
  filter.connect(output).connect(destination);

  const sub = context.createOscillator();
  sub.type = 'sine';
  const subGain = context.createGain();
  subGain.gain.value = 0.62;
  sub.connect(subGain).connect(filter);

  const saws: OscillatorNode[] = [];
  for (const detune of [-11, 8, -24, 19]) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.detune.value = detune;
    const gain = context.createGain();
    gain.gain.value = 0.15;
    oscillator.connect(gain).connect(filter);
    saws.push(oscillator);
  }

  const startAt = context.currentTime;
  sub.start(startAt);
  for (const oscillator of saws) oscillator.start(startAt);
  let stopped = false;

  return {
    setPitch(midi, time, smoothing = 0.09) {
      const frequency = midiToFreq(midi);
      sub.frequency.setTargetAtTime(frequency / 2, time, smoothing);
      for (const oscillator of saws) oscillator.frequency.setTargetAtTime(frequency, time, smoothing);
    },
    setOpen(hz, time, smoothing = 0.12) {
      filter.frequency.setTargetAtTime(hz, time, smoothing);
    },
    setLevel(level, time, smoothing = 0.12) {
      output.gain.setTargetAtTime(Math.max(0.0001, level), time, smoothing);
    },
    cut(time) {
      output.gain.cancelScheduledValues(time);
      output.gain.setValueAtTime(output.gain.value, time);
      output.gain.setTargetAtTime(0.0001, time, 0.018);
    },
    dispose() {
      if (stopped) return;
      stopped = true;
      const at = context.currentTime;
      try {
        sub.stop(at);
        for (const oscillator of saws) oscillator.stop(at);
      } catch {
        // Already stopped by a closing context.
      }
    },
  };
}

// ---- the arrangement's instruments --------------------------------------------

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
  const musicOut = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const duckOut = () => environment.mix()?.duck ?? musicOut();

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
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseHitVoice.play({
      context,
      buffer,
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

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.2,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 41, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.56 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  const snareTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.11,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 120, time: time + 0.08 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.16 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  const bassTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.7 }, { type: 'square', gain: 0.3, octave: -1 }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 5,
      frequencyAutomation: (time, { vel }) => [
        { type: 'set', value: 260 + vel * 720, time },
        { type: 'exponentialRamp', value: 150, time: time + 0.19 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.3 * vel, time: time + 0.005 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  // A 303 walking the chord: resonant, short, and always a little rude.
  const acidTone = voice<{ vel: number; cutoff: number; slide: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ slide }) => 0.12 + slide * 0.1,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 11,
      frequencyAutomation: (time, { cutoff, slide }) => [
        { type: 'set', value: cutoff, time },
        { type: 'exponentialRamp', value: 260, time: time + 0.11 + slide * 0.08 },
      ],
    },
    gainAutomation: (time, _gain, { vel, slide }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.1 * vel, time: time + 0.004 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 + slide * 0.1 },
    ],
  });

  const padTone = voice<{ duration: number; bright: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time, { duration, bright }) => [
        { type: 'set', value: 320 + bright * 260, time },
        { type: 'linearRamp', value: 620 + bright * 1500, time: time + duration * 0.55 },
        { type: 'linearRamp', value: 340 + bright * 300, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.042, time: time + Math.min(0.9, duration * 0.3) },
      { type: 'set', value: 0.042, time: time + duration - 0.5 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.13,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 3200 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.15 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  // The klaxon: a two-tone alarm through a narrow band, unmistakably a warning.
  const klaxonTone = voice<{ duration: number; vel: number }>({
    oscillators: [{ type: 'square', gain: 0.6 }, { type: 'sawtooth', gain: 0.4, midiOffset: 0.12 }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: { type: 'bandpass', Q: 3.4, cutoff: 1400 },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: 0.16 * vel, time: time + 0.05 },
      { type: 'set', value: 0.16 * vel, time: time + duration - 0.12 },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const subTone = voice<{ vel: number; decay: number }>({
    oscillators: [{ type: 'sine' }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const sparkleTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 0.7 }, { type: 'triangle', gain: 0.3, octave: 1 }],
    duration: 0.42,
    stopPadding: 0.05,
    filter: { type: 'highpass', cutoff: 900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicOut();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 165, vel, destination: output });
      noiseHit(time, 0.09 * vel, 0.004, 'highpass', 1500, output);
      // Moderate sidechain: the kick's duck IS the pump.
      mix.duckAt(time, 0.46, 0.24);
    },

    clap(_context, time, vel) {
      const output = musicOut();
      const mix = environment.mix();
      if (!output) return;
      noiseHit(time, 0.15 * vel, 0.05, 'bandpass', 1750, output);
      noiseHit(time + 0.012, 0.1 * vel, 0.075, 'bandpass', 2100, output);
      if (mix?.reverbSend) noiseHit(time, 0.07 * vel, 0.06, 'bandpass', 1900, mix.reverbSend);
    },

    hat(_context, time, vel, decay) {
      const duck = duckOut();
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8200, duck);
    },

    snare(context, time, vel) {
      const output = musicOut();
      if (!output) return;
      snareTone.play({ context, time, frequency: 300, vel, destination: output });
      noiseHit(time, 0.13 * vel, 0.055, 'highpass', 3400, output);
    },

    bass(context, time, midi, vel) {
      const duck = duckOut();
      if (!duck) return;
      bassTone.play({ context, time, midi, vel, destination: duck });
    },

    acid(context, time, midi, vel, cutoff, slide) {
      const mix = environment.mix();
      const duck = duckOut();
      if (!duck) return;
      acidTone.play({
        context,
        time,
        midi,
        vel,
        cutoff,
        slide,
        destination: duck,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.3 }] : undefined,
      });
    },

    pad(context, time, midis, duration, bright) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const destinations: AudioNode[] = [mix.duck];
      if (mix.reverbSend) destinations.push(mix.reverbSend);
      for (const midi of midis as number[]) {
        for (const detune of [-8, 8]) {
          padTone.play({ context, time, midi, detune, duration, bright, destination: destinations });
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      const duck = duckOut();
      if (!duck) return;
      arpTone.play({
        context,
        time,
        midi,
        vel,
        destination: duck,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.5 }] : undefined,
      });
    },

    klaxon(context, time, midi, duration, vel) {
      const mix = environment.mix();
      const output = musicOut();
      if (!output) return;
      klaxonTone.play({
        context,
        time,
        midi,
        duration,
        vel,
        destination: output,
        sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.5 }] : undefined,
      });
    },

    alarm(context, time, duration, fromMidi, toMidi) {
      const output = musicOut();
      const mix = environment.mix();
      if (!output) return;
      // A rising sweep: the charge announcing itself over the top of the mix.
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.08,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(fromMidi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(toMidi), time: time + duration }],
        filter: {
          type: 'bandpass',
          Q: 6,
          frequencyAutomation: [
            { type: 'set', value: 700, time },
            { type: 'exponentialRamp', value: 3400, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'exponentialRamp', value: 0.09, time: time + duration * 0.8 },
          { type: 'linearRamp', value: 0, time: time + duration },
        ],
        destination: output,
        sends: mix?.reverbSend ? [{ destination: mix.reverbSend, gain: 0.4 }] : [],
      });
    },

    riser(context, time, duration, peak) {
      const output = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.12,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.3,
          frequencyAutomation: [
            { type: 'set', value: 340, time },
            { type: 'exponentialRamp', value: 7200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: peak, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.06 },
        ],
        destination: output,
      });
    },

    impact(context, time, vel) {
      const output = musicOut();
      if (!output) return;
      subTone.play({
        context,
        time,
        frequency: 190,
        vel: 0.62 * vel,
        decay: 0.85,
        destination: output,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 32, time: time + 0.5 }],
      });
      noiseHit(time, 0.24 * vel, 0.22, 'lowpass', 900, output);
    },

    crash(_context, time, vel) {
      const output = musicOut();
      const mix = environment.mix();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 1.5, 'highpass', 5200, output);
      if (mix?.reverbSend) noiseHit(time, 0.16 * vel, 2.2, 'highpass', 4200, mix.reverbSend);
    },

    sparkle(context, time, midi, vel) {
      const mix = environment.mix();
      const output = musicOut();
      if (!output) return;
      const sends: Array<{ destination: AudioNode; gain: number }> = [];
      if (mix?.delaySend) sends.push({ destination: mix.delaySend, gain: 0.65 });
      if (mix?.reverbSend) sends.push({ destination: mix.reverbSend, gain: 0.5 });
      sparkleTone.play({ context, time, midi, vel, destination: output, sends });
    },

    subPulse(context, time, midi, vel, decay) {
      const output = musicOut();
      if (!output) return;
      subTone.play({ context, time, midi, vel, decay, destination: output });
    },

    rumble(context, time, duration) {
      const output = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output) return;
      // Containment failure: everything drops to a long low sub and filtered noise.
      subTone.play({
        context,
        time,
        frequency: 58,
        vel: 0.5,
        decay: duration,
        destination: output,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 24, time: time + duration }],
      });
      if (!buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.15,
        loop: true,
        filter: {
          type: 'lowpass',
          Q: 2,
          frequencyAutomation: [
            { type: 'set', value: 1800, time },
            { type: 'exponentialRamp', value: 90, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.28, time },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
    },
  }, {
    kick: ['vel'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    snare: ['vel'],
    bass: ['midi', 'vel'],
    acid: ['midi', 'vel', 'cutoff', 'slide'],
    pad: ['midis', 'duration', 'bright'],
    arp: ['midi', 'vel'],
    klaxon: ['midi', 'duration', 'vel'],
    alarm: ['duration', 'fromMidi', 'toMidi'],
    riser: ['duration', 'peak'],
    impact: ['vel'],
    crash: ['vel'],
    sparkle: ['midi', 'vel'],
    subPulse: ['midi', 'vel', 'decay'],
    rumble: ['duration'],
  });

  return { ...instruments, noiseHit };
}

export type MassDriverVoices = ReturnType<typeof createMassDriverVoices>;
