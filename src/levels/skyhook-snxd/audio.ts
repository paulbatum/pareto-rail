import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSkyhookVoices, installSkyhookWind, type SkyTonalVoice, type WindController } from './audio-voices';
import { SKYHOOK_BARS, SKYHOOK_BPM, SKYHOOK_DURATION, SKYHOOK_SCORE_SECTIONS, SKYHOOK_STEPS_PER_BAR, SKYHOOK_TIME } from './timing';

// The Skyhook score: 128 BPM in A minor, 32 bars = exactly the 60-second
// climb, and the arrangement is an altimeter. The storm act is wide and warm
// — wind bed, saw-stack pads, four-on-the-floor; the cloudbreak drop at bar 8
// brightens it; bar 16 strips the kit to a half-time pulse and a single-sine
// pad as the air thins; the Lamprey act is nearly vacuum — sub pulses, hull
// ticks, a low two-saw dread motif; and the dock resolves to A major at a
// whisper. Locks, shots, chips, and kills are all notes in this score: they
// snap to the transport, read the live chord, and kills walk hidden per-act
// melody lanes so a clean volley is a solo.

const SIXTEENTH = SKYHOOK_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SKYHOOK_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Am9 — Fmaj9 — Cadd9 — G, two bars each: the open-sky loop.
const CHORDS: Chord[] = [
  { bass: 33, pad: [57, 60, 64, 71], arp: [69, 72, 76, 79], stab: [69, 72, 76] }, // Am9
  { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 76], stab: [65, 69, 72] }, // Fmaj9
  { bass: 36, pad: [55, 60, 64, 67], arp: [67, 72, 76, 79], stab: [67, 72, 76] }, // Cadd9
  { bass: 31, pad: [55, 59, 62, 67], arp: [67, 71, 74, 79], stab: [67, 71, 74] }, // G
];
// Boss bars 20–29 walk Am — Bb — Am — E — Am; the flat second is the thing
// on the tether. (Array order compensates for absolute-bar chord indexing.)
const BOSS_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 28, pad: [56, 59, 64, 68], arp: [64, 68, 71, 76], stab: [64, 68, 71] }, // E
  CHORDS[0],
  { bass: 34, pad: [58, 62, 65, 69], arp: [70, 74, 77, 81], stab: [70, 74, 77] }, // Bbmaj7
];
// Dock: A major, arrival warmth.
const DOCK_CHORDS: Chord[] = [
  { bass: 33, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81], stab: [69, 73, 76] },
];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

