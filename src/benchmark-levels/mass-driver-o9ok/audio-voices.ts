import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Construction only. The spine decides what plays and when; this file only
// knows how a coil, a rail, a capacitor bank and a fault alarm are built out of
// oscillators. The two persistent voices — the barrel hum and the charge whine —
// are installed once and driven by handle, because they never stop and never
// retrigger: they are the machine, not an event.

export type MassDriverTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  bite: number;
  space: number;
};

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type BarrelHum = {
  /** Glide the fundamental to `midi`, arriving at `time`. */
  glideTo(midi: number, time: number): void;
  /** Set the fundamental immediately at `time`. */
  setPitch(midi: number, time: number): void;
  /** Overall level of the hum. */
  setLevel(level: number, time: number, glide?: number): void;
  /** Brightness: how much saw sits on top of the sub. */
  setTone(open: number, time: number, glide?: number): void;
  /** The firing-charge whine: level and pitch of the layer above the hum. */
  setCharge(level: number, midi: number, time: number, glide?: number): void;
};

/**
 * The gun is the instrument. One continuous voice runs the whole level: a sub
 * fundamental with two detuned saws an octave up, behind a lowpass that opens
 * as the run accelerates. Above it sits a whine that only exists while the
 * firing charge is building — the countdown you can hear.
 */
