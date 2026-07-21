import {
  defineInstruments,
  playBufferSourceVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Skyhook's instrument bench. The level's one musical idea is that the mix
// loses air as the car climbs, so nearly every voice here takes a `room`
// argument: the same drum, pad or bell is played wide and wet down in the
// weather and close and dry in vacuum. The tether toll is the exception — it
// is structure-borne, so it survives all the way to the top.

export type SkyhookTonalVoice = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  /** Reverb send: this is the air. It runs from 0.45 down to 0.05 over the climb. */
  air: number;
  /** Breath noise mixed under the tone; also an air-density value. */
  grit: number;
};

export type SkyhookVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type WindBed = {
  setLevel(value: number, time: number): void;
  setBrightness(value: number, time: number): void;
};

/**
 * The atmosphere itself: a wide band of filtered noise with a slow swell. The
 * arrangement fades it out completely by the time the car leaves the air, and
 * that silence is the loudest thing in the level.
 */
export function installSkyhookWind(context: AudioContext, mix: MixBus): WindBed | null {
  if (!mix.noiseBuffer) return null;
  const source = context.createBufferSource();
  source.buffer = mix.noiseBuffer;
  source.loop = true;

  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 520;
  band.Q.value = 0.55;

  const shelf = context.createBiquadFilter();
  shelf.type = 'lowpass';
  shelf.frequency.value = 1400;

  const gain = context.createGain();
  gain.gain.value = 0;

  // Two slow LFOs so the gusting never loops audibly.
  for (const [rate, depth] of [[0.077, 0.5], [0.131, 0.28]] as const) {
    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    lfo.frequency.value = rate;
    lfoGain.gain.value = depth * 180;
    lfo.connect(lfoGain).connect(band.frequency);
    lfo.start();
  }

  source.connect(band).connect(shelf).connect(gain).connect(mix.music);
  if (mix.reverbSend) {
    const send = context.createGain();
    send.gain.value = 0.6;
    gain.connect(send).connect(mix.reverbSend);
  }
  source.start();

  return {
    setLevel(value, time) {
      gain.gain.setTargetAtTime(value, time, 0.5);
    },
    setBrightness(value, time) {
      shelf.frequency.setTargetAtTime(600 + value * 2600, time, 0.6);
    },
  };
}

/** The station's own sound: a quiet machine hum that only exists once docked. */
export function installStationHum(context: AudioContext, mix: MixBus) {
  const gain = context.createGain();
  gain.gain.value = 0;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  for (const [midi, level, detune] of [[33, 0.5, -6], [45, 0.28, 5], [52, 0.14, 9]] as const) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(midi);
    osc.detune.value = detune;
    const partial = context.createGain();
    partial.gain.value = level;
    osc.connect(partial).connect(filter);
    osc.start();
  }
  filter.connect(gain).connect(mix.music);
  return {
    setLevel(value: number, time: number) {
      gain.gain.setTargetAtTime(value, time, 0.7);
    },
  };
}

