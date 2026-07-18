import { defineInstruments, playBufferSourceVoice, type MixBus } from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// The Broadside kit is an orchestra, built out of the smallest number of
// synthesis ideas that will carry one:
//
//   brass    detuned sawtooths behind a lowpass that OPENS with the envelope,
//            so a note gets brighter as it is pushed — the single most
//            important trick for making a synth read as brass rather than as a
//            saw lead. `bite` scales how far the filter travels.
//   strings  many slightly-detuned sawtooths with a slow attack and a soft
//            lowpass; `voices` counts layers per note so the arrangement can
//            thin the section down to a solo line and back.
//   tremolo  the same section under a real gain LFO — the sound of an orchestra
//            holding its breath, which is what the shield pass runs on.
//   timpani  a sine dropping a fifth in 90 ms over a lowpassed noise thump.
//   choir    triangles behind a vocal-ish bandpass, drenched in the reverb.
//
// Everything player-facing is a *player instrument* rather than an effect: the
// lock is a pizzicato, the volley is a brass stab, and the kill is the solo
// line. Gains are tuned by ear per voice, not matched numerically — a sawtooth
// stack at 0.05 is far louder than a sine at 0.05.

export type PlayerVoiceSpec = {
  oscillator: OscillatorType;
  decay: number;
  cutoff: number;
  gain: number;
  /** Air on top of the note: bow noise, breath, hall. */
  sparkle: number;
  reverb: number;
};

