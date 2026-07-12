import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Skyhook is scored so the mix IS the altitude: warm and wet at the bottom,
// stripped and dry at the top, a low machine menace under the thin heights, then
// near-silence in the dock. These voices are the leaf construction layer — the
// spine (audio.ts) owns which voice plays when, at what pitch, and how wet.

// Player-facing tonal timbre. `reverb` is the base reverb-send gain for this
// voice; the spine has already folded the section into it, so a storm lock is
// wet and a thin-air lock is bone dry through the same static hall.
export type SkyhookTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  sparkle: number;
  reverb: number;
};

export type SkyhookVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type SkyhookAtmosphere = {
  /** Ramp the wind noise bed toward `level` (0..1) with a slow time constant. */
  setWind(level: number, time: number): void;
  /** Ramp the rain hiss bed toward `level` (0..1). Rain lives only in the storm. */
  setRain(level: number, time: number): void;
};

// A looping wind bed plus a rain hiss bed. The storm rides both; punching the
// cloud deck kills the rain and thins the wind; the vacuum is nearly silent.
export function installSkyhookAtmosphere(context: AudioContext, mix: MixBus): SkyhookAtmosphere | null {
  if (!mix.noiseBuffer) return null;

  const windSource = context.createBufferSource();
  windSource.buffer = mix.noiseBuffer;
  windSource.loop = true;
  const windFilter = context.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 520;
  windFilter.Q.value = 0.7;
  const windGain = context.createGain();
  windGain.gain.value = 0.18;
  // Slow gusting so the bed breathes instead of sitting as flat hiss.
  const gust = context.createOscillator();
  gust.frequency.value = 0.09;
  const gustGain = context.createGain();
  gustGain.gain.value = 0.06;
  gust.connect(gustGain).connect(windGain.gain);
  windSource.connect(windFilter).connect(windGain).connect(mix.music);

  const windBody = context.createBufferSource();
  windBody.buffer = mix.noiseBuffer;
  windBody.loop = true;
  const bodyFilter = context.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.value = 150;
  const bodyGain = context.createGain();
  bodyGain.gain.value = 0.08;
  windBody.connect(bodyFilter).connect(bodyGain).connect(mix.music);

  const rainSource = context.createBufferSource();
  rainSource.buffer = mix.noiseBuffer;
  rainSource.loop = true;
  const rainFilter = context.createBiquadFilter();
  rainFilter.type = 'highpass';
  rainFilter.frequency.value = 2600;
  const rainGain = context.createGain();
  rainGain.gain.value = 0;
  rainSource.connect(rainFilter).connect(rainGain).connect(mix.music);

  windSource.start();
  windBody.start();
  rainSource.start();
  gust.start();

  return {
    setWind(level, time) {
      windGain.gain.setTargetAtTime(0.36 * level, time, 0.9);
      bodyGain.gain.setTargetAtTime(0.16 * level, time, 0.9);
    },
    setRain(level, time) {
      rainGain.gain.setTargetAtTime(0.09 * level, time, 0.7);
    },
  };
}

