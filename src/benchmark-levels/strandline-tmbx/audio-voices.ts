import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type AutomationStep,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf: Strandline's synth voices. The music is water and glass — a bell
// heartbeat, drips, glass plucks, breathy pads, a wordless choir — against
// one sour voice, the parasite drone. Arrangement, harmony, and every level
// decision live in audio.ts; these only build sound from parameters.

export type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type BellTimbre = {
  wave: OscillatorType;
  /** Inharmonic partial ratio and level: glassier at higher ratios. */
  partial: number;
  partialGain: number;
  decay: number;
  cutoff: number;
  gain: number;
};

export function createStrandlineVoices(environment: VoiceEnvironment) {
  const noiseVoice = noiseHitSpec({ filterType: 'bandpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noise(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const buffer = environment.mix()?.noiseBuffer;
    if (!context || !buffer) return;
    noiseVoice.play({ context, buffer, time, velocity: vel, decay, filterType, frequency, destination, offset: Math.random() * 1.5 });
  }

  function tone(
    context: AudioContext,
    options: {
      time: number;
      frequency: number;
      wave: OscillatorType;
      gain: AutomationStep[];
      stop: number;
      destination: AudioNode | AudioNode[];
      frequencyAutomation?: AutomationStep[];
      filter?: { type: BiquadFilterType; frequency: number; Q?: number; frequencyAutomation?: AutomationStep[] };
      detune?: number;
      sends?: Array<{ destination: AudioNode; gain: number }>;
    },
  ) {
    playOscillatorVoice({
      context,
      time: options.time,
      stopTime: options.stop,
      oscillatorType: options.wave,
      frequency: options.frequency,
      frequencyAutomation: options.frequencyAutomation,
      detune: options.detune,
      filter: options.filter,
      gainAutomation: options.gain,
      destination: options.destination,
      sends: options.sends,
    });
  }

  const sends = (delayGain: number, reverbGain: number) => {
    const mix = environment.mix();
    const list: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delayGain > 0) list.push({ destination: mix.delaySend, gain: delayGain });
    if (mix?.reverbSend && reverbGain > 0) list.push({ destination: mix.reverbSend, gain: reverbGain });
    return list;
  };

  const envelope = (time: number, peak: number, attack: number, hold: number, release: number): AutomationStep[] => [
    { type: 'set', value: 0.0001, time },
    { type: 'linearRamp', value: peak, time: time + attack },
    { type: 'set', value: peak, time: time + attack + hold },
    { type: 'exponentialRamp', value: 0.0001, time: time + attack + hold + release },
  ];

  const pluck = (time: number, peak: number, decay: number): AutomationStep[] => [
    { type: 'set', value: peak, time },
    { type: 'exponentialRamp', value: 0.0001, time: time + decay },
  ];

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    // The jellyfish's heartbeat: a soft sub thump and the whoosh of water
    // pushed out of the bell, with the rest of the music breathing around it.
    pulse(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix) return;
      const f = midiToFreq(midi);
      tone(context, {
        time,
        frequency: f * 2,
        frequencyAutomation: [{ type: 'exponentialRamp', value: f, time: time + 0.08 }],
        wave: 'sine',
        gain: [
          { type: 'set', value: 0.0001, time },
          { type: 'linearRamp', value: 0.42 * vel, time: time + 0.02 },
          { type: 'exponentialRamp', value: 0.0001, time: time + 1.1 },
        ],
        stop: time + 1.2,
        destination: mix.music,
      });
      const buffer = mix.noiseBuffer;
      if (buffer) {
        playBufferSourceVoice({
          context,
          buffer,
          time,
          stopTime: time + 1.3,
          loop: true,
          filter: {
            type: 'lowpass',
            Q: 2,
            frequencyAutomation: [
              { type: 'set', value: 160, time },
              { type: 'exponentialRamp', value: 520 + vel * 300, time: time + 0.18 },
              { type: 'exponentialRamp', value: 140, time: time + 1.1 },
            ],
          },
          gainAutomation: envelope(time, 0.09 * vel, 0.14, 0.05, 0.95),
          destination: mix.music,
        });
      }
      mix.duckAt(time, 1 - 0.28 * vel, 0.7);
    },

    pad(context, time, midis, duration, cutoff, gain) {
      const mix = environment.mix();
      if (!mix) return;
      for (const midi of midis as number[]) {
        for (const detune of [-8, 7]) {
          tone(context, {
            time,
            frequency: midiToFreq(midi),
            detune,
            wave: 'sawtooth',
            filter: {
              type: 'lowpass',
              frequency: cutoff,
              Q: 0.7,
              frequencyAutomation: [
                { type: 'set', value: cutoff * 0.6, time },
                { type: 'linearRamp', value: cutoff, time: time + duration * 0.45 },
                { type: 'linearRamp', value: cutoff * 0.7, time: time + duration },
              ],
            },
            gain: [
              { type: 'set', value: 0.0001, time },
              { type: 'linearRamp', value: gain, time: time + Math.min(1.2, duration * 0.35) },
              { type: 'set', value: gain, time: time + duration * 0.7 },
              { type: 'linearRamp', value: 0.0001, time: time + duration },
            ],
            stop: time + duration + 0.05,
            destination: mix.duck,
            sends: sends(0, 0.5),
          });
        }
      }
    },

    // A drop of water on glass: a sine that chirps up into its pitch.
    drip(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix) return;
      const f = midiToFreq(midi);
      tone(context, {
        time,
        frequency: f * 0.82,
        frequencyAutomation: [{ type: 'exponentialRamp', value: f, time: time + 0.03 }],
        wave: 'sine',
        gain: pluck(time, 0.12 * vel, 0.7),
        stop: time + 0.75,
        destination: mix.duck,
        sends: sends(0.55, 0.6),
      });
      noise(time, 0.025 * vel, 0.02, 'bandpass', f * 4, mix.duck);
    },

    glass(context, time, midi, vel, bright) {
      const mix = environment.mix();
      if (!mix) return;
      const f = midiToFreq(midi);
      tone(context, { time, frequency: f, wave: 'triangle', gain: pluck(time, 0.1 * vel, 0.3 + bright * 0.25), stop: time + 0.6, destination: mix.duck, sends: sends(0.35, 0.25) });
      tone(context, { time, frequency: f * 4.01, wave: 'sine', gain: pluck(time, 0.028 * vel * (0.5 + bright), 0.12), stop: time + 0.2, destination: mix.duck, sends: sends(0.3, 0) });
    },

    kick(context, time, vel) {
      const mix = environment.mix();
      if (!mix) return;
      tone(context, {
        time,
        frequency: 96,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 44, time: time + 0.14 }],
        wave: 'sine',
        gain: pluck(time, 0.5 * vel, 0.3),
        stop: time + 0.34,
        destination: mix.music,
      });
      mix.duckAt(time, 1 - 0.35 * vel, 0.3);
    },

    shaker(_context, time, vel) {
      const duck = environment.mix()?.duck;
      if (duck) noise(time, vel, 0.035, 'highpass', 6800, duck);
    },

    // Wet wooden click, like a shell knocked underwater.
    click(context, time, vel) {
      const mix = environment.mix();
      if (!mix) return;
      noise(time, 0.12 * vel, 0.03, 'bandpass', 2100, mix.duck);
      tone(context, { time, frequency: 1250, wave: 'sine', gain: pluck(time, 0.05 * vel, 0.04), stop: time + 0.06, destination: mix.duck, sends: sends(0.15, 0.2) });
    },

    bass(context, time, midi, vel, duration) {
      const mix = environment.mix();
      if (!mix) return;
      const f = midiToFreq(midi);
      tone(context, { time, frequency: f, wave: 'sine', gain: envelope(time, 0.26 * vel, 0.012, duration * 0.4, duration * 0.6), stop: time + duration + 0.05, destination: mix.duck });
      tone(context, {
        time,
        frequency: f * 2,
        wave: 'triangle',
        filter: { type: 'lowpass', frequency: 420 },
        gain: envelope(time, 0.08 * vel, 0.012, duration * 0.2, duration * 0.5),
        stop: time + duration + 0.05,
        destination: mix.duck,
      });
    },

    // A wordless choir: saws through two vowel formants, slow to bloom.
    choir(context, time, midis, duration, gain) {
      const mix = environment.mix();
      if (!mix) return;
      for (const midi of midis as number[]) {
        for (const [formant, q, level] of [[720, 5, 1], [1160, 6, 0.7]] as const) {
          for (const detune of [-10, 9]) {
            tone(context, {
              time,
              frequency: midiToFreq(midi),
              detune,
              wave: 'sawtooth',
              filter: { type: 'bandpass', frequency: formant, Q: q },
              gain: [
                { type: 'set', value: 0.0001, time },
                { type: 'linearRamp', value: gain * level, time: time + Math.min(1.4, duration * 0.4) },
                { type: 'set', value: gain * level, time: time + duration * 0.7 },
                { type: 'linearRamp', value: 0.0001, time: time + duration },
              ],
              stop: time + duration + 0.05,
              destination: mix.duck,
              sends: sends(0, 0.8),
            });
          }
        }
      }
    },

    // Struck bell: a pure fundamental and a quick inharmonic shimmer.
    chime(context, time, midi, vel) {
      const mix = environment.mix();
      if (!mix) return;
      const f = midiToFreq(midi);
      tone(context, { time, frequency: f, wave: 'sine', gain: pluck(time, 0.09 * vel, 1.6), stop: time + 1.7, destination: mix.duck, sends: sends(0.3, 0.6) });
      tone(context, { time, frequency: f * 2.76, wave: 'sine', gain: pluck(time, 0.035 * vel, 0.5), stop: time + 0.55, destination: mix.duck, sends: sends(0.2, 0.4) });
      tone(context, { time, frequency: f * 5.4, wave: 'sine', gain: pluck(time, 0.012 * vel, 0.18), stop: time + 0.2, destination: mix.duck });
    },

    // The parasite: two saws a quarter-tone apart through a wobbling
    // resonant lowpass. It beats against itself — the one sour sound here.
    sour(context, time, midi, duration, gain) {
      const mix = environment.mix();
      if (!mix) return;
      const f = midiToFreq(midi);
      const wobble: AutomationStep[] = [{ type: 'set', value: 380, time }];
      for (let t = 0.3; t < duration; t += 0.3) {
        wobble.push({ type: 'linearRamp', value: 380 + 420 * (0.5 + 0.5 * Math.sin(t * 5.3)), time: time + t });
      }
      for (const ratio of [1, 1.028]) {
        tone(context, {
          time,
          frequency: f * ratio,
          wave: 'sawtooth',
          filter: { type: 'lowpass', frequency: 380, Q: 7, frequencyAutomation: wobble },
          gain: [
            { type: 'set', value: 0.0001, time },
            { type: 'linearRamp', value: gain, time: time + Math.min(0.8, duration * 0.3) },
            { type: 'set', value: gain, time: time + duration * 0.75 },
            { type: 'linearRamp', value: 0.0001, time: time + duration },
          ],
          stop: time + duration + 0.05,
          destination: mix.duck,
          sends: sends(0, 0.3),
        });
      }
    },

    // A breathy wooden flute for the upstream counter-line.
    flute(context, time, midi, duration, vel) {
      const mix = environment.mix();
      if (!mix) return;
      const f = midiToFreq(midi);
      tone(context, {
        time,
        frequency: f,
        wave: 'triangle',
        filter: { type: 'lowpass', frequency: 1900 },
        gain: envelope(time, 0.07 * vel, 0.06, duration * 0.5, duration * 0.6),
        stop: time + duration * 1.2,
        destination: mix.duck,
        sends: sends(0.35, 0.35),
      });
      noise(time, 0.018 * vel, 0.09, 'bandpass', f * 2, mix.duck);
    },

    // Threading past a strand: a soft swell of water, panned to its side.
    whoosh(context, time, pan, gain) {
      const mix = environment.mix();
      const buffer = mix?.noiseBuffer;
      if (!mix || !buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.6;
      filter.frequency.setValueAtTime(360, time);
      filter.frequency.exponentialRampToValueAtTime(1300, time + 0.16);
      filter.frequency.exponentialRampToValueAtTime(420, time + 0.5);
      const amp = context.createGain();
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(gain, time + 0.16);
      amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.52);
      const panner = context.createStereoPanner();
      panner.pan.setValueAtTime(pan * 0.6, time);
      panner.pan.linearRampToValueAtTime(pan, time + 0.4);
      source.connect(filter).connect(amp).connect(panner).connect(mix.music);
      source.start(time, Math.random() * 1.2);
      source.stop(time + 0.6);
    },

    riser(context, time, duration, gain) {
      const mix = environment.mix();
      const buffer = mix?.noiseBuffer;
      if (!mix || !buffer) return;
      playBufferSourceVoice({
        context,
        buffer,
        time,
        stopTime: time + duration + 0.1,
        loop: true,
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequencyAutomation: [
            { type: 'set', value: 260, time },
            { type: 'exponentialRamp', value: 5200, time: time + duration },
          ],
        },
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'exponentialRamp', value: gain, time: time + duration },
          { type: 'linearRamp', value: 0.0001, time: time + duration + 0.08 },
        ],
        destination: mix.duck,
      });
    },
  }, {
    pulse: ['midi', 'vel'],
    pad: ['midis', 'duration', 'cutoff', 'gain'],
    drip: ['midi', 'vel'],
    glass: ['midi', 'vel', 'bright'],
    kick: ['vel'],
    shaker: ['vel'],
    click: ['vel'],
    bass: ['midi', 'vel', 'duration'],
    choir: ['midis', 'duration', 'gain'],
    chime: ['midi', 'vel'],
    sour: ['midi', 'duration', 'gain'],
    flute: ['midi', 'duration', 'vel'],
    riser: ['duration', 'gain'],
    whoosh: ['pan', 'gain'],
  });

  // ---- the player's instruments (not traced; they answer the player) ----

  const sfx = () => environment.mix()?.sfx ?? null;

  /** Lock: a drop of the jelly's light — a pitched droplet chirp. */
  function droplet(time: number, midi: number, gain: number, bright: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    const f = midiToFreq(midi);
    tone(context, {
      time,
      frequency: f * 0.7,
      frequencyAutomation: [{ type: 'exponentialRamp', value: f, time: time + 0.035 }],
      wave: 'sine',
      gain: pluck(time, gain, 0.16 + bright * 0.12),
      stop: time + 0.32,
      destination: output,
      sends: sends(0.3, 0.25),
    });
    if (bright > 0.1) {
      tone(context, { time, frequency: f * 3, wave: 'triangle', gain: pluck(time, gain * 0.22 * bright, 0.08), stop: time + 0.1, destination: output });
    }
  }

  /** Fire: a bubble of light pushed out — soft thump, bubbly puff, rising chirp. */
  function thoop(time: number, rootMidi: number, gain: number, cutoff: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    const f = midiToFreq(rootMidi);
    tone(context, {
      time,
      frequency: f * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: f * 4, time: time + 0.09 }],
      wave: 'sine',
      filter: { type: 'lowpass', frequency: cutoff },
      gain: pluck(time, gain, 0.12),
      stop: time + 0.14,
      destination: output,
      sends: sends(0.15, 0.1),
    });
    noise(time, gain * 0.5, 0.06, 'bandpass', cutoff * 0.8, output);
  }

  /** Kill: the written lane note in the section's bell timbre, with a body an octave down. */
  function killBell(time: number, midi: number, timbre: BellTimbre, vel: number, weight: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    const f = midiToFreq(midi);
    const g = timbre.gain * vel * weight;
    tone(context, {
      time,
      frequency: f,
      wave: timbre.wave,
      filter: { type: 'lowpass', frequency: timbre.cutoff },
      gain: pluck(time, g, timbre.decay),
      stop: time + timbre.decay + 0.05,
      destination: output,
      sends: sends(0.45, 0.35),
    });
    tone(context, {
      time,
      frequency: f * timbre.partial,
      wave: 'sine',
      gain: pluck(time, g * timbre.partialGain, timbre.decay * 0.35),
      stop: time + timbre.decay * 0.4,
      destination: output,
      sends: sends(0.3, 0.2),
    });
    tone(context, { time, frequency: f / 2, wave: 'sine', gain: pluck(time, g * 0.45, timbre.decay * 0.7), stop: time + timbre.decay, destination: output });
  }

  function sparkle(time: number, midi: number, gain: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    tone(context, { time, frequency: midiToFreq(midi), wave: 'sine', gain: pluck(time, gain, 0.6), stop: time + 0.65, destination: output, sends: sends(0.5, 0.4) });
  }

  /** Non-lethal hit: a muted pluck and a wet tick. */
  function chip(time: number, midi: number, gain: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    tone(context, { time, frequency: midiToFreq(midi), wave: 'triangle', filter: { type: 'lowpass', frequency: 2400 }, gain: pluck(time, gain, 0.14), stop: time + 0.16, destination: output, sends: sends(0.25, 0) });
    noise(time, gain * 0.35, 0.03, 'bandpass', 3200, output);
  }

  /** Reject: the parasite's sourness in the player's hands — a detuned blurp that sinks. */
  function sourBlurp(time: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    for (const [start, end, at] of [[311, 147, 0], [330, 139, 0.03]] as const) {
      tone(context, {
        time: time + at,
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: time + at + 0.22 }],
        wave: 'sawtooth',
        filter: {
          type: 'bandpass',
          frequency: 900,
          Q: 4,
          frequencyAutomation: [{ type: 'set', value: 1100, time: time + at }, { type: 'exponentialRamp', value: 320, time: time + at + 0.22 }],
        },
        gain: pluck(time + at, 0.15, 0.26),
        stop: time + at + 0.3,
        destination: output,
      });
    }
    noise(time, 0.08, 0.1, 'bandpass', 700, output);
  }

  /** Miss: something slips away into the water — a low sinking blub. */
  function blub(time: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    tone(context, {
      time,
      frequency: 180,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 70, time: time + 0.16 }],
      wave: 'sine',
      gain: pluck(time, 0.06, 0.18),
      stop: time + 0.2,
      destination: output,
      sends: sends(0, 0.3),
    });
  }

  /** Spore launch: a wet sour pop, the parasite's one attack sound. */
  function sporePop(time: number, midi: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    const f = midiToFreq(midi);
    tone(context, {
      time,
      frequency: f * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: f, time: time + 0.12 }],
      wave: 'square',
      filter: { type: 'lowpass', frequency: 1300, Q: 6 },
      gain: pluck(time, 0.05, 0.2),
      stop: time + 0.24,
      destination: output,
      sends: sends(0.2, 0.3),
    });
    noise(time, 0.06, 0.05, 'bandpass', 900, output);
  }

  /** Membrane hit: a muffled impact under a violet cluster. */
  function sting(time: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    tone(context, {
      time,
      frequency: 110,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 36, time: time + 0.3 }],
      wave: 'sine',
      gain: pluck(time, 0.4, 0.45),
      stop: time + 0.5,
      destination: output,
    });
    for (const midi of [59, 60, 66]) {
      tone(context, {
        time,
        frequency: midiToFreq(midi),
        wave: 'sawtooth',
        filter: { type: 'lowpass', frequency: 1400 },
        gain: pluck(time, 0.05, 0.4),
        stop: time + 0.45,
        destination: output,
        sends: sends(0, 0.3),
      });
    }
    noise(time, 0.18, 0.2, 'lowpass', 600, output);
  }

  /** Bloom: a chord of chimes, for a clean volley and for the web dying back. */
  function bloom(time: number, midis: number[], gain: number, spread: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    midis.forEach((midi, index) => {
      const at = time + index * spread;
      const f = midiToFreq(midi);
      tone(context, { time: at, frequency: f, wave: 'sine', gain: pluck(at, gain, 1.4), stop: at + 1.5, destination: output, sends: sends(0.35, 0.6) });
      tone(context, { time: at, frequency: f * 2.76, wave: 'sine', gain: pluck(at, gain * 0.3, 0.4), stop: at + 0.45, destination: output, sends: sends(0.2, 0.3) });
    });
  }

  /** Low sub drop, for the parent's stages and death. */
  function subDrop(time: number, from: number, to: number, gain: number, length: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    tone(context, {
      time,
      frequency: from,
      frequencyAutomation: [{ type: 'exponentialRamp', value: to, time: time + length * 0.6 }],
      wave: 'sine',
      gain: pluck(time, gain, length),
      stop: time + length + 0.05,
      destination: output,
    });
  }

  /** Tearing: noise ripped through a falling bandpass. */
  function tear(time: number, gain: number) {
    const context = environment.context();
    const mix = environment.mix();
    const output = sfx();
    if (!context || !output || !mix?.noiseBuffer) return;
    playBufferSourceVoice({
      context,
      buffer: mix.noiseBuffer,
      time,
      stopTime: time + 0.8,
      loop: true,
      filter: {
        type: 'bandpass',
        Q: 3,
        frequencyAutomation: [{ type: 'set', value: 2600, time }, { type: 'exponentialRamp', value: 220, time: time + 0.7 }],
      },
      gainAutomation: [
        { type: 'set', value: gain, time },
        { type: 'exponentialRamp', value: 0.0001, time: time + 0.75 },
      ],
      destination: output,
    });
  }

  /** Parasite chord stab for pumps and arrivals: sour, short, wet. */
  function sourStab(time: number, midis: number[], gain: number) {
    const context = environment.context();
    const output = sfx();
    if (!context || !output) return;
    for (const midi of midis) {
      for (const ratio of [1, 1.026]) {
        tone(context, {
          time,
          frequency: midiToFreq(midi) * ratio,
          wave: 'sawtooth',
          filter: { type: 'lowpass', frequency: 1100, Q: 5, frequencyAutomation: [{ type: 'set', value: 1600, time }, { type: 'exponentialRamp', value: 300, time: time + 0.5 }] },
          gain: pluck(time, gain, 0.6),
          stop: time + 0.65,
          destination: output,
          sends: sends(0.2, 0.4),
        });
      }
    }
  }

  return {
    ...instruments,
    noise,
    droplet,
    thoop,
    killBell,
    sparkle,
    chip,
    sourBlurp,
    blub,
    sporePop,
    sting,
    bloom,
    subDrop,
    tear,
    sourStab,
  };
}
