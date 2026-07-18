import type { EventBus } from '../../events';
import { createBeatLevelAudio, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createStrandlineVoices, type StrandlineKillVoice } from './audio-voices';
import {
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
} from './timing';

// The score is the animal waking up. It starts as one drone, one contraction
// every other beat, and a single struck light; every section adds a layer of
// something that had stopped working, and the crown fight takes them all away
// again so the last two bars can put them back at once.
//
// The player is the soloist. Kills read a hidden per-section melody lane out of
// the live chord, locks climb a pentatonic, and every player sound is snapped
// to the transport's real grid — so a chained volley plays a phrase rather
// than a burst of noise.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR;
const LANE_STEPS = 32;

// D major, read modally: the drift is unresolved sus colour, the crown pulls
// toward B minor, and the coda finally lands on a plain, wide D major 9.
type Chord = { bass: number; sub: number; pad: number[]; arp: number[] };

const D_ADD9: Chord = { bass: 38, sub: 26, pad: [50, 57, 62, 64], arp: [62, 66, 69, 76] };
const B_MIN7: Chord = { bass: 35, sub: 23, pad: [50, 54, 59, 62], arp: [59, 62, 66, 71] };
const G_MAJ9: Chord = { bass: 31, sub: 19, pad: [47, 55, 59, 62], arp: [55, 59, 62, 66] };
const A_SIX9: Chord = { bass: 33, sub: 21, pad: [52, 57, 61, 64], arp: [57, 61, 64, 69] };
const E_MIN9: Chord = { bass: 28, sub: 16, pad: [50, 55, 59, 64], arp: [59, 62, 67, 71] };
const D_MAJ9: Chord = { bass: 38, sub: 26, pad: [50, 57, 62, 66], arp: [62, 66, 69, 73] };

const CHORDS = [D_ADD9, B_MIN7, G_MAJ9, A_SIX9];
const LOCK_SCALE = [62, 66, 69, 71, 74, 78, 81, 86]; // D major pentatonic, rising per lock

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Degrees index the current chord's lead set (its arpeggio plus the same notes
// an octave up), so a kill on any step of any bar is a chord tone.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Drift — a slow, wide arch. Sparse waves pick calm fragments out of it.
  0: [
    0, 1, 2, 3, 2, 1, 0, 1,
    2, 3, 4, 3, 2, 1, 2, 3,
    4, 5, 4, 3, 2, 3, 4, 5,
    6, 5, 4, 3, 2, 1, 2, 0,
  ],
  // Bloom — the arch opens into thirds; chained kills start to sound like a run.
  1: [
    0, 2, 4, 2, 1, 3, 5, 3,
    2, 4, 6, 4, 3, 5, 7, 5,
    4, 2, 5, 3, 6, 4, 7, 5,
    6, 4, 3, 5, 4, 2, 1, 3,
  ],
  // Deep — fast octave zig-zag, so a dense volley rings out as a broken chord.
  2: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    7, 3, 6, 2, 5, 1, 4, 0,
    2, 5, 3, 6, 4, 7, 5, 7,
  ],
  // Crown — high descending peals answered by a climb: brood pops toll.
  3: [
    7, 6, 5, 4, 7, 6, 5, 4,
    6, 5, 4, 3, 6, 5, 4, 3,
    5, 4, 3, 2, 5, 4, 3, 2,
    4, 5, 6, 7, 5, 6, 7, 7,
  ],
  // Serene — the animal's own line, falling gently and landing on the root.
  4: [
    7, 6, 5, 6, 4, 5, 3, 4,
    2, 3, 1, 2, 0, 1, 2, 0,
    5, 4, 3, 4, 2, 3, 1, 2,
    0, 2, 4, 2, 1, 0, 1, 0,
  ],
};