export function createSkyhookVoices(environment: SkyhookVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const noiseBuffer = environment.mix()?.noiseBuffer;
    if (!context || !noiseBuffer) return;
    noiseHitVoice.play({ context, buffer: noiseBuffer, time, velocity: vel, decay, filterType, frequency, destination, offset: Math.random() * 2 });
  }

  function reverbSend(gain: number) {
    const send = environment.mix()?.reverbSend;
    return send && gain > 0 ? [{ destination: send, gain }] : [];
  }

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.18,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 42, time: time + 0.11 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.08,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 150, time: time + 0.06 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.12 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
    ],
  });

  const bellTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', octave: 1, frequencyRatio: 1.5, gain: 0.32 },
    ],
    duration: 0.9,
    stopPadding: 0.1,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 3200,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 600, time: time + 0.26 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.05 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const playerToneSpec = voice<{ voice: SkyhookTonalVoice }>({
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
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.05 * vel, 0.005, 'highpass', 1400, output);
      // Light, spacious pump — this is not drum & bass.
      mix.duckAt(time, 0.78, 0.13);
    },

    snare(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.16 * vel, 0.09, 'bandpass', 1650, output);
      noiseHit(time, 0.08 * vel, 0.03, 'highpass', 5200, output);
      snareBody.play({ context, time, frequency: 230, vel, destination: output });
    },

    // Thin-air replacement for the snare: a dry wooden tick that keeps the 2 and 4.
    rim(_context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.11 * vel, 0.018, 'bandpass', 2600, output);
      noiseHit(time, 0.05 * vel, 0.01, 'highpass', 6400, output);
    },

    shaker(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.03, 'highpass', 8600, duck);
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8000, duck);
    },

    openHat(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.2, 'highpass', 7200, duck);
    },

    // Warm detuned-saw pad, lowpassed. `cutoff` narrows and `reverb` dries as the
    // air thins, so the same pad reads as wide storm warmth or a thin high sheet.
    pad(context, time, midis, duration, vel, cutoff, reverb) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        for (const detune of [-7, 7]) {
          const osc = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 3;
          filter.type = 'lowpass';
          filter.frequency.value = cutoff;
          const level = (0.036 * vel) / Math.sqrt(midis.length / 3);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(0.9, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(filter).connect(gain).connect(mix.duck);
          if (reverb > 0 && mix.reverbSend) {
            const wet = context.createGain();
            wet.gain.value = reverb;
            gain.connect(wet).connect(mix.reverbSend);
          }
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    },

    // Full sub bass for the storm.
    sub(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.34;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = midiToFreq(midi);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.3 * vel, time + 0.01);
      gain.gain.setValueAtTime(0.3 * vel, time + dur * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(gain).connect(duck);
      osc.start(time);
      osc.stop(time + dur + 0.03);
    },

    // Thin-air replacement for the sub: a soft rounded pulse, barely there.
    softPulse(context, time, midi, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const dur = 0.5;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.12 * vel, time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(gain).connect(duck);
      osc.start(time);
      osc.stop(time + dur + 0.03);
    },

    // High sparse bell — the last thing keeping time when the air is nearly gone.
    bell(context, time, midi, vel, reverb) {
      const output = sfxDestination();
      if (!output) return;
      bellTone.play({ context, time, midi, vel, destination: output, sends: reverbSend(reverb) });
    },

    // The hopeful cloud-break lead.
    lead(context, time, midi, duration, vel, reverb) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3000, time);
      filter.frequency.linearRampToValueAtTime(2000, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.075 * vel, time + 0.03);
      gain.gain.setValueAtTime(0.075 * vel, time + Math.max(0.03, duration - 0.1));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);
      for (const [type, detune] of [['triangle', -5], ['sine', 6]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      filter.connect(gain).connect(mix.duck);
      if (reverb > 0 && mix.reverbSend) {
        const wet = context.createGain();
        wet.gain.value = reverb;
        gain.connect(wet).connect(mix.reverbSend);
      }
      if (mix.delaySend) {
        const echo = context.createGain();
        echo.gain.value = 0.4;
        gain.connect(echo).connect(mix.delaySend);
      }
    },

    stab(context, time, midis, vel, reverb) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        for (const detune of [-9, 9]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: reverbSend(reverb) });
        }
      }
    },

    // Warm resolved swell — the dock's one exhale of harmony.
    swell(context, time, midis, duration, vel, reverb) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        const osc = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = Math.sin(midi * 3.7) * 5;
        filter.type = 'lowpass';
        filter.frequency.value = 1400;
        const level = (0.04 * vel) / Math.sqrt(midis.length / 3);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + duration * 0.4);
        gain.gain.setValueAtTime(level, time + duration * 0.62);
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(filter).connect(gain).connect(mix.duck);
        if (reverb > 0 && mix.reverbSend) {
          const wet = context.createGain();
          wet.gain.value = reverb;
          gain.connect(wet).connect(mix.reverbSend);
        }
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    },

    // Distant storm thunder — a low rumble with a soft sub body, deep in the hall.
    thunder(context, time, vel) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix) return;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(52, time);
      osc.frequency.exponentialRampToValueAtTime(28, time + 1.1);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.34 * vel, time + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 1.5);
      osc.connect(gain).connect(output);
      if (mix.reverbSend) {
        const wet = context.createGain();
        wet.gain.value = 0.6;
        gain.connect(wet).connect(mix.reverbSend);
      }
      osc.start(time);
      osc.stop(time + 1.6);
      noiseHit(time, 0.22 * vel, 1.2, 'lowpass', 360, output);
      if (mix.reverbSend) noiseHit(time, 0.14 * vel, 1.6, 'lowpass', 500, mix.reverbSend);
    },

    // The lamprey latches: a huge inharmonic metallic CLANK plus the tether strain.
    clank(context, time, vel) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix) return;
      const base = 176;
      for (const [ratio, level, decay] of [[1, 0.3, 0.6], [2.76, 0.2, 0.4], [5.42, 0.13, 0.28], [8.9, 0.08, 0.18]] as const) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'square';
        osc.frequency.value = base * ratio;
        gain.gain.setValueAtTime(level * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        osc.connect(gain).connect(output);
        if (mix.reverbSend) {
          const wet = context.createGain();
          wet.gain.value = 0.5;
          gain.connect(wet).connect(mix.reverbSend);
        }
        osc.start(time);
        osc.stop(time + decay + 0.05);
      }
      noiseHit(time, 0.34 * vel, 0.14, 'bandpass', 1500, output);
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(70, time);
      sub.frequency.exponentialRampToValueAtTime(34, time + 0.6);
      subGain.gain.setValueAtTime(0.42 * vel, time);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + 0.8);
      sub.connect(subGain).connect(output);
      sub.start(time);
      sub.stop(time + 0.85);
    },

    // Groaning tether-strain rumble, a slow menace swell under everything.
    strain(context, time, vel, duration) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix) return;
      for (const detune of [-16, 12]) {
        const osc = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(27);
        osc.detune.value = detune;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(120, time);
        filter.frequency.linearRampToValueAtTime(240, time + duration * 0.6);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.09 * vel, time + duration * 0.45);
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(filter).connect(gain).connect(output);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      noiseHit(time, 0.1 * vel, duration, 'lowpass', 160, output);
    },

    // Low groan-bass: the machine's own voice, riding the E-flat pedal.
    groan(context, time, midi, duration, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(150, time);
      filter.frequency.linearRampToValueAtTime(320, time + duration * 0.5);
      filter.frequency.linearRampToValueAtTime(140, time + duration);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.12 * vel, time + duration * 0.3);
      gain.gain.setValueAtTime(0.12 * vel, time + duration * 0.65);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      for (const detune of [-12, 11]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
      const subOsc = context.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.value = midiToFreq(midi - 12);
      subOsc.connect(gain);
      subOsc.start(time);
      subOsc.stop(time + duration + 0.05);
      filter.connect(gain).connect(duck);
    },

    // Escalating boss grind: metallic scrape that climbs with damage `intensity`.
    grind(_context, time, vel, intensity) {
      const output = sfxDestination();
      const mix = environment.mix();
      if (!output || !mix) return;
      noiseHit(time, 0.12 * vel, 0.16 + intensity * 0.14, 'bandpass', 1200 + intensity * 2600, output);
      noiseHit(time, 0.06 * vel, 0.06, 'highpass', 3400 + intensity * 3000, output);
      if (mix.reverbSend) noiseHit(time, 0.05 * vel, 0.3, 'bandpass', 900 + intensity * 1400, mix.reverbSend);
    },

    // Airlock hiss swell as the car seals into the bay.
    airlock(_context, time, duration) {
      const context = environment.context();
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!context || !output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 0.9,
          frequency: 1800,
          frequencyAutomation: [
            { type: 'linearRamp', value: 3400, time: time + duration * 0.5 },
            { type: 'linearRamp', value: 900, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'linearRamp', value: 0.12, time: time + duration * 0.45 },
          { type: 'exponentialRamp', value: 0.001, time: time + duration },
        ],
        destination: output,
      });
    },

    // Slow soft heartbeat — the docked car's pulse, almost nothing.
    heartbeat(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      for (const [offset, level] of [[0, 1], [0.16, 0.6]] as const) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(66, time + offset);
        osc.frequency.exponentialRampToValueAtTime(40, time + offset + 0.14);
        gain.gain.setValueAtTime(0.16 * vel * level, time + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, time + offset + 0.2);
        osc.connect(gain).connect(output);
        osc.start(time + offset);
        osc.stop(time + offset + 0.24);
      }
    },

    // Two-tone car-alarm honk — the deadline telegraph as the lamprey nears the car.
    klaxon(context, time) {
      const output = sfxDestination();
      const mix = environment.mix();
      if (!output) return;
      for (const [offset, freq] of [[0, 618], [0.15, 742]] as const) {
        const osc = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        filter.Q.value = 3;
        gain.gain.setValueAtTime(0, time + offset);
        gain.gain.linearRampToValueAtTime(0.055, time + offset + 0.02);
        gain.gain.setValueAtTime(0.055, time + offset + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, time + offset + 0.14);
        osc.connect(filter).connect(gain).connect(output);
        if (mix?.reverbSend) {
          const wet = context.createGain();
          wet.gain.value = 0.2;
          gain.connect(wet).connect(mix.reverbSend);
        }
        osc.start(time + offset);
        osc.stop(time + offset + 0.17);
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
          Q: 1.2,
          frequency: 240,
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
  }, {
    kick: ['vel'],
    snare: ['vel'],
    rim: ['vel'],
    shaker: ['vel'],
    hat: ['vel', 'decay'],
    openHat: ['vel'],
    pad: ['midis', 'duration', 'vel', 'cutoff', 'reverb'],
    sub: ['midi', 'vel'],
    softPulse: ['midi', 'vel'],
    bell: ['midi', 'vel', 'reverb'],
    lead: ['midi', 'duration', 'vel', 'reverb'],
    stab: ['midis', 'vel', 'reverb'],
    swell: ['midis', 'duration', 'vel', 'reverb'],
    thunder: ['vel'],
    clank: ['vel'],
    strain: ['vel', 'duration'],
    groan: ['midi', 'duration', 'vel'],
    grind: ['vel', 'intensity'],
    airlock: ['duration'],
    heartbeat: ['vel'],
    klaxon: [],
    riser: ['duration', 'level'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voiceSpec: SkyhookTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: voiceSpec.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({ context, time, midi, voice: voiceSpec, velocity: vel, weight, destination: output, sends: playerSends(0.34, voiceSpec.reverb) });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
