import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createPluckBank, type PluckBank, type PluckTimbre } from './audio-pluck';
import { installRiver, type River, type RiverState } from './audio-river';

export type { PluckTimbre } from './audio-pluck';
export type { RiverState } from './audio-river';

// Spillway's instruments, all synthesised: hand drums (djembe bass, open tone
// and slap; a frame drum; seed shakers; a big low drum for set pieces), bowed
// low strings (ensemble pads, legato lines, spiccato, stabs, glissando rips),
// and Karplus-Strong plucked strings (harp and kora; see audio-pluck.ts).
//
// Every instrument writes into a shared bus that gives its family one body:
// a drum bus with a little low-end weight, a string bus with a cello-body bump
// around 260 Hz and the saw fizz cut near 3 kHz, and a pluck bus with a gourd
// resonance near 190 Hz. The player has its own copies of the pluck, string and
// drum buses on the SFX gain so the player's notes follow the SFX slider.
//
// Gains are set for perceived loudness, not equal numbers: detuned saws are
// far louder per unit gain than the sine membranes, so a bowed note sits at a
// few hundredths while a drum's fundamental sits near 0.5.

export type Route = 'music' | 'player';

export type SpillwayVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

type Buses = {
  drums: Record<Route, AudioNode>;
  strings: Record<Route, AudioNode>;
  plucks: Record<Route, AudioNode>;
  reverb: AudioNode | null;
  bank: PluckBank;
  river: River;
};

type NoiseOptions = {
  gain: number;
  decay: number;
  type: BiquadFilterType;
  frequency: number;
  Q?: number;
  attack?: number;
  sweepTo?: number;
};

type MembraneOptions = {
  from: number;
  to?: number;
  sweep?: number;
  decay: number;
  gain: number;
};

type BowOptions = {
  level: number;
  attack: number;
  release: number;
  cutoff: number;
  detunes: readonly number[];
  vibratoDepth: number;
  vibratoDelay: number;
  tremolo?: number;
  rosin?: number;
};

const ENSEMBLE_DETUNES = [-9, -2, 7] as const;
const SECTION_DETUNES = [-11, -4, 3, 10] as const;

