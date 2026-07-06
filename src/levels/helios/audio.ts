import type { EventBus } from '../../events';
import {
  createAudioGraphBuilder,
  createLevelAudioKit,
  createStepTransport,
  playBufferSourceVoice,
  playNoiseHit,
  playOscillatorVoice,
} from '../../engine/audio-kit';
import { createAudioTraceSink, createNoopTraceBus, type AudioTraceResult, type AudioTraceSink } from '../../engine/audio-trace';
import { getActionSfxQuantization } from '../../engine/action-sfx-quantization';
import { emitBeatAt, midiToFreq } from '../../engine/music';
import { HELIOS_BPM, HELIOS_DURATION } from './gameplay';

// The Helios score: 172 BPM drum & bass in E minor, 86 bars = exactly the
// 120-second run. Sections land on the run's set pieces — drop 1 at the gate
// (bar 16), drop 2 at the corona plunge (bar 40), a breakdown while the
// serpent breaches (56–63), and the boss theme (64–79) with a phrygian F
// leaning on the tonic. The player's guns are not an effects layer: locks,
// shots, armor chips, kills, and boss damage all snap to the transport and
// read the current harmony, while kills unmute a hidden sequencer lane so
// clean volleys play melodic runs through the arrangement.

const SIXTEENTH = 60 / HELIOS_BPM / 4;
const THIRTYSECOND = SIXTEENTH / 2;
const SCHEDULE_AHEAD = 0.18;
const SCHEDULER_MS = 25;
const STEPS_PER_BAR = 16;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Em — C — Am — B, two bars each.
const CHORDS: Chord[] = [
  { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] }, // Em
  { bass: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72], stab: [64, 67, 72] }, // C
  { bass: 33, pad: [45, 52, 57, 60], arp: [57, 60, 64, 69], stab: [60, 64, 69] }, // Am
  { bass: 35, pad: [47, 51, 54, 59], arp: [59, 63, 66, 71], stab: [63, 66, 71] }, // B
];
// Boss section: Em — F — Em — B. The F natural is the serpent.
const BOSS_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], stab: [65, 69, 72] }, // F
  CHORDS[0],
  CHORDS[3],
];

// Lock count is a degree into the current chord's live lead set; the sixth
// lock is ignition. Kills read a hidden two-bar lane in the same degree space.
type SectionIndex = 0 | 1 | 2 | 3;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Approach: slow glassy arches while the wreck field opens up.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Furnace road: jump-cut broken chords for dense DnB volleys.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Corona / burning sea: high, urgent fragments that leave room for the bass.
  2: [
    4, 5, 7, 6, 4, 2, 5, 3,
    6, 7, 5, 4, 6, 3, 5, 2,
    7, 6, 5, 4, 7, 5, 3, 1,
    4, 5, 6, 7, 6, 5, 4, 0,
  ],
  // Suneater: tolling descents answered by climbs into the phrygian boss harmony.
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    3, 2, 1, 0, 4, 3, 2, 1,
    4, 5, 6, 7, 5, 6, 7, 4,
  ],
};

type TonalVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; sparkle: number; reverb: number };
type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: TonalVoice; kill: TonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'sine', decay: 0.11, cutoff: 3600, gain: 0.12, sparkle: 0.5, reverb: 0.18 },
    kill: { oscillator: 'triangle', decay: 0.28, cutoff: 3200, gain: 0.15, sparkle: 0.7, reverb: 0.28 },
    fire: { oscillator: 'triangle', cutoff: 3300, gain: 0.07, fallSemitones: 12, noise: 0.035 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.085, cutoff: 2600, gain: 0.055, sparkle: 0.35, reverb: 0.12 },
    kill: { oscillator: 'square', decay: 0.18, cutoff: 3000, gain: 0.11, sparkle: 0.55, reverb: 0.2 },
    fire: { oscillator: 'sawtooth', cutoff: 3800, gain: 0.065, fallSemitones: 7, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.075, cutoff: 3900, gain: 0.052, sparkle: 0.45, reverb: 0.18 },
    kill: { oscillator: 'sawtooth', decay: 0.22, cutoff: 4200, gain: 0.12, sparkle: 0.8, reverb: 0.26 },
    fire: { oscillator: 'sawtooth', cutoff: 5200, gain: 0.07, fallSemitones: 12, noise: 0.06 },
  },
  3: {
    lock: { oscillator: 'sawtooth', decay: 0.13, cutoff: 2200, gain: 0.06, sparkle: 0.25, reverb: 0.34 },
    kill: { oscillator: 'sawtooth', decay: 0.38, cutoff: 2800, gain: 0.14, sparkle: 0.65, reverb: 0.42 },
    fire: { oscillator: 'square', cutoff: 3000, gain: 0.06, fallSemitones: 13, noise: 0.05 },
  },
};

