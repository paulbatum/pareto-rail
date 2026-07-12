import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type DownpourTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type DownpourVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function installRainAmbience(context: AudioContext, mix: MixBus) {
  if (!mix.noiseBuffer) return;

  // Steady airy rain: bandpass hiss around 2-5kHz with a slow gusting LFO.
  const rainSource = context.createBufferSource();
  rainSource.buffer = mix.noiseBuffer;
  rainSource.loop = true;
  const rainFilter = context.createBiquadFilter();
  rainFilter.type = 'bandpass';
  rainFilter.frequency.value = 3200;
  rainFilter.Q.value = 0.7;
  const rainGain = context.createGain();
  rainGain.gain.value = 0.07;
  const gustLfo = context.createOscillator();
  gustLfo.frequency.value = 0.08;
  const gustGain = context.createGain();
  gustGain.gain.value = 0.02;
  gustLfo.connect(gustGain).connect(rainGain.gain);
  rainSource.connect(rainFilter).connect(rainGain).connect(mix.music);
  rainSource.start();
  gustLfo.start();

  // Distant thunder-weight: very low soft rumble.
  const rumbleSource = context.createBufferSource();
  rumbleSource.buffer = mix.noiseBuffer;
  rumbleSource.loop = true;
  const rumbleFilter = context.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 70;
  rumbleFilter.Q.value = 0.5;
  const rumbleGain = context.createGain();
  rumbleGain.gain.value = 0.08;
  const rumbleLfo = context.createOscillator();
  rumbleLfo.frequency.value = 0.05;
  const rumbleLfoGain = context.createGain();
  rumbleLfoGain.gain.value = 0.03;
  rumbleLfo.connect(rumbleLfoGain).connect(rumbleGain.gain);
  rumbleSource.connect(rumbleFilter).connect(rumbleGain).connect(mix.music);
  rumbleSource.start();
  rumbleLfo.start();
}

