import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import { createThermalVoices } from './audio-voices';
import {
  INK_BARS,
  INK_STEPS_PER_BAR,
  INK_TIME,
  THERMAL_INK_BPM,
  THERMAL_SCORE_SECTIONS,
  type ThermalSection,
} from './timing';

// The fight is scored, not accompanied: a slow industrial pulse, a heavy
// bouncing bass, sparse struck metal, and one haunting lead over an 8-bar
// E-minor cycle. Under infrared the noise falls back — drums thin to a sub
// pulse, sonar pings mark the bars, and the melody turns bright and focused.
// Player actions are notes: locks climb the live chord, kills walk hidden
// melody lanes, the core's chips ring an escalating anvil, and the killing
// blow lands a scheduled finale as the lamps return.

const SIXTEENTH = INK_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = INK_STEPS_PER_BAR;
const CYCLE_STEPS = 8 * STEPS_PER_BAR; // 4 chords x 2 bars

// E natural minor: Em — Cmaj7 — Am — Bm, two bars each.
const CHORDS = [
  { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 74] }, // Em7
  { bass: 24, pad: [52, 55, 60, 64], arp: [64, 67, 72, 76] }, // Cmaj7
  { bass: 33, pad: [52, 57, 60, 64], arp: [64, 69, 72, 76] }, // Am
  { bass: 35, pad: [54, 59, 62, 66], arp: [66, 71, 74, 78] }, // Bm
];
type Chord = typeof CHORDS[number];

// Kill lanes: degrees 0–7 into the lead set (arp plus octave). Murk broods
// stepwise, infrared zig-zags high and tight, the finale peals downward.
const MURK_LANE = [
  0, 1, 2, 1, 3, 2, 1, 0,
  2, 3, 4, 3, 5, 4, 3, 2,
  4, 3, 2, 3, 5, 4, 3, 2,
  6, 5, 4, 5, 7, 6, 5, 4,
];
const IR_LANE = [
  4, 6, 5, 7, 4, 6, 5, 7,
  6, 4, 7, 5, 6, 4, 7, 5,
  7, 5, 6, 4, 7, 5, 6, 4,
  5, 7, 6, 7, 4, 5, 6, 7,
];
const FIN_LANE = [
  7, 6, 5, 4, 7, 6, 5, 4,
  6, 5, 4, 3, 6, 5, 4, 3,
  5, 4, 3, 2, 5, 4, 3, 2,
  4, 5, 6, 7, 4, 5, 6, 7,
];
const KILL_LANES: Record<ThermalSection, number[]> = {
  m0: MURK_LANE,
  i1: IR_LANE,
  m1: MURK_LANE,
  i2: IR_LANE,
  m2: MURK_LANE,
  fin: FIN_LANE,
};

// The haunting lead: one 8-bar phrase, sparse, an octave below the kill
// register so chained kills solo above it. [cycleStep, midi, durationSteps].
const MELODY: Array<[number, number, number]> = [
  [0, 64, 12], [12, 62, 4],
  [16, 59, 20],
  [40, 60, 10], [52, 62, 4],
  [56, 64, 24],
  [88, 57, 10], [100, 60, 4],
  [104, 64, 8], [112, 62, 8],
  [120, 66, 20],
];
const melodyByStep = new Map(MELODY.map(([step, midi, dur]) => [step, { midi, dur }]));

type PlayerVoice = {
  kill: { oscillator: OscillatorType; decay: number; cutoff: number; gain: number };
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
};
const MURK_VOICE: PlayerVoice = {
  kill: { oscillator: 'triangle', decay: 0.5, cutoff: 2100, gain: 0.18 },
  lock: { oscillator: 'triangle', cutoff: 1300, gain: 0.13 },
  fire: { cutoff: 1700, noise: 0.04 },
};
const IR_VOICE: PlayerVoice = {
  kill: { oscillator: 'square', decay: 0.3, cutoff: 3300, gain: 0.12 },
  lock: { oscillator: 'sine', cutoff: 4200, gain: 0.17 },
  fire: { cutoff: 3400, noise: 0.05 },
};
const FIN_VOICE: PlayerVoice = {
  kill: { oscillator: 'sawtooth', decay: 0.46, cutoff: 3000, gain: 0.14 },
  lock: { oscillator: 'sine', cutoff: 4200, gain: 0.17 },
  fire: { cutoff: 4000, noise: 0.06 },
};
const SECTION_VOICES: Record<ThermalSection, PlayerVoice> = {
  m0: MURK_VOICE,
  i1: IR_VOICE,
  m1: MURK_VOICE,
  i2: IR_VOICE,
  m2: MURK_VOICE,
  fin: FIN_VOICE,
};
const SECTION_BRIGHT: Record<ThermalSection, number> = { m0: 0.12, i1: 0.9, m1: 0.18, i2: 0.95, m2: 0.25, fin: 1 };