export function createSpillwayVoices(environment: SpillwayVoiceEnvironment) {
  let buses: Buses | null = null;

  // ---- shared buses --------------------------------------------------------

  function install(context: AudioContext, mix: MixBus, riverInitial: RiverState) {
    const chain = (destination: AudioNode, filters: BiquadFilterOptionsLite[], sends: Array<[AudioNode | undefined, number]>) => {
      const input = context.createGain();
      let node: AudioNode = input;
      for (const spec of filters) {
        const filter = context.createBiquadFilter();
        filter.type = spec.type;
        filter.frequency.value = spec.frequency;
        if (spec.Q !== undefined) filter.Q.value = spec.Q;
        if (spec.gain !== undefined) filter.gain.value = spec.gain;
        node = node.connect(filter);
      }
      node.connect(destination);
      for (const [target, amount] of sends) {
        if (!target || amount <= 0) continue;
        const send = context.createGain();
        send.gain.value = amount;
        node.connect(send).connect(target);
      }
      return input;
    };

    const drumBody: BiquadFilterOptionsLite[] = [
      { type: 'highpass', frequency: 32 },
      { type: 'peaking', frequency: 110, Q: 0.9, gain: 2 },
      { type: 'peaking', frequency: 3400, Q: 0.8, gain: -2 },
    ];
    const stringBody: BiquadFilterOptionsLite[] = [
      { type: 'highpass', frequency: 40 },
      { type: 'peaking', frequency: 260, Q: 0.9, gain: 3 },
      { type: 'peaking', frequency: 560, Q: 1.4, gain: 1.5 },
      { type: 'peaking', frequency: 2900, Q: 1.2, gain: -4 },
      { type: 'lowpass', frequency: 7000, Q: 0.5 },
    ];
    const pluckBody: BiquadFilterOptionsLite[] = [
      { type: 'highpass', frequency: 70 },
      { type: 'peaking', frequency: 190, Q: 1.2, gain: 4 },
      { type: 'highshelf', frequency: 6500, gain: -4 },
    ];

    buses = {
      drums: {
        music: chain(mix.duck, drumBody, [[mix.reverbSend, 0.16]]),
        player: chain(mix.sfx, drumBody, [[mix.reverbSend, 0.22]]),
      },
      strings: {
        music: chain(mix.duck, stringBody, [[mix.reverbSend, 0.42]]),
        player: chain(mix.sfx, stringBody, [[mix.reverbSend, 0.36]]),
      },
      plucks: {
        music: chain(mix.duck, pluckBody, [[mix.delaySend, 0.2], [mix.reverbSend, 0.3]]),
        player: chain(mix.sfx, pluckBody, [[mix.delaySend, 0.3], [mix.reverbSend, 0.26]]),
      },
      reverb: mix.reverbSend ?? null,
      bank: createPluckBank(context),
      // The water is not music: it sits after the duck so a finale's duck
      // leaves the river running, but it still follows the music slider.
      river: installRiver(context, mix.music, riverInitial),
    };
  }

  function release() {
    buses = null;
  }

  // ---- primitives ----------------------------------------------------------

  function noise(context: AudioContext, time: number, destination: AudioNode, options: NoiseOptions) {
    const buffer = environment.mix()?.noiseBuffer;
    if (!buffer || options.gain <= 0.0002) return;
    const attack = options.attack ?? 0;
    const end = time + attack + options.decay;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = options.type;
    filter.frequency.setValueAtTime(options.frequency, time);
    if (options.sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(options.sweepTo, end);
    if (options.Q !== undefined) filter.Q.value = options.Q;
    const gain = context.createGain();
    if (attack > 0) {
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(options.gain, time + attack);
    } else {
      gain.gain.setValueAtTime(options.gain, time);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(gain).connect(destination);
    source.start(time, Math.random() * 1.8);
    source.stop(end + 0.03);
  }

  function membrane(context: AudioContext, time: number, destination: AudioNode, options: MembraneOptions) {
    if (options.gain <= 0.0002) return;
    const oscillator = context.createOscillator();
    oscillator.frequency.setValueAtTime(options.from, time);
    if (options.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(options.to, time + (options.sweep ?? 0.05));
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(options.gain, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + options.decay);
    oscillator.connect(gain).connect(destination);
    oscillator.start(time);
    oscillator.stop(time + options.decay + 0.03);
  }

  function bowedNote(context: AudioContext, time: number, midi: number, duration: number, options: BowOptions, destination: AudioNode) {
    const end = time + Math.max(duration, options.attack);
    const stop = end + options.release + 0.05;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(options.level, time + options.attack);
    envelope.gain.setValueAtTime(options.level, end);
    envelope.gain.linearRampToValueAtTime(0, end + options.release);

    // The bow bites harder as the note speaks: the filter opens with the attack.
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(options.cutoff * 0.45, time);
    filter.frequency.linearRampToValueAtTime(options.cutoff, time + options.attack * 1.2);

    // Vibrato arrives after the note has settled, as a player's would.
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 5 + ((midi * 7) % 5) * 0.12;
    const vibratoDepth = context.createGain();
    vibratoDepth.gain.setValueAtTime(0, time);
    vibratoDepth.gain.linearRampToValueAtTime(options.vibratoDepth, time + options.vibratoDelay);
    vibrato.connect(vibratoDepth);

    const frequency = midiToFreq(midi);
    for (const detune of options.detunes) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      vibratoDepth.connect(oscillator.detune);
      oscillator.connect(filter);
      oscillator.start(time);
      oscillator.stop(stop);
    }
    vibrato.start(time);
    vibrato.stop(stop);
    filter.connect(envelope);

    const buffer = environment.mix()?.noiseBuffer;
    if (options.rosin && buffer) {
      const rosin = context.createBufferSource();
      rosin.buffer = buffer;
      rosin.loop = true;
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = Math.min(6000, frequency * 6);
      band.Q.value = 0.8;
      const rosinGain = context.createGain();
      rosinGain.gain.value = options.rosin;
      rosin.connect(band).connect(rosinGain).connect(envelope);
      rosin.start(time, Math.random() * 1.5);
      rosin.stop(stop);
    }

    if (options.tremolo && options.tremolo > 0) {
      // Bowed tremolo: fast repeated bow strokes, heard as a flutter in level.
      const tremolo = context.createGain();
      tremolo.gain.value = 1 - options.tremolo * 0.5;
      const lfo = context.createOscillator();
      lfo.frequency.value = 10.5 + (midi % 3) * 0.4;
      const depth = context.createGain();
      depth.gain.value = options.tremolo * 0.5;
      lfo.connect(depth).connect(tremolo.gain);
      lfo.start(time);
      lfo.stop(stop);
      envelope.connect(tremolo).connect(destination);
    } else {
      envelope.connect(destination);
    }
  }

  function pluckAt(
    context: AudioContext,
    time: number,
    midi: number,
    vel: number,
    timbre: PluckTimbre,
    destination: AudioNode,
    options: { damp?: number; glideTo?: number; glideSeconds?: number } = {},
  ) {
    if (!buses) return;
    const buffer = buses.bank.buffer(midi, timbre);
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (options.glideTo !== undefined) {
      source.playbackRate.setValueAtTime(1, time);
      source.playbackRate.exponentialRampToValueAtTime(options.glideTo, time + (options.glideSeconds ?? 0.4));
    }
    const gain = context.createGain();
    gain.gain.setValueAtTime(vel, time);
    if (options.damp !== undefined) gain.gain.setTargetAtTime(0, time + options.damp, 0.025);
    source.connect(gain).connect(destination);
    source.start(time);
    source.stop(time + buffer.duration + 0.05);
  }

  // ---- drums ---------------------------------------------------------------

  function djembeBassAt(context: AudioContext, time: number, vel: number, destination: AudioNode) {
    // The low bass tone: a palm in the middle of the head. Short pitch fall,
    // no click; the hand's thump is lowpassed noise.
    membrane(context, time, destination, { from: 118, to: 66, sweep: 0.05, decay: 0.42, gain: 0.55 * vel });
    membrane(context, time, destination, { from: 190, to: 108, sweep: 0.03, decay: 0.14, gain: 0.16 * vel });
    noise(context, time, destination, { gain: 0.22 * vel, decay: 0.045, type: 'lowpass', frequency: 420, Q: 0.7 });
    noise(context, time, destination, { gain: 0.05 * vel, decay: 0.012, type: 'bandpass', frequency: 1800 });
  }

  function djembeToneAt(context: AudioContext, time: number, vel: number, pitch: number, destination: AudioNode) {
    // Open tone: fingers at the rim. The partials are membrane modes, not harmonics.
    const f = 290 * pitch;
    membrane(context, time, destination, { from: f * 1.08, to: f, sweep: 0.018, decay: 0.17, gain: 0.6 * vel });
    membrane(context, time, destination, { from: f * 1.59, decay: 0.09, gain: 0.3 * vel });
    membrane(context, time, destination, { from: f * 2.14, decay: 0.05, gain: 0.18 * vel });
    noise(context, time, destination, { gain: 0.42 * vel, decay: 0.025, type: 'bandpass', frequency: 1400, Q: 0.9 });
  }

  function djembeSlapAt(context: AudioContext, time: number, vel: number, destination: AudioNode) {
    noise(context, time, destination, { gain: 1.45 * vel, decay: 0.065, type: 'bandpass', frequency: 3000, Q: 0.7 });
    noise(context, time, destination, { gain: 0.5 * vel, decay: 0.018, type: 'highpass', frequency: 6500 });
    membrane(context, time, destination, { from: 720, decay: 0.035, gain: 0.3 * vel });
    membrane(context, time, destination, { from: 1130, decay: 0.025, gain: 0.22 * vel });
  }

  function frameDrumAt(context: AudioContext, time: number, vel: number, pitch: number, destination: AudioNode) {
    // A large frame drum struck with the flat hand: deep, open, slow to die.
    const f = 88 * pitch;
    membrane(context, time, destination, { from: f * 1.25, to: f, sweep: 0.06, decay: 0.6, gain: 0.5 * vel });
    membrane(context, time, destination, { from: f * 1.6, decay: 0.22, gain: 0.14 * vel });
    noise(context, time, destination, { gain: 0.16 * vel, decay: 0.07, type: 'lowpass', frequency: 900 });
    noise(context, time, destination, { gain: 0.05 * vel, decay: 0.015, type: 'bandpass', frequency: 2400, Q: 0.6 });
  }

  function bigDrumAt(context: AudioContext, time: number, vel: number, destination: AudioNode) {
    // A big low drum for the set pieces: long, and sent hard into the hall.
    const hall = buses?.reverb;
    const target = hall ? [destination, hall] : [destination];
    for (const [index, node] of target.entries()) {
      const scale = index === 0 ? 1 : 0.4;
      membrane(context, time, node, { from: 96, to: 52, sweep: 0.09, decay: 1.3, gain: 0.75 * vel * scale });
      membrane(context, time, node, { from: 150, to: 88, sweep: 0.05, decay: 0.4, gain: 0.22 * vel * scale });
      noise(context, time, node, { gain: 0.35 * vel * scale, decay: 0.4, type: 'lowpass', frequency: 260 });
    }
    noise(context, time, destination, { gain: 0.12 * vel, decay: 0.04, type: 'bandpass', frequency: 900, Q: 0.8 });
  }

  function shakerAt(context: AudioContext, time: number, vel: number, swish: number, destination: AudioNode) {
    if (swish > 0) {
      // A long shake: the seeds move as one mass.
      noise(context, time, destination, { gain: 4 * vel, attack: 0.05 * swish, decay: 0.12 * swish, type: 'bandpass', frequency: 6500, Q: 0.9 });
      return;
    }
    // A short shake is a few seed grains, not one noise click.
    const grains: Array<[number, number]> = [[0, 1], [0.007, 0.6], [0.015, 0.35]];
    for (const [offset, level] of grains) {
      noise(context, time + offset, destination, { gain: 7 * vel * level, decay: 0.018, type: 'bandpass', frequency: 7200, Q: 1.1 });
    }
  }

  // ---- strings -------------------------------------------------------------

  function padAt(context: AudioContext, time: number, midis: readonly number[], duration: number, vel: number, brightness: number, tremolo: number, destination: AudioNode) {
    const level = (0.028 * vel) / Math.sqrt(Math.max(1, midis.length) / 4);
    const attack = Math.min(0.9, Math.max(0.25, duration * 0.3));
    for (const midi of midis) {
      // Low notes need more level: a lowpassed saw at 70 Hz carries little the ear hears.
      const registerLift = midi < 48 ? 1.5 : 1;
      bowedNote(context, time, midi, duration, {
        level: level * registerLift,
        attack,
        release: Math.min(1.2, duration * 0.35),
        cutoff: 450 + brightness * 1900 + Math.max(0, midi - 48) * 12,
        detunes: ENSEMBLE_DETUNES,
        vibratoDepth: 7,
        vibratoDelay: 0.5,
        tremolo,
        rosin: 0.05 * brightness,
      }, destination);
    }
  }

  function lineAt(context: AudioContext, time: number, midi: number, duration: number, vel: number, brightness: number, destination: AudioNode) {
    bowedNote(context, time, midi, duration, {
      level: 0.042 * vel,
      attack: Math.min(0.14, duration * 0.3),
      release: 0.22,
      cutoff: 1300 + brightness * 2000,
      detunes: SECTION_DETUNES,
      vibratoDepth: 11,
      vibratoDelay: Math.min(0.35, duration * 0.5),
      rosin: 0.08,
    }, destination);
  }

  function spiccatoAt(context: AudioContext, time: number, midi: number, vel: number, brightness: number, destination: AudioNode) {
    // Bounced bow: a short, bright scrape that darkens in a tenth of a second.
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(900 + brightness * 2400, time);
    filter.frequency.exponentialRampToValueAtTime(420, time + 0.1);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.12 * vel, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.17);
    for (const detune of [-7, 7]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = midiToFreq(midi);
      oscillator.detune.value = detune;
      oscillator.connect(filter);
      oscillator.start(time);
      oscillator.stop(time + 0.2);
    }
    filter.connect(gain).connect(destination);
    noise(context, time, destination, { gain: 0.025 * vel, decay: 0.02, type: 'bandpass', frequency: 3200, Q: 1 });
  }

  function stabAt(context: AudioContext, time: number, midis: readonly number[], vel: number, brightness: number, destination: AudioNode) {
    // Tutti sforzando: a hard bow attack that drops to a held tone and releases.
    const level = (0.08 * vel) / Math.sqrt(Math.max(1, midis.length) / 3);
    for (const midi of midis) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.7;
      filter.frequency.setValueAtTime(1200 + brightness * 3800, time);
      filter.frequency.exponentialRampToValueAtTime(600, time + 0.4);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(level * (midi < 48 ? 1.5 : 1), time + 0.006);
      gain.gain.exponentialRampToValueAtTime(level * 0.35, time + 0.12);
      gain.gain.linearRampToValueAtTime(0, time + 0.6);
      for (const detune of [-10, 10]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = midiToFreq(midi);
        oscillator.detune.value = detune;
        oscillator.connect(filter);
        oscillator.start(time);
        oscillator.stop(time + 0.65);
      }
      filter.connect(gain).connect(destination);
    }
    noise(context, time, destination, { gain: 0.06 * vel, decay: 0.035, type: 'bandpass', frequency: 2600, Q: 0.8 });
  }

  function ripAt(context: AudioContext, time: number, fromMidi: number, toMidi: number, duration: number, vel: number, destination: AudioNode) {
    // A glissando swell up (or down) into a downbeat, played in octaves.
    const end = time + duration;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(350, time);
    filter.frequency.exponentialRampToValueAtTime(toMidi > fromMidi ? 2800 : 500, end);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.05 * vel, end);
    gain.gain.linearRampToValueAtTime(0, end + 0.08);
    for (const octave of [0, 12]) {
      for (const detune of [-8, 8]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(midiToFreq(fromMidi + octave), time);
        oscillator.frequency.exponentialRampToValueAtTime(midiToFreq(toMidi + octave), end);
        oscillator.detune.value = detune;
        oscillator.connect(filter);
        oscillator.start(time);
        oscillator.stop(end + 0.1);
      }
    }
    filter.connect(gain).connect(destination);
  }

  // ---- instruments ---------------------------------------------------------

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    djembeBass(context, time: number, vel: number) {
      if (buses) djembeBassAt(context, time, vel, buses.drums.music);
    },
    djembeTone(context, time: number, vel: number, pitch: number) {
      if (buses) djembeToneAt(context, time, vel, pitch, buses.drums.music);
    },
    djembeSlap(context, time: number, vel: number) {
      if (buses) djembeSlapAt(context, time, vel, buses.drums.music);
    },
    frameDrum(context, time: number, vel: number, pitch: number, route: Route) {
      if (buses) frameDrumAt(context, time, vel, pitch, buses.drums[route]);
    },
    shaker(context, time: number, vel: number, swish: number) {
      if (buses) shakerAt(context, time, vel, swish, buses.drums.music);
    },
    bigDrum(context, time: number, vel: number, route: Route) {
      if (buses) bigDrumAt(context, time, vel, buses.drums[route]);
    },
    pad(context, time: number, midis: number[], duration: number, vel: number, brightness: number, tremolo: number) {
      if (buses) padAt(context, time, midis, duration, vel, brightness, tremolo, buses.strings.music);
    },
    line(context, time: number, midi: number, duration: number, vel: number, brightness: number) {
      if (buses) lineAt(context, time, midi, duration, vel, brightness, buses.strings.music);
    },
    spiccato(context, time: number, midi: number, vel: number, brightness: number, route: Route) {
      if (buses) spiccatoAt(context, time, midi, vel, brightness, buses.strings[route]);
    },
    stab(context, time: number, midis: number[], vel: number, brightness: number, route: Route) {
      if (buses) stabAt(context, time, midis, vel, brightness, buses.strings[route]);
    },
    rip(context, time: number, fromMidi: number, toMidi: number, duration: number, vel: number) {
      if (buses) ripAt(context, time, fromMidi, toMidi, duration, vel, buses.strings.music);
    },
    pluck(context, time: number, midi: number, vel: number, timbre: PluckTimbre, route: Route) {
      if (buses) pluckAt(context, time, midi, vel, timbre, buses.plucks[route]);
    },
    strum(context, time: number, midis: number[], vel: number, spread: number, timbre: PluckTimbre, route: Route) {
      if (!buses) return;
      for (const [index, midi] of midis.entries()) pluckAt(context, time + index * spread, midi, vel * (1 - index * 0.05), timbre, buses.plucks[route]);
    },
    river(context, time: number, body: number, color: number, roar: number, spray: number, surge: number) {
      void context;
      buses?.river.set(time, { body, color, roar, spray, surge }, 0.18);
    },
    gateBurst(context, time: number, vel: number) {
      // Concrete giving way: a boom, a long low rumble, and the crack itself.
      if (!buses) return;
      const output = buses.drums.music;
      bigDrumAt(context, time, vel, output);
      noise(context, time, output, { gain: 0.5 * vel, attack: 0.02, decay: 2.4, type: 'lowpass', frequency: 180, Q: 0.8 });
      noise(context, time, output, { gain: 0.3 * vel, decay: 0.6, type: 'bandpass', frequency: 1200, Q: 0.6, sweepTo: 300 });
      noise(context, time, output, { gain: 0.25 * vel, decay: 0.08, type: 'highpass', frequency: 4000 });
      if (buses.reverb) noise(context, time, buses.reverb, { gain: 0.3 * vel, decay: 1.2, type: 'bandpass', frequency: 700, Q: 0.5 });
    },

    // ---- player instruments -------------------------------------------------

    playerFire(context, time: number, midi: number, vel: number) {
      // A pizzicato note and the hiss of a flare leaving the launcher.
      if (!buses) return;
      pluckAt(context, time, midi, 0.42 * vel, 'pizz', buses.plucks.player);
      noise(context, time, buses.plucks.player, { gain: 0.05 * vel, decay: 0.08, type: 'bandpass', frequency: 2400, Q: 1.2, sweepTo: 600 });
    },
    playerLock(context, time: number, midi: number, vel: number) {
      // A harp harmonic: a soft pluck stopped almost at once.
      if (buses) pluckAt(context, time, midi, 0.2 * vel, 'harp', buses.plucks.player, { damp: 0.16 });
    },
    playerKill(context, time: number, midi: number, vel: number, timbre: PluckTimbre, weight: number) {
      if (!buses) return;
      pluckAt(context, time, midi, 0.9 * vel * weight, timbre, buses.plucks.player);
      // The lower octave on a softer string gives the note a body without a synth sub.
      pluckAt(context, time, midi - 12, 0.3 * vel * weight, 'harp', buses.plucks.player);
    },
    playerHarmonic(context, time: number, midi: number, vel: number) {
      if (buses) pluckAt(context, time, midi, 0.14 * vel, 'harp', buses.plucks.player, { damp: 0.5 });
    },
    deadString(context, time: number, midi: number) {
      // The rejected release: a palm-muted string a semitone off, and fret buzz.
      if (!buses) return;
      const output = buses.plucks.player;
      pluckAt(context, time, midi, 0.5, 'muted', output);
      pluckAt(context, time + 0.012, midi + 1, 0.36, 'muted', output);
      noise(context, time, output, { gain: 0.05, decay: 0.07, type: 'bandpass', frequency: 900, Q: 3 });
      frameDrumAt(context, time, 0.18, 0.8, buses.drums.player);
    },
    cableSnap(context, time: number, midi: number, vel: number) {
      // A steel cable parting: a bright twang that falls away, a crack, and the whip.
      if (!buses) return;
      pluckAt(context, time, midi, 0.34 * vel, 'cable', buses.plucks.player, { glideTo: 0.55, glideSeconds: 0.5 });
      noise(context, time, buses.plucks.player, { gain: 0.14 * vel, decay: 0.03, type: 'highpass', frequency: 3000 });
      noise(context, time + 0.02, buses.plucks.player, { gain: 0.08 * vel, decay: 0.25, type: 'bandpass', frequency: 4000, Q: 1.5, sweepTo: 600 });
    },
    playerChip(context, time: number, midis: number[], bassMidi: number, intensity: number) {
      // A non-lethal hit on armour: a frame-drum knock and a short spiccato chord.
      if (!buses) return;
      frameDrumAt(context, time, 0.35 + intensity * 0.35, 1.3 + intensity * 0.4, buses.drums.player);
      for (const midi of midis) spiccatoAt(context, time, midi, 0.3 + intensity * 0.5, 0.3 + intensity * 0.6, buses.strings.player);
      spiccatoAt(context, time, bassMidi, 0.5, 0.2, buses.strings.player);
    },
    legBreak(context, time: number, midis: number[], bassMidi: number, intensity: number) {
      // A leg gives way: the big drum and a tutti stab, both growing with each leg.
      if (!buses) return;
      bigDrumAt(context, time, 0.6 + intensity * 0.6, buses.drums.player);
      stabAt(context, time, [bassMidi, bassMidi + 12, ...midis], 0.9 + intensity * 0.5, 0.35 + intensity * 0.6, buses.strings.player);
      noise(context, time, buses.drums.player, { gain: 0.18 + intensity * 0.1, decay: 0.9, type: 'lowpass', frequency: 300, Q: 0.6 });
    },
    playerHit(context, time: number, bassMidi: number) {
      // Hull damage: a heavy drum, a string scrape on a minor second, and a splash.
      if (!buses) return;
      bigDrumAt(context, time, 0.7, buses.drums.player);
      stabAt(context, time, [bassMidi + 12, bassMidi + 13, bassMidi + 18], 0.8, 0.8, buses.strings.player);
      noise(context, time, buses.drums.player, { gain: 0.14, attack: 0.01, decay: 0.5, type: 'bandpass', frequency: 1800, Q: 0.5, sweepTo: 700 });
    },
    missThud(context, time: number, midi: number) {
      if (!buses) return;
      frameDrumAt(context, time, 0.22, 0.9, buses.drums.player);
      pluckAt(context, time, midi, 0.16, 'pizz', buses.plucks.player);
    },
    slabGrind(context, time: number, vel: number) {
      // A torn gate slab: concrete grinding, low and short.
      if (!buses) return;
      noise(context, time, buses.drums.player, { gain: 0.16 * vel, attack: 0.04, decay: 0.45, type: 'bandpass', frequency: 320, Q: 1.1, sweepTo: 140 });
      frameDrumAt(context, time, 0.3 * vel, 0.7, buses.drums.player);
    },
  }, {
    djembeBass: ['vel'],
    djembeTone: ['vel', 'pitch'],
    djembeSlap: ['vel'],
    frameDrum: ['vel', 'pitch', 'route'],
    shaker: ['vel', 'swish'],
    bigDrum: ['vel', 'route'],
    pad: ['midis', 'duration', 'vel', 'brightness', 'tremolo'],
    line: ['midi', 'duration', 'vel', 'brightness'],
    spiccato: ['midi', 'vel', 'brightness', 'route'],
    stab: ['midis', 'vel', 'brightness', 'route'],
    rip: ['fromMidi', 'toMidi', 'duration', 'vel'],
    pluck: ['midi', 'vel', 'timbre', 'route'],
    strum: ['midis', 'vel', 'spread', 'timbre', 'route'],
    river: ['body', 'color', 'roar', 'spray', 'surge'],
    gateBurst: ['vel'],
    playerFire: ['midi', 'vel'],
    playerLock: ['midi', 'vel'],
    playerKill: ['midi', 'vel', 'timbre', 'weight'],
    playerHarmonic: ['midi', 'vel'],
    deadString: ['midi'],
    cableSnap: ['midi', 'vel'],
    playerChip: ['midis', 'bassMidi', 'intensity'],
    legBreak: ['midis', 'bassMidi', 'intensity'],
    playerHit: ['bassMidi'],
    missThud: ['midi'],
    slabGrind: ['vel'],
  });

  return { install, release, ...instruments };
}

type BiquadFilterOptionsLite = {
  type: BiquadFilterType;
  frequency: number;
  Q?: number;
  gain?: number;
};