export function createDownpourVoices(environment: DownpourVoiceEnvironment) {
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
    duration: 0.13,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 48, time: time + 0.07 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.06,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 130, time: time + 0.045 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.13 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.06 },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.11,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 3400,
      Q: 4,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 700, time: time + 0.1 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.07 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.28,
    stopPadding: 0.04,
    filter: {
      type: 'lowpass',
      frequency: 2600,
      Q: 3,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 420, time: time + 0.24 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });

  const alarmTone = voice<{ duration: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: ({ duration }) => duration,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 260,
      Q: 2,
      frequencyAutomation: (time, { duration }) => [{ type: 'linearRamp', value: 1200, time: time + duration * 0.8 }],
    },
    gainAutomation: (time, _gain, { duration }) => [
      { type: 'set', value: 0, time },
      { type: 'linearRamp', value: 0.13, time: time + duration * 0.7 },
      { type: 'linearRamp', value: 0, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.8,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.55 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.8 },
    ],
  });

  const playerToneSpec = voice<{ voice: DownpourTonalVoice }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ voice }) => voice.cutoff },
    envelope: { decay: ({ voice }) => voice.decay },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 145, vel, destination: output });
      noiseHit(time, 0.08 * vel, 0.004, 'highpass', 1700, output);
      mix.duckAt(time, 0.4, 0.16);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 0.07, 'bandpass', 2100, output);
      noiseHit(time, 0.1 * vel, 0.03, 'highpass', 5400, output);
      snareBody.play({ context, time, frequency: 190, vel, destination: output });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 7400, duck);
      noiseHit(time, vel * 0.4, decay, 'bandpass', 9200, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.17, 'highpass', 6600, duck);
    },

    ride(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.14, 'bandpass', 8800, duck);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.9, 'highpass', 4000, output);
      noiseHit(time, vel * 0.5, 1.4, 'bandpass', 6600, reverbSend);
    },

    bass(context, time, midi, vel, growl) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.24;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.28 * vel, time + 0.008);
      subGain.gain.setValueAtTime(0.28 * vel, time + dur * 0.7);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 9;
      filter.frequency.setValueAtTime(260 + growl * 1100 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(150, time + dur);
      // Subtle lowpass wobble for menace.
      const wobble = context.createOscillator();
      const wobbleGain = context.createGain();
      wobble.type = 'sine';
      wobble.frequency.value = 5.5;
      wobbleGain.gain.value = 120 * growl;
      wobble.connect(wobbleGain).connect(filter.frequency);
      wobble.start(time);
      wobble.stop(time + dur + 0.02);

      const reeseGain = context.createGain();
      reeseGain.gain.setValueAtTime(0, time);
      reeseGain.gain.linearRampToValueAtTime(0.09 * vel, time + 0.006);
      reeseGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-18, 0, 18]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
      filter.connect(reeseGain).connect(duck);
    },

    pad(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const [type, detune] of [['triangle', -8], ['triangle', 8], ['sawtooth', 0]] as const) {
          const osc = context.createOscillator();
          const band = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = type;
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 3;
          band.type = 'bandpass';
          band.frequency.setValueAtTime(700, time);
          band.frequency.linearRampToValueAtTime(1100, time + duration * 0.6);
          band.frequency.linearRampToValueAtTime(760, time + duration);
          band.Q.value = 0.8;
          const level = ((type === 'sawtooth' ? 0.035 : 0.05) * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(1.1, duration * 0.4));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.2, duration * 0.4));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(band).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.75;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.45 }] });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-12, 12]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.4 }] });
        }
      }
    },

    lead(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 11;
      filter.frequency.setValueAtTime(3200, time);
      filter.frequency.exponentialRampToValueAtTime(420, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.06 * vel, time + 0.015);
      gain.gain.setValueAtTime(0.06 * vel, time + Math.max(0.02, duration - 0.08));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);
      const vibrato = context.createOscillator();
      const vibratoGain = context.createGain();
      vibrato.frequency.value = 5.6;
      vibratoGain.gain.setValueAtTime(0, time);
      vibratoGain.gain.linearRampToValueAtTime(7, time + Math.min(0.4, duration * 0.6));
      for (const [type, detune] of [['sawtooth', -6], ['square', 6]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        vibrato.connect(vibratoGain).connect(osc.detune);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      vibrato.start(time);
      vibrato.stop(time + duration + 0.05);
      filter.connect(gain);
      gain.connect(mix.duck);
      const echo = context.createGain();
      echo.gain.value = 0.5;
      gain.connect(echo).connect(mix.delaySend);
      const hall = context.createGain();
      hall.gain.value = 0.3;
      gain.connect(hall).connect(mix.reverbSend);
    },

    alarm(context, time, midi, duration) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      alarmTone.play({ context, time, midi, duration, destination: mix.duck, sends: [{ destination: mix.reverbSend, gain: 0.55 }] });
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
          frequency: 240,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 6800, time: time + duration }],
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
      noiseHit(time, 0.26 * vel, 0.32, 'lowpass', 380, output);
      instruments.crash(time, 0.16 * vel);
    },

    thunder(context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !reverbSend || !noiseBuffer) return;
      // Instant bright crack.
      noiseHit(time, 0.5 * vel, 0.04, 'highpass', 3200, output);
      // Long low rumble with big reverb send.
      const decay = 1.5 + vel;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + decay + 0.1,
        loop: true,
        filter: { type: 'lowpass', Q: 0.7, frequency: 120 },
        gainAutomation: [
          { type: 'set', value: 0.3 * vel, time: time + 0.02 },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        destination: output,
      });
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + decay + 0.1,
        loop: true,
        filter: { type: 'lowpass', Q: 0.7, frequency: 140 },
        gainAutomation: [
          { type: 'set', value: 0.4 * vel, time: time + 0.02 },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        destination: reverbSend,
      });
    },
  }, {
    kick: ['vel'],
    snare: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    ride: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel', 'growl'],
    pad: ['midis', 'duration', 'vel'],
    arp: ['midi', 'vel'],
    stab: ['midis', 'vel'],
    lead: ['midi', 'duration', 'vel'],
    alarm: ['midi', 'duration'],
    riser: ['duration', 'level'],
    impact: ['vel'],
    thunder: ['vel'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voice: DownpourTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice, velocity: vel, weight, destination: output, sends: playerSends(0.42, voice.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, alarmSwell: instruments.alarm, noiseHit, playerSends, playerTone, playerNoise };
}