export function createAudio(bus: EventBus) {
  return createThermalAudio(bus).audio;
}

export const traceThermalInkAudio = createAudioTraceHarness({
  level: 'thermal-ink-yk97',
  bpm: THERMAL_INK_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createThermalAudio,
});

function createThermalAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let coreId = -1;
  let coreTotalHp = 0;
  let coreHits = 0;
  const armIds = new Set<number>();

  const score = createScore<Chord, ThermalSection>({
    bpm: THERMAL_INK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: THERMAL_SCORE_SECTIONS,
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
      compressor: { threshold: -17, ratio: 4.5, attack: 0.006, release: 0.24 },
      delay: { time: SIXTEENTH * 3, feedback: 0.32, dampHz: 2100 },
      reverb: { seconds: 2.6, decay: 2.3, level: 0.14 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      coreId = -1;
      coreTotalHp = 0;
      coreHits = 0;
      armIds.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (context) pad(context.currentTime + 0.05, [40, 52, 59, 64, 71], 5, 0.3);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createThermalVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { kick, subKick, bass, pad, lead, anvil, chain, tick, sonar, foghorn, riser, gurgle, boom, noiseHit } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- player voice specs ---------------------------------------------------

  const killLayerVoice = voice<{ pv: PlayerVoice['kill'] }>({
    oscillators: [{ type: ({ pv }) => pv.oscillator, gain: ({ pv }) => pv.gain }],
    duration: ({ pv }) => pv.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ pv }) => pv.cutoff },
    envelope: { decay: ({ pv }) => pv.decay },
  });

  const killBodyVoice = voice<{ decay: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.09 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    envelope: { decay: ({ decay }) => decay * 0.8 },
  });

  const lockVoice = voice<{ pv: PlayerVoice['lock']; lockCount: number }>({
    oscillators: [{ type: ({ pv }) => pv.oscillator, gain: ({ pv }) => pv.gain }],
    duration: 0.12,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ pv, lockCount }) => pv.cutoff + lockCount * 160 },
    envelope: { decay: 0.12 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.085 }],
    duration: 0.09,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.09 },
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.13,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 3600 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
    ],
  });

  // The reject: a short, sour harbor-horn blat — unmistakably negative.
  const rejectHornVoice = voice<{ vel: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5 },
      { type: 'square', gain: 0.35, frequencyRatio: 1.019 },
    ],
    duration: 0.3,
    stopPadding: 0.04,
    filter: { type: 'lowpass', cutoff: 620, Q: 3 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency, time },
      { type: 'exponentialRamp', value: frequency * 0.82, time: time + 0.26 },
    ],
  });

  const impactStabVoice = voice({
    oscillators: [{ type: 'square', gain: 0.06 }],
    duration: 0.24,
    stopPadding: 0.04,
    envelope: { decay: 0.24 },
  });

  // ---- arrangement ----------------------------------------------------------

  const blankBar = '................';
  const padEven = 'P...............' + blankBar;
  const kickMurk = 'K.......k.......';
  const kickDrive = 'K.......k.....k.';
  const heartbeat = 'K..k............';
  const subInk = 'S.......S.......';
  const bassMurk = 'B..b..u.....B.u.';
  const bassLate = 'B..b..u..u..B.u.';
  const tickBar = '..t.....t..t....';
  const anvilTwo = blankBar + '............A...';
  const chainTwo = '......c.........' + blankBar;
  const sonarBar = '........s.......';

  const padTrack = (airy: number) => hits<Chord>(padEven, { P: 1 }, ({ time, chord }) => pad(time, chord.pad, 32 * SIXTEENTH * 1.05, airy));
  const kickTrack = (pattern: string) => hits(pattern, { K: 1, k: 0.82 }, ({ time }, vel) => kick(time, vel));
  const subTrack = () => hits(subInk, { S: 0.9 }, ({ time }, vel) => subKick(time, vel));
  const bassTrack = (pattern: string, bright: number) =>
    hits<Chord>(pattern, { B: 1, b: 0.72, u: 0.8 }, ({ time, chord }, vel, symbol) => {
      bass(time, chord.bass + (symbol === 'u' ? 12 : 0), vel, bright);
    });
  const tickTrack = (vel: number) => hits(tickBar, { t: vel }, ({ time }, velocity) => tick(time, velocity));
  const anvilTrack = () => hits(anvilTwo, { A: 1 }, ({ time }) => anvil(time, 1));
  const chainTrack = () => hits(chainTwo, { c: 1 }, ({ time }) => chain(time, 1));
  const sonarTrack = () => hits<Chord>(sonarBar, { s: 1 }, ({ time, chord }) => sonar(time, midiToFreq(chord.arp[0] + 24), 0.8));

  // The lead reads the 8-bar phrase off the absolute arrangement position so
  // the melody stays in phase with the chord cycle across section boundaries.
  const melodyTrack = (bright: number, vel = 1) => fn<Chord>(({ position, time }) => {
    const note = melodyByStep.get(position % CYCLE_STEPS);
    if (!note) return;
    lead(time, note.midi, note.dur * SIXTEENTH, vel, bright);
  });

  const murkTracks = (kickPattern: string, bassBright: number, withMetal: boolean, melodyBright: number) => [
    padTrack(0),
    kickTrack(kickPattern),
    bassTrack(bassBright > 0.3 ? bassLate : bassMurk, bassBright),
    tickTrack(0.05),
    ...(withMetal ? [anvilTrack(), chainTrack()] : []),
    melodyTrack(melodyBright),
  ];

  const inkTracks = (melodyVel: number) => [
    padTrack(1),
    subTrack(),
    sonarTrack(),
    melodyTrack(0.92, melodyVel),
    oneShot<Chord>(0, 0, ({ time }) => {
      boom(time, 0.9);
      gurgle(time + 0.02, 1.3, 1);
    }),
  ];

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'reveal', fromBar: 0, toBar: 2, tracks: [padTrack(0), kickTrack(kickMurk), melodyTrack(0.1, 0.8), oneShot(0, 0, ({ time }) => foghorn(time, 40, 0.5, 2.2))] },
      { name: 'murk-a', fromBar: 2, toBar: INK_BARS.ink1, tracks: [...murkTracks(kickMurk, 0.1, true, 0.12), oneShot(3, 8, ({ time }) => riser(time, 8 * SIXTEENTH))] },
      { name: 'ink-1', fromBar: INK_BARS.ink1, toBar: INK_BARS.murkB, tracks: inkTracks(1) },
      { name: 'murk-b', fromBar: INK_BARS.murkB, toBar: INK_BARS.ink2, tracks: [...murkTracks(kickDrive, 0.25, true, 0.18), oneShot(0, 0, ({ time }) => foghorn(time, 45, 0.4, 1.6)), oneShot(3, 8, ({ time }) => riser(time, 8 * SIXTEENTH))] },
      { name: 'ink-2', fromBar: INK_BARS.ink2, toBar: INK_BARS.murkC, tracks: inkTracks(1.1) },
      { name: 'murk-c', fromBar: INK_BARS.murkC, toBar: INK_BARS.coreReveal, tracks: [...murkTracks(kickDrive, 0.4, true, 0.25), oneShot(0, 0, ({ time }) => foghorn(time, 45, 0.4, 1.6))] },
      { name: 'core-reveal', fromBar: INK_BARS.coreReveal, toBar: INK_BARS.ink3, tracks: [...murkTracks(kickDrive, 0.5, true, 0.3), oneShot(1, 0, ({ time }) => riser(time, 16 * SIXTEENTH))] },
      { name: 'ink-3', fromBar: INK_BARS.ink3, toBar: INK_BARS.outro, tracks: [...inkTracks(1.25), kickTrack(heartbeat)] },
      {
        name: 'lamps-return',
        fromBar: INK_BARS.outro,
        tracks: [
          melodyTrack(0.2, 0.9),
          oneShot(0, 0, ({ time }) => {
            pad(time, [40, 52, 59, 64, 71], 2.4, 0.4);
            foghorn(time + 0.3, 40, 0.55, 2.0);
          }),
        ],
      },
    ],
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'harbor-idle',
      fromBar: 0,
      tracks: [
        padTrack(0.2),
        hits<Chord>(sonarBar + blankBar, { s: 1 }, ({ time, chord }) => sonar(time, midiToFreq(chord.arp[0] + 24), 0.5)),
        hits(blankBar + tickBar, { t: 0.03 }, ({ time }, vel) => tick(time, vel)),
        oneShot(6, 0, ({ time }) => foghorn(time, 40, 0.35, 2.4)),
      ],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position % (8 * STEPS_PER_BAR), time);
    else {
      runArrangement.schedule(position, time);
      if (position % STEPS_PER_BAR === 0) runArrangement.recordSectionStart(time, position / STEPS_PER_BAR);
    }
  }

  // ---- player instruments ---------------------------------------------------

  function killNote(time: number, position: number, section: ThermalSection, chainIndex: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output) return;
    const lane = KILL_LANES[section];
    const degree = lane[position % lane.length];
    const midi = score.leadSetAt(position)[degree];
    const pv = SECTION_VOICES[section].kill;
    const vel = Math.min(1.4, 1 + chainIndex * 0.13);
    const sends = audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.45 }] : undefined;
    killLayerVoice.play({ context: ctx, time, midi, pv, velocity: vel, destination: output, sends });
    killBodyVoice.play({ context: ctx, time, midi, decay: pv.decay, velocity: vel, destination: output });
    if (chainIndex >= 2) {
      killLayerVoice.play({ context: ctx, time, midi: midi + 12, pv, velocity: vel * 0.45, destination: output, sends });
    }
    noiseHit(time, 0.05, 0.07, 'highpass', 5200, output);
  }

  // Core chips ring a deep anvil that grows with the damage dealt; a beacon
  // note climbs the lead set so the fight audibly ratchets toward the finale.
  function coreChip(intensity: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const rootFreq = midiToFreq(chord.bass + 24);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: rootFreq * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.24 + 0.18 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
      ],
      destination: output,
    });
    anvil(time, 0.6 + 0.5 * intensity);
    const leadSet = score.leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.55,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.06 + 0.08 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
      ],
      destination: output,
      sends: audioMix?.delaySend ? [{ destination: audioMix.delaySend, gain: 0.5 }] : undefined,
    });
  }

  // The killing blow: the music bows out, a sub drop lands on E, a wide chord
  // blooms as the lamps return, and a victory line falls through the delay.
  function coreFinale() {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix) return;
    const delaySend = audioMix.delaySend;
    const time = score.nextGridTime(ctx.currentTime, 2);
    audioMix.duckAt(time, 0.16, 2.0);

    boom(time, 1.1);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.1,
      oscillatorType: 'sine',
      frequency: 164.8,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 41.2, time: time + 0.5 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.0 },
      ],
      destination: output,
    });
    // E-minor bloom through three octaves with a slow filter open.
    for (const midi of [40, 52, 59, 64, 67]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.7,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 600, time },
              { type: 'linearRamp', value: 2500, time: time + 1.0 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.045, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.6 },
          ],
          destination: output,
          sends: delaySend ? [{ destination: delaySend, gain: 0.35 }] : undefined,
        });
      }
    }
    // The melody's last word: a falling E-minor peal, ringing out.
    [88, 86, 83, 79, 76, 71, 67, 64].forEach((midi, index) => {
      if (!ctx || !output) return;
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.55,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 3600 },
        gainAutomation: [
          { type: 'set', value: 0.13 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.5 },
        ],
        destination: output,
        sends: delaySend ? [{ destination: delaySend, gain: 0.55 }] : undefined,
      });
    });
    foghorn(time + 1.2, 40, 0.5, 2.2);
    noiseHit(time, 0.13, 0.6, 'highpass', 5600, output);
  }

  // ---- event wiring ---------------------------------------------------------

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'arm') armIds.add(enemyId);
    if (kind !== 'core' || !ctx) return;
    coreId = enemyId;
    // The mantle opens: a riser and a low two-note warning.
    const mix = runtime.mix();
    const time = score.nextGridTime(ctx.currentTime);
    riser(time, 1.6);
    [52, 58].forEach((midi, index) => {
      if (!ctx || !mix?.duck) return;
      const at = time + index * 0.4;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.55,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1400 },
        gainAutomation: [
          { type: 'set', value: 0.15, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.5 },
        ],
        destination: mix.duck,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.5 }] : undefined,
      });
    });
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === coreId) {
      coreFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position).to, indexInVolley ?? 0);
    if (armIds.delete(enemyId)) {
      // Severing an arm lands a heavy wet thud under the lane note.
      boom(kill.time, 0.7);
      gurgle(kill.time + 0.02, 0.7, 0.8);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const section = score.sectionMixAt(position).to;
    const pv = SECTION_VOICES[section].lock;
    const leadSet = score.leadSetAt(position);
    const midi = leadSet[Math.min(leadSet.length - 1, Math.max(0, lockCount - 1))];
    lockVoice.play({
      context: ctx,
      time,
      midi,
      pv,
      lockCount,
      destination: output,
      sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: section === 'i1' || section === 'i2' || section === 'fin' ? 0.6 : 0.3 }] : undefined,
    });
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const pv = SECTION_VOICES[score.sectionMixAt(position).to].fire;
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff: pv.cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      destination: output,
    });
    noiseHit(time, pv.noise, 0.02, 'highpass', 3000, output);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output) return;
    if (enemyId === coreId) {
      coreTotalHp = Math.max(coreTotalHp, hitPointsRemaining + coreHits + 1);
      coreHits += 1;
      coreChip(Math.min(1, coreHits / Math.max(1, coreTotalHp)));
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    ([[0, 0.07], [1, 0.06], [2, 0.05]] as const).forEach(([index, vel]) => {
      if (!ctx || !output) return;
      chipVoice.play({
        context: ctx,
        time: time + THIRTYSECOND * index,
        midi: arp[index] + 12,
        vel,
        destination: output,
        sends: mix?.delaySend ? [{ destination: mix.delaySend, gain: 0.35 }] : undefined,
      });
    });
    noiseHit(time, 0.035, 0.035, 'highpass', 5400, output);
  });

  // The core's first stage cracking: a heavy anvil and a riser into the rest
  // of the fight.
  bus.on('stage', ({ enemyId }) => {
    if (!ctx || enemyId !== coreId) return;
    const mix = runtime.mix();
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    mix?.duckAt(time, 0.4, 0.7);
    anvil(time, 1.2);
    boom(time, 0.8);
    riser(time + 0.05, 1.2);
  });

  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2300 },
        gainAutomation: [
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: mix.duck,
        sends: mix.delaySend ? [{ destination: mix.delaySend, gain: 0.5 }] : undefined,
      });
    }
    noiseHit(time, 0.08, 0.3, 'highpass', 6400, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    rejectHornVoice.play({ context: ctx, time, frequency: 138, vel: 0.2, destination: output });
    rejectHornVoice.play({ context: ctx, time: time + 0.04, frequency: 92.5, vel: 0.15, destination: output });
    noiseHit(time, 0.12, 0.1, 'bandpass', 540, output);
  });

  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    boom(time, 1);
    // Deliberately out of key: a sour minor-second pair.
    for (const midi of [63, 68]) {
      impactStabVoice.play({ context: ctx, time, midi, destination: output });
    }
    noiseHit(time, 0.18, 0.14, 'bandpass', 880, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.16,
      oscillatorType: 'sine',
      frequency: 120,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 62, time: time + 0.13 }],
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.14 },
      ],
      destination: output,
    });
  });

  return runtime;
}
