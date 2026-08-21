import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createVespersVoices, type VespersVoiceArgs } from './voices';
import {
  VESPERS_BARS,
  VESPERS_BPM,
  VESPERS_SCORE_SECTIONS,
  VESPERS_STEPS_PER_BAR,
  VESPERS_TIME,
} from './timing';

// Vespers is played, not programmed: a held pedal note in D minor, and the
// voices of the organ entering one at a time above it — tenor flute, alto
// principal, then the tune itself — into full choir-and-bell counterpoint for
// the feast. No percussion anywhere: the pulse is the lines moving against
// each other. The silence strips it back to the pedal and one lone flute, the
// rose section builds the tension back up, and the final bar turns the minor
// major. The player's locks, shots, and kills are organ voices too — every
// pitched action snaps to the transport grid and takes its pitch from the
// live harmony, so a chained volley is a melodic run inside the polyphony.

const SIXTEENTH = VESPERS_TIME.stepSeconds;
const STEPS_PER_BAR = VESPERS_STEPS_PER_BAR;
const LINE_STEPS = 64; // four bars: two full chords

// D minor and its diatonic friends. `lead` is the tune register; the score
// extends it an octave up to make the 8-degree kill lanes.
type Chord = { bass: number; pad: readonly number[]; lead: readonly number[] };

const CHORDS: readonly Chord[] = [
  { bass: 38, pad: [50, 53, 57, 60], lead: [62, 65, 69, 74] }, // D minor
  { bass: 34, pad: [46, 50, 53, 58], lead: [65, 70, 74, 77] }, // B flat
  { bass: 41, pad: [53, 57, 60, 65], lead: [69, 72, 77, 81] }, // F major
  { bass: 36, pad: [48, 52, 55, 60], lead: [67, 72, 76, 79] }, // C major
];

// The picardy: bar 21 drops the minor for D major and holds it to the end.
const MAJOR_CHORDS: readonly Chord[] = [
  { bass: 38, pad: [50, 54, 57, 62], lead: [66, 69, 74, 78] }, // D major
];

type SectionIndex = 0 | 1 | 2 | 3;

// Kill lanes: degrees into the current chord's 8-note lead set. Each section
// writes its own contour — a slow chant arch for the processional, octave
// zig-zags for the feast, a gentle descent through the silence, and tolling
// peals for the rose.
const KILL_LANES: Record<SectionIndex, readonly number[]> = {
  0: [
    0, 1, 2, 1, 2, 3, 2, 1,
    2, 3, 4, 3, 4, 3, 2, 1,
    0, 1, 2, 1, 2, 3, 2, 1,
    4, 5, 4, 3, 2, 1, 0, 1,
  ],
  1: [
    0, 4, 2, 6, 1, 5, 3, 7,
    2, 6, 4, 0, 3, 7, 5, 1,
    0, 4, 2, 6, 1, 5, 3, 7,
    4, 7, 6, 5, 3, 2, 1, 0,
  ],
  2: [
    7, 5, 3, 1, 0, 2, 4, 2,
    0, 1, 0, 2, 1, 0, 1, 0,
    3, 2, 1, 0, 2, 1, 0, 1,
    0, 1, 2, 1, 0, 0, 1, 0,
  ],
  3: [
    7, 6, 7, 5, 7, 4, 6, 3,
    7, 5, 6, 4, 7, 3, 5, 2,
    6, 5, 4, 3, 5, 4, 3, 2,
    4, 3, 2, 1, 7, 6, 5, 4,
  ],
};

// Locks climb the D minor pentatonic; the timbre stays a soft chiff all run —
// the lock is a breath on the pipe, not a UI tick.
const LOCK_SCALE = [62, 65, 67, 69, 72, 74, 77, 81];

