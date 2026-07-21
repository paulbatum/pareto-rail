import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type MassDriverTone = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; edge: number; reverb: number };

export type MassDriverVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type BarrelHum = {
  /** Glide the hum to a new pitch. This is the gun charging, and it only rises. */
  setMidi(midi: number, time: number, glide: number): void;
  /** Open the hum's filter and gain as the firing charge builds. */
  setDrive(amount: number, time: number, smoothing?: number): void;
};

/**
 * The barrel hum: two detuned saws through a resonant lowpass, running for the
 * entire level and never retriggered. Its pitch is the gun's charge state, so
 * the single longest musical gesture in the run is the thing the player is
 * riding. Everything else in the arrangement is scored on top of this.
 */
export function installBarrelHum(context: AudioContext, mix: MixBus): BarrelHum {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 190;
  filter.Q.value = 5.5;

  const level = context.createGain();
  level.gain.value = 0.19;

  const oscillators: OscillatorNode[] = [];
  for (const detune of [-8, 7]) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(26);
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start();
    oscillators.push(osc);
  }

  // A sub sine under the saws so the hum has weight on small speakers too.
  const sub = context.createOscillator();
  const subGain = context.createGain();
  sub.type = 'sine';
  sub.frequency.value = midiToFreq(26);
  subGain.gain.value = 0.3;
  sub.connect(subGain).connect(level);
  sub.start();

  // Slow amplitude breathing: a machine idling, not a held synth pad.
  const lfo = context.createOscillator();
  const lfoGain = context.createGain();
  lfo.frequency.value = 0.14;
  lfoGain.gain.value = 0.035;
  lfo.connect(lfoGain).connect(level.gain);
  lfo.start();

  filter.connect(level).connect(mix.music);

  return {
    setMidi(midi, time, glide) {
      const frequency = midiToFreq(midi);
      for (const osc of oscillators) {
        osc.frequency.cancelScheduledValues(time);
        osc.frequency.setValueAtTime(osc.frequency.value, time);
        osc.frequency.exponentialRampToValueAtTime(Math.max(8, frequency), time + glide);
      }
      sub.frequency.cancelScheduledValues(time);
      sub.frequency.setValueAtTime(sub.frequency.value, time);
      sub.frequency.exponentialRampToValueAtTime(Math.max(8, frequency * 0.5), time + glide);
    },
    setDrive(amount, time, smoothing = 1.2) {
      filter.frequency.setTargetAtTime(180 + amount * 900, time, smoothing);
      level.gain.setTargetAtTime(0.17 + amount * 0.16, time, smoothing);
    },
  };
}

