import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSkyhookVoices, installWind, type SkyTonalVoice, type WindLayer } from './audio-voices';
import {
  LIGHTNING_BARS,
  SKYHOOK_BARS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_SCORE_SECTIONS,
  SKYHOOK_STEPS_PER_BAR,
  SKYHOOK_TIME,
} from './timing';

// The Skyhook score: 128 BPM, 32 bars = the whole 60-second climb, in A minor
// leaning airy (Am9 – Fmaj7 – Cadd9 – Gsus). The arrangement is scored the way
// the air behaves: the storm act is wide — wind bed, breathy pads, loose
// breakbeat — and every 8-bar phrase STRIPS layers as the car climbs. By the
// vacuum act the music is a heartbeat kick, a sub pulse, and glass bells, so
// the player's own kill melody is most of what is left. Docking (bars 28–32)
// decays to a pad, a slow chime figure, and one soft final thump.

const SIXTEENTH = SKYHOOK_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = SKYHOOK_STEPS_PER_BAR;
const KILL_LANE_STEPS = 32;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Am9 — Fmaj7 — Cadd9 — Gsus, two bars each: wide and airy.
const CHORDS: Chord[] = [
  { bass: 33, pad: [57, 64, 67, 71], arp: [69, 72, 76, 79], stab: [69, 72, 76] }, // Am9
  { bass: 29, pad: [53, 60, 64, 69], arp: [65, 69, 72, 77], stab: [65, 69, 72] }, // Fmaj7
  { bass: 36, pad: [55, 62, 64, 67], arp: [67, 72, 74, 79], stab: [67, 72, 76] }, // Cadd9
  { bass: 31, pad: [55, 60, 62, 67], arp: [67, 71, 74, 79], stab: [67, 71, 74] }, // Gsus
];
// Thin air / boss (bars 16–28). chordAt indexes by absolute bar, so this array
// is ordered for floor(bar/2)%4: 16→Am, 18→Dm (the latch), 20→E (the squeeze),
// 22→Am, 24→Am, 26→Dm.
const THIN_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 38, pad: [53, 57, 62, 65], arp: [62, 65, 69, 74], stab: [65, 69, 74] }, // Dm
  { bass: 40, pad: [52, 59, 64, 68], arp: [64, 68, 71, 76], stab: [64, 68, 71] }, // E
  CHORDS[0],
];
// Dock (bars 28–32): Fmaj7 floating home to C. floor(28/2)%2 = 0 → F first.
const DOCK_CHORDS: Chord[] = [
  { bass: 41, pad: [57, 60, 65, 69], arp: [65, 69, 72, 76], stab: [65, 69, 72] }, // Fmaj7
  { bass: 36, pad: [55, 60, 64, 71], arp: [67, 72, 76, 79], stab: [67, 72, 76] }, // Cmaj9
];

type SectionIndex = 0 | 1 | 2 | 3;

// Kill lanes: a hidden two-bar sequencer per act. Storm rolls like swells;
// blue skips brightly; thin climbs in fragments; vacuum walks high and sparse
// — up there the player's melody is nearly the whole arrangement.
const KILL_LANES: Record<SectionIndex, number[]> = {
  0: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 3, 2, 4, 3, 5, 4, 6,
    5, 4, 3, 5, 4, 6, 5, 7,
    6, 5, 4, 3, 4, 2, 3, 1,
  ],
  1: [
    0, 4, 2, 5, 3, 6, 4, 7,
    5, 3, 6, 4, 7, 5, 6, 4,
    2, 5, 3, 6, 4, 7, 5, 6,
    7, 6, 5, 4, 5, 3, 4, 2,
  ],
  2: [
    4, 5, 6, 7, 5, 6, 7, 6,
    5, 7, 6, 7, 4, 6, 5, 7,
    6, 7, 5, 6, 7, 5, 6, 4,
    5, 6, 7, 5, 6, 4, 5, 3,
  ],
  3: [
    7, 5, 6, 4, 5, 3, 4, 2,
    3, 4, 5, 6, 7, 6, 5, 4,
    6, 4, 5, 3, 4, 2, 3, 1,
    2, 3, 4, 5, 6, 5, 4, 7,
  ],
};

