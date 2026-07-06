import {
  defineInstruments,
  playBufferSourceVoice,
  playNoiseHit,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

export type HeliosTonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };

export type HeliosVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function installHeliosRumble(context: AudioContext, mix: MixBus) {
  if (!mix.noiseBuffer) return;
  const rumbleSource = context.createBufferSource();
  rumbleSource.buffer = mix.noiseBuffer;
  rumbleSource.loop = true;
  const rumbleFilter = context.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 90;
  rumbleFilter.Q.value = 0.6;
  const rumbleGain = context.createGain();
  rumbleGain.gain.value = 0.16;
  const rumbleLfo = context.createOscillator();
  rumbleLfo.frequency.value = 0.11;
  const rumbleLfoGain = context.createGain();
  rumbleLfoGain.gain.value = 0.05;
  rumbleLfo.connect(rumbleLfoGain).connect(rumbleGain.gain);
  rumbleSource.connect(rumbleFilter).connect(rumbleGain).connect(mix.music);
  rumbleSource.start();
  rumbleLfo.start();
}

export function createHeliosVoices(environment: HeliosVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

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
    playNoiseHit({
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

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    kick(context, time, vel) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.18,
        oscillatorType: 'sine',
        frequency: 165,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 44, time: time + 0.09 }],
        gainAutomation: [
          { type: 'set', value: 0.52 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
        ],
        destination: output,
      });
      noiseHit(time, 0.09 * vel, 0.004, 'highpass', 1500, output);
      mix.duckAt(time, 0.4, 0.16);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 0.075, 'bandpass', 1750, output);
      noiseHit(time, 0.1 * vel, 0.03, 'highpass', 5200, output);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.09,
        oscillatorType: 'triangle',
        frequency: 215,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 130, time: time + 0.05 }],
        gainAutomation: [
          { type: 'set', value: 0.14 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
        ],
        destination: output,
      });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8200, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.18, 'highpass', 7400, duck);
    },

    ride(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.14, 'bandpass', 9800, duck);
    },

    crash(_context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output || !reverbSend) return;
      noiseHit(time, vel, 0.9, 'highpass', 4600, output);
      noiseHit(time, vel * 0.5, 1.4, 'bandpass', 7200, reverbSend);
    },

    bass(context, time, midi, vel, growl) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.21;
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.value = midiToFreq(midi);
      subGain.gain.setValueAtTime(0, time);
      subGain.gain.linearRampToValueAtTime(0.26 * vel, time + 0.008);
      subGain.gain.setValueAtTime(0.26 * vel, time + dur * 0.7);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.02);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 7;
      filter.frequency.setValueAtTime(300 + growl * 900 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(170, time + dur);
      const reeseGain = context.createGain();
      reeseGain.gain.setValueAtTime(0, time);
      reeseGain.gain.linearRampToValueAtTime(0.1 * vel, time + 0.006);
      reeseGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-14, 14]) {
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

    choir(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-9, 9]) {
          const osc = context.createOscillator();
          const vowel = context.createBiquadFilter();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 7.3) * 4;
          vowel.type = 'bandpass';
          vowel.frequency.setValueAtTime(620, time);
          vowel.frequency.linearRampToValueAtTime(950, time + duration * 0.5);
          vowel.frequency.linearRampToValueAtTime(620, time + duration);
          vowel.Q.value = 0.9;
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 2100;
          const level = (0.05 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.7, duration * 0.25));
          gain.gain.setValueAtTime(level, time + duration - Math.min(0.9, duration * 0.3));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(vowel).connect(lowpass).connect(gain);
          gain.connect(mix.duck);
          const send = context.createGain();
          send.gain.value = 0.6;
          gain.connect(send).connect(mix.reverbSend);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    arp(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.12,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        filter: {
          type: 'lowpass',
          frequency: 2900,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 900, time: time + 0.09 }],
        },
        gainAutomation: [
          { type: 'set', value: 0.075 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.42 }],
      });
    },

    stab(context, time, midis, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        for (const detune of [-11, 11]) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + 0.3,
            oscillatorType: 'sawtooth',
            frequency: midiToFreq(midi),
            detune,
            filter: {
              type: 'lowpass',
              frequency: 3600,
              frequencyAutomation: [{ type: 'exponentialRamp', value: 500, time: time + 0.22 }],
            },
            gainAutomation: [
              { type: 'set', value: 0.05 * vel, time },
              { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
            ],
            destination: mix.duck,
            sends: [{ destination: mix.reverbSend, gain: 0.35 }],
          });
        }
      }
    },

    lead(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.delaySend || !mix.reverbSend) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2600, time);
      filter.frequency.linearRampToValueAtTime(1700, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.085 * vel, time + 0.02);
      gain.gain.setValueAtTime(0.085 * vel, time + Math.max(0.02, duration - 0.08));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);
      const vibrato = context.createOscillator();
      const vibratoGain = context.createGain();
      vibrato.frequency.value = 5.4;
      vibratoGain.gain.setValueAtTime(0, time);
      vibratoGain.gain.linearRampToValueAtTime(6, time + Math.min(0.4, duration * 0.6));
      for (const [type, detune] of [['sawtooth', -7], ['square', 7]] as const) {
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
      playOscillatorVoice({
        context,
        time,
        stopTime: time + duration + 0.05,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: {
          type: 'lowpass',
          frequency: 360,
          frequencyAutomation: [{ type: 'linearRamp', value: 1500, time: time + duration * 0.8 }],
        },
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: 0.15, time: time + duration * 0.7 },
          { type: 'linearRamp', value: 0, time: time + duration },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.reverbSend, gain: 0.5 }],
      });
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
          frequency: 260,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 7200, time: time + duration }],
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
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.8,
        oscillatorType: 'sine',
        frequency: 120,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 30, time: time + 0.5 }],
        gainAutomation: [
          { type: 'set', value: 0.5 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.75 },
        ],
        destination: output,
      });
      noiseHit(time, 0.26 * vel, 0.3, 'lowpass', 420, output);
      instruments.crash(time, 0.16 * vel);
    },
  }, {
    kick: ['vel'],
    snare: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    ride: ['vel'],
    crash: ['vel'],
    bass: ['midi', 'vel', 'growl'],
    choir: ['midis', 'duration', 'vel'],
    arp: ['midi', 'vel'],
    stab: ['midis', 'vel'],
    lead: ['midi', 'duration', 'vel'],
    alarm: ['midi', 'duration'],
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

  function playerTone(time: number, midi: number, voice: HeliosTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voice.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playOscillatorVoice({
      context,
      time,
      stopTime: time + voice.decay + 0.04,
      oscillatorType: voice.oscillator,
      frequency: midiToFreq(midi),
      filter: { type: 'lowpass', frequency: voice.cutoff },
      gainAutomation: [
        { type: 'set', value: voice.gain * vel * weight, time },
        { type: 'exponentialRamp', value: 0.001, time: time + voice.decay },
      ],
      destination: output,
      sends: playerSends(0.42, voice.reverb),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, alarmSwell: instruments.alarm, noiseHit, playerSends, playerTone, playerNoise };
}