export type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export function createBroadsideVoices(environment: VoiceEnvironment) {
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

  // ---- declarative voices ---------------------------------------------------

  const timpaniTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.85,
    stopPadding: 0.05,
    frequencyAutomation: (time, frequency) => [
      { type: 'exponentialRamp', value: frequency * 0.66, time: time + 0.09 },
      { type: 'exponentialRamp', value: frequency * 0.6, time: time + 0.8 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.62 * vel, time },
      { type: 'exponentialRamp', value: 0.14 * vel, time: time + 0.22 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
    ],
  });

  const snareBody = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.07,
    stopPadding: 0.02,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 150, time: time + 0.06 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.1 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
    ],
  });

  const pizzTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.8 },
      { type: 'sawtooth', gain: 0.35 },
    ],
    duration: 0.19,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      frequency: 3000,
      Q: 1.6,
      frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 700, time: time + 0.16 }],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.13 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.19 },
    ],
  });

  const harpTone = voice<{ vel: number; duration: number }>({
    oscillators: [
      { type: 'sine', gain: 0.8 },
      { type: 'sine', frequencyRatio: 2.01, gain: 0.22 },
      { type: 'sine', frequencyRatio: 4.03, gain: 0.06 },
    ],
    duration: ({ duration }) => duration,
    stopPadding: 0.06,
    gainAutomation: (time, _gain, { vel, duration }) => [
      { type: 'set', value: 0.1 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + duration },
    ],
  });

  const impactTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.9,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.5 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  const playerToneSpec = voice<{ voice: PlayerVoiceSpec }>({
    oscillators: [{ type: ({ voice }) => voice.oscillator, gain: ({ voice }) => voice.gain }],
    duration: ({ voice }) => voice.decay,
    stopPadding: 0.05,
    filter: {
      type: 'lowpass',
      cutoff: ({ voice }) => voice.cutoff,
      Q: 1.1,
      // Player notes open and close like a bowed attack rather than a beep.
      frequencyAutomation: (time, { voice }) => [
        { type: 'set', value: voice.cutoff * 0.45, time },
        { type: 'linearRamp', value: voice.cutoff, time: time + Math.min(0.05, voice.decay * 0.3) },
        { type: 'exponentialRamp', value: Math.max(300, voice.cutoff * 0.35), time: time + voice.decay },
      ],
    },
    envelope: {
      attack: ({ voice }) => Math.min(0.02, voice.decay * 0.12),
      decay: ({ voice }) => voice.decay,
    },
  });

  // ---- raw-primitive voices --------------------------------------------------
  // Brass, strings, tremolo, and choir need per-note node graphs (opening
  // filters, real LFOs, per-layer detune), so they are built by hand.

  function brassStack(
    context: AudioContext,
    destination: AudioNode,
    reverbSend: AudioNode | undefined,
    time: number,
    midi: number,
    duration: number,
    vel: number,
    bite: number,
    layers: number,
    reverbGain: number,
  ) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.2;
    const open = 380 + bite * 3400 * (0.4 + vel * 0.6);
    filter.frequency.setValueAtTime(300, time);
    filter.frequency.linearRampToValueAtTime(open, time + Math.min(0.09, duration * 0.35));
    filter.frequency.exponentialRampToValueAtTime(Math.max(260, open * 0.42), time + duration);

    const gain = context.createGain();
    const peak = (0.052 * vel) / Math.sqrt(layers);
    const attack = Math.min(0.05, duration * 0.2);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + attack);
    gain.gain.setValueAtTime(peak * 0.86, time + Math.max(attack, duration * 0.6));
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    filter.connect(gain).connect(destination);
    if (reverbSend && reverbGain > 0) {
      const send = context.createGain();
      send.gain.value = reverbGain;
      gain.connect(send).connect(reverbSend);
    }

    for (let layer = 0; layer < layers; layer += 1) {
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = layers === 1 ? 0 : (layer / (layers - 1) - 0.5) * 17;
      // A touch of lip vibrato on longer notes.
      if (duration > 0.5) {
        const lfo = context.createOscillator();
        lfo.frequency.value = 5.2;
        const lfoGain = context.createGain();
        lfoGain.gain.setValueAtTime(0, time);
        lfoGain.gain.linearRampToValueAtTime(5, time + duration * 0.5);
        lfo.connect(lfoGain).connect(osc.detune);
        lfo.start(time);
        lfo.stop(time + duration + 0.05);
      }
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + duration + 0.06);
    }
  }

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    // --- percussion ----------------------------------------------------------
    timpani(context, time, midi, vel) {
      const output = musicDestination();
      const mix = environment.mix();
      if (!output || !mix) return;
      timpaniTone.play({ context, time, frequency: midiToFreq(midi), vel, destination: output });
      noiseHit(time, 0.13 * vel, 0.045, 'lowpass', 260, output);
      if (mix.reverbSend) noiseHit(time, 0.05 * vel, 0.3, 'lowpass', 400, mix.reverbSend);
      mix.duckAt(time, 0.72, 0.16);
    },

    // A struck roll: dense low noise swelling into whatever lands next.
    timpaniRoll(_context, time, duration, vel) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      const context = environment.context();
      if (!output || !noiseBuffer || !context) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.08,
        loop: true,
        filter: { type: 'lowpass', Q: 2.4, frequency: 180 },
        gainAutomation: [
          { type: 'set', value: 0.02 * vel, time },
          { type: 'exponentialRamp', value: 0.4 * vel, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
        ],
        destination: output,
      });
    },

    snare(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.12 * vel, 0.055, 'highpass', 1900, duck);
      noiseHit(time + 0.006, 0.07 * vel, 0.09, 'bandpass', 3400, duck);
      snareBody.play({ context, time, frequency: 320, vel, destination: duck });
    },

    // The military roll under the martial acts.
    snareRoll(_context, time, duration, vel) {
      const duck = environment.mix()?.duck;
      const noiseBuffer = environment.mix()?.noiseBuffer;
      const context = environment.context();
      if (!duck || !noiseBuffer || !context) return;
      playBufferSourceVoice({
        context,
        buffer: noiseBuffer,
        time,
        stopTime: time + duration + 0.05,
        loop: true,
        filter: { type: 'bandpass', Q: 0.9, frequency: 2600 },
        gainAutomation: [
          { type: 'set', value: 0.01 * vel, time },
          { type: 'exponentialRamp', value: 0.09 * vel, time: time + duration },
          { type: 'linearRamp', value: 0, time: time + duration + 0.04 },
        ],
        destination: duck,
      });
    },

    cymbal(_context, time, vel, decay) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output) return;
      noiseHit(time, 0.1 * vel, decay, 'highpass', 6200, output);
      if (reverbSend) noiseHit(time, 0.06 * vel, decay * 1.8, 'bandpass', 8200, reverbSend);
    },

    gong(context, time, vel) {
      const output = musicDestination();
      const reverbSend = environment.mix()?.reverbSend;
      if (!output) return;
      impactTone.play({ context, time, frequency: 78, vel: vel * 0.7, destination: output });
      noiseHit(time, 0.16 * vel, 1.6, 'bandpass', 900, output);
      if (reverbSend) noiseHit(time, 0.13 * vel, 2.6, 'highpass', 2600, reverbSend);
    },

    impact(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      impactTone.play({ context, time, frequency: 120, vel, destination: output });
      noiseHit(time, 0.24 * vel, 0.3, 'lowpass', 340, output);
      noiseHit(time, 0.1 * vel, 0.8, 'highpass', 4800, output);
    },

    // --- brass ---------------------------------------------------------------
    brass(context, time, midi, duration, vel, bite) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      brassStack(context, mix.duck, mix.reverbSend, time, midi, duration, vel, bite, 3, 0.4);
    },

    // Trombones and tuba: fewer layers, darker filter, more weight.
    lowBrass(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      brassStack(context, mix.duck, mix.reverbSend, time, midi, duration, vel * 1.15, 0.42, 2, 0.3);
    },

    // The horn call: one long note that swells rather than being struck.
    horn(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      brassStack(context, mix.duck, mix.reverbSend, time, midi, duration, vel, 0.6, 3, 0.62);
    },

    // --- strings -------------------------------------------------------------
    strings(context, time, midis, duration, vel, voicesPerNote, cutoff) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const layers = Math.max(1, Math.round(voicesPerNote));
      for (const midi of midis) {
        for (let layer = 0; layer < layers; layer += 1) {
          const osc = context.createOscillator();
          const lowpass = context.createBiquadFilter();
          const gain = context.createGain();
          osc.type = layers === 1 ? 'triangle' : 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          // Wide, uneven detune: a real section is never in tune with itself.
          osc.detune.value = (layers === 1 ? 0 : (layer / (layers - 1) - 0.5) * 24)
            + Math.sin(midi * 7.3 + layer * 3.1) * 5;
          lowpass.type = 'lowpass';
          lowpass.Q.value = 0.7;
          lowpass.frequency.setValueAtTime(cutoff * 0.6, time);
          lowpass.frequency.linearRampToValueAtTime(cutoff, time + Math.min(0.6, duration * 0.4));
          lowpass.frequency.linearRampToValueAtTime(cutoff * 0.7, time + duration);
          const level = (0.05 * vel) / (Math.sqrt(midis.length) * Math.sqrt(layers));
          const attack = Math.min(0.55, duration * 0.28);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(level, time + attack);
          gain.gain.setValueAtTime(level, time + duration - Math.min(0.9, duration * 0.3));
          gain.gain.linearRampToValueAtTime(0, time + duration);
          osc.connect(lowpass).connect(gain).connect(mix.duck);
          if (mix.reverbSend) {
            const send = context.createGain();
            send.gain.value = 0.55;
            gain.connect(send).connect(mix.reverbSend);
          }
          osc.start(time);
          osc.stop(time + duration + 0.06);
        }
      }
    },

    // Tremolo strings: the same section under a real amplitude LFO. This is the
    // sound of the boss act — sustained dread rather than sustained warmth.
    tremolo(context, time, midis, duration, vel, rate) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      const bus = context.createGain();
      const level = (0.06 * vel) / Math.sqrt(midis.length);
      bus.gain.setValueAtTime(0, time);
      bus.gain.linearRampToValueAtTime(level, time + Math.min(0.35, duration * 0.25));
      bus.gain.setValueAtTime(level, time + duration * 0.75);
      bus.gain.linearRampToValueAtTime(0, time + duration);

      const lfo = context.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = rate;
      const lfoGain = context.createGain();
      lfoGain.gain.value = level * 0.55;
      lfo.connect(lfoGain).connect(bus.gain);
      lfo.start(time);
      lfo.stop(time + duration + 0.05);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1700;
      filter.Q.value = 0.8;
      filter.connect(bus).connect(mix.duck);
      if (mix.reverbSend) {
        const send = context.createGain();
        send.gain.value = 0.45;
        bus.connect(send).connect(mix.reverbSend);
      }

      for (const midi of midis) {
        for (const detune of [-8, 9]) {
          const osc = context.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToFreq(midi);
          osc.detune.value = detune;
          osc.connect(filter);
          osc.start(time);
          osc.stop(time + duration + 0.06);
        }
      }
    },

    // --- colour --------------------------------------------------------------
    choir(context, time, midis, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck || !mix.reverbSend) return;
      for (const midi of midis) {
        const osc = context.createOscillator();
        const formant = context.createBiquadFilter();
        const gain = context.createGain();
        osc.type = 'triangle';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = Math.sin(midi * 11.1) * 8;
        // A fixed vowel-ish resonance is enough to read as voices in a hall.
        formant.type = 'bandpass';
        formant.frequency.value = 820;
        formant.Q.value = 1.4;
        const level = (0.085 * vel) / Math.sqrt(midis.length);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + Math.min(0.8, duration * 0.35));
        gain.gain.setValueAtTime(level, time + duration * 0.7);
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(formant).connect(gain).connect(mix.duck);
        const send = context.createGain();
        send.gain.value = 0.85;
        gain.connect(send).connect(mix.reverbSend);
        osc.start(time);
        osc.stop(time + duration + 0.08);
      }
    },

    pizz(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      pizzTone.play({
        context,
        time,
        midi,
        vel,
        destination: mix.duck,
        sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.3 }] : undefined,
      });
    },

    harp(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix?.duck) return;
      harpTone.play({
        context,
        time,
        midi,
        duration,
        vel,
        destination: mix.duck,
        sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.55 }] : undefined,
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
  }, {
    timpani: ['midi', 'vel'],
    timpaniRoll: ['duration', 'vel'],
    snare: ['vel'],
    snareRoll: ['duration', 'vel'],
    cymbal: ['vel', 'decay'],
    gong: ['vel'],
    impact: ['vel'],
    brass: ['midi', 'duration', 'vel', 'bite'],
    lowBrass: ['midi', 'duration', 'vel'],
    horn: ['midi', 'duration', 'vel'],
    strings: ['midis', 'duration', 'vel', 'voicesPerNote', 'cutoff'],
    tremolo: ['midis', 'duration', 'vel', 'rate'],
    choir: ['midis', 'duration', 'vel'],
    pizz: ['midi', 'vel'],
    harp: ['midi', 'duration', 'vel'],
    riser: ['duration', 'level'],
  });

  function playerSends(delayGain: number, reverbGain: number) {
    const mix = environment.mix();
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) sends.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) sends.push({ destination: mix.reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, spec: PlayerVoiceSpec, vel: number, weight = 1) {
    if (environment.trace) {
      environment.trace.record(time, 'playerTone', { midi, vel, oscillator: spec.oscillator });
      return;
    }
    const context = environment.context();
    const output = sfxDestination();
    if (!context || !output) return;
    playerToneSpec.play({
      context,
      time,
      midi,
      voice: spec,
      velocity: vel,
      weight,
      destination: output,
      sends: playerSends(0.22, spec.reverb),
    });
  }

  function playerNoise(time: number, vel: number, decay: number, frequency: number) {
    const output = sfxDestination();
    if (!output) return;
    noiseHit(time, vel, decay, 'highpass', frequency, output);
  }

  return { ...instruments, noiseHit, playerSends, playerTone, playerNoise };
}
