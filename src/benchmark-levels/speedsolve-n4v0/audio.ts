import type { EventBus } from '../../events';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { voice } from '../../engine/audio-voices';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createSpeedsolveVoices } from './audio-voices';
import { snapClock, type SnapRequest } from './snap-clock';
import {
  SPEEDSOLVE_BPM,
  SPEEDSOLVE_STEPS_PER_BAR,
  SS_BARS,
  SS_DURATION,
  SS_SCORE_SECTIONS,
  SS_TIME,
} from './timing';

// SPEEDSOLVE's score is precise and mechanical: a locked 120 BPM kit built from
// clicks and tuned thocks, a sub that never swings, sixteenth plucks with clean
// attacks. The cube is the percussion section — every layer snap the player
// causes is quantized onto the transport's eighth grid by the provider below,
// so kills, snaps, and drums are one instrument. Each face conquered adds a
// layer to the arrangement; the finale sits on a dominant pedal that only
// resolves when the core bursts.

const SIXTEENTH = SS_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const EIGHTH = SIXTEENTH * 2;
const STEPS_PER_BAR = SPEEDSOLVE_STEPS_PER_BAR;
const LANE_STEPS = 32;
const MAX_LAYERS = 6;

// C major, stepwise rising: the harmony "solves" upward every two bars.
const CHORDS = [
  { bass: 36, pad: [55, 59, 62, 64], arp: [72, 76, 79, 83] }, // Cmaj9
  { bass: 38, pad: [53, 57, 60, 64], arp: [74, 77, 81, 84] }, // Dm9
  { bass: 40, pad: [55, 59, 62, 64], arp: [76, 79, 83, 86] }, // Em7
  { bass: 41, pad: [57, 60, 64, 67], arp: [77, 81, 84, 88] }, // Fmaj9
];
// The finale hangs on the dominant until the core dies.
const FINALE_CHORDS = [
  { bass: 43, pad: [59, 62, 65, 69], arp: [79, 83, 86, 89] }, // G13
  { bass: 43, pad: [60, 62, 65, 67], arp: [79, 84, 86, 89] }, // G7sus
];
type Chord = typeof CHORDS[number];
const LOCK_SCALE = [72, 74, 76, 79, 81, 84, 86, 88]; // C major pentatonic, rising per lock

type SectionIndex = 0 | 1 | 2 | 3;
// Kill-melody lanes: degrees into the lead set (arp + octave). A chained volley
// walks consecutive steps, so each lane is a real fragment, not a scale.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Faces 1–2: mechanical octave zig-zag, every kill a clean interval.
  0: [
    0, 4, 1, 5, 2, 6, 3, 7,
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    4, 0, 5, 1, 6, 2, 7, 3,
  ],
  // Faces 3–4: ascending runs that turn over at the top.
  1: [
    0, 1, 2, 3, 4, 5, 6, 7,
    7, 6, 5, 4, 3, 2, 1, 0,
    0, 2, 4, 6, 1, 3, 5, 7,
    7, 5, 3, 1, 6, 4, 2, 0,
  ],
  // Faces 5–6: falling thirds answered from below.
  2: [
    7, 4, 6, 3, 5, 2, 4, 1,
    3, 0, 2, 7, 4, 1, 3, 0,
    7, 4, 6, 3, 5, 2, 4, 1,
    6, 3, 5, 2, 4, 1, 3, 0,
  ],
  // Finale: high peals hammering the top of the register.
  3: [
    7, 7, 6, 7, 5, 7, 4, 7,
    6, 6, 5, 6, 4, 6, 3, 6,
    7, 5, 7, 4, 7, 3, 7, 2,
    5, 4, 5, 3, 5, 2, 5, 1,
  ],
};

type KillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number };
const SECTION_VOICES: Record<SectionIndex, { kill: KillVoice; lock: { oscillator: OscillatorType; cutoff: number; gain: number }; fire: { cutoff: number; noise: number } }> = {
  0: {
    kill: { oscillator: 'triangle', decay: 0.3, cutoff: 3000, gain: 0.2, shimmer: 0.3 },
    lock: { oscillator: 'triangle', cutoff: 3000, gain: 0.12 },
    fire: { cutoff: 2200, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.22, cutoff: 2600, gain: 0.12, shimmer: 0.45 },
    lock: { oscillator: 'square', cutoff: 2200, gain: 0.05 },
    fire: { cutoff: 3000, noise: 0.045 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.34, cutoff: 3200, gain: 0.13, shimmer: 0.6 },
    lock: { oscillator: 'sawtooth', cutoff: 2400, gain: 0.05 },
    fire: { cutoff: 3800, noise: 0.06 },
  },
  3: {
    kill: { oscillator: 'sawtooth', decay: 0.42, cutoff: 4200, gain: 0.15, shimmer: 0.8 },
    lock: { oscillator: 'sawtooth', cutoff: 2800, gain: 0.055 },
    fire: { cutoff: 4600, noise: 0.07 },
  },
};

export function createAudio(bus: EventBus) {
  return createSpeedsolveAudio(bus).audio;
}

export const traceSpeedsolveAudio = createAudioTraceHarness({
  level: 'speedsolve-n4v0',
  bpm: SPEEDSOLVE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: SS_DURATION,
  createAudio: createSpeedsolveAudio,
});

function createSpeedsolveAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  const kindById = new Map<number, string>();
  let layers = 0;
  let pendingLayers = 0;
  let layersApplyAtBar = Infinity;
  let coreId = -1;
  let coreTotalHits = 0;
  let coreHits = 0;
  let coreKilled = false;
  let lastSnapTime = -Infinity;
  let lastMissTime = -Infinity;

  const score = createScore<Chord, SectionIndex>({
    bpm: SPEEDSOLVE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: SS_BARS.finale, chords: FINALE_CHORDS, barsPerChord: 1 }],
    sections: SS_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -17, ratio: 5, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.28, dampHz: 3200 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      layers = 0;
      pendingLayers = 0;
      layersApplyAtBar = Infinity;
      coreId = -1;
      coreTotalHits = 0;
      coreHits = 0;
      coreKilled = false;
      lastSnapTime = -Infinity;
      kindById.clear();
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      // Without the core dead the dominant never resolves: the cube escapes on
      // a suspended chord. A destroyed core already had its cadence.
      if (context && !coreKilled) pad(context.currentTime + 0.05, [55, 60, 62, 65, 69], 5);
    },
    onDispose() {
      ctx = null;
      snapClock.setProvider(null);
    },
  });

  const voices = createSpeedsolveVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { thock, click, clack, sub, pluck, pad, stab, tick, snap, boom, cascade, riser, whoosh, chime, ping, anvil, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- the cube's percussion: the snap provider --------------------------------
  // Gameplay asks for a landing; we answer with the exact transport slot and
  // schedule the sound there. Consecutive snaps never share an eighth, so a
  // volley of kills becomes a roll of turns.
  snapClock.setProvider((request: SnapRequest) => {
    if (!ctx) return null;
    const grid = request.gridSixteenths;
    let time = score.nextGridTime(ctx.currentTime + request.minDelay, grid);
    const minTime = lastSnapTime + EIGHTH - 1e-4;
    if (time < minTime) time = score.nextGridTime(minTime, grid);
    lastSnapTime = time;
    scheduleSnapSound(time, request);
    return time - ctx.currentTime;
  });

  function scheduleSnapSound(time: number, request: SnapRequest) {
    if (!ctx) return;
    switch (request.kind) {
      case 'arm':
        snap(time, 0.7, 'arm');
        break;
      case 'solve':
        snap(time, 1, 'solve');
        break;
      case 'fall': {
        // The face falls away: cubies clatter, a boom underneath, and a glassy
        // solve figure climbs the live chord.
        const mix = runtime.mix();
        mix?.duckAt(time, 0.55, 0.5);
        cascade(time, 11, 0.42);
        boom(time, 0.8);
        const chord = score.chordAt(score.arrangementPositionAt(time));
        chord.arp.forEach((midi, index) => chime(time + index * SIXTEENTH, midi + 12, 0.9 - index * 0.1, 0.55));
        break;
      }
      default:
        snap(time, 1, 'solve');
    }
  }

  // ---- patterns ------------------------------------------------------------------

  const layered = (minLayer: number, track: ArrangementTrack<Chord>): ArrangementTrack<Chord> => ({
    patternLength: track.patternLength,
    run(context) {
      if (layers >= minLayer) track.run(context);
    },
  });

  const bar = (pattern: string) => pattern;
  const fourBars = (...bars: string[]) => bars.join('');

  const thockSolve = fourBars(
    bar('K...K...K...K...'),
    bar('K...K...K...K...'),
    bar('K...K...K...K...'),
    bar('K...K...K.k.k.k.'),
  );
  const thockFinale = fourBars(bar('K...K...K...K...'), bar('K...K...K...K.k.'));
  const clickEighths = bar('c.c.c.c.c.c.c.c.');
  const clickOffSixteenths = bar('.c.c.c.c.c.c.c.c');
  const clickAccents = bar('..C...C...C...C.');
  const clackBackbeat = bar('....X.......X...');
  const clackGhost = bar('..........x...x.');
  const subRoot = bar('B.......B.......');
  const subSyncopated = bar('...b..B....b..f.');
  const subFinale = bar('B.b.B.b.B.b.B.b.');
  const pluckEighths = bar('A.A.A.A.A.A.A.A.');
  const pluckOffSixteenths = bar('.a.a.a.a.a.a.a.a');
  const stabOff = bar('..S...S.....S...');
  const stabFinale = bar('S.....S...S.....');
  const tickRoll = fourBars(bar('................'), bar('................'), bar('................'), bar('............tttt'));
  const swingCue = fourBars(bar('R...............'), bar('................'), bar('................'), bar('....W...r.......'));

  const thockTrack = (pattern: string) => hits<Chord>(pattern, { K: 1, k: 0.82 }, ({ time }, vel) => thock(time, vel));
  const clickTrack = (pattern: string) => hits<Chord>(pattern, { c: 0.05, C: 0.1 }, ({ time }, vel, symbol) => click(time, vel, symbol === 'C' ? 0.03 : 0.012));
  const clackTrack = (pattern: string) => hits<Chord>(pattern, { X: 1, x: 0.45 }, ({ time }, vel) => clack(time, vel));
  const subTrack = (pattern: string) => hits<Chord>(pattern, { B: 1, b: 0.7, f: 0.7 }, ({ time, chord }, vel, symbol) => {
    const offset = symbol === 'f' ? 7 : 0;
    sub(time, chord.bass + offset, vel);
  });
  const pluckTrack = (pattern: string, order: number[], octave: number, vel: number) => hits<Chord>(pattern, { A: vel, a: vel * 0.75 }, ({ time, step, chord }, velocity) => {
    pluck(time, chord.arp[order[Math.floor(step / 2) % order.length]] + octave * 12, velocity);
  });
  const padTrack = (barsPerChord: number) => fn<Chord>(({ bar: absoluteBar, step, time, chord }) => {
    if (step !== 0 || absoluteBar % barsPerChord !== 0) return;
    pad(time, chord.pad, barsPerChord * STEPS_PER_BAR * SIXTEENTH * 1.04);
  });
  const stabTrack = (pattern: string) => hits<Chord>(pattern, { S: 1 }, ({ time, chord }, vel) => stab(time, chord.pad.map((midi) => midi + 12), vel));
  const tickTrack = hits<Chord>(tickRoll, { t: 0.7 }, ({ time, step, chord }, vel) => tick(time, chord.arp[step % 4] + 12, vel));
  const swingTrack = hits<Chord>(swingCue, { R: 1, W: 1, r: 1 }, ({ time, bar: absoluteBar }, _vel, symbol) => {
    if (symbol === 'W') whoosh(time, EIGHTH * 6);
    else if (symbol === 'r') riser(time, EIGHTH * 4, 0.45);
    else if (absoluteBar > 0) snap(time, 1.1, 'arrive');
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(2),
        hits<Chord>(bar('c...c...c...c...'), { c: 0.025 }, ({ time }, vel) => click(time, vel, 0.012)),
        hits<Chord>(bar('A...A...A...A...'), { A: 0.32 }, ({ time, step, chord }, vel) => pluck(time, chord.arp[(step / 4) % 4] - 12, vel)),
        fn<Chord>(({ bar: absoluteBar, step, time }) => {
          // The idle cube turns a layer every other bar; visuals snap on the
          // matching downbeat.
          if (step === 0 && absoluteBar % 2 === 0) snap(time, 0.55, 'idle');
        }),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      {
        name: 'solve',
        fromBar: SS_BARS.face1,
        toBar: SS_BARS.finale,
        tracks: [
          thockTrack(thockSolve),
          clickTrack(clickEighths),
          layered(2, clickTrack(clickOffSixteenths)),
          layered(4, clickTrack(clickAccents)),
          layered(1, clackTrack(clackBackbeat)),
          layered(5, clackTrack(clackGhost)),
          subTrack(subRoot),
          layered(3, subTrack(subSyncopated)),
          layered(2, pluckTrack(pluckEighths, [0, 2, 1, 3, 2, 0, 3, 1], -1, 0.5)),
          layered(5, pluckTrack(pluckOffSixteenths, [3, 1, 2, 0, 1, 3, 0, 2], -1, 0.42)),
          layered(3, padTrack(2)),
          layered(4, stabTrack(stabOff)),
          layered(6, tickTrack),
          swingTrack,
        ],
      },
      {
        name: 'finale',
        fromBar: SS_BARS.finale,
        toBar: SS_BARS.lastStretch,
        tracks: [
          thockTrack(thockFinale),
          clickTrack(clickEighths),
          clickTrack(clickOffSixteenths),
          clackTrack(clackBackbeat),
          subTrack(subFinale),
          pluckTrack(pluckEighths, [0, 2, 1, 3, 2, 0, 3, 1], -1, 0.55),
          layered(3, pluckTrack(pluckOffSixteenths, [3, 1, 2, 0, 1, 3, 0, 2], 0, 0.4)),
          padTrack(1),
          stabTrack(stabFinale),
          // The shell blows open on the downbeat; a riser carries the reveal.
          oneShot(0, 0, ({ time }) => {
            boom(time, 1);
            cascade(time, 18, 0.7);
            riser(time, STEPS_PER_BAR * 2 * SIXTEENTH, 0.7);
            runtime.mix()?.duckAt(time, 0.4, 0.8);
          }),
        ],
      },
      {
        name: 'last-stretch',
        fromBar: SS_BARS.lastStretch,
        tracks: [
          thockTrack(bar('K...K...K...K.k.')),
          clickTrack(clickEighths),
          clickTrack(clickOffSixteenths),
          clackTrack(bar('....X...x...X.x.')),
          subTrack(subFinale),
          pluckTrack(pluckEighths, [0, 2, 1, 3, 2, 0, 3, 1], -1, 0.6),
          pluckTrack(pluckOffSixteenths, [3, 1, 2, 0, 1, 3, 0, 2], 0, 0.45),
          padTrack(1),
          stabTrack(bar('S...S...S...S...')),
          fn<Chord>(({ step, time, chord }) => {
            // Klaxon pulse while the core still lives: the clock is running.
            if (coreKilled || step % 4 !== 2) return;
            tick(time, chord.arp[0] + 12, 0.9);
          }),
        ],
      },
    ],
  });

  // Layers are earned by conquering faces, but time guarantees a floor: one
  // layer per face window, so the build never stalls for a struggling player
  // and a fast solver simply hears each layer a few bars early.
  function timeFloorLayers(absoluteBar: number) {
    return Math.min(MAX_LAYERS - 1, Math.floor(absoluteBar / 4));
  }

  function scheduleStep({ position, time, mode, step, bar: absoluteBar }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      ambientArrangement.schedule(position, time);
      return;
    }
    if (step === 0) {
      if (absoluteBar >= layersApplyAtBar) {
        layers = Math.min(MAX_LAYERS, pendingLayers);
        layersApplyAtBar = Infinity;
      }
      layers = Math.max(layers, timeFloorLayers(absoluteBar));
    }
    runArrangement.schedule(position, time);
  }

  // ---- player instruments -------------------------------------------------------

  const killLayerVoice = voice<{ killVoice: KillVoice }>({
    oscillators: [{ type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain }],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { decay: ({ killVoice }) => killVoice.decay },
  });
  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.5 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });
  const killOctaveVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.35 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay },
  });
  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.085,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 200 },
    envelope: { decay: 0.085 },
  });
  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.085 }],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.07 },
  });
  const jamVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'square' }],
    duration: 0.16,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });
  const impactBoomVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.4,
    stopPadding: 0.05,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 32, time: time + 0.28 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.42, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
    ],
  });
  const impactStabVoice = voice({
    oscillators: [{ type: 'square' }],
    duration: 0.22,
    stopPadding: 0.04,
    gainAutomation: (time) => [
      { type: 'set', value: 0.06, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  function sectionLayers(sectionMix: SectionMix<SectionIndex>): Array<[SectionIndex, number]> {
    return sectionMix.from === sectionMix.to
      ? [[sectionMix.to, 1]]
      : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
  }

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = SECTION_VOICES[sectionMix.from].kill;
    const toVoice = SECTION_VOICES[sectionMix.to].kill;
    const vel = Math.min(1.35, 1 + chain * 0.11);
    const decay = lerp(fromVoice.decay, toVoice.decay, sectionMix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, sectionMix.t);
    const shimmer = lerp(fromVoice.shimmer, toVoice.shimmer, sectionMix.t);
    for (const [section, weight] of sectionLayers(sectionMix)) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice: SECTION_VOICES[section].kill,
        velocity: vel,
        weight,
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.4 }],
      });
    }
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killOctaveVoice.play({ context: ctx, time, midi, decay, gain, destination: output, sends: [{ destination: audioMix.delaySend, gain: 0.45 }] });
    }
    noiseHit(time, 0.04 * shimmer + 0.02, 0.05, 'highpass', 6000, output);
  }

  // A face conquered: a confirming stab climbs the chord, and the arrangement
  // gains a layer on the next bar line with a short riser leading in.
  function faceConquered() {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    stab(time, chord.pad.map((midi) => midi + 12), 1);
    chord.arp.forEach((midi, index) => chime(time + index * THIRTYSECOND, midi + 12, 0.8, 0.45));
    noiseHit(time, 0.1, 0.25, 'highpass', 6500, mix.duck);
    pendingLayers = Math.min(MAX_LAYERS, layers + 1);
    const nextBarPosition = (score.barAt(position) + 1) * STEPS_PER_BAR;
    layersApplyAtBar = score.barAt(nextBarPosition);
    const barTime = time + (nextBarPosition - position) * SIXTEENTH;
    if (barTime - time > EIGHTH) riser(barTime - Math.min(barTime - time, EIGHTH * 3), Math.min(barTime - time, EIGHTH * 3), 0.5);
  }

  // The core bursts: the music bows out for a breath, a sub drop lands on C,
  // the dominant finally resolves into a C major bloom, and confetti chimes
  // scatter over the next two bars.
  function coreFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.duck) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    audioMix.duckAt(time, 0.18, 2.4);
    boom(time, 1.2);
    cascade(time, 24, 1.1);
    for (const midi of [36, 48, 55, 64, 67, 72]) {
      for (const detune of [-5, 5]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 3.2,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 600, time },
              { type: 'linearRamp', value: 3200, time: time + 1.2 },
              { type: 'linearRamp', value: 900, time: time + 3.0 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.001, time },
            { type: 'exponentialRamp', value: 0.05, time: time + 0.05 },
            { type: 'set', value: 0.05, time: time + 1.6 },
            { type: 'exponentialRamp', value: 0.001, time: time + 3.1 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.3 }],
        });
      }
    }
    // Confetti: C major pentatonic sparks on the sixteenth grid, thinning out.
    const sparkle = [84, 88, 91, 93, 96, 100, 103, 105];
    for (let i = 0; i < 32; i += 1) {
      const density = 1 - i / 32;
      if (((i * 7919) % 100) / 100 > density * 0.95 + 0.05) continue;
      const midi = sparkle[(i * 5) % sparkle.length];
      chime(time + i * SIXTEENTH, midi, 0.6 * density + 0.2, 0.4);
    }
    noiseHit(time, 0.16, 0.7, 'highpass', 5600, output);
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    kindById.set(enemyId, kind);
    if (kind === 'core') {
      coreId = enemyId;
      const mix = runtime.mix();
      if (!ctx || !mix?.duck) return;
      // The core comes online: a low two-note alarm in the dominant.
      const time = score.nextGridTime(ctx.currentTime);
      [55, 59].forEach((midi, index) => {
        if (!ctx) return;
        const at = time + index * EIGHTH;
        stab(at, [midi, midi + 7], 1.1);
      });
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const kind = kindById.get(enemyId);
    kindById.delete(enemyId);
    if (!ctx) return;
    if (enemyId === coreId) {
      coreKilled = true;
      coreFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    if (kind === 'hub') faceConquered();
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    for (const [section, weight] of sectionLayers(sectionMix)) {
      if (weight < 0.02) continue;
      const lock = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: lock.oscillator,
        cutoff: lock.cutoff,
        gainValue: lock.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.3 }],
      });
    }
    noiseHit(time, 0.03, 0.006, 'highpass', 7000, output);
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const fromFire = SECTION_VOICES[sectionMix.from].fire;
    const toFire = SECTION_VOICES[sectionMix.to].fire;
    const cutoff = lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t);
    const noise = lerp(fromFire.noise, toFire.noise, sectionMix.t);
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.06 }],
      destination: output,
    });
    noiseHit(time, noise, 0.015, 'highpass', 3200, output);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    if (lethal || !ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (enemyId === coreId) {
      coreTotalHits = Math.max(coreTotalHits, hitPointsRemaining + 1 + coreHits);
      coreHits += 1;
      const intensity = Math.min(1, coreHits / Math.max(1, coreTotalHits));
      const lead = score.leadSetAt(position);
      const beacon = lead[Math.min(lead.length - 1, Math.floor(intensity * lead.length))];
      anvil(time, chord.bass, chord.arp, beacon, intensity);
      return;
    }
    // Hub chips: each hit rings a higher, brighter ping — the axle is failing.
    const remaining = Math.max(0, hitPointsRemaining);
    const intensity = remaining === 0 ? 1 : 1 / (remaining + 1);
    const index = Math.min(chord.arp.length - 1, Math.round(intensity * (chord.arp.length - 1)));
    ping(time, chord.arp[index] + 12, intensity);
  });

  bus.on('stage', ({ enemyId, stageIndex, hitStageCount }) => {
    if (enemyId !== coreId || !ctx) return;
    const output = sfxDestination();
    if (!output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    boom(time, 0.7);
    cascade(time, 8, 0.3);
    stab(time, chord.pad.map((midi) => midi + 12), 1.2);
    // The last stage is the naked heart: a rising alarm.
    if (stageIndex === hitStageCount - 1) {
      [67, 71, 74].forEach((midi, index) => chime(time + index * EIGHTH, midi + 12, 1, 0.5));
      riser(time, EIGHTH * 3, 0.6);
    }
  });

  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    stab(time, chord.pad.map((midi) => midi + 12), 0.9);
    noiseHit(time, 0.08, 0.28, 'highpass', 7000, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // A jammed turn: two dry, detuned low clacks that are deliberately out of
    // key, plus a buzz of plastic grinding.
    const time = ctx.currentTime;
    jamVoice.play({ context: ctx, time, frequency: 138, vel: 0.2, frequencyAutomation: [{ type: 'exponentialRamp', value: 92, time: time + 0.14 }], destination: output });
    jamVoice.play({ context: ctx, time: time + 0.05, frequency: 146, vel: 0.15, frequencyAutomation: [{ type: 'exponentialRamp', value: 88, time: time + 0.19 }], destination: output });
    noiseHit(time, 0.14, 0.08, 'bandpass', 640, output);
    noiseHit(time + 0.04, 0.09, 0.1, 'highpass', 2200, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    impactBoomVoice.play({ context: ctx, time, frequency: 92, destination: output });
    for (const midi of [61, 66]) impactStabVoice.play({ context: ctx, time, midi, destination: output });
    noiseHit(time, 0.2, 0.14, 'bandpass', 900, output);
  });

  bus.on('miss', ({ enemyId }) => {
    kindById.delete(enemyId);
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Whole faces leave at once on a swing; one tock covers the batch.
    if (time - lastMissTime < 0.15) return;
    lastMissTime = time;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.14,
      oscillatorType: 'sine',
      frequency: 140,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 72, time: time + 0.11 }],
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: output,
    });
  });

  return runtime;
}