type FireVoice = { oscillator: OscillatorType; cutoff: number; gain: number; fallSemitones: number; noise: number };

// Player instruments per act: warm and windblown low, glassy and pure high.
const PLAYER_VOICES: Record<SectionIndex, { lock: SkyTonalVoice; kill: SkyTonalVoice; fire: FireVoice }> = {
  0: {
    lock: { oscillator: 'triangle', decay: 0.1, cutoff: 3000, gain: 0.1, sparkle: 0.45, reverb: 0.2 },
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3200, gain: 0.14, sparkle: 0.6, reverb: 0.28 },
    fire: { oscillator: 'sawtooth', cutoff: 3200, gain: 0.06, fallSemitones: 10, noise: 0.05 },
  },
  1: {
    lock: { oscillator: 'square', decay: 0.08, cutoff: 3300, gain: 0.05, sparkle: 0.4, reverb: 0.14 },
    kill: { oscillator: 'square', decay: 0.2, cutoff: 3700, gain: 0.11, sparkle: 0.6, reverb: 0.2 },
    fire: { oscillator: 'sawtooth', cutoff: 4200, gain: 0.06, fallSemitones: 8, noise: 0.045 },
  },
  2: {
    lock: { oscillator: 'sawtooth', decay: 0.09, cutoff: 3800, gain: 0.05, sparkle: 0.5, reverb: 0.28 },
    kill: { oscillator: 'sawtooth', decay: 0.26, cutoff: 4200, gain: 0.12, sparkle: 0.75, reverb: 0.34 },
    fire: { oscillator: 'square', cutoff: 3600, gain: 0.055, fallSemitones: 11, noise: 0.04 },
  },
  3: {
    lock: { oscillator: 'sine', decay: 0.15, cutoff: 4200, gain: 0.12, sparkle: 0.55, reverb: 0.45 },
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 5200, gain: 0.16, sparkle: 0.85, reverb: 0.55 },
    fire: { oscillator: 'triangle', cutoff: 3400, gain: 0.05, fallSemitones: 12, noise: 0.028 },
  },
};

// Docking chime figure, played over bars 28–31. [bar-in-dock, step, midi, beats]
const DOCK_CHIME: Array<[number, number, number, number]> = [
  [0, 0, 81, 2], [0, 8, 77, 2],
  [1, 0, 76, 2], [1, 8, 72, 2],
  [2, 0, 79, 2], [2, 8, 76, 2],
  [3, 0, 72, 4],
];

export function createAudio(bus: EventBus) {
  return createSkyhookAudio(bus).audio;
}

export const traceSkyhookAudio = createAudioTraceHarness({
  level: 'skyhook-p46c',
  bpm: SKYHOOK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SKYHOOK_DURATION,
  createAudio: createSkyhookAudio,
});

function createSkyhookAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let wind: WindLayer | null = null;
  let bossId = -1;
  let bossMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: SKYHOOK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { fromBar: SKYHOOK_BARS.thin, toBar: SKYHOOK_BARS.dock, chords: THIN_CHORDS, barsPerChord: 2 },
      { fromBar: SKYHOOK_BARS.dock, chords: DOCK_CHORDS, barsPerChord: 2 },
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
      compressor: { threshold: -16, ratio: 5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 2600 },
      reverb: { seconds: 3.2, decay: 2.8, level: 0.55 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      wind = installWind(context, mix);
      wind?.setLevel(0.1, context.currentTime);
    },
    onStep: scheduleStep,
    onRunStart() {
      bossId = -1;
      bossMaxHp = 0;
    },
    onRunEnd() {
      const context = runtime.context();
      // The car is docked: one warm, airless chord and the hiss of pressure.
      if (context) {
        pad(context.currentTime + 0.05, [48, 55, 64, 67, 71], 6, 0.9, 0.3);
        hiss(context.currentTime + 0.15, 2.4, 0.05);
      }
    },
    onDispose() {
      ctx = null;
      wind = null;
    },
  });

  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- arrangement ----------------------------------------------------------

  const blankBar = '................';
  const evenBarPad = 'P...............................';

  // Wind bed level per section — the single clearest "air thinning" control.
  const WIND_LEVELS: Record<string, number> = { storm: 0.34, blue: 0.16, thin: 0.06, vacuum: 0.02, dock: 0.012 };

  function windTrack(section: string) {
    return fn<Chord>(({ time, step }) => {
      if (step === 0 && wind) wind.setLevel(WIND_LEVELS[section] ?? 0.05, time);
    });
  }

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
          fn(({ time, step }) => {
            if (step === 0 && wind) wind.setLevel(0.16, time);
          }),
          hits(evenBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.6, 0.8)),
          hits('B...............' + blankBar, { B: 0.5 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.5)),
          hits('....L.......L...' + blankBar, { L: 0.4 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[(step / 4) % 4], vel)),
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
        // Storm: everything at once, loose and weathered — the widest the mix will ever be.
        name: 'storm',
        fromBar: SKYHOOK_BARS.storm,
        tracks: [
          windTrack('storm'),
          hits(evenBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.9, 1)),
          hits('K.......K.....k.', { K: 0.9, k: 0.6 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.75 }, ({ time }, vel) => snare(time, vel)),
          hits('x.x.x.x.x.x.x.x.', { x: 0.028 }, ({ time }, vel) => shaker(time, vel)),
          hits('..H...H...H...H.', { H: 0.05 }, ({ time }, vel) => hat(time, vel, 0.03)),
          hits('B.....B.....B...', { B: 0.75 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 1)),
          hits('A.A.A.A.A.A.A.A.', { A: 0.5 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[(step / 2) % 4], vel)),
          // Thunder rides the authored lightning strikes.
          fn(({ time, bar, step }) => {
            for (const strike of LIGHTNING_BARS) {
              if (bar === Math.floor(strike) && step === Math.round((strike % 1) * STEPS_PER_BAR)) thunder(time, 1);
            }
          }),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
          fn(({ time, step, bar }) => { if (bar === 7 && step >= 8) snare(time, 0.2 + (step - 8) * 0.06); }),
        ],
      },
      {
        // Blue: punch through the deck — crisper, brighter, the low mud gone.
        name: 'blue',
        fromBar: SKYHOOK_BARS.cloudbreak,
        tracks: [
          windTrack('blue'),
          oneShot(0, 0, ({ time }) => {
            impact(time, 1);
            crash(time, 0.26);
          }),
          hits('K.....K...K.....', { K: 1 }, ({ time }, vel) => kick(time, vel)),
          hits('....S.......S...', { S: 0.85 }, ({ time }, vel) => snare(time, vel)),
          hits('..............G.' + blankBar, { G: 0.28 }, ({ time }, vel) => snare(time, vel)),
          hits('h.H.h.H.h.H.h.H.', { h: 0.035, H: 0.07 }, ({ time }, vel) => hat(time, vel, 0.028)),
          hits('B..B....B..B....', { B: 0.8 }, ({ time, step, chord }, vel) => bass(time, chord.bass + (step === 8 ? 12 : 0), vel, 0.6)),
          hits('A.A.A.A.A.A.A.A.', { A: 0.6 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[[0, 2, 1, 3, 2, 0, 3, 1][(step / 2) % 8]], vel)),
          hits('S...............' + blankBar, { S: 0.6 }, ({ time, chord }, vel) => stab(time, chord.stab, vel)),
          hits('P...............................................................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.6, 0.6)),
          oneShot(6, 0, ({ time }) => riser(time, 32 * SIXTEENTH, 0.2)),
        ],
      },
      {
        // Thin: the air runs out. Pad reduced to a whisper, shaker gone, ride
        // pings in the emptiness; the Tetherjack's groan enters at bar 18.
        name: 'thin',
        fromBar: SKYHOOK_BARS.thin,
        tracks: [
          windTrack('thin'),
          hits('K.......K.......', { K: 0.9 }, ({ time }, vel) => kick(time, vel)),
          hits('....S...........', { S: 0.6 }, ({ time }, vel) => snare(time, vel)),
          hits('..R...R...R...R.', { R: 0.04 }, ({ time }, vel) => ride(time, vel)),
          hits('B...............', { B: 0.7 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0.25)),
          hits('A...A...A...A...', { A: 0.4 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[(step / 4) % 4], vel)),
          hits(evenBarPad, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, 0.5, 0.28)),
          hits('....L.......L...', { L: 0.28 }, ({ time, step, chord }, vel) => bell(time, chord.arp[(step / 4) % 4] + 12, vel, 1.6)),
          // The boss climbs down through this whole act: its groan answers
          // every second downbeat, rising with the damage it has taken.
          fn(({ time, bar, step, chord }) => {
            if (bar >= SKYHOOK_BARS.bossLatch && bar % 2 === 0 && step === 0) bossGroan(time, chord.bass, 12 * SIXTEENTH, bossRage());
          }),
          oneShot(SKYHOOK_BARS.bossLatch - SKYHOOK_BARS.thin, 8, ({ time }) => riser(time, 8 * SIXTEENTH, 0.16)),
        ],
      },
      {
        // Vacuum: barely there. Heartbeat kick, sub pulse, glass bells. The
        // player's kill lane owns the register now.
        name: 'vacuum',
        fromBar: SKYHOOK_BARS.vacuum,
        tracks: [
          windTrack('vacuum'),
          hits('K...............', { K: 0.8 }, ({ time }, vel) => kick(time, vel)),
          hits('........K.......', { K: 0.35 }, ({ time }, vel) => kick(time, vel)),
          hits('..R.......R.....', { R: 0.032 }, ({ time }, vel) => ride(time, vel)),
          hits('B...............', { B: 0.6 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0)),
          hits('L...............' + blankBar, { L: 0.32 }, ({ time, chord }, vel) => bell(time, chord.arp[3] + 12, vel, 2.4)),
          hits('........L.......' + blankBar, { L: 0.2 }, ({ time, chord }, vel) => bell(time, chord.arp[1] + 12, vel, 2)),
          fn(({ time, bar, step, chord }) => {
            if (bar % 2 === 0 && step === 0) bossGroan(time, chord.bass, 14 * SIXTEENTH, bossRage());
          }),
        ],
      },
      {
        // Dock: deceleration. No drums. A pad, the chime figure, one last thump.
        name: 'dock',
        fromBar: SKYHOOK_BARS.dock,
        toBar: SKYHOOK_BARS.end,
        tracks: [
          windTrack('dock'),
          hits('P...............................................................', { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.8, 0.2)),
          hits('B...............................', { B: 0.5 }, ({ time, chord }, vel) => bass(time, chord.bass, vel, 0)),
          fn(({ time, step, barInSection }) => {
            if (step % 2 !== 0) return;
            for (const [chimeBar, chimeStep, midi, beats] of DOCK_CHIME) {
              if (chimeBar === barInSection && chimeStep === step) bell(time, midi, 0.5, beats * 4 * SIXTEENTH);
            }
          }),
          // Contact: the docking clamps take the car. Soft, final, felt.
          oneShot(3, 8, ({ time }) => {
            impact(time, 0.55);
            hiss(time + 0.1, 1.6, 0.04);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- voices ---------------------------------------------------------------

  const voices = createSkyhookVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, snare, hat, shaker, ride, crash, bass, pad, pluck, bell, stab,
    bossGroan, thunder, riser, impact, hiss, noiseHit, playerSends, playerTone, playerNoise,
  } = voices;

  function bossRage() {
    return bossMaxHp <= 0 ? 0.15 : Math.min(1, 0.2 + 0.8 * (1 - bossHpRemaining / Math.max(1, bossMaxHp)));
  }
  let bossHpRemaining = 0;

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
    oscillators: [{ type: 'sine', octave: 1, gain: 0.32 }],
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
    duration: 0.075,
    stopPadding: 0.017,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.075 },
  });

  const hitTriangleVoice = voice<{ cutoff: number; gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: ({ decay }) => decay },
  });

  const stageVoice = voice<{ gainValue: number; decay: number }>({
    oscillators: [{ type: 'triangle', gain: ({ gainValue }) => gainValue }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    envelope: { decay: ({ decay }) => decay },
  });

  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.18,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 5, frequency: 760 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.18 },
    ],
  });

  const playerHitBoomVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.44 }],
    duration: 0.5,
    stopPadding: 0.05,
    envelope: { decay: 0.5 },
  });

  const klaxonVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: ({ vel }) => 0.05 * vel }],
    duration: 0.14,
    stopPadding: 0.03,
    filter: { type: 'lowpass', frequency: 2200 },
    envelope: { decay: 0.14 },
  });

  const missVoice = voice({
    oscillators: [{ type: 'sine', gain: 0.04 }],
    duration: 0.12,
    stopPadding: 0.02,
    envelope: { decay: 0.12 },
  });

  const grapplerWarnVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: ({ vel }) => 0.055 * vel }],
    duration: 0.16,
    stopPadding: 0.03,
    envelope: { decay: 0.16 },
  });

  // ---- player instruments ---------------------------------------------------
  // Every positive player action snaps to the transport, reads the live chord,
  // and sends tails into the same delay/hall as the arrangement. Kills walk
  // the hidden lane, so a chained volley performs a melodic run.

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
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: playerSends(0.5, 0.2) });
    }
    const sparkle = mixedVoiceValue(mix, 'kill', 'sparkle') as number;
    playerNoise(time, 0.02 + sparkle * 0.045, 0.09, 7400);
  }

  // Boss chips escalate: each hit on the Tetherjack rings a tone that climbs
  // and brightens with total damage dealt.
  function bossChip(time: number, intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass + 24);
    const context = ctx;
    hitTriangleVoice.play({
      context,
      time,
      frequency: root * (1 + intensity * 0.5),
      cutoff: 1800 + intensity * 3600,
      gainValue: 0.1 + intensity * 0.1,
      decay: 0.3,
      destination: output,
      sends: playerSends(0.24, 0.3),
    });
    const beacon = score.leadSetAt(position)[Math.min(7, Math.floor(intensity * 8))];
    playerTone(time + THIRTYSECOND, beacon + 12, PLAYER_VOICES[3].kill, 0.4 + intensity * 0.4, 1);
    playerNoise(time, 0.08 + intensity * 0.09, 0.1, 4600);
  }

  // The killing blow: duck the arrangement for a breath, let the carcass fall
  // in a long descending figure, then land a clean resolve.
  function bossFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.duck) return;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    audioMix.duckAt(time, 0.12, 1.6);
    impact(time, 1.3);
    crash(time, 0.3);
    // Falling: the lead set walked top to bottom, accelerating like a drop.
    const leadSet = score.leadSetAt(position);
    leadSet.slice().reverse().forEach((midi, index) => {
      const at = time + index * (THIRTYSECOND * (1 + index * 0.12));
      playerTone(at, midi, PLAYER_VOICES[3].kill, 0.85 - index * 0.06, 1);
    });
    pad(time + 0.4, [chord.bass + 24, ...chord.pad], 5, 1.0, 0.35);
    bell(time + 0.5, chord.arp[3] + 12, 0.8, 3.2);
  }

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
    playerNoise(time, 0.012 + sparkle * 0.03, 0.025, 9200);
    if (lockCount >= 6) {
      const output = sfxDestination();
      if (!output) return;
      playerTone(time + THIRTYSECOND, midi + 12, PLAYER_VOICES[mix.to].kill, 0.55, 1);
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
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    playerTone(time, score.chordAt(position).bass + 24, PLAYER_VOICES[score.sectionMixAt(position).to].lock, 0.35, 1);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const mix = score.sectionMixAt(position);
    const sourceMidi = chord.arp[(indexInVolley ?? 0) % chord.arp.length] + 24;
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
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(sourceMidi - fire.fallSemitones), time: time + 0.062 }],
        destination: output,
        sends: playerSends(0.16, 0.08),
      });
    }
    const fromFire = PLAYER_VOICES[mix.from].fire;
    const toFire = PLAYER_VOICES[mix.to].fire;
    playerNoise(time, lerp(fromFire.noise, toFire.noise, mix.t), 0.026, 4600);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    if (enemyId === bossId) {
      bossMaxHp = Math.max(bossMaxHp, hitPointsRemaining + 1);
      bossHpRemaining = hitPointsRemaining;
      bossChip(time, 1 - hitPointsRemaining / Math.max(1, bossMaxHp));
      return;
    }
    const chord = score.chordAt(score.arrangementPositionAt(time));
    const context = ctx;
    for (const [index, midi] of chord.stab.entries()) {
      hitTriangleVoice.play({
        context,
        time: time + index * THIRTYSECOND,
        midi: midi + 12,
        cutoff: 3400,
        gainValue: 0.05 - index * 0.008,
        decay: 0.09,
        destination: output,
        sends: playerSends(0.2, 0.16),
      });
    }
    playerNoise(time, 0.04, 0.035, 5400);
  });

  bus.on('stage', ({ enemyId, stageIndex }) => {
    const output = sfxDestination();
    if (!ctx || !output || !runtime.mix()?.reverbSend) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    playerNoise(time, 0.18, 0.14, 2400);
    for (const midi of [chord.bass + 12, chord.stab[(stageIndex + 1) % chord.stab.length] + 12]) {
      stageVoice.play({
        context: ctx,
        time,
        midi,
        gainValue: 0.13,
        decay: 0.6,
        destination: output,
        sends: playerSends(0.24, 0.5),
      });
    }
    if (enemyId === bossId) {
      // The carapace shears off and it climbs faster — brace.
      riser(time, 1.4, 0.18);
      bossGroan(time + 0.1, score.chordAt(score.arrangementPositionAt(time)).bass, 10 * SIXTEENTH, 0.9);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    if (enemyId === bossId) {
      bossFinale(kill.time);
      return;
    }
    const position = Math.max(0, kill.step - score.arrangementStart);
    killMelody(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 4 || kills < size || !runtime.mix()?.duck) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.stab.map((midi) => midi + 12), size >= 6 ? 0.9 : 0.68);
    const leadSet = score.leadSetAt(position);
    [0, 2, 4, 7].forEach((degree, index) => {
      playerTone(time + index * THIRTYSECOND, leadSet[degree] + 12, PLAYER_VOICES[score.sectionMixAt(position).to].kill, 0.6 - index * 0.06, 1);
    });
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx) return;
    if (!output) return;
    const time = ctx.currentTime;
    // Rejection: a dry two-tone stall warning. Cold hardware, no reward.
    for (const [frequency, at, vel] of [[311, time, 0.14], [294, time + 0.09, 0.11]] as const) {
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
    playerHitBoomVoice.play({
      context: ctx,
      time,
      midi: chord.bass + 12,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(chord.bass), time: time + 0.32 }],
      destination: output,
    });
    // Hull klaxon: two descending barks pitched from the live chord.
    const context = ctx;
    [chord.stab[2] + 12, chord.stab[0] + 12].forEach((midi, index) => {
      klaxonVoice.play({ context, time: time + index * 0.14, midi, vel: 1, destination: output, sends: playerSends(0.1, 0.08) });
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
    if (kind === 'ripper') {
      bossId = enemyId;
      bossHpRemaining = 9;
      bossMaxHp = 9;
      // The latch: a huge metallic slam and a rising groan from above.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      impact(time, 1.15);
      riser(time, 1.8, 0.18);
      bossGroan(time + 0.2, 26, 1.4, 0.35);
    } else if (kind === 'grappler') {
      const output = sfxDestination();
      if (!output) return;
      // Deck warning: two quick rising pips — something is coming for the car.
      const time = score.nextGridTime(ctx.currentTime, 0.5);
      const position = score.arrangementPositionAt(time);
      const leadSet = score.leadSetAt(position);
      const context = ctx;
      [0, 2].forEach((degree, index) => {
        grapplerWarnVoice.play({
          context,
          time: time + index * SIXTEENTH,
          midi: leadSet[degree],
          vel: 1,
          destination: output,
          sends: playerSends(0.12, 0.1),
        });
      });
    }
  });

  return runtime;
}