// Per-section player voicing. The kill is an organ pipe everywhere; it only
// brightens and lengthens as the run deepens.
const SECTION_KILL: Record<SectionIndex, { cutoff: number; gain: number; decay: number; shimmer: number }> = {
  0: { cutoff: 2400, gain: 0.15, decay: 0.7, shimmer: 0.3 },
  1: { cutoff: 3000, gain: 0.16, decay: 0.75, shimmer: 0.45 },
  2: { cutoff: 2000, gain: 0.13, decay: 0.9, shimmer: 0.2 },
  3: { cutoff: 3400, gain: 0.17, decay: 0.8, shimmer: 0.6 },
};

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-1izg',
  bpm: VESPERS_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 63,
  createAudio: createVespersAudio,
});

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let heartId = -1;

  const score = createScore<Chord, SectionIndex>({
    bpm: VESPERS_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: VESPERS_BARS.ignition, chords: MAJOR_CHORDS, barsPerChord: 1 }],
    sections: VESPERS_SCORE_SECTIONS,
    leadSet: (chord) => [...chord.lead, ...chord.lead.map((midi) => midi + 12)],
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
      compressor: { threshold: -20, ratio: 4, attack: 0.008, release: 0.3 },
      // Cathedral acoustics: a long slap off the far wall plus a deep stone
      // reverb everything lives in.
      delay: { time: SIXTEENTH * 6, feedback: 0.28, dampHz: 2100 },
      reverb: { seconds: 3.4, decay: 2.6, level: 0.6 },
      noiseSeconds: 3,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      heartId = -1;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      const mix = runtime.mix();
      if (!context || !mix) return;
      // The last chord keeps ringing after the run ends: D major, wide.
      pad(context.currentTime + 0.05, MAJOR_CHORDS[0].pad, 5.5, 1);
    },
    onDispose() {
      ctx = null;
    },
  });

  // ---- musical position ----------------------------------------------------

  // ---- voices -------------------------------------------------------------

  const voices = createVespersVoices({
    trace,
    context: () => ctx,
    musicBus: () => {
      const mix = runtime.mix();
      if (!mix) return null;
      return { duck: mix.duck, reverbSend: mix.reverbSend, delaySend: mix.delaySend, noiseBuffer: mix.noiseBuffer };
    },
  }) as VespersVoiceArgs;

  const sfx = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;
  const sends = () => {
    const mix = runtime.mix();
    if (!mix?.delaySend || !mix.reverbSend) return [];
    return [
      { destination: mix.delaySend, gain: 0.4 },
      { destination: mix.reverbSend, gain: 0.5 },
    ];
  };

  // Player instruments. The kill is a full organ pipe: fundamental, octave,
  // quint, and a bright reed layer — a chord in one note, the way a big
  // organ sounds when you pull all the stops.
  const killFundamental = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', gain: 1 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.1,
    envelope: { attack: 0.012, decay: ({ decay }) => decay, sustain: 0.28, release: ({ decay }) => decay * 0.5 },
  });
  const killOctave = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: 1, gain: 0.5 }],
    duration: ({ decay }) => decay * 0.8,
    stopPadding: 0.1,
    envelope: { attack: 0.01, decay: ({ decay }) => decay * 0.8, sustain: 0.2, release: 0.3 },
  });
  const killQuint = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'triangle', midiOffset: 19, gain: 0.3 }],
    duration: ({ decay }) => decay * 0.6,
    stopPadding: 0.1,
    envelope: { decay: ({ decay }) => decay * 0.6 },
  });
  const killReed = voice<{ cutoff: number; gain: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.14 }],
    duration: 0.3,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.28 },
  });
  const lockChiff = voice<{ gainValue: number; lockCount: number }>({
    oscillators: [{ type: 'triangle', gain: 1 }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ lockCount }) => 2200 + lockCount * 200 },
    envelope: { attack: 0.004, decay: 0.09 },
  });
  const fireBreath = voice<{ from: number; to: number }>({
    oscillators: [{ type: 'sine', gain: 0.085 }],
    duration: 0.09,
    stopPadding: 0.02,
    frequencyAutomation: (time, _frequency, { from, to }) => [
      { type: 'set', value: midiToFreq(from), time },
      { type: 'exponentialRamp', value: midiToFreq(to), time: time + 0.08 },
    ],
    envelope: { decay: 0.09 },
  });
  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 1 }],
    duration: 0.16,
    stopPadding: 0.03,
    envelope: { decay: 0.15 },
  });
  const rejectThud = voice<{ from: number; to: number; vel: number }>({
    oscillators: [{ type: 'sine', gain: 1 }],
    duration: 0.3,
    stopPadding: 0.03,
    frequencyAutomation: (time, _frequency, { from, to }) => [
      { type: 'set', value: from, time },
      { type: 'exponentialRamp', value: to, time: time + 0.24 },
    ],
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });
  const impactStab = voice({
    oscillators: [{ type: 'sawtooth', gain: 0.05 }],
    duration: 0.3,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 900 },
    envelope: { decay: 0.28 },
  });

  function pad(time: number, midis: readonly number[], dur: number, vel: number) {
    for (const midi of midis) voices.choir(time, midi, vel, dur);
  }

  // ---- counterpoint lines --------------------------------------------------
  // Each line is a degree contour over the current chord's lead set, written
  // as 16-step bars. Degrees (not absolute pitches), so every line re-voices
  // consonantly as the harmony moves — the counterpoint is real: the lines
  // were written against each other, and they never leave the chord.

  const bar = (...bars: string[]) => bars.join('');

  const SOPRANO = bar(
    '0...0...2...0...',
    '1.......2.......',
    '3...2...1...0...',
    '2...............',
  );
  const TENOR = bar(
    '....1...1...0...',
    '.1...0...1......',
    '....2...1...2...',
    '0.......1.......',
  );
  const ALTO = bar(
    '..2..3..2..1..0.',
    '..1..2..1..0.1..',
    '..4..3..2..3..2.',
    '..1..0..1..2..1.',
  );
  const SILENCE_LINE = bar(
    '0...............',
    '................',
    '1...............',
    '................',
  );
  const ROSE_OSTINATO = '0.0.2.0.1.0.2.1.4.3.2.1.0.1.2.0.';

  const PEDAL_PATTERN = bar('P...............', '................');
  const CHOIR_PATTERN = bar('C...............', '................');
  const BELL_FEAST = bar('B...............', '................');
  const BELL_EACH_BAR = 'B...............';

  const lineTrack = (pattern: string, vel: number, durSteps: number, play: VespersVoiceArgs['soprano']) =>
    hits<Chord>(pattern, { '0': vel, '1': vel, '2': vel, '3': vel, '4': vel, '5': vel, '6': vel, '7': vel }, ({ time: at, chord }, velocity, symbol) => {
      play(at, chord.lead[Number(symbol)], velocity, durSteps * SIXTEENTH * 0.95);
    });

  const pedalTrack = () => hits<Chord>(PEDAL_PATTERN, { P: 1 }, ({ time: at, chord }) => voices.pedal(at, chord.bass, 1, 32 * SIXTEENTH * 1.02));
  const choirTrack = (vel: number) => hits<Chord>(CHOIR_PATTERN, { C: 1 }, ({ time: at, chord }, velocity) => {
    for (const midi of chord.pad) voices.choir(at, midi, velocity * vel, 32 * SIXTEENTH * 1.05);
  });
  const bellFeastTrack = () => hits<Chord>(BELL_FEAST, { B: 1 }, ({ time: at, chord }) => voices.bell(at, chord.bass + 24, 0.9));
  const bellBarTrack = () => hits<Chord>(BELL_EACH_BAR, { B: 1 }, ({ time: at, chord }, velocity) => voices.bell(at, chord.bass + 24, velocity));

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        pedalTrack(),
        hits<Chord>(SILENCE_LINE, { '0': 0.35, '1': 0.35 }, ({ time: at, chord }, vel, symbol) => voices.flute(at, chord.lead[Number(symbol)], vel, 32 * SIXTEENTH)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      // Bar 0: the pedal alone, a dark room and one held note.
      { name: 'pedal', fromBar: VESPERS_BARS.run, toBar: VESPERS_BARS.voice2, tracks: [pedalTrack()] },
      // Bar 2: the tenor flute answers.
      { name: 'voice-2', fromBar: VESPERS_BARS.voice2, toBar: VESPERS_BARS.voice3, tracks: [pedalTrack(), lineTrack(TENOR, 0.8, 4, voices.flute)] },
      // Bar 4: the alto principal steps in against it.
      { name: 'voice-3', fromBar: VESPERS_BARS.voice3, toBar: VESPERS_BARS.voice4, tracks: [pedalTrack(), lineTrack(TENOR, 0.8, 4, voices.flute), lineTrack(ALTO, 0.55, 2, voices.principal)] },
      // Bar 6: the tune itself, at last.
      { name: 'voice-4', fromBar: VESPERS_BARS.voice4, toBar: VESPERS_BARS.feast, tracks: [pedalTrack(), lineTrack(TENOR, 0.8, 4, voices.flute), lineTrack(ALTO, 0.55, 2, voices.principal), lineTrack(SOPRANO, 0.9, 4, voices.soprano)] },
      // Feast: everyone, with choir weight and bell on the two-bar swells.
      { name: 'feast', fromBar: VESPERS_BARS.feast, toBar: VESPERS_BARS.silence, tracks: [pedalTrack(), lineTrack(TENOR, 0.85, 4, voices.flute), lineTrack(ALTO, 0.6, 2, voices.principal), lineTrack(SOPRANO, 1, 4, voices.soprano), choirTrack(1), bellFeastTrack()] },
      // The silence: pedal and one lone flute, almost nothing.
      { name: 'silence', fromBar: VESPERS_BARS.silence, toBar: VESPERS_BARS.rose, tracks: [pedalTrack(), lineTrack(SILENCE_LINE, 0.5, 32, voices.flute)] },
      // The rose: harmonic rhythm doubles, the ostinato grinds, a bell tolls
      // every bar, and a two-bar riser leads into the tutti.
      {
        name: 'rose',
        fromBar: VESPERS_BARS.rose,
        toBar: VESPERS_BARS.tutti,
        tracks: [
          pedalTrack(),
          lineTrack(ROSE_OSTINATO, 0.6, 2, voices.principal),
          lineTrack(SOPRANO, 0.85, 4, voices.soprano),
          bellBarTrack(),
          oneShot(2, 0, ({ time: at }) => voices.riser(at, 2 * 16 * SIXTEENTH)),
        ],
      },
      // Tutti: every rank open for the ignition and the major turn.
      { name: 'tutti', fromBar: VESPERS_BARS.tutti, tracks: [pedalTrack(), lineTrack(TENOR, 0.9, 4, voices.flute), lineTrack(ALTO, 0.65, 2, voices.principal), lineTrack(SOPRANO, 1, 4, voices.soprano), choirTrack(1.15), bellBarTrack()] },
    ],
  });

  function scheduleStep({ position, time: at, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, at);
    else runArrangement.schedule(position, at);
  }

  // ---- the player's organ ----------------------------------------------

  function killNote(time: number, position: number, sectionMix: SectionMix<SectionIndex>, chain: number) {
    const output = sfx();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend || !mix.reverbSend) return;
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LINE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const fromVoice = SECTION_KILL[sectionMix.from];
    const toVoice = SECTION_KILL[sectionMix.to];
    const vel = Math.min(1.35, 1 + chain * 0.1);
    const decay = lerp(fromVoice.decay, toVoice.decay, sectionMix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, sectionMix.t);
    const cutoff = lerp(fromVoice.cutoff, toVoice.cutoff, sectionMix.t);
    const shimmer = lerp(fromVoice.shimmer, toVoice.shimmer, sectionMix.t);
    const playerSends = sends();

    killFundamental.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output, sends: playerSends });
    killOctave.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output, sends: playerSends });
    killQuint.play({ context: ctx, time, midi, decay, gain, velocity: vel, destination: output, sends: playerSends });
    killReed.play({ context: ctx, time, midi, cutoff, gain: 1, velocity: 0.5 * vel * (0.4 + shimmer), destination: output });
    voices.noise(time, 0.025 * shimmer + 0.012, 0.05, 'highpass', 5200);
  }

  // Breaking the heart: the whole organ opens at once. The music bows out
  // for a breath, then D major blooms through the full instrument while a
  // peal falls from the top of the register — the biggest single event in
  // the level, matched by the rose window igniting on screen.
  function ignition() {
    const output = sfx();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.duck || !mix.delaySend || !mix.reverbSend) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(time, 0.12, 2.4);
    const major = MAJOR_CHORDS[0];
    const delaySend = mix.delaySend;
    const reverbSend = mix.reverbSend;

    // Sub drop onto the tonic.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.4,
      oscillatorType: 'sine',
      frequency: midiToFreq(major.bass - 12),
      gainAutomation: [
        { type: 'set', value: 0.4, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.3 },
      ],
      destination: output,
    });
    // Full D major through opening filters.
    for (const midi of [major.bass, ...major.pad, 66, 74]) {
      for (const detune of [-7, 7]) {
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
              { type: 'set', value: 500, time },
              { type: 'linearRamp', value: 3200, time: time + 1.6 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.038, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 3.0 },
          ],
          destination: output,
          sends: [
            { destination: delaySend, gain: 0.3 },
            { destination: reverbSend, gain: 0.55 },
          ],
        });
      }
    }
    // Victory peal: D major falling from the top, bell-voiced.
    [90, 86, 81, 78, 74, 69, 66].forEach((midi, index) => {
      if (!ctx || !output) return;
      const at = time + index * SIXTEENTH * 2;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 1.6,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.11 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 1.4 },
        ],
        destination: output,
        sends: [
          { destination: delaySend, gain: 0.5 },
          { destination: reverbSend, gain: 0.6 },
        ],
      });
    });
    voices.bell(time, major.bass + 24, 1.2);
    voices.noise(time, 0.1, 0.8, 'highpass', 6000);
  }

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (heartId === enemyId) {
      ignition();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfx();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.reverbSend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = score.quantizePlayerAction(ctx.currentTime);
    lockChiff.play({
      context: ctx,
      time,
      midi,
      gainValue: 0.08,
      lockCount,
      destination: output,
      sends: [{ destination: mix.reverbSend, gain: 0.35 }],
    });
    voices.noise(time, 0.02, 0.03, 'bandpass', 3200);
  });

  bus.on('fire', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const root = score.chordAt(position).bass;
    fireBreath.play({ context: ctx, time, frequency: midiToFreq(root + 24), from: root + 24, to: root + 12, destination: output });
    voices.noise(time, 0.035, 0.03, 'bandpass', 850);
  });

  bus.on('hit', ({ lethal }) => {
    const output = sfx();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.reverbSend) return;
    const reverbSend = mix.reverbSend;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    ([[0, 0.06], [2, 0.05]] as const).forEach(([index, vel], i) => {
      if (!ctx || !output) return;
      chipVoice.play({
        context: ctx,
        time: time + SIXTEENTH * 0.25 * i,
        midi: chord.lead[index] + 12,
        vel,
        destination: output,
        sends: [{ destination: reverbSend, gain: 0.4 }],
      });
    });
    voices.noise(time, 0.03, 0.04, 'highpass', 5000);
  });

  // A clean sweep of four or more earns a bell: the building itself approves.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.bell(time, chord.bass + 24, 0.8);
    pad(time, chord.pad, 1.6, 0.5);
  });

  bus.on('reject', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // A dead, dry thud with a sour second — the one moment the organ refuses
    // to speak. Deliberately outside the reverb.
    rejectThud.play({ context: ctx, time, frequency: 92, from: 92, to: 44, vel: 0.2, destination: output });
    rejectThud.play({ context: ctx, time: time + 0.03, frequency: 97, from: 97, to: 49, vel: 0.1, destination: output });
    voices.noise(time, 0.1, 0.08, 'lowpass', 500);
  });

  // Hull hit: stone-deep boom under a tritone stab — the only out-of-key
  // sound in the level.
  bus.on('playerhit', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    rejectThud.play({ context: ctx, time, frequency: 70, from: 70, to: 32, vel: 0.34, destination: output });
    for (const midi of [57, 63]) {
      impactStab.play({ context: ctx, time, midi, destination: output });
    }
    voices.noise(time, 0.16, 0.16, 'bandpass', 700);
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    const mix = runtime.mix();
    if (kind !== 'heart' || !ctx || !mix?.duck) return;
    score.overrideSection(3);
    heartId = enemyId;
    const time = score.nextGridTime(ctx.currentTime);
    voices.pedal(time, 26, 1.3, 3);
    voices.bell(time, 50, 1.1);
    voices.noise(time, 0.06, 0.5, 'lowpass', 900);
  });

  bus.on('miss', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    voices.noise(time, 0.035, 0.12, 'lowpass', 420);
  });

  return runtime;
}