// Per-section voicing for the player's instruments. Gains are set by perceived
// loudness, not matching numbers: the saw in the crown section would swamp the
// drift's sine at the same value.
const SECTION_VOICES: Record<SectionIndex, {
  kill: StrandlineKillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number; sweep: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.75, cutoff: 3200, gain: 0.2, shimmer: 0.35, octave: 0 },
    lock: { oscillator: 'sine', cutoff: 2600, gain: 0.15 },
    fire: { cutoff: 1500, noise: 0.035, sweep: 0.55 },
  },
  1: {
    kill: { oscillator: 'triangle', decay: 0.6, cutoff: 3600, gain: 0.16, shimmer: 0.5, octave: 0 },
    lock: { oscillator: 'triangle', cutoff: 2900, gain: 0.12 },
    fire: { cutoff: 2100, noise: 0.045, sweep: 0.6 },
  },
  2: {
    kill: { oscillator: 'square', decay: 0.36, cutoff: 2900, gain: 0.1, shimmer: 0.62, octave: 0 },
    lock: { oscillator: 'square', cutoff: 2300, gain: 0.05 },
    fire: { cutoff: 3100, noise: 0.06, sweep: 0.7 },
  },
  3: {
    kill: { oscillator: 'sawtooth', decay: 0.42, cutoff: 3000, gain: 0.085, shimmer: 0.72, octave: 0 },
    lock: { oscillator: 'sawtooth', cutoff: 2100, gain: 0.042 },
    fire: { cutoff: 3800, noise: 0.075, sweep: 0.8 },
  },
  4: {
    kill: { oscillator: 'sine', decay: 1.5, cutoff: 4200, gain: 0.24, shimmer: 0.9, octave: 1 },
    lock: { oscillator: 'sine', cutoff: 3400, gain: 0.16 },
    fire: { cutoff: 1800, noise: 0.02, sweep: 0.4 },
  },
};

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-os2b',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let parentId = -1;
  let parentMaxHp = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      // The crown pulls the harmony minor without leaving the key.
      { fromBar: STRANDLINE_BARS.crown, toBar: STRANDLINE_BARS.serene, chords: [B_MIN7, E_MIN9], barsPerChord: 2 },
      // The coda resolves and stays there.
      { fromBar: STRANDLINE_BARS.serene, chords: [D_MAJ9], barsPerChord: 2 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
    leadSet: (chord) => [...chord.arp, ...chord.arp.map((midi) => midi + 12)],
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.82,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -19, ratio: 4.5, attack: 0.008, release: 0.3 },
      // A long, dark delay and a big soft room: this is a lot of water.
      delay: { time: SIXTEENTH * 6, feedback: 0.42, dampHz: 1900 },
      reverb: { seconds: 4.2, decay: 2.4, level: 0.5 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      parentId = -1;
      parentMaxHp = 0;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      // Whatever happened, the water goes on. One last wide chord.
      if (context) pad(context.currentTime + 0.05, D_MAJ9.pad, 6, 1);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { pulse, sub, bass, bell, pad, swell, groan, caustic, tick, riser, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- the player's instruments --------------------------------------------

  const killLayerVoice = voice<{ killVoice: StrandlineKillVoice }>({
    oscillators: [
      { type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain, octave: ({ killVoice }) => killVoice.octave },
      { type: 'sine', octave: ({ killVoice }) => killVoice.octave + 1, gain: ({ killVoice }) => killVoice.gain * killVoice.shimmer * 0.4 },
    ],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.08,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { attack: 0.004, decay: ({ killVoice }) => killVoice.decay },
  });

  // A pure body an octave down keeps square and saw voices from sounding thin.
  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.6 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.06,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.75 },
    ],
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.2,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 220 },
    // A droplet: it blooms fast and rings a moment, never clicks.
    envelope: { attack: 0.006, decay: 0.19 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'triangle', gain: 0.12 }, { type: 'sine', octave: -1, gain: 0.1 }],
    duration: 0.16,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: 0.004, decay: 0.15 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.2,
    stopPadding: 0.03,
    filter: { type: 'bandpass', Q: 2.2, cutoff: 2600 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  // The webbing refusing a shot: a wet, muffled slap with no pitch centre.
  const rejectVoice = voice<{ vel: number; filterStart: number; filterEnd: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.34,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 7,
      frequencyAutomation: (time, { filterStart, filterEnd }) => [
        { type: 'set', value: filterStart, time },
        { type: 'exponentialRamp', value: filterEnd, time: time + 0.26 },
      ],
    },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  const impactVoice = voice({
    oscillators: [{ type: 'sine' }],
    duration: 0.6,
    stopPadding: 0.06,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 28, time: time + 0.42 }],
    gainAutomation: (time) => [
      { type: 'set', value: 0.46, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
    ],
  });

  const stingVoice = voice({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.34,
    stopPadding: 0.04,
    filter: { type: 'bandpass', Q: 4, cutoff: 1400 },
    gainAutomation: (time) => [
      { type: 'set', value: 0.075, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  // ---- the arrangement -----------------------------------------------------

  const blank = '................';
  const padEven = 'P...............' + blank;
  const padOdd = blank + 'P...............';
  const pulseHalf = 'P.......p.......';
  const pulseFour = 'P.......p...p...';
  const pulseSwim = 'P...p...P...p.p.';
  const pulseDrive = 'P..pP..pP..pp.p.';
  const pulseHeavy = 'P.......P.......';
  const bellSlow = 'b.......b.......';
  const bellWalk = 'b...b...b...b...';
  const bellArp = 'b.b.b.b.b.b.b.b.';
  const bellBraid = 'b.bb.b.bb.b.b.bb';
  const tickSparse = '....t.......t...';
  const tickEven = '..t...t...t...t.';
  const tickDense = '.t.t.t.t.t.t.t.t';
  const bassSlow = 'B...............';
  const bassWalk = 'B.......f.......';
  const bassDrive = 'B...B..fB...f.f.';
  const causticGrid = '......c.......c.';

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0, 0.85),
        subTrack(0.7),
        hits('b.......b...b...', { b: 0.42 }, ({ time, step, chord }, vel) => bell(time, chord.arp[(step / 4) % chord.arp.length], vel, 1.5)),
        hits(causticGrid, { c: 0.5 }, ({ time, chord }, vel) => caustic(time, chord.arp[3] + 12, vel)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      // Drift — almost nothing. One drone, one contraction every other beat.
      {
        name: 'drift',
        fromBar: STRANDLINE_BARS.drift,
        toBar: STRANDLINE_BARS.bloom,
        tracks: [
          padTrack(STRANDLINE_BARS.drift, 0.8),
          subTrack(0.8),
          pulseTrack(pulseHalf, 0.72),
          bellTrack(bellSlow, 0.4, 1.6),
          hits(tickSparse, { t: 0.03 }, ({ time }, vel) => tick(time, vel)),
        ],
      },
      // Bloom — bass and a walking light: the first thing to come back on.
      {
        name: 'bloom',
        fromBar: STRANDLINE_BARS.bloom,
        toBar: STRANDLINE_BARS.openWater,
        tracks: [
          padTrack(STRANDLINE_BARS.bloom, 0.9),
          subTrack(0.9),
          pulseTrack(pulseFour, 0.82),
          bassTrack(bassSlow),
          bellTrack(bellWalk, 0.48, 1.3),
          hits(tickEven, { t: 0.035 }, ({ time }, vel) => tick(time, vel)),
          hits(causticGrid, { c: 0.5 }, ({ time, chord }, vel) => caustic(time, chord.arp[2] + 12, vel)),
        ],
      },
      // Open water — the drums drop out entirely and the animal is just there.
      {
        name: 'open-water',
        fromBar: STRANDLINE_BARS.openWater,
        toBar: STRANDLINE_BARS.deep,
        tracks: [
          padTrack(STRANDLINE_BARS.openWater, 1.15),
          subTrack(1.1),
          oneShot(0, 0, ({ time, chord }) => swell(time, [chord.pad[0], chord.pad[2], chord.pad[3] + 12], STRANDLINE_TIME.bar(2) * 0.98, 1)),
          bellTrack('b.......b...b..b', 0.5, 1.9),
          hits('..c...c...c...c.', { c: 0.62 }, ({ time, chord }, vel) => caustic(time, chord.arp[3] + 12, vel)),
        ],
      },
      // Deep — everything at once, the water closes in.
      {
        name: 'deep',
        fromBar: STRANDLINE_BARS.deep,
        toBar: STRANDLINE_BARS.braid,
        tracks: [
          padTrack(STRANDLINE_BARS.deep, 1),
          subTrack(0.85),
          pulseTrack(pulseSwim, 0.9),
          bassTrack(bassWalk),
          bellTrack(bellArp, 0.4, 0.8),
          hits(tickDense, { t: 0.04 }, ({ time }, vel) => tick(time, vel)),
        ],
      },
      // Braid — the densest water; the bell line doubles.
      {
        name: 'braid',
        fromBar: STRANDLINE_BARS.braid,
        toBar: STRANDLINE_BARS.crown,
        tracks: [
          padTrack(STRANDLINE_BARS.braid, 1),
          subTrack(0.85),
          pulseTrack(pulseDrive, 0.95),
          bassTrack(bassDrive),
          bellTrack(bellBraid, 0.36, 0.6),
          hits(tickDense, { t: 0.05 }, ({ time }, vel) => tick(time, vel)),
          oneShot(2, 8, ({ time }) => riser(time, STRANDLINE_TIME.bar(0.5))),
        ],
      },
      // Crown — the arrangement is stripped to the infestation's own growl.
      {
        name: 'crown',
        fromBar: STRANDLINE_BARS.crown,
        toBar: STRANDLINE_BARS.purge,
        tracks: [
          subTrack(1.1),
          pulseTrack(pulseHeavy, 1),
          fn(({ barInSection, step, time, chord }) => {
            if (step !== 0 || barInSection % 2 !== 0) return;
            groan(time, chord.bass - 12, STRANDLINE_TIME.bar(2) * 0.9, 1);
          }),
          bellTrack('b.......b.......', 0.34, 1.1),
          hits('....t.......t..t', { t: 0.045 }, ({ time }, vel) => tick(time, vel)),
        ],
      },
      // Purge — the layers come back one bar at a time as the sheets die.
      {
        name: 'purge',
        fromBar: STRANDLINE_BARS.purge,
        toBar: STRANDLINE_BARS.serene,
        tracks: [
          padTrack(STRANDLINE_BARS.purge, 0.9),
          subTrack(1),
          pulseTrack(pulseSwim, 0.95),
          bassTrack(bassWalk),
          bellTrack(bellWalk, 0.44, 1.0),
          hits(tickEven, { t: 0.045 }, ({ time }, vel) => tick(time, vel)),
          fn(({ barInSection, step, time, chord }) => {
            if (step !== 0 || barInSection % 2 !== 0) return;
            groan(time, chord.bass - 12, STRANDLINE_TIME.bar(2) * 0.85, 0.7);
          }),
          oneShot(3, 8, ({ time }) => riser(time, STRANDLINE_TIME.bar(0.5))),
        ],
      },
      // Serene — the whole animal lit. Everything sustains, nothing strikes.
      {
        name: 'serene',
        fromBar: STRANDLINE_BARS.serene,
        toBar: STRANDLINE_BARS.end,
        tracks: [
          padTrack(STRANDLINE_BARS.serene, 1.6),
          subTrack(1.3),
          oneShot(0, 0, ({ time, chord }) => swell(time, [chord.pad[1], chord.pad[3], chord.arp[2] + 12], STRANDLINE_TIME.bar(2), 1.1)),
          hits('P...............', { P: 0.5 }, ({ time }, vel) => pulse(time, vel)),
          hits('b.....b...b...b.', { b: 0.5 }, ({ time, step, chord }, vel) => {
            const set = [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
            bell(time, set[[7, 5, 3, 0][(step / 2) % 4]], vel, 2.6);
          }),
          hits('..c.......c.....', { c: 0.7 }, ({ time, chord }, vel) => caustic(time, chord.arp[3] + 12, vel)),
        ],
      },
    ],
  });

  function padTrack(fromBar: number, vel: number) {
    return hits<Chord>(fromBar % 2 === 0 ? padEven : padOdd, { P: vel }, ({ time, chord }, velocity) =>
      pad(time, chord.pad, STRANDLINE_TIME.bar(2) * 1.04, velocity));
  }

  function subTrack(vel: number) {
    return hits<Chord>(padEven, { P: vel }, ({ time, chord }, velocity) =>
      sub(time, chord.sub, STRANDLINE_TIME.bar(2) * 1.02, velocity));
  }

  function pulseTrack(pattern: string, vel: number) {
    return hits(pattern, { P: vel, p: vel * 0.66 }, ({ time }, velocity) => pulse(time, velocity));
  }

  function bassTrack(pattern: string) {
    return hits<Chord>(pattern, { B: 1, f: 0.72 }, ({ time, chord }, vel, symbol) =>
      bass(time, chord.bass + (symbol === 'f' ? 7 : 0), vel));
  }

  function bellTrack(pattern: string, vel: number, decay: number) {
    return hits<Chord>(pattern, { b: vel }, ({ time, step, chord }, velocity) => {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      bell(time, chord.arp[order[(step / 2) % order.length]], velocity, decay);
    });
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- kills, locks, shots -------------------------------------------------

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    // The lane contour flips at the halfway point of a crossfade; the timbre
    // is the part that needs a smooth handover, not the (always consonant) note.
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const from = SECTION_VOICES[sectionMix.from].kill;
    const to = SECTION_VOICES[sectionMix.to].kill;
    const vel = Math.min(1.4, 1 + chain * 0.11);
    const decay = lerp(from.decay, to.decay, sectionMix.t);
    const gain = lerp(from.gain, to.gain, sectionMix.t);

    const layers: Array<[StrandlineKillVoice, number]> = sectionMix.from === sectionMix.to
      ? [[to, 1]]
      : [[from, 1 - sectionMix.t], [to, sectionMix.t]];
    for (const [killVoice, weight] of layers) {
      if (weight < 0.02) continue;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice,
        velocity: vel,
        weight,
        destination: output,
        sends: [
          { destination: mix.delaySend, gain: 0.5 },
          ...(mix.reverbSend ? [{ destination: mix.reverbSend, gain: 0.45 }] : []),
        ],
      });
    }
    killBodyVoice.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output });
    // The parasite letting go of the strand: a short wet release.
    noiseHit(time, 0.045, 0.07, 'bandpass', 2600, output);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === parentId) {
      parentFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    const sectionMix = score.sectionMixAt(score.arrangementPositionAt(time));
    const layers: Array<[SectionIndex, number]> = sectionMix.from === sectionMix.to
      ? [[sectionMix.to, 1]]
      : [[sectionMix.from, 1 - sectionMix.t], [sectionMix.to, sectionMix.t]];
    for (const [index, weight] of layers) {
      if (weight < 0.02) continue;
      const spec = SECTION_VOICES[index].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: spec.oscillator,
        cutoff: spec.cutoff,
        gainValue: spec.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.3 }],
      });
    }
    noiseHit(time, 0.014 + lockCount * 0.004, 0.02, 'highpass', 4200, output);
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const from = SECTION_VOICES[sectionMix.from].fire;
    const to = SECTION_VOICES[sectionMix.to].fire;
    const cutoff = lerp(from.cutoff, to.cutoff, sectionMix.t);
    const noise = lerp(from.noise, to.noise, sectionMix.t);
    // The shot is pressure released: it falls a fifth from the chord's root,
    // three octaves up, so the gun retunes as the harmony moves.
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 29), time: time + 0.11 }],
      destination: output,
    });
    noiseHit(time, noise, 0.05, 'bandpass', 1700, output);
  });

  // Non-lethal hits climb the live chord instead of a fixed triad, so a borer
  // being prised out or a brood being opened stays in tune bar to bar.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend) return;
    if (enemyId === parentId) {
      parentMaxHp = Math.max(parentMaxHp, hitPointsRemaining + 1);
      parentChip(1 - hitPointsRemaining / parentMaxHp);
      return;
    }
    const delaySend = mix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.075], [2, 0.055]] as const).forEach(([index, vel], order) => {
      if (!ctx || !output) return;
      chipVoice.play({
        context: ctx,
        time: time + order * SIXTEENTH * 0.5,
        midi: arp[index] + 12,
        vel,
        destination: output,
        sends: [{ destination: delaySend, gain: 0.3 }],
      });
    });
    noiseHit(time, 0.03, 0.05, 'bandpass', 1900, output);
  });

  // Chipping the parent rings a deep, wrong bell where everything else in the
  // level rings clean, and it grows with the damage dealt.
  function parentChip(intensity: number) {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const root = midiToFreq(chord.bass);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.7,
      oscillatorType: 'sine',
      frequency: root * 2,
      frequencyAutomation: [{ type: 'exponentialRamp', value: root * 0.5, time: time + 0.16 }],
      gainAutomation: [
        { type: 'set', value: 0.3 + 0.18 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.6 },
      ],
      destination: output,
    });
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.32,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1700 + 2800 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.04 + 0.022 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
        ],
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.28 }],
      });
    }
    // A beacon climbing the lead set: the fight audibly ratchets to the end.
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.8,
      oscillatorType: 'triangle',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.06 + 0.07 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.75 },
      ],
      destination: output,
      sends: [{ destination: mix.delaySend, gain: 0.5 }],
    });
    noiseHit(time, 0.09 + 0.07 * intensity, 0.1, 'bandpass', 1200, output);
  }

  // The killing blow. The mix ducks for a breath, the infestation's growl slides
  // away downward, and a wide D major bloom opens with a falling peal over it —
  // the level's only fully resolved chord.
  function parentFinale() {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const delaySend = mix.delaySend;
    const reverbSend = mix.reverbSend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(time, 0.18, 2.6);

    // The parasite dragged off and away.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.6,
      oscillatorType: 'sawtooth',
      frequency: midiToFreq(47),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(23), time: time + 1.3 }],
      filter: { type: 'lowpass', frequency: 900 },
      gainAutomation: [
        { type: 'set', value: 0.16, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.5 },
      ],
      destination: output,
    });

    // D major opening through three octaves with a slow filter bloom.
    for (const midi of [38, 50, 57, 62, 66, 69]) {
      for (const detune of [-7, 7]) {
        playOscillatorVoice({
          context: ctx,
          time: time + 0.12,
          stopTime: time + 3.4,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 420, time: time + 0.12 },
              { type: 'linearRamp', value: 2400, time: time + 1.8 },
              { type: 'linearRamp', value: 1100, time: time + 3.4 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.001, time: time + 0.12 },
            { type: 'linearRamp', value: 0.036, time: time + 0.9 },
            { type: 'exponentialRamp', value: 0.001, time: time + 3.3 },
          ],
          destination: output,
          sends: [
            { destination: delaySend, gain: 0.3 },
            ...(reverbSend ? [{ destination: reverbSend, gain: 0.75 }] : []),
          ],
        });
      }
    }

    // The animal's light coming back on, note by note, from the top down.
    [90, 86, 81, 78, 74, 69, 66, 62].forEach((midi, index) => {
      if (!ctx || !output) return;
      const at = time + 0.25 + index * SIXTEENTH * 2;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 1.4,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.001, time: at },
          { type: 'linearRamp', value: 0.13 - index * 0.008, time: at + 0.01 },
          { type: 'exponentialRamp', value: 0.001, time: at + 1.3 },
        ],
        destination: output,
        sends: [
          { destination: delaySend, gain: 0.6 },
          ...(reverbSend ? [{ destination: reverbSend, gain: 0.7 }] : []),
        ],
      });
    });
    noiseHit(time, 0.11, 0.9, 'highpass', 5200, output);
  }

  // Six clean kills in one release: the water itself answers with the chord.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 5 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.9,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2600 },
        gainAutomation: [
          { type: 'set', value: 0.001, time },
          { type: 'linearRamp', value: 0.05, time: time + 0.02 },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.55 }],
      });
    }
    noiseHit(time, 0.07, 0.4, 'highpass', 6200, mix.duck);
  });

  // A refused release: dull, wet and clearly wrong, with none of the sparkle a
  // hit has. The webbing swallowing a shot sounds exactly like this.
  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    for (const [start, end, at, vel] of [
      [196, 62, time, 0.2],
      [147, 44, time + 0.035, 0.15],
    ] as const) {
      rejectVoice.play({
        context: ctx,
        time: at,
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.28 }],
        vel,
        filterStart: 780,
        filterEnd: 220,
        destination: output,
      });
    }
    noiseHit(time, 0.16, 0.16, 'lowpass', 520, output);
    noiseHit(time + 0.04, 0.05, 0.2, 'bandpass', 1500, output);
  });

  // Hull damage: one deliberately out-of-key stab under a low impact.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    impactVoice.play({ context: ctx, time, frequency: 88, destination: output });
    for (const midi of [61, 67] as const) {
      stingVoice.play({ context: ctx, time, midi, destination: output });
    }
    noiseHit(time, 0.2, 0.2, 'bandpass', 780, output);
  });

  // The crown: the parent's arrival turns the music over on the spot, so the
  // player instruments snap to their section rather than crossfading.
  bus.on('spawn', ({ kind, enemyId }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend) return;
    if (kind === 'parent') {
      score.overrideSection(3);
      parentId = enemyId;
      const time = score.nextGridTime(ctx.currentTime);
      riser(time, 1.6);
      for (const [index, midi] of [35, 42].entries()) {
        const at = time + index * 0.5;
        playOscillatorVoice({
          context: ctx,
          time: at,
          stopTime: at + 0.9,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          filter: { type: 'lowpass', frequency: 900 },
          gainAutomation: [
            { type: 'set', value: 0.001, time: at },
            { type: 'linearRamp', value: 0.19, time: at + 0.06 },
            { type: 'exponentialRamp', value: 0.001, time: at + 0.85 },
          ],
          destination: mix.duck,
          sends: [{ destination: mix.delaySend, gain: 0.5 }],
        });
      }
      return;
    }
    if (kind === 'brood') {
      // Each brood squeezed out is a low, wet knock on the grid.
      const time = score.nextGridTime(ctx.currentTime, 1);
      noiseHit(time, 0.11, 0.18, 'lowpass', 700, mix.duck);
    }
  });

  // Every webbing sheet that dies puts one more layer of the animal back on.
  bus.on('bossphase', ({ phase }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend) return;
    if (phase !== 'exposed') return;
    score.clearOverride();
    const time = score.nextGridTime(ctx.currentTime, 2);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const [index, midi] of chord.arp.entries()) {
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.8,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi + 12),
        gainAutomation: [
          { type: 'set', value: 0.001, time: at },
          { type: 'linearRamp', value: 0.08, time: at + 0.01 },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.75 },
        ],
        destination: mix.duck,
        sends: [{ destination: mix.delaySend, gain: 0.6 }],
      });
    }
  });

  // A parasite that got away: the light it was holding stays out. One dull tick.
  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.24,
      oscillatorType: 'sine',
      frequency: 138,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 62, time: time + 0.2 }],
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
      ],
      destination: output,
    });
  });

  return runtime;
}