const KILL_LANES: Record<SectionIndex, number[]> = {
  // Storm: slow arches climbing out of the weather.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 4,
  ],
  // Jetstream: jump-cut broken chords for dense sunlit volleys.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 6, 5, 7, 6, 4, 2, 0,
  ],
  // Stratosphere: high glassy fragments in the thinning air.
  2: [
    4, 5, 7, 6, 5, 4, 6, 5,
    7, 6, 5, 7, 6, 5, 4, 6,
    5, 6, 7, 5, 4, 5, 6, 4,
    7, 6, 5, 4, 5, 6, 7, 4,
  ],
  // Vacuum: tolling descents while the Lamprey closes.
  3: [
    7, 6, 5, 4, 5, 4, 3, 2,
    4, 3, 2, 1, 3, 2, 1, 0,
    4, 3, 2, 1, 2, 1, 0, 1,
    3, 2, 1, 0, 2, 3, 4, 5,
  ],
  // Dock: settling home.
  4: [
    4, 3, 2, 1, 2, 1, 0, 1,
    2, 3, 4, 3, 2, 1, 0, 0,
    3, 2, 1, 0, 1, 0, 1, 2,
    3, 2, 1, 0, 0, 1, 2, 3,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

const PLAYER_VOICES: Record<SectionIndex, { lock: SkyTonalVoice; kill: SkyTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 3000, gain: 0.11, sparkle: 0.45, reverb: 0.2 },
    kill: { oscillator: 'triangle', decay: 0.27, cutoff: 2900, gain: 0.14, sparkle: 0.6, reverb: 0.28 },
    fire: { oscillator: 'triangle', cutoff: 2800, gain: 0.07, fallSemitones: 10, noise: 0.045 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 2900, gain: 0.05, sparkle: 0.4, reverb: 0.14 },
    kill: { oscillator: 'square', decay: 0.2, cutoff: 3400, gain: 0.11, sparkle: 0.6, reverb: 0.2 },
    fire: { oscillator: 'sawtooth', cutoff: 3600, gain: 0.06, fallSemitones: 8, noise: 0.05 },
  },
  2: {
    lock: { oscillator: 'sine', decay: 0.1, cutoff: 4200, gain: 0.13, sparkle: 0.7, reverb: 0.3 },
    kill: { oscillator: 'sine', decay: 0.32, cutoff: 4600, gain: 0.15, sparkle: 0.85, reverb: 0.34 },
    fire: { oscillator: 'triangle', cutoff: 3200, gain: 0.06, fallSemitones: 12, noise: 0.035 },
  },
  3: {
    // Vacuum: everything the player does sounds carried through the hull —
    // dull, close, and heavy on the tail.
    lock: { oscillator: 'sine', decay: 0.13, cutoff: 1500, gain: 0.11, sparkle: 0.15, reverb: 0.42 },
    kill: { oscillator: 'sine', decay: 0.4, cutoff: 1700, gain: 0.15, sparkle: 0.3, reverb: 0.5 },
    fire: { oscillator: 'square', cutoff: 1500, gain: 0.045, fallSemitones: 14, noise: 0.02 },
  },
  4: {
    lock: { oscillator: 'sine', decay: 0.16, cutoff: 2600, gain: 0.09, sparkle: 0.5, reverb: 0.5 },
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 3000, gain: 0.12, sparkle: 0.7, reverb: 0.55 },
    fire: { oscillator: 'sine', cutoff: 2200, gain: 0.04, fallSemitones: 8, noise: 0.015 },
  },
};

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-snxd',
  bpm: SKYHOOK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let wind: WindController | null = null;
  let mawId = -1;
  const MAW_TOTAL_HP = 6; // hitStages [3, 3]

  const score = createScore<Chord, SectionIndex>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: SKYHOOK_BARS.lamprey, toBar: SKYHOOK_BARS.dock, chords: BOSS_CHORDS, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.dock, chords: DOCK_CHORDS, barsPerChord: 1 },
    ],
    sections: SKYHOOK_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2600 },
      reverb: { seconds: 2.8, decay: 2.7, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      wind = installSkyhookWind(context, mix);
      wind.setWind(context.currentTime + 0.1, 0.2, 1.5);
    },
    onStep: scheduleStep,
    onRunStart() {
      mawId = -1;
      const context = runtime.context();
      if (context && wind) wind.setWind(context.currentTime + 0.05, 0.45, 1.2);
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) {
        wind?.setWind(context.currentTime + 0.5, 0.2, 4);
        pad(context.currentTime + 0.05, [57, 61, 64, 69, 76], 6, 0.8, 2, 1400);
      }
    },
    onDispose() {
      ctx = null;
      wind = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement -----------------------------------------------------------

  const blankBar = '................';
  const fourFloor = 'K...K...K...K...';
  const softFloor = 'K.......K.......';
  const clapBar = '........C.......';
  const backbeat = '....C.......C...';
  const offbeatOpen = '..o...o...o...o.';
  const evenArp = 'A.A.A.A.A.A.A.A.';
  const tickBar = 't..t..t.t..t..t.'; // 3-3-2: the car's ratchet, heard through the floor

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt(position) {
      const bar = Math.floor(position / STEPS_PER_BAR);
      return CHORDS[Math.floor(bar / 2) % CHORDS.length];
    },
    sections: [
      {
        name: 'ambient',
        fromBar: 0,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.62, 2, 1200)),
          hits(['............A...', '............A...'].join(''), { A: 1 }, ({ time, step, chord }) => bell(time, chord.arp[step % chord.arp.length], 0.3)),
        ],
      },
    ],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'storm',
        fromBar: SKYHOOK_BARS.launch,
        tracks: [
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.9, 3, 1550)),
          hits([blankBar, blankBar, softFloor, softFloor, fourFloor, fourFloor, fourFloor, fourFloor].join(''), { K: 0.8 }, ({ time }, vel) => kick(time, vel)),
          hits([blankBar, blankBar, blankBar, blankBar, clapBar, clapBar, clapBar, clapBar].join(''), { C: 0.6 }, ({ time }, vel) => clap(time, vel)),
          hits([blankBar, blankBar, offbeatOpen, offbeatOpen, offbeatOpen, offbeatOpen, offbeatOpen, offbeatOpen].join(''), { o: 0.05 }, ({ time }, vel) => openHat(time, vel)),
          hits('B.......b.....B.', { B: 0.75, b: 0.5 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.3)),
          hits(evenArp, { A: 1 }, ({ time, step, bar, chord }) => arp(time, chord.arp[(step / 2) % chord.arp.length] - 12, 0.3 + bar * 0.045, 1900)),
          fn(({ time, step, bar, chord }) => { if (bar % 2 === 1 && step === 8) bell(time, chord.arp[3], 0.32); }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.22)),
          fn(({ time, step, bar }) => { if (bar === 7 && step >= 8 && step % 2 === 0) clap(time, 0.2 + (step - 8) * 0.07); }),
        ],
      },
      {
        name: 'jetstream',
        fromBar: SKYHOOK_BARS.cloudbreak,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.05);
            crash(time, 0.3);
            windTo(time, 0.12, 3);
          }),
          oneShot(4, 0, ({ time }) => windTo(time, 0.05, 4)),
          hits(fourFloor, { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits(backbeat, { C: 0.85 }, ({ time }, vel) => clap(time, vel)),
          hits('h.h.H.h.h.h.H.h.', { h: 0.035, H: 0.07 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits(offbeatOpen, { o: 0.06 }, ({ time }, vel) => openHat(time, vel)),
          fn(({ time, step, chord }) => {
            const bassSteps: Record<number, [number, number]> = { 0: [0, 1], 3: [0, 0.7], 6: [12, 0.55], 8: [0, 0.9], 11: [7, 0.6], 14: [12, 0.7] };
            if (step in bassSteps) bass(time, chord.bass + bassSteps[step][0], bassSteps[step][1], 0.7);
          }),
          hits(evenArp, { A: 0.55 }, ({ time, step, chord }, vel) => {
            const order = [0, 2, 1, 3, 2, 0, 3, 1];
            arp(time, chord.arp[order[(step / 2) % order.length]] - 12, vel, 2700);
          }),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.02, 0.8, 3, 1750)),
          fn(({ time, step, bar, chord }) => { if (step === 8) bell(time, chord.arp[bar % chord.arp.length], 0.3); }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
        ],
      },
      {
        name: 'stratosphere',
        fromBar: SKYHOOK_BARS.stratosphere,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            crash(time, 0.16);
            subPulse(time, chord.bass, 0.8);
            windTo(time, 0, 3);
          }),
          hits('K.......k.......', { K: 0.75, k: 0.5 }, ({ time }, vel) => kick(time, vel)),
          hits(tickBar, { t: 0.5 }, ({ time }, vel) => tick(time, vel)),
          hits('B...............', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0)),
          hits('P...............................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad.slice(1), 32 * SIXTEENTH * 1.04, 0.75, 1, 950)),
          hits('A...A...A...A...', { A: 0.42 }, ({ time, step, chord }, vel) => bell(time, chord.arp[(step / 4) % chord.arp.length], vel)),
          fn(({ time, step, bar }) => { if (bar % 2 === 0 && step === 12) chime(time, 88, 1.4, 0.28); }),
          oneShot(3, 0, ({ time }) => riser(time, 16 * SIXTEENTH, 0.16)),
        ],
      },
      {
        name: 'lamprey',
        fromBar: SKYHOOK_BARS.lamprey,
        tracks: [
          oneShot(0, 0, ({ time }) => {
            impact(time, 1.2);
            crash(time, 0.22);
          }),
          hits('S.......S.......', { S: 0.85 }, ({ time, chord }, vel) => subPulse(time, chord.bass, vel)),
          hits(tickBar, { t: 0.45 }, ({ time }, vel) => tick(time, vel)),
          fn(({ time, step, chord }) => { if (step === 0) drone(time, chord.bass + 24, 16 * SIXTEENTH * 1.05, 0.5); }),
          fn(({ time, step, barInSection, chord }) => {
            if (step === 0 && barInSection % 2 === 0) motif(time, chord.bass + 12, 32 * SIXTEENTH * 0.96, 0.85);
          }),
          fn(({ time, step, barInSection, chord }) => {
            // The last two bars before the deadline: the toll accelerates.
            if (barInSection >= 7 && step % 4 === 2) tick(time, 0.6 + barInSection * 0.03);
            if (barInSection === 8 && step === 8) subPulse(time, chord.bass - 12, 1);
          }),
        ],
      },
      {
        name: 'dock',
        fromBar: SKYHOOK_BARS.dock,
        toBar: SKYHOOK_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time, chord }) => {
            pad(time, chord.pad, 44 * SIXTEENTH, 0.85, 2, 1250);
            subPulse(time, chord.bass, 0.5);
          }),
          oneShot(0, 12, ({ time }) => bell(time, 76, 0.34)),
          oneShot(1, 4, ({ time }) => bell(time, 73, 0.3)),
          oneShot(1, 12, ({ time }) => bell(time, 69, 0.26)),
          oneShot(2, 0, ({ time }) => chime(time, 81, 2.6, 0.4)),
          oneShot(2, 4, ({ time }) => dockLatch(time, 1)),
          oneShot(2, 6, ({ time }) => tick(time, 0.5)),
        ],
      },
    ],
  });

  function windTo(time: number, level: number, ramp: number) {
    wind?.setWind(time, level, ramp);
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ------------------------------------------------------------------

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, clap, hat, openHat, tick, subPulse, bass, pad, arp, bell, chime, drone, motif, riser, crash, impact, dockLatch,
    noiseHit, playerSends, playerTone, playerNoise,
  } = voices;

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.3 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.04,
    envelope: { decay: ({ decay }) => decay },
  });

  const lockBassVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.18 }],
    duration: 0.18,
    stopPadding: 0.04,
    envelope: { decay: 0.18 },
  });

  const fireVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const clankVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3400 },
    envelope: { decay: 0.09 },
  });

  const shearVoice = voice<{ gainValue: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: 0.55,
    stopPadding: 0.06,
    envelope: { decay: 0.55 },
  });

  // Rejection: a dead relay buzzer — cold utilitarian "no".
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.18,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 480 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });

  const hullBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.55,
    stopPadding: 0.05,
    envelope: { decay: 0.55 },
  });

  const hazardBeepVoice = voice({
    oscillators: [{ type: 'square', gain: 0.05 }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: 2400 },
    envelope: { decay: 0.1 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  const klaxonVoice = voice({
    oscillators: [{ type: 'triangle', gain: 0.055 }],
    duration: 0.24,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 2100 },
    envelope: { decay: 0.24 },
  });

  const twangVoice = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.09 }],
    duration: 0.9,
    stopPadding: 0.06,
    filter: { type: 'bandpass', Q: 2.4, frequency: 1600 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.09, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
    ],
  });

  // ---- player instruments ---------------------------------------------------

  function mixedVoiceValue(mix: SectionMix<SectionIndex>, slot: 'lock' | 'kill', key: keyof SkyTonalVoice) {
    const from = PLAYER_VOICES[mix.from][slot][key];
    const to = PLAYER_VOICES[mix.to][slot][key];
    return typeof from === 'number' && typeof to === 'number' ? lerp(from, to, mix.t) : to;
  }

  function killMelody(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const leadSet = score.leadSetAt(position);
    const degree = KILL_LANES[laneSection][position % KILL_LANE_STEPS];
    const midi = leadSet[degree];
    const vel = Math.min(1.45, 1 + chain * 0.14);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].kill, vel, weight);
    }
    const decay = mixedVoiceValue(mix, 'kill', 'decay') as number;
    const gain = mixedVoiceValue(mix, 'kill', 'gain') as number;
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.45, 0.2) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkle * 0.045, 0.08, 7400);
  }

  // The Lamprey audibly loses the fight: every chip is brighter, higher, and
  // more strained than the last.
  function mawChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 12);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sawtooth',
      frequency: root * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root * (1 + intensity * 1.2), time: time + 0.3 }],
      filter: { type: 'lowpass', frequency: 700 + intensity * 2600, Q: 2 },
      gainAutomation: [
        { type: 'set', value: 0.1 + intensity * 0.1, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
      ],
      destination: output,
      sends: playerSends(0.2, 0.4),
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon, PLAYER_VOICES[3].kill, 0.5 + intensity * 0.4, 1);
    playerNoise(time, 0.08 + intensity * 0.08, 0.09, 4200);
  }

  function mawFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.12, 1.5);
    impact(time, 1.35);
    // The severed grip: a cable twang whipping away down the tether.
    twangVoice.play({
      context: ctx,
      time: time + 0.05,
      frequency: 1900,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 160, time: time + 0.8 }],
      destination: output,
      sends: playerSends(0.3, 0.5),
    });
    subPulse(time + 0.02, chord.bass - 12, 1);
    score.leadSetAt(position).slice().reverse().forEach((midi, index) => {
      const at = time + 0.1 + index * SIXTEENTH;
      playerTone(at, midi, PLAYER_VOICES[3].kill, 0.85 - index * 0.07, 1);
    });
    chime(time + 0.1 + 8 * SIXTEENTH, 81, 2.2, 0.4);
  }

  // ---- event wiring ------------------------------------------------------------

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    const mix = score.sectionMixAt(position);
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      playerTone(time, midi, PLAYER_VOICES[section].lock, 1, weight);
    }
    const sparkle = mixedVoiceValue(mix, 'lock', 'sparkle') as number;
    playerNoise(time, 0.012 + sparkle * 0.03, 0.022, 9200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.5, 1);
      lockBassVoice.play({
        context: ctx,
        time,
        midi: score.chordAt(position).bass + 12,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(score.chordAt(position).bass), time: time + 0.14 }],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.32, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 12;
    for (const [section, weight] of score.sectionLayers(mix)) {
      if (weight < 0.02) continue;
      const fire = PLAYER_VOICES[section].fire;
      fireVoice.play({
        context: ctx,
        time,
        midi: sourceMidi,
        oscillator: fire.oscillator,
        cutoff: fire.cutoff,
        gainValue: fire.gain,
        weight,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.065 }],
        destination: output,
        sends: playerSends(0.16, 0.08),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.028, 4600);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === mawId) {
      mawChip(time, 1 - hitPointsRemaining / MAW_TOTAL_HP);
      return;
    }
    // Armor chip: a tuned clank ringing off the plating.
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      clankVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        gainValue: 0.05 - index * 0.009,
        destination: output,
        sends: playerSends(0.2, 0.16),
      });
    }
    playerNoise(time, 0.04, 0.032, 5400);
  });

  bus.on('stage', ({ enemyId }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Plating shears away.
    noiseHit(time, 0.18, 0.14, 'bandpass', 2300, output);
    for (const midi of [chord.bass + 12, chord.stab[1] + 12]) {
      shearVoice.play({ context: ctx, time, midi, gainValue: 0.13, destination: output, sends: playerSends(0.24, 0.5) });
    }
    if (enemyId === mawId) {
      riser(time, 1.4, 0.16); // it slips, swings wide, and comes on again
      subPulse(time + 0.05, chord.bass - 12, 0.9);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === mawId) {
      mawFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const leadSet = score.leadSetAt(position);
    const mix = score.sectionMixAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree], PLAYER_VOICES[mix.to].kill, (size >= 6 ? 0.7 : 0.55) - index * 0.06, 1);
    });
    if (size >= 6) subPulse(time, score.chordAt(position).bass, 0.6);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [frequency, at, vel] of [[196, time, 0.13], [185, time + 0.09, 0.1]] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency,
        frequencyAutomation: [{ type: 'exponentialRamp', value: frequency * 0.55, time: at + 0.15 }],
        vel,
        destination: output,
      });
    }
    noiseHit(time, 0.1, 0.06, 'bandpass', 700, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    // Structural hit: a boom through the frame, then the hazard beeper.
    hullBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.3 }],
      destination: output,
    });
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[2] + 11].forEach((midi, index) => {
      hazardBeepVoice.play({ context, time: time + 0.16 + index * 0.12, midi, destination: output, sends: playerSends(0.1, 0.1) });
    });
    noiseHit(time, 0.18, 0.15, 'bandpass', 900, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    const chord = score.chordAt(score.arrangementPositionAt(time));
    missVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 24,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass + 12), time: time + 0.11 }],
      destination: output,
      sends: playerSends(0.08, 0),
    });
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'maw') {
      mawId = enemyId;
      // The latch, heard before it is believed: a hull-shaking slam from far
      // overhead and a long metallic groan down the tether.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const audioMix = runtime.mix();
      audioMix?.duckAt(time, 0.35, 0.9);
      impact(time, 1.3);
      riser(time + 0.1, 2.0, 0.18);
      motif(time + 0.15, 28, 2.4, 1);
      twangVoice.play({
        context: ctx,
        time: time + 0.08,
        frequency: 900,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 90, time: time + 0.9 }],
        destination: sfxDestination() ?? audioMix?.master ?? ctx.destination,
        sends: playerSends(0.25, 0.5),
      });
    } else if (kind === 'sapper') {
      // Two-tone klaxon: something is on the car.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const position = score.arrangementPositionAt(time);
      const leadSet = score.leadSetAt(position);
      const output = sfxDestination();
      if (!output) return;
      [leadSet[2], leadSet[0]].forEach((midi, index) => {
        klaxonVoice.play({ context: ctx as AudioContext, time: time + index * SIXTEENTH, midi: midi - 12, destination: output, sends: playerSends(0.12, 0.14) });
      });
    } else if (kind === 'breaker') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      motif(time, 40, 1.6, 0.6);
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (!ctx) return;
    const output = sfxDestination();
    if (!output) return;
    if (phase === 'exposed') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      const leadSet = score.leadSetAt(score.arrangementPositionAt(time));
      [0, 2, 4].forEach((degree, index) => {
        playerTone(time + index * THIRTYSECOND * 2, leadSet[degree] + 12, PLAYER_VOICES[3].kill, 0.55, 1);
      });
    } else if (phase === 'summoned') {
      // It reached the car.
      const time = ctx.currentTime;
      [0, 1, 2].forEach((index) => {
        klaxonVoice.play({ context: ctx as AudioContext, time: time + index * 0.14, frequency: index % 2 === 0 ? 740 : 620, destination: output });
      });
    }
  });

  return runtime;
}
