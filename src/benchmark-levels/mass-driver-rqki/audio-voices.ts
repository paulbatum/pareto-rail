import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Construction only. Every pitch, gain, pattern, and section decision lives in
// audio.ts; this file just knows how to make the noises an orbital railgun
// makes: a coil striking, a capacitor bank humming, and current arcing.

export type MassDriverTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  bite: number;
  reverb: number;
};

export type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type ChargeHum = {
  set(time: number, midi: number, level: number, brightness: number): void;
  release(time: number, seconds: number): void;
};

/**
 * The gun is the instrument. A single continuous drone runs from the moment
 * audio starts until the muzzle, climbing two octaves across the run — the
 * capacitor bank spinning up. It is not part of the arrangement; the
 * arrangement is played over the top of it.
 */
export function installChargeHum(context: AudioContext, mix: MixBus): ChargeHum {
  const output = mix.music ?? mix.master;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 140;
  filter.Q.value = 6.5;

  const level = context.createGain();
  level.gain.value = 0;
  filter.connect(level).connect(output);

  const sub = context.createOscillator();
  sub.type = 'sine';
  const growl = context.createOscillator();
  growl.type = 'sawtooth';
  growl.detune.value = 7;
  const growlGain = context.createGain();
  growlGain.gain.value = 0.28;

  // A slow beat between the two saw partials: machinery, not a synth pad.
  const beatOsc = context.createOscillator();
  beatOsc.type = 'sawtooth';
  beatOsc.detune.value = -11;
  const beatGain = context.createGain();
  beatGain.gain.value = 0.2;

  sub.connect(filter);
  growl.connect(growlGain).connect(filter);
  beatOsc.connect(beatGain).connect(filter);
  sub.start();
  growl.start();
  beatOsc.start();

  return {
    set(time, midi, humLevel, brightness) {
      const frequency = midiToFreq(midi);
      for (const oscillator of [sub, growl, beatOsc]) {
        oscillator.frequency.cancelScheduledValues(time);
        oscillator.frequency.setValueAtTime(Math.max(8, oscillator.frequency.value), time);
        oscillator.frequency.exponentialRampToValueAtTime(frequency, time + 1.6);
      }
      filter.frequency.cancelScheduledValues(time);
      filter.frequency.setValueAtTime(Math.max(20, filter.frequency.value), time);
      filter.frequency.exponentialRampToValueAtTime(frequency * (2 + brightness * 9), time + 1.6);
      level.gain.setTargetAtTime(humLevel, time, 0.5);
    },
    release(time, seconds) {
      level.gain.cancelScheduledValues(time);
      level.gain.setValueAtTime(Math.max(0.0001, level.gain.value), time);
      level.gain.linearRampToValueAtTime(0, time + seconds);
      filter.frequency.cancelScheduledValues(time);
      filter.frequency.setValueAtTime(Math.max(20, filter.frequency.value), time);
      filter.frequency.exponentialRampToValueAtTime(60, time + seconds);
    },
  };
}