export function createSkyhookVoices(environment: SkyhookVoiceEnvironment) {
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

  function roomSend(room: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.reverbSend && room > 0.01) sends.push({ destination: mix.reverbSend, gain: room });
    return sends;
  }

  const kickTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.19,
    stopPadding: 0.03,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 41, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.58 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.075,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 128, time: time + 0.055 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.15 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.075 },
    ],
  });

  // The tether toll: a strap the size of a country, struck. Two inharmonic
  // partials over a long decay, plus a short metallic transient.
  const tollPartial = voice<{ vel: number; ratio: number; level: number; decay: number }>({
    oscillators: [{ type: 'sine', frequencyRatio: ({ ratio }) => ratio }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel, level, decay }) => [
      { type: 'set', value: level * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const arpTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.14,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequency: 3400,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 900, time: time + 0.13 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.085 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      frequency: 3100,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 480, time: time + 0.26 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.048 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.85,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.55 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.52 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
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
    kick(context, time, vel, room) {
      const mix = environment.mix();
      const output = musicDestination();
      if (!mix || !output) return;
      kickTone.play({ context, time, frequency: 150, vel, destination: output });
      noiseHit(time, 0.07 * vel, 0.005, 'highpass', 1700, output);
      if (room > 0.05) noiseHit(time, 0.05 * vel * room, 0.22, 'lowpass', 320, output);
      mix.duckAt(time, 0.46, 0.14);
    },

    snare(context, time, vel, room) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, 0.2 * vel, 0.06 + room * 0.09, 'bandpass', 1850, output);
      noiseHit(time, 0.09 * vel, 0.026, 'highpass', 5600, output);
      snareBody.play({ context, time, frequency: 205, vel, destination: output, sends: roomSend(room * 0.7) });
    },

    hat(_context, time, vel, decay) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, decay, 'highpass', 8600, duck);
    },

    shaker(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, vel, 0.09, 'bandpass', 6400, duck);
    },

    crash(_context, time, vel, room) {
      const output = musicDestination();
      if (!output) return;
      noiseHit(time, vel, 0.7, 'highpass', 4200, output);
      const reverbSend = environment.mix()?.reverbSend;
      if (reverbSend && room > 0.05) noiseHit(time, vel * room, 1.5, 'bandpass', 6800, reverbSend);
    },

    // Struck ribbon. `rate` shortens the decay for the fast tolls up top.
    toll(context, time, midi, vel, room, rate) {
      const output = musicDestination();
      if (!output) return;
      const decay = (2.6 / Math.max(0.5, rate)) * (0.55 + room * 0.45);
      for (const [ratio, level, scale] of [[1, 0.16, 1], [2.76, 0.055, 0.55], [5.4, 0.022, 0.3]] as const) {
        tollPartial.play({
          context,
          time,
          midi,
          ratio,
          level,
          decay: decay * scale,
          vel,
          destination: output,
          sends: roomSend(0.2 + room * 0.5),
        });
      }
      noiseHit(time, 0.05 * vel, 0.035, 'bandpass', 2600, output);
    },

    // The air itself as a chord: wide detuned saws behind a moving lowpass.
    pad(context, time, midis, duration, vel, room) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        for (const detune of [-11, 11]) {
          const osc = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune + Math.sin(midi * 5.1) * 5;
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(500 + room * 500, time);
          filter.frequency.linearRampToValueAtTime(1200 + room * 1400, time + duration * 0.45);
          filter.frequency.linearRampToValueAtTime(600 + room * 500, time + duration);
          filter.Q.value = 0.7;
          const level = (0.042 * vel) / Math.sqrt(midis.length / 4);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + Math.min(1.1, duration * 0.3));
          gain.gain.setValueAtTime(level, time + duration - Math.min(1.2, duration * 0.35));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(filter).connect(gain);
          gain.connect(mix.duck);
          if (mix.reverbSend && room > 0.01) {
            const send = context.createGain();
            send.gain.value = 0.35 + room * 0.55;
            gain.connect(send).connect(mix.reverbSend);
          }
          osc.start(time);
          osc.stop(time + duration + 0.06);
        }
      }
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
      subGain.gain.linearRampToValueAtTime(0.28 * vel, time + 0.01);
      subGain.gain.setValueAtTime(0.28 * vel, time + dur * 0.65);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      sub.connect(subGain).connect(duck);
      sub.start(time);
      sub.stop(time + dur + 0.03);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(280 + growl * 950 * vel, time);
      filter.frequency.exponentialRampToValueAtTime(160, time + dur);
      const bite = context.createGain();
      bite.gain.setValueAtTime(0, time);
      bite.gain.linearRampToValueAtTime(0.075 * vel * growl, time + 0.008);
      bite.gain.exponentialRampToValueAtTime(0.001, time + dur);
      for (const detune of [-11, 11]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 0.03);
      }
      filter.connect(bite).connect(duck);
    },

    arp(context, time, midi, vel, room) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const sends: Array<{ destination: AudioNode; gain: number }> = [];
      if (mix.delaySend) sends.push({ destination: mix.delaySend, gain: 0.28 + room * 0.3 });
      if (mix.reverbSend && room > 0.02) sends.push({ destination: mix.reverbSend, gain: room * 0.6 });
      arpTone.play({ context, time, midi, vel, destination: mix.duck, sends });
    },

    stab(context, time, midis, vel, room) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      for (const midi of midis) {
        for (const detune of [-9, 9]) {
          stabTone.play({ context, time, midi, detune, vel, destination: mix.duck, sends: roomSend(room * 0.45) });
        }
      }
    },

    // The Descender's theme voice: cold, metallic, two octaves of detuned square.
    lead(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, time);
      filter.frequency.linearRampToValueAtTime(1300, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.062 * vel, time + 0.03);
      gain.gain.setValueAtTime(0.062 * vel, time + Math.max(0.03, duration - 0.09));
      gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);
      for (const [type, detune, octave] of [['square', -8, 0], ['sawtooth', 8, -1]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi + octave * 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.06);
      }
      filter.connect(gain).connect(mix.duck);
      if (mix.delaySend) {
        const echo = context.createGain();
        echo.gain.value = 0.32;
        gain.connect(echo).connect(mix.delaySend);
      }
    },

    // Structure drone: what the tether sounds like with a building on it.
    drone(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(240, time);
      filter.frequency.linearRampToValueAtTime(700, time + duration * 0.6);
      filter.frequency.linearRampToValueAtTime(220, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.09 * vel, time + duration * 0.2);
      gain.gain.setValueAtTime(0.09 * vel, time + duration * 0.7);
      gain.gain.linearRampToValueAtTime(0, time + duration);
      for (const [ratio, detune] of [[1, 0], [1.0035, 0], [2, -14], [3.02, 12]] as const) {
        const osc = context.createOscillator();
        osc.type = ratio > 1.5 ? 'triangle' : 'sawtooth';
        osc.frequency.value = midiToFreq(midi) * ratio;
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.06);
      }
      filter.connect(gain).connect(mix.duck);
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
          frequencyAutomation: [{ type: 'exponentialRamp', value: 6800, time: time + duration }],
        },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: level, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.07 },
        ],
        destination: output,
      });
    },

    impact(context, time, vel, room) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 118, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.32, 'lowpass', 400, output);
      instruments.crash(time, 0.15 * vel, room);
    },
  }, {
    kick: ['vel', 'room'],
    snare: ['vel', 'room'],
    hat: ['vel', 'decay'],
    shaker: ['vel'],
    crash: ['vel', 'room'],
    toll: ['midi', 'vel', 'room', 'rate'],
    pad: ['midis', 'duration', 'vel', 'room'],
    bass: ['midi', 'vel', 'growl'],
    arp: ['midi', 'vel', 'room'],
    stab: ['midis', 'vel', 'room'],
    lead: ['midi', 'duration', 'vel'],
    drone: ['midi', 'duration', 'vel'],
    riser: ['duration', 'level'],
    impact: ['vel', 'room'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, tonal: SkyhookTonalVoice, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: tonal.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({
      context,
      time,
      midi,
      voice: tonal,
      velocity: vel,
      weight,
      destination: output,
      sends: playerSends(0.2 + tonal.air * 0.4, tonal.air),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise, sfxDestination };
}