// Boss lead theme, one 8-bar phrase played twice. [bar, step(8ths), midi, beats]
const LEAD_THEME: Array<[number, number, number, number]> = [
  [0, 0, 76, 1.5], [0, 3, 74, 0.5], [0, 4, 76, 2],
  [1, 0, 79, 1], [1, 2, 77, 1], [1, 4, 76, 1], [1, 6, 74, 1],
  [2, 0, 76, 3],
  [3, 0, 71, 1], [3, 2, 74, 1], [3, 4, 76, 0.5], [3, 5, 74, 0.5], [3, 6, 71, 1],
  [4, 0, 77, 2], [4, 4, 76, 1], [4, 6, 74, 1],
  [5, 0, 76, 1], [5, 2, 74, 1], [5, 4, 71, 1], [5, 6, 69, 1],
  [6, 0, 71, 3.5],
];

export function createAudio(bus: EventBus) {
  return createHeliosAudio(bus).audio;
}

export function traceHeliosAudio(options: { seconds?: number } = {}): AudioTraceResult {
  const seconds = options.seconds ?? HELIOS_DURATION;
  const events: AudioTraceResult['events'] = [];
  const trace = createAudioTraceSink(events);
  const tracedAudio = createHeliosAudio(createNoopTraceBus(), trace);
  tracedAudio.traceRun(seconds);
  return {
    metadata: {
      level: 'helios',
      bpm: HELIOS_BPM,
      seconds,
      stepSeconds: SIXTEENTH,
      mode: 'run',
    },
    events,
  };
}

function createHeliosAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let arrangementStart = 0;
  let mode: 'run' | 'ambient' = 'ambient';
  let transportEpoch = 0;
  let heartId = -1;
  let heartMaxHp = 0;

  let master: GainNode | null = null;
  let musicGain: GainNode | null = null;
  let sfxGain: GainNode | null = null;
  let duck: GainNode | null = null;
  let delaySend: GainNode | null = null;
  let reverbSend: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  const transport = createStepTransport({
    stepSeconds: SIXTEENTH,
    scheduleAhead: SCHEDULE_AHEAD,
    startDelay: 0.06,
    onStep({ index, time }) {
      scheduleStep(index, time);
    },
  });

  const audio = createLevelAudioKit({
    volumeScale: 0.8,
    schedulerMs: SCHEDULER_MS,
    onCreateContext(context, musicVolume, sfxVolume) {
      ctx = context;
      buildGraph(context, musicVolume, sfxVolume);
      transport.start(context);
      transportEpoch = transport.nextStepTime;
    },
    onSchedule(context) {
      transport.schedule(context);
    },
    onMusicVolumeChange(context, musicVolume) {
      if (musicGain) musicGain.gain.setTargetAtTime(musicVolume, context.currentTime, 0.05);
    },
    onSfxVolumeChange(context, sfxVolume) {
      if (sfxGain) sfxGain.gain.setTargetAtTime(sfxVolume, context.currentTime, 0.02);
    },
    onDispose() {
      ctx = null;
      master = null;
      musicGain = null;
      sfxGain = null;
      duck = null;
      delaySend = null;
      reverbSend = null;
      noiseBuffer = null;
    },
  });

  function buildGraph(context: AudioContext, musicVolume: number, sfxVolume: number) {
    const graph = createAudioGraphBuilder(context);

    master = graph.gain();
    musicGain = graph.gain(musicVolume);
    sfxGain = graph.gain(sfxVolume);
    const compressor = graph.compressor({ threshold: -16, ratio: 5, attack: 0.004, release: 0.2 });
    graph.connect(musicGain, master);
    graph.connect(sfxGain, master);
    graph.connect(master, compressor);
    graph.connect(compressor, context.destination);

    duck = graph.gain();
    graph.connect(duck, musicGain);

    // Dotted-eighth feedback delay: where the arp and lead live.
    delaySend = graph.gain();
    const delay = graph.delay(1, SIXTEENTH * 3);
    const feedback = graph.gain(0.32);
    const damp = graph.biquadFilter({ type: 'lowpass', frequency: 2400 });
    graph.connect(delaySend, delay);
    graph.connect(delay, damp);
    graph.connect(damp, feedback);
    graph.connect(feedback, delay);
    graph.connect(damp, duck);

    // Generated-impulse hall: the "cathedral of fire" space for choir and hits.
    reverbSend = graph.gain();
    const convolver = context.createConvolver();
    convolver.buffer = makeImpulse(context, 2.4, 2.6);
    const reverbLevel = graph.gain(0.5);
    graph.connect(reverbSend, convolver);
    graph.connect(convolver, reverbLevel);
    graph.connect(reverbLevel, duck);

    noiseBuffer = graph.noiseBuffer(2);

    // The star itself: an endless low rumble under everything.
    const rumbleSource = context.createBufferSource();
    rumbleSource.buffer = noiseBuffer;
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
    rumbleSource.connect(rumbleFilter).connect(rumbleGain).connect(musicGain);
    rumbleSource.start();
    rumbleLfo.start();
  }

  const musicDestination = () => musicGain ?? master;
  const sfxDestination = () => sfxGain ?? master;

  function makeImpulse(context: AudioContext, seconds: number, decay: number) {
    const length = Math.floor(context.sampleRate * seconds);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
      }
    }
    return impulse;
  }

  function traceRun(seconds: number) {
    mode = 'run';
    heartId = -1;
    heartMaxHp = 0;
    arrangementStart = 0;
    transport.reset(0.06, 0);
    transportEpoch = 0.06;
    ctx = { currentTime: 0 } as AudioContext;
    transport.runUntil(seconds);
    ctx = null;
  }

  // ---- scheduler ------------------------------------------------------------

  function scheduleStep(index: number, time: number) {
    const position = Math.max(0, index - arrangementStart);
    const step = position % 16;
    const barIndex = Math.floor(position / 16);

    if (trace && step === 0) recordSection(time, barIndex);

    if (position % 4 === 0) {
      scheduleBeat(time, Math.floor(position / 4), step === 0);
    }

    if (mode === 'ambient') {
      const chord = CHORDS[Math.floor(barIndex / 2) % CHORDS.length];
      if (step === 0 && barIndex % 2 === 0) choir(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.7);
      if (step % 4 === 0) arp(time, chord.arp[(step / 4) % chord.arp.length], 0.4);
      return;
    }

    const inBoss = barIndex >= 64 && barIndex < 80;
    const chordSet = inBoss ? BOSS_CHORDS : CHORDS;
    const chord = chordSet[Math.floor(barIndex / 2) % chordSet.length];

    // ---- section router: 0 intro · 8 build · 16 drop1 · 32 shift · 40 drop2
    //      · 56 breakdown · 64 boss · 80 outro
    if (barIndex < 8) {
      if (step === 0 && barIndex % 4 === 0) choir(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.8);
      if (step % 2 === 0) arp(time, chord.arp[(step / 2) % chord.arp.length], 0.28 + barIndex * 0.04);
      if (step === 0 && barIndex >= 4) kick(time, 0.7);
      if (step === 8 && barIndex >= 6) kick(time, 0.5);
      if (barIndex >= 4 && step % 4 === 2) hat(time, 0.035, 0.025);
      return;
    }

    if (barIndex < 16) {
      if (step === 0 || step === 10) kick(time, step === 0 ? 0.95 : 0.85);
      if (step === 12) snare(time, 0.8);
      if (step % 2 === 0) hat(time, step % 4 === 2 ? 0.07 : 0.04, 0.03);
      if (step === 0 || step === 6 || step === 11) bass(time, chord.bass, 0.72, 0.5);
      if (step % 2 === 0) arp(time, chord.arp[(step / 2) % chord.arp.length], 0.55);
      if (step === 0 && barIndex % 4 === 0) choir(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.7);
      if (barIndex === 14 && step === 0) riser(time, 32 * SIXTEENTH, 0.2);
      if (barIndex === 15 && step >= 8) snare(time, 0.25 + (step - 8) * 0.07); // roll into the gate
      return;
    }

    if (barIndex < 56) {
      const drop2 = barIndex >= 40;
      const shift = barIndex >= 32 && barIndex < 40;
      if (step === 0 && (barIndex === 16 || barIndex === 40)) impact(time, drop2 ? 1.1 : 1);

      // Two-step core; drop 2 adds the third kick and a ride.
      if (step === 0 || step === 10 || (drop2 && step === 6)) kick(time, step === 0 ? 1 : 0.88);
      if (step === 4 || step === 12) snare(time, 0.9);
      const ghostStep = barIndex % 2 === 0 ? 7 : 15;
      if (step === ghostStep) snare(time, 0.3);
      if (shift && barIndex % 2 === 1 && step === 14) snare(time, 0.42);
      if (step % 2 === 0) hat(time, step % 4 === 2 ? 0.085 : 0.045, 0.028);
      else if (drop2 || shift) hat(time, 0.028, 0.02);
      if (drop2 && step % 4 === 0) ride(time, 0.05);
      if ((barIndex >= 20 && barIndex % 8 === 4 || drop2 && barIndex % 4 === 2) && step === 2) openHat(time, 0.1);

      const bassSteps: Record<number, [number, number]> = drop2
        ? { 0: [0, 1], 3: [0, 0.75], 5: [12, 0.6], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.7], 13: [3, 0.6], 14: [7, 0.8] }
        : { 0: [0, 1], 3: [0, 0.75], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.7], 14: [7, 0.8] };
      if (step in bassSteps) bass(time, chord.bass + bassSteps[step][0], bassSteps[step][1], drop2 ? 0.9 : 0.7);

      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      const octave = drop2 && step >= 8 ? 12 : 0;
      if (step % 2 === 0) arp(time, chord.arp[order[(step / 2) % order.length]] + octave, drop2 ? 0.8 : 0.62);
      if (step === 0 && barIndex % 2 === 0) stab(time, chord.stab, drop2 ? 0.85 : 0.65);
      if (step === 0 && barIndex % 8 === 0) choir(time, chord.pad, 64 * SIXTEENTH, 0.55);
      if (barIndex === 38 && step === 0) riser(time, 32 * SIXTEENTH, 0.22);
      return;
    }

    if (barIndex < 64) {
      // Breakdown: the drums die, the serpent stirs.
      if (step === 0) kick(time, 0.55);
      if (step === 0 && barIndex % 2 === 0) choir(time, chord.pad, 32 * SIXTEENTH * 1.05, 1);
      if (step % 4 === 0) arp(time, chord.arp[(step / 4) % chord.arp.length], 0.3);
      // Alarm: low B against F — the tritone under the reveal.
      if (barIndex >= 58 && step === 0) alarmSwell(time, barIndex % 2 === 0 ? 47 : 53, 16 * SIXTEENTH);
      if (barIndex === 62 && step === 0) riser(time, 32 * SIXTEENTH, 0.26);
      if (barIndex === 63) snare(time, 0.16 + step * 0.05); // full-bar roll into the boss theme
      return;
    }

    if (barIndex < 80) {
      if (step === 0 && barIndex === 64) {
        impact(time, 1.25);
        crash(time, 0.3);
      }
      if (step === 0 || step === 10 || (barIndex % 2 === 1 && step === 6)) kick(time, step === 0 ? 1 : 0.9);
      if (step === 4 || step === 12) snare(time, 0.95);
      if (step === (barIndex % 2 === 0 ? 7 : 11)) snare(time, 0.32);
      if (barIndex % 4 === 3 && step === 14) snare(time, 0.5);
      if (step % 2 === 0) hat(time, step % 4 === 2 ? 0.09 : 0.05, 0.028);
      else hat(time, 0.03, 0.02);
      if (step % 4 === 2) ride(time, 0.05);

      const bossBass: Record<number, [number, number]> = {
        0: [0, 1], 2: [0, 0.6], 3: [0, 0.8], 6: [7, 0.85], 8: [0, 0.95], 10: [12, 0.6], 11: [0, 0.75], 14: [1, 0.7],
      };
      if (step in bossBass) bass(time, chord.bass + bossBass[step][0], bossBass[step][1], 1);
      if (step === 0 && barIndex % 2 === 0) stab(time, chord.stab, 0.9);
      if (step === 0 && barIndex % 8 === 0) choir(time, chord.pad, 128 * SIXTEENTH, 0.5);

      const themeBar = (barIndex - 64) % 8;
      if (step % 2 === 0) {
        for (const [noteBar, noteStep, midi, beats] of LEAD_THEME) {
          if (noteBar === themeBar && noteStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.85);
        }
      }
      return;
    }

    // Outro: ride the wave out.
    if (barIndex < 86) {
      const fade = 1 - (barIndex - 80) / 7;
      if (step === 0 || step === 10) kick(time, 0.85 * fade);
      if (step === 12) snare(time, 0.7 * fade);
      if (step % 2 === 0) hat(time, 0.05 * fade, 0.03);
      if ((step === 0 || step === 8) && barIndex < 84) bass(time, chord.bass, 0.7 * fade, 0.5);
      if (step % 2 === 0) arp(time, chord.arp[(step / 2) % chord.arp.length], 0.5 * fade);
      if (step === 0 && barIndex === 80) choir(time, [52, 55, 59, 64, 66], 96 * SIXTEENTH, 0.9); // Em(add9)
      if (step === 0 && barIndex === 85) {
        kick(time, 1);
        crash(time, 0.25);
      }
    }
  }

  function nextGridTime(time: number, gridSixteenths = 0.5) {
    const grid = SIXTEENTH * gridSixteenths;
    const stepsFromEpoch = Math.max(0, Math.ceil((time - transportEpoch) / grid - 1e-4));
    return transportEpoch + stepsFromEpoch * grid;
  }

  const quantize = (time: number) => nextGridTime(time, 0.5);

  function quantizeActionSfx(time: number) {
    const { enabled, gridThirtyseconds } = getActionSfxQuantization();
    if (!enabled) return time;
    return nextGridTime(time, gridThirtyseconds / 2);
  }

  function arrangementPositionAt(time: number) {
    const step = Math.round((time - transportEpoch) / SIXTEENTH);
    return Math.max(0, step - arrangementStart);
  }

  function chordAt(position: number) {
    const barIndex = Math.floor(position / STEPS_PER_BAR);
    const chordSet = barIndex >= 64 && barIndex < 80 ? BOSS_CHORDS : CHORDS;
    return chordSet[Math.floor(barIndex / 2) % chordSet.length];
  }

  function leadSetAt(position: number) {
    const chord = chordAt(position);
    return [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
  }

  function sectionAt(bar: number): SectionIndex {
    if (bar >= 64) return 3;
    if (bar >= 40) return 2;
    if (bar >= 16) return 1;
    return 0;
  }

  type SectionMix = { from: SectionIndex; to: SectionIndex; t: number };

  function sectionMixAt(position: number): SectionMix {
    const bar = position / STEPS_PER_BAR;
    if (bar >= 62 && bar < 64) return { from: 2, to: 3, t: (bar - 62) / 2 };
    if (bar >= 38 && bar < 40) return { from: 1, to: 2, t: (bar - 38) / 2 };
    if (bar >= 14 && bar < 16) return { from: 0, to: 1, t: (bar - 14) / 2 };
    const section = sectionAt(bar);
    return { from: section, to: section, t: 1 };
  }

  function sectionLayers(mix: SectionMix): Array<[SectionIndex, number]> {
    return mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
  }

  function scheduleBeat(time: number, beatNumber: number, isDownbeat: boolean) {
    if (trace) {
      trace.record(time, 'beat', { beatNumber, isDownbeat });
      return;
    }
    if (ctx) emitBeatAt(bus, ctx, time, beatNumber, isDownbeat);
  }

  function recordSection(time: number, barIndex: number) {
    const section = sectionForBar(barIndex);
    if (section) trace?.record(time, 'section', { section, bar: barIndex });
  }

  function sectionForBar(barIndex: number) {
    if (barIndex === 0) return 'intro';
    if (barIndex === 8) return 'build';
    if (barIndex === 16) return 'drop-1';
    if (barIndex === 32) return 'shift';
    if (barIndex === 40) return 'drop-2';
    if (barIndex === 56) return 'breakdown';
    if (barIndex === 64) return 'boss';
    if (barIndex === 80) return 'outro';
    return null;
  }

  // ---- instruments ------------------------------------------------------------

  function kick(time: number, vel: number) {
    if (trace) {
      trace.record(time, 'kick', { vel });
      return;
    }
    const output = musicDestination();
    if (!ctx || !output || !duck) return;
    playOscillatorVoice({
      context: ctx,
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
    duck.gain.cancelScheduledValues(time);
    duck.gain.setValueAtTime(0.4, time);
    duck.gain.linearRampToValueAtTime(1, time + 0.16);
  }

  function snare(time: number, vel: number) {
    if (trace) {
      trace.record(time, 'snare', { vel });
      return;
    }
    const output = musicDestination();
    if (!ctx || !output) return;
    noiseHit(time, 0.2 * vel, 0.075, 'bandpass', 1750, output);
    noiseHit(time, 0.1 * vel, 0.03, 'highpass', 5200, output);
    playOscillatorVoice({
      context: ctx,
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
  }

  function hat(time: number, vel: number, decay: number) {
    if (trace) {
      trace.record(time, 'hat', { vel, decay });
      return;
    }
    if (!duck) return;
    noiseHit(time, vel, decay, 'highpass', 8200, duck);
  }

  function openHat(time: number, vel: number) {
    if (trace) {
      trace.record(time, 'openHat', { vel });
      return;
    }
    if (!duck) return;
    noiseHit(time, vel, 0.18, 'highpass', 7400, duck);
  }

  function ride(time: number, vel: number) {
    if (trace) {
      trace.record(time, 'ride', { vel });
      return;
    }
    if (!duck) return;
    noiseHit(time, vel, 0.14, 'bandpass', 9800, duck);
  }

  function crash(time: number, vel: number) {
    if (trace) {
      trace.record(time, 'crash', { vel });
      return;
    }
    const output = musicDestination();
    if (!output || !reverbSend) return;
    noiseHit(time, vel, 0.9, 'highpass', 4600, output);
    noiseHit(time, vel * 0.5, 1.4, 'bandpass', 7200, reverbSend);
  }

  // Reese + sub: two saws detuned ±14 cents an octave up, sine at the root.
  function bass(time: number, midi: number, vel: number, growl: number) {
    if (trace) {
      trace.record(time, 'bass', { midi, vel, growl });
      return;
    }
    if (!ctx || !duck) return;
    const dur = 0.21;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = midiToFreq(midi);
    subGain.gain.setValueAtTime(0, time);
    subGain.gain.linearRampToValueAtTime(0.26 * vel, time + 0.008);
    subGain.gain.setValueAtTime(0.26 * vel, time + dur * 0.7);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    sub.connect(subGain).connect(duck);
    sub.start(time);
    sub.stop(time + dur + 0.02);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(300 + growl * 900 * vel, time);
    filter.frequency.exponentialRampToValueAtTime(170, time + dur);
    const reeseGain = ctx.createGain();
    reeseGain.gain.setValueAtTime(0, time);
    reeseGain.gain.linearRampToValueAtTime(0.1 * vel, time + 0.006);
    reeseGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    for (const detune of [-14, 14]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi + 12);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    }
    filter.connect(reeseGain).connect(duck);
  }

  // Choir: detuned saw stack through a vowel-ish bandpass. The epic bed.
  function choir(time: number, midis: number[], duration: number, vel: number) {
    if (trace) {
      trace.record(time, 'choir', { midis, duration, vel });
      return;
    }
    if (!ctx || !duck || !reverbSend) return;
    for (const midi of midis) {
      for (const detune of [-9, 9]) {
        const osc = ctx.createOscillator();
        const vowel = ctx.createBiquadFilter();
        const lowpass = ctx.createBiquadFilter();
        const gain = ctx.createGain();
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
        gain.connect(duck);
        const send = ctx.createGain();
        send.gain.value = 0.6;
        gain.connect(send).connect(reverbSend);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    }
  }

  function arp(time: number, midi: number, vel: number) {
    if (trace) {
      trace.record(time, 'arp', { midi, vel });
      return;
    }
    if (!ctx || !duck || !delaySend) return;
    playOscillatorVoice({
      context: ctx,
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
      destination: duck,
      sends: [{ destination: delaySend, gain: 0.42 }],
    });
  }

  function stab(time: number, midis: number[], vel: number) {
    if (trace) {
      trace.record(time, 'stab', { midis, vel });
      return;
    }
    if (!ctx || !duck || !reverbSend) return;
    for (const midi of midis) {
      for (const detune of [-11, 11]) {
        playOscillatorVoice({
          context: ctx,
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
          destination: duck,
          sends: [{ destination: reverbSend, gain: 0.35 }],
        });
      }
    }
  }

  function lead(time: number, midi: number, duration: number, vel: number) {
    if (trace) {
      trace.record(time, 'lead', { midi, duration, vel });
      return;
    }
    if (!ctx || !duck || !delaySend || !reverbSend) return;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, time);
    filter.frequency.linearRampToValueAtTime(1700, time + duration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.085 * vel, time + 0.02);
    gain.gain.setValueAtTime(0.085 * vel, time + Math.max(0.02, duration - 0.08));
    gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.value = 5.4;
    vibratoGain.gain.setValueAtTime(0, time);
    vibratoGain.gain.linearRampToValueAtTime(6, time + Math.min(0.4, duration * 0.6));
    for (const [type, detune] of [['sawtooth', -7], ['square', 7]] as const) {
      const osc = ctx.createOscillator();
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
    gain.connect(duck);
    const echo = ctx.createGain();
    echo.gain.value = 0.5;
    gain.connect(echo).connect(delaySend);
    const hall = ctx.createGain();
    hall.gain.value = 0.3;
    gain.connect(hall).connect(reverbSend);
  }

  function alarmSwell(time: number, midi: number, duration: number) {
    if (trace) {
      trace.record(time, 'alarm', { midi, duration });
      return;
    }
    if (!ctx || !duck || !reverbSend) return;
    playOscillatorVoice({
      context: ctx,
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
      destination: duck,
      sends: [{ destination: reverbSend, gain: 0.5 }],
    });
  }

  function riser(time: number, duration: number, level: number) {
    if (trace) {
      trace.record(time, 'riser', { duration, level });
      return;
    }
    const output = musicDestination();
    if (!ctx || !output || !noiseBuffer) return;
    playBufferSourceVoice({
      context: ctx,
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
  }

  function impact(time: number, vel: number) {
    if (trace) {
      trace.record(time, 'impact', { vel });
      return;
    }
    const output = musicDestination();
    if (!ctx || !output) return;
    playOscillatorVoice({
      context: ctx,
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
    crash(time, 0.16 * vel);
  }

  function noiseHit(
    time: number,
    vel: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    destination: AudioNode,
  ) {
    if (!ctx || !noiseBuffer) return;
    playNoiseHit({
      context: ctx,
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

  // ---- player instruments ---------------------------------------------------
  // Player actions are written into the score: every positive action snaps to
  // the transport, reads the live chord, and sends tails into the same delay /
  // hall as the arrangement. Kills walk a hidden two-bar sequencer lane so a
  // clean volley performs a melody instead of stacking explosion sounds.

  function playerSends(delayGain: number, reverbGain: number) {
    const sends: Array<{ destination: AudioNode; gain: number }> = [];
    if (delaySend && delayGain > 0) sends.push({ destination: delaySend, gain: delayGain });
    if (reverbSend && reverbGain > 0) sends.push({ destination: reverbSend, gain: reverbGain });
    return sends;
  }

  function playerTone(time: number, midi: number, voice: TonalVoice, vel: number, weight = 1) {
    if (trace) {
      trace.record(time, 'playerTone', { midi, vel, oscillator: voice.oscillator });
      return;
    }
    const output = sfxDestination();
    if (!ctx || !output) return;
    playOscillatorVoice({
      context: ctx,
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

  function mixedVoiceValue(mix: SectionMix, slot: 'lock' | 'kill', key: keyof TonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
  }

  function killMelody(time: number, position: number, mix: SectionMix, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = leadSetAt(position);
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = leadSet[degree];
    const vel = Math.min(1.45, 1 + chain * 0.14);
    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + decay + 0.04,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi - 12),
      gainAutomation: [
        { type: 'set', value: gain * 0.52 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
      ],
      destination: output,
    });
    if (chain >= 2) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + decay + 0.04,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi + 12),
        gainAutomation: [
          { type: 'set', value: gain * 0.34, time },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        destination: output,
        sends: playerSends(0.5, 0.18),
      });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.025 + sparkle * 0.05, 0.09, 7200);
  }

  function heartChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = arrangementPositionAt(time);
    const chord = chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.52,
      oscillatorType: 'sine',
      frequency: root * 4,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + intensity * 0.18, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.46 },
      ],
      destination: output,
    });
    for (const midi of chord.stab) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.32,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 1500 + intensity * 3200 },
        gainAutomation: [
          { type: 'set', value: 0.04 + intensity * 0.025, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.27 },
        ],
        destination: output,
        sends: playerSends(0.25, 0.35),
      });
    }
    const beacon = leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES[3].kill, 0.45 + intensity * 0.35, 1);
    playerNoise(time, 0.1 + intensity * 0.08, 0.1, 5200);
  }

  function heartFinale(time: number) {
    const output = sfxDestination();
    if (!ctx || !output || !duck) return;
    const position = arrangementPositionAt(time);
    const chord = chordAt(position);
    duck.gain.cancelScheduledValues(time);
    duck.gain.setValueAtTime(0.14, time);
    duck.gain.linearRampToValueAtTime(1, time + 1.4);
    impact(time, 1.4);
    choir(time + 0.08, [chord.bass, ...chord.pad, ...chord.stab.map((midi) => midi + 12)], 6, 1.15);
    riser(time, 0.8, 0.14);
    leadSetAt(position).slice().reverse().forEach((midi, index) => {
      const at = time + index * THIRTYSECOND;
      playerTone(at, midi + 12, PLAYER_VOICES[3].kill, 0.9 - index * 0.06, 1);
    });
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = quantizeActionSfx(ctx.currentTime);
    const position = arrangementPositionAt(time);
    const midi = leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    const mix = sectionMixAt(position);
    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].lock, 1, weight);
    }
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.015 + sparkle * 0.035, 0.025, 9000);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.22,
        oscillatorType: 'sine',
        frequency: midiToFreq(chordAt(position).bass + 12),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chordAt(position).bass), time: time + 0.14 }],
        gainAutomation: [
          { type: 'set', value: 0.19, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
        ],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = nextGridTime(ctx.currentTime, 0.5);
    playerTone(time, chordAt(arrangementPositionAt(time)).bass + 24, PLAYER_VOICES[sectionMixAt(arrangementPositionAt(time)).to].lock, 0.35, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = quantizeActionSfx(ctx.currentTime);
    const position = arrangementPositionAt(time);
    const chord = chordAt(position);
    const mix = sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const voice = PLAYER_VOICES[section].fire;
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.095,
        oscillatorType: voice.oscillator,
        frequency: midiToFreq(sourceMidi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - voice.fallSemitones), time: time + 0.065 }],
        filter: { type: 'lowpass', frequency: voice.cutoff },
        gainAutomation: [
          { type: 'set', value: voice.gain * weight, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.078 },
        ],
        destination: output,
        sends: playerSends(0.18, 0.08),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.026, 4800);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === heartId) {
      heartMaxHp = Math.max(heartMaxHp, hitPointsRemaining + 1);
      heartChip(time, 1 - hitPointsRemaining / Math.max(1, heartMaxHp));
      return;
    }
    const chord = chordAt(arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      const at = time + index * THIRTYSECOND;
      playOscillatorVoice({
        context,
        time: at,
        stopTime: at + 0.11,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 3600 },
        gainAutomation: [
          { type: 'set', value: 0.055 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.09 },
        ],
        destination: output,
        sends: playerSends(0.22, 0.18),
      });
    }
    playerNoise(time, 0.045, 0.035, 5600);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output || !reverbSend) return;
    const time = nextGridTime(ctx.currentTime, 1);
    const chord = chordAt(arrangementPositionAt(time));
    playerNoise(time, 0.2, 0.13, 2600);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.68,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.14, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.62 },
        ],
        destination: output,
        sends: playerSends(0.26, 0.55),
      });
    }
    if (enemyId === heartId) riser(time, 1.6, 0.18); // it dives — brace
  });

  let lastKillStep = -1;
  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    let step = Math.round((nextGridTime(ctx.currentTime, 1) - transportEpoch) / SIXTEENTH);
    if (step <= lastKillStep) step = lastKillStep + 1;
    lastKillStep = step;
    const time = transportEpoch + step * SIXTEENTH;
    if (enemyId === heartId) {
      heartFinale(time);
      return;
    }
    const position = Math.max(0, step - arrangementStart);
    killMelody(time, position, sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !duck) return;
    const time = nextGridTime(ctx.currentTime, 4);
    const position = arrangementPositionAt(time);
    const chord = chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.95 : 0.72);
    const leadSet = leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[sectionMixAt(position).to].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Rejection: a dead anvil clank with a minor-second snarl — cold iron, no reward.
    for (const [frequency, at, vel] of [[233, time, 0.16], [247, time + 0.02, 0.12]] as const) {
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.24,
        oscillatorType: 'square',
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.4, time: at + 0.16 }],
        filter: { type: 'bandpass', Q: 4, frequency: 900 },
        gainAutomation: [
          { type: 'set', value: vel, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.2 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.14, 0.08, 'bandpass', 620, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = chordAt(arrangementPositionAt(time));
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.55,
      oscillatorType: 'sine',
      frequency: midiToFreq(chord.bass + 12),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.32 }],
      gainAutomation: [
        { type: 'set', value: 0.46, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
      ],
      destination: output,
    });
    // Hull alarm: still alarming, but it borrows the live chord instead of a fixed siren.
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      const at = time + index * 0.13;
      playOscillatorVoice({
        context,
        time: at,
        stopTime: at + 0.15,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.06, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.12 },
        ],
        destination: output,
        sends: playerSends(0.12, 0.08),
      });
    });
    noiseHit(time, 0.2, 0.16, 'bandpass', 800, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = chordAt(arrangementPositionAt(time));
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'sine',
      frequency: midiToFreq(chord.bass + 24),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.11 }],
      gainAutomation: [
        { type: 'set', value: 0.045, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'heart') {
      heartId = enemyId;
      // The Suneater breaches: a war-horn triad and a long riser.
      const time = quantize(ctx.currentTime);
      riser(time, 2.2, 0.2);
      [28, 40, 47].forEach((midi, index) => {
        if (!ctx || !duck || !reverbSend) return;
        const at = time + index * 0.3;
        playOscillatorVoice({
          context: ctx,
          time: at,
          stopTime: at + 1.2,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          filter: {
            type: 'lowpass',
            frequency: 500,
            frequencyAutomation: [{ type: 'linearRamp', value: 1300, time: at + 0.4 }],
          },
          gainAutomation: [
            { type: 'set', value: 0, time: at },
            { type: 'linearRamp', value: 0.2, time: at + 0.05 },
            { type: 'exponentialRamp', value: 0.001, time: at + 1.1 },
          ],
          destination: duck,
          sends: [{ destination: reverbSend, gain: 0.55 }],
        });
      });
    } else if (kind === 'flare') {
      const output = sfxDestination();
      if (!output) return;
      // Prominence warning: a short upward siren voiced from the live arp.
      const time = nextGridTime(ctx.currentTime, 0.5);
      const leadSet = leadSetAt(arrangementPositionAt(time));
      const sourceMidi = leadSet[enemyId % 4];
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.44,
        oscillatorType: 'triangle',
        frequency: midiToFreq(sourceMidi),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi + 12), time: time + 0.34 }],
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'exponentialRamp', value: 0.05, time: time + 0.26 },
          { type: 'linearRamp', value: 0, time: time + 0.4 },
        ],
        destination: output,
        sends: playerSends(0.16, 0.14),
      });
    }
  });

  bus.on('runstart', () => {
    mode = 'run';
    heartId = -1;
    heartMaxHp = 0;
    lastKillStep = -1;
    // Restart the arrangement on the next 16th so the drops track the run
    // set pieces to within ~90 ms.
    arrangementStart = transport.stepIndex;
  });

  bus.on('runend', () => {
    mode = 'ambient';
    if (!ctx) return;
    choir(ctx.currentTime + 0.05, [52, 59, 64, 66, 71], 6, 0.9);
  });

  return { audio, traceRun };
}