export function createMassDriverVoices(environment: VoiceEnvironment, hum: () => ChargeHum | null) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1200, velocity: 1, decay: 0.04 });

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseHitVoice.play({ context, buffer, time, velocity: vel, decay, filterType, frequency, destination, offset: Math.random() * 1.4 });
  }

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.19,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 40, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  // The coil strike: a hard, short, metallic ping that gets brighter and
  // shorter as the payload speeds up. This is the sound of a ring going past.
  const coilTone = voice<{ vel: number; bright: number }>({
    oscillators: [{ type: 'square', gain: 0.16 }],
    duration: ({ bright }) => 0.11 - bright * 0.045,
    stopPadding: 0.03,
    filter: {
      type: 'bandpass',
      Q: 9,
      frequency: ({ bright }) => 900 + bright * 4200,
      frequencyAutomation: (time, { bright }) => [
        { type: 'exponentialRamp', value: 500 + bright * 1400, time: time + 0.09 },
      ],
    },
    gainAutomation: (time, gain, { vel, bright }) => [
      { type: 'set', value: gain * vel * (0.6 + bright * 0.7), time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 - bright * 0.04 },
    ],
  });

  const clapBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.06,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 150, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.11 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.06 },
    ],
  });

  // Hypnotic 16th sequence: one resonant saw with a per-note filter sweep. The
  // level's "locked pulse" lives here.
  const seqTone = voice<{ vel: number; open: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.115,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 11,
      frequency: ({ open }) => 500 + open * 3600,
      frequencyAutomation: (time, { open }) => [
        { type: 'exponentialRamp', value: 300 + open * 500, time: time + 0.1 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.052 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.115 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.22,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 4200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 600, time: time + 0.19 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.042 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const alarmTone = voice<{ duration: number; vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'bandpass',
      Q: 5,
      frequency: 420,
      frequencyAutomation: (time, { duration }) => [
        { type: 'linearRamp', value: 1900, time: time + duration * 0.75 },
        { type: 'linearRamp', value: 500, time: time + duration },
      ],
    },
    gainAutomation: (time, _gain, { duration, vel }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.11 * vel, time: time + duration * 0.25 },
      { type: 'linearRamp', value: 0.08 * vel, time: time + duration * 0.8 },
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

  const chargeBeepTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.09 }],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'bandpass', Q: 7, frequency: 2400 },
    envelope: { decay: 0.07 },
  });

  const playerToneSpec = voice<{ voice: MassDriverTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      Q: ({ voice }) => 1 + voice.bite * 9,
      cutoff: ({ voice }) => voice.cutoff,
    },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.004, 'highpass', 2400, output);
      mix.duckAt(time, 0.46, 0.14);
    },

    coil(context, time, vel, bright) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix?.delaySend || !output) return;
      coilTone.play({
        context,
        time,
        frequency: 190 + bright * 260,
        vel,
        bright,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.18 + bright * 0.24 }],
      });
      noiseHit(time, 0.05 + bright * 0.09, 0.012 + bright * 0.02, 'bandpass', 3200 + bright * 6000, output);
    },

    clap(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      // Three offset noise bursts: a room of relays closing, not a drum.
      for (const [offset, level] of [[0, 1], [0.008, 0.7], [0.018, 0.45]] as const) {
        noiseHit(time + offset, 0.16 * vel * level, 0.055, 'bandpass', 1900, output);
      }
      noiseHit(time, 0.07 * vel, 0.02, 'highpass', 6400, output);
      clapBody.play({ context, time, frequency: 240, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 9200, duck);
    },

    ride(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.16, 'bandpass', 10500, duck);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.85, 'highpass', 5200, output);
      noiseHit(time, vel * 0.5, 1.5, 'bandpass', 8200, reverbSend);
    },

    bass(context, time, midi, vel, drive) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.2;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.3 * vel, time + 0.007);
      subGain.gain.setValueAtTime(0.3 * vel, time + dur * 0.65);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 8;
      filter.frequency.setValueAtTime(280 + drive * 1100 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(150, time + dur);
      const edgeGain = context.createGain();
      edgeGain.gain.setValueAtTime(0, time);
      edgeGain.gain.linearRampToValueAtTime(0.085 * vel, time + 0.005);
      edgeGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-12, 12]) {
        const osc = context.createOscillator();
        osc.type = 'square';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
      filter.connect(edgeGain).connect(duck);
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-8, 8]) {
          const osc = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 3;
          filter.type = 'lowpass';
          filter.Q.value = 1.4;
          filter.frequency.setValueAtTime(420, time);
          filter.frequency.linearRampToValueAtTime(1500, time + duration * 0.55);
          filter.frequency.linearRampToValueAtTime(600, time + duration);
          const peak = (0.035 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(peak, time + Math.min(0.9, duration * 0.3));
          gain.gain.setValueAtTime(peak, time + duration - Math.min(1.1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(filter).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.55;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    seq(context, time, midi, vel, open) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      seqTone.play({ context, time, midi, vel, open, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.34 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-10, 10]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.32 }] });
        }
      }
    },

    alarm(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.45 }] });
    },

    chargeBeep(context, time, midi, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!output || !mix?.delaySend) return;
      chargeBeepTone.play({ context, time, midi, vel, destination: output, sends: [{ destination: mix.delaySend, gain: 0.2 }] });
    },

    riser(context, time, duration, level) {
      const output = musicDestination();
      const buffer = environment.mix()?.noiseBuffer;
      if (!output || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequency: 300,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 8600, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.07 },
        ],
        destination: output,
      });
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 110, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.34, 'lowpass', 500, output);
      instruments.crash(time, 0.15 * vel);
    },

    hum(_context, time, midi, level, brightness) {
      hum()?.set(time, midi, level, brightness);
    },

    humRelease(_context, time, seconds) {
      hum()?.release(time, seconds);
    },
  }, {
    kick: ['vel'],
    coil: ['vel', 'bright'],
    clap: ['vel'],
    hat: ['vel', 'decay'],
    ride: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel', 'drive'],
    pad: ['midis', 'duration', 'vel'],
    seq: ['midi', 'vel', 'open'],
    stab: ['midis', 'vel'],
    alarm: ['midi', 'duration', 'vel'],
    chargeBeep: ['midi', 'vel'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    hum: ['midi', 'level', 'brightness'],
    humRelease: ['seconds'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tone: MassDriverTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tone.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: tone, velocity: vel, weight, destination: output, sends: playerSends(0.3, tone.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