export function createMassDriverVoices(environment: MassDriverVoiceEnvironment) {
  const musicOut = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxOut = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseVoice.play({ context, buffer, time, velocity: vel, decay, filterType, frequency, destination, offset: Math.random() * 1.4 });
  }

  // The coil pulse. One of these lands on every beat of the run, and the camera
  // crosses a ring at the same instant — so this is not a kick drum, it is the
  // sound of the thing you are riding through.
  const coilThump = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.17,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 41, time: time + 0.075 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.58 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
    ],
  });

  const coilRing = voice<{ vel: number; bright: number }>({
    oscillators: [{ type: 'square', gain: 0.055 }],
    duration: 0.055,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 3.2,
      cutoff: ({ bright }) => 1800 + bright * 2600,
    },
    envelope: { decay: 0.055 },
  });

  const subTone = voice<{ vel: number; growl: number }>({
    oscillators: [{ type: 'sine', gain: 0.32 }],
    duration: 0.22,
    stopPadding: 0.03,
    envelope: { attack: 0.006, decay: 0.2 },
  });

  const reeseTone = voice<{ vel: number; growl: number }>({
    oscillators: [
      { type: 'sawtooth', octave: 1, gain: 0.075, detune: -13 },
      { type: 'sawtooth', octave: 1, gain: 0.075, detune: 13 },
    ],
    duration: 0.22,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 6,
      cutoff: ({ growl }) => 280 + growl * 1100,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 190, time: time + 0.2 }],
    },
    envelope: { attack: 0.005, decay: 0.2 },
  });

  const arcTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.055 }],
    duration: 0.085,
    stopPadding: 0.02,
    filter: {
      type: 'bandpass',
      Q: 2.4,
      frequency: 3200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 900, time: time + 0.08 }],
    },
    envelope: { decay: 0.085 },
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.042 }],
    duration: 0.3,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 4200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 620, time: time + 0.26 }],
    },
    envelope: { decay: 0.3 },
  });

  const alarmTone = voice<{ duration: number; level: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'bandpass',
      Q: 6,
      frequency: 700,
      frequencyAutomation: (time, { duration }) => [{ type: 'linearRamp', value: 2200, time: time + duration * 0.75 }],
    },
    gainAutomation: (time, _gain, { duration, level }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: level, time: time + duration * 0.55 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.85,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 26, time: time + 0.55 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.55 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
    ],
  });

  const playerToneSpec = voice<{ tone: MassDriverTone }>({
    oscillators: [{ type: ({ tone }) => tone.oscillator, gain: ({ tone }) => tone.gain }],
    duration: ({ tone }) => tone.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ tone }) => tone.cutoff },
    envelope: { decay: ({ tone }) => tone.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    coil(context, time, vel, bright) {
      const mix = environment.mix();
      const out = musicOut();
      if (!mix || !out) return;
      coilThump.play({ context, time, frequency: 168, vel, destination: out });
      coilRing.play({ context, time, midi: 79, vel, bright, velocity: vel, destination: out });
      noiseHit(time, 0.075 * vel, 0.006, 'highpass', 2600, out);
      mix.duckAt(time, 0.46, 0.13);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 9200, duck);
    },

    sizzle(_context, time, vel) {
      // Corona static off the coils; the level's only "cymbal".
      const out = musicOut();
      if (!out) return;
      noiseHit(time, vel, 0.5, 'bandpass', 6400, out);
    },

    crash(_context, time, vel) {
      const out = musicOut();
      const reverbSend = environment.mix()?.reverbSend;
      if (!out || !reverbSend) return;
      noiseHit(time, vel, 0.85, 'highpass', 5200, out);
      noiseHit(time, vel * 0.5, 1.5, 'bandpass', 8200, reverbSend);
    },

    bass(context, time, midi, vel, growl) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      subTone.play({ context, time, midi, vel, growl, velocity: vel, destination: duck });
      reeseTone.play({ context, time, midi, vel, growl, velocity: vel, destination: duck });
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      // The bore's own resonance: narrow, metallic, and slightly out of tune
      // with itself, so long tones beat against each other like a big cavity.
      for (const midi of midis) {
        for (const detune of [-7, 6]) {
          const osc = context.createOscillator();
          const band = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 5;
          band.type = 'bandpass';
          band.Q.value = 1.4;
          band.frequency.setValueAtTime(430, time);
          band.frequency.linearRampToValueAtTime(1150, time + duration * 0.6);
          band.frequency.linearRampToValueAtTime(520, time + duration);
          const peak = (0.042 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(peak, time + Math.min(0.9, duration * 0.3));
          gain.gain.setValueAtTime(peak, time + duration - Math.min(1.0, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(band).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.55;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arc(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arcTone.play({ context, time, midi, vel, velocity: vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.38 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, velocity: vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.3 }] });
        }
      }
    },

    alarm(context, time, midi, duration, level) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, level, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.45 }] });
    },

    riser(context, time, duration, level) {
      const out = musicOut();
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.3,
          frequency: 220,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 8200, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.07 },
        ],
        destination: out,
      });
    },

    impact(context, time, vel) {
      const out = musicOut();
      if (!out) return;
      impactTone.play({ context, time, frequency: 118, vel, destination: out });
      noiseHit(time, 0.3 * vel, 0.34, 'lowpass', 380, out);
      instruments.crash(time, 0.18 * vel);
    },
  }, {
    coil: ['vel', 'bright'],
    hat: ['vel', 'decay'],
    sizzle: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel', 'growl'],
    pad: ['midis', 'duration', 'vel'],
    arc: ['midi', 'vel'],
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

  function playerTone(time: number, midi: number, tone: MassDriverTone, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tone.oscillator });
      return;
    }
    const context = environment.context();
    const out = sfxOut();
    if (!context || !out) return;
    playerToneSpec.play({ context, time, midi, tone, velocity: vel, weight, destination: out, sends: playerSends(0.38, tone.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const out = sfxOut();
    if (!out) return;
    noiseHit(time, vel, decay, 'highpass', frequency, out);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