export function installBarrelHum(context: AudioContext, mix: MixBus, startMidi: number): BarrelHum {
  const destination = mix.duck ?? mix.music ?? mix.master;

  const humGain = context.createGain();
  humGain.gain.value = 0;
  const humFilter = context.createBiquadFilter();
  humFilter.type = 'lowpass';
  humFilter.frequency.value = 220;
  humFilter.Q.value = 3.2;
  humFilter.connect(humGain).connect(destination);

  const sub = context.createOscillator();
  sub.type = 'sine';
  const subGain = context.createGain();
  subGain.gain.value = 0.75;
  sub.connect(subGain).connect(humFilter);

  // Two saws an octave up, detuned against each other: the beating between them
  // is the barrel resonance, and it gets faster as the pitch climbs.
  const saws: OscillatorNode[] = [];
  const sawGain = context.createGain();
  sawGain.gain.value = 0;
  sawGain.connect(humFilter);
  for (const detune of [-9, 11]) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.connect(sawGain);
    saws.push(osc);
  }

  // Charge whine: bandpassed saws well above the music, silent until the
  // safeties jam.
  const whineGain = context.createGain();
  whineGain.gain.value = 0;
  const whineFilter = context.createBiquadFilter();
  whineFilter.type = 'bandpass';
  whineFilter.Q.value = 5.5;
  whineFilter.frequency.value = 1800;
  whineFilter.connect(whineGain).connect(destination);
  const whines: OscillatorNode[] = [];
  for (const detune of [-6, 7]) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.connect(whineFilter);
    whines.push(osc);
  }

  const setFrequencies = (midi: number, time: number, glide: number) => {
    const base = midiToFreq(midi);
    const apply = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(time);
      if (glide <= 0) param.setValueAtTime(value, time);
      else {
        param.setValueAtTime(Math.max(0.001, param.value), time);
        param.exponentialRampToValueAtTime(Math.max(0.001, value), time + glide);
      }
    };
    apply(sub.frequency, base);
    for (const osc of saws) apply(osc.frequency, base * 2);
  };

  const now = context.currentTime;
  setFrequencies(startMidi, now, 0);
  for (const osc of [sub, ...saws, ...whines]) osc.start(now);
  whines[0].frequency.value = midiToFreq(72);
  whines[1].frequency.value = midiToFreq(72);

  const ramp = (param: AudioParam, value: number, time: number, glide: number) => {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
    if (glide <= 0) param.setValueAtTime(value, time);
    else param.linearRampToValueAtTime(value, time + glide);
  };

  return {
    glideTo(midi, time) {
      const base = midiToFreq(midi);
      const at = Math.max(time, context.currentTime);
      const glide = Math.max(0.05, time - context.currentTime);
      sub.frequency.exponentialRampToValueAtTime(base, at);
      for (const osc of saws) osc.frequency.exponentialRampToValueAtTime(base * 2, at);
      // Brightness follows pitch: a faster gun is a louder gun.
      humFilter.frequency.exponentialRampToValueAtTime(Math.max(120, base * 9), at);
      void glide;
    },
    setPitch(midi, time) {
      setFrequencies(midi, time, 0);
      humFilter.frequency.cancelScheduledValues(time);
      humFilter.frequency.setValueAtTime(Math.max(120, midiToFreq(midi) * 5), time);
    },
    setLevel(level, time, glide = 0.4) {
      ramp(humGain.gain, level, time, glide);
    },
    setTone(open, time, glide = 0.6) {
      ramp(sawGain.gain, open * 0.32, time, glide);
    },
    setCharge(level, midi, time, glide = 0.6) {
      ramp(whineGain.gain, level, time, glide);
      const frequency = midiToFreq(midi);
      for (const osc of whines) {
        osc.frequency.cancelScheduledValues(time);
        osc.frequency.setValueAtTime(Math.max(20, osc.frequency.value), time);
        osc.frequency.exponentialRampToValueAtTime(frequency, time + Math.max(0.05, glide));
      }
      whineFilter.frequency.cancelScheduledValues(time);
      whineFilter.frequency.setValueAtTime(whineFilter.frequency.value, time);
      whineFilter.frequency.exponentialRampToValueAtTime(frequency * 1.6, time + Math.max(0.05, glide));
    },
  };
}

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
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
    duration: 0.17,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 41, time: time + 0.075 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.58 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
  });

  // The coil tick: a metallic ping through a resonant bandpass that rises with
  // the run. This is the sound of passing through a ring.
  const coilPing = voice<{ vel: number; heat: number }>({
    oscillators: [
      { type: 'square', gain: 0.5 },
      { type: 'sine', octave: 1, gain: 0.3 },
    ],
    duration: ({ heat }) => 0.035 + heat * 0.03,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 7,
      cutoff: ({ heat }) => 900 + heat * 4200,
    },
    gainAutomation: (time, gain, { vel, heat }) => [
      { type: 'set', value: gain * vel * (0.5 + heat * 0.5), time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.035 + heat * 0.03 },
    ],
  });

  const snapTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.055,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 150, time: time + 0.045 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.055 },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 3200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 800, time: time + 0.08 }],
    },
    envelope: { decay: 0.09 },
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.042 }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: 3,
      frequency: 3400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 480, time: time + 0.19 }],
    },
    envelope: { decay: 0.22 },
  });

  const alarmTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'square' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'bandpass',
      Q: 4.5,
      frequency: 900,
      frequencyAutomation: (time, { duration }) => [{ type: 'linearRamp', value: 2200, time: time + duration * 0.8 }],
    },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0.001, time },
      { type: 'linearRamp', value: level, time: time + duration * 0.35 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 1.1,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 24, time: time + 0.8 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.6 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.1 },
    ],
  });

  const playerToneSpec = voice<{ voice: MassDriverTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', Q: 2.4, cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.08 * vel, 0.004, 'highpass', 2400, output);
      mix.duckAt(time, 0.44, 0.14);
    },

    /** One ring, passed through. `heat` is how far down the barrel you are. */
    coil(context, time, midi, vel, heat) {
      const output = musicDestination();
      if (!output) return;
      coilPing.play({ context, time, midi, vel, heat, destination: output });
      noiseHit(time, 0.05 * vel * (0.4 + heat), 0.012 + heat * 0.01, 'bandpass', 2600 + heat * 5200, output);
    },

    snap(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.17 * vel, 0.05, 'bandpass', 2100, output);
      noiseHit(time, 0.1 * vel, 0.022, 'highpass', 6400, output);
      snapTone.play({ context, time, frequency: 240, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8800, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.2, 'highpass', 7000, duck);
    },

    ride(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.13, 'bandpass', 10500, duck);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.85, 'highpass', 4200, output);
      noiseHit(time, vel * 0.5, 1.5, 'bandpass', 7600, reverbSend);
    },

    /** Rail bass: a sub with a hard-filtered saw shadow, gated short. */
    bass(context, time, midi, vel, bite) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const duration = 0.19;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.3 * vel, time + 0.006);
      subGain.gain.setValueAtTime(0.3 * vel, time + duration * 0.65);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + duration + 0.02);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 8;
      filter.frequency.setValueAtTime(280 + bite * 1400 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(160, time + duration);
      const shadow = context.createGain();
      shadow.gain.setValueAtTime(0, time);
      shadow.gain.linearRampToValueAtTime(0.085 * vel, time + 0.005);
      shadow.gain.exponentialRampToValueAtTime(0.001, time + duration);
      for (const detune of [-12, 12]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.02);
      }
      filter.connect(shadow).connect(duck);
    },

    /** Barrel resonance: a slow pad that sounds like a big metal tube ringing. */
    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-7, 8]) {
          const osc = context.createOscillator();
          const body = context.createBiquadFilter();
          const tame = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 5;
          body.type = 'bandpass';
          body.Q.value = 1.4;
          body.frequency.setValueAtTime(420, time);
          body.frequency.linearRampToValueAtTime(760, time + duration * 0.5);
          body.frequency.linearRampToValueAtTime(420, time + duration);
          tame.type = 'lowpass';
          tame.frequency.value = 1900;
          const level = (0.042 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.9, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(body).connect(tame).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.55;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, velocity: vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.38 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-13, 13]) {
          stabTone.play({ context, time, midi, detune, vel, velocity: vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.32 }] });
        }
      }
    },

    /** Fault alarm: the interlock telling you it is not going to open. */
    alarm(context, time, midi, duration, level) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, level, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.45 }] });
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
          Q: 1.3,
          frequency: 300,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 8200, time: time + duration }],
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
      noiseHit(time, 0.3 * vel, 0.34, 'lowpass', 380, output);
      instruments.crash(time, 0.18 * vel);
    },
  }, {
    kick: ['vel'],
    coil: ['midi', 'vel', 'heat'],
    snap: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    ride: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel', 'bite'],
    pad: ['midis', 'duration', 'vel'],
    arp: ['midi', 'vel'],
    stab: ['midis', 'vel'],
    alarm: ['midi', 'duration', 'level'],
    riser: ['duration', 'level'],
    impact: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tonalVoice: MassDriverTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonalVoice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({
      context,
      time,
      midi,
      voice: tonalVoice,
      velocity: vel,
      weight,
      destination: output,
      sends: playerSends(0.34, tonalVoice.space),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
