import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createStrandlineVoices } from './audio-voices';
import {
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
} from './timing';

// Strandline is scored like the animal it is set inside. A slow pulse comes
// first — the jelly's heart, a lub-dub every two beats. Every stretch of the
// run adds another layer of the score as more of the animal comes back to
// life: pad, bells, bass, surf, groove. The parasites carry a sour undertow
// (a semitone and a tritone against the tonic) that thins as their webbing
// dies back, and when the parent lets go the pulse resolves into a slow,
// serene D major.
//
// The player is the soloist: locks climb the live chord, fire falls from its
// root, and kills read a hidden melody lane so a chained volley plays a
// written phrase — always on the transport's grid, always in the harmony.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const BAR = STRANDLINE_TIME.barSeconds;
const STEPS_PER_BAR = STRANDLINE_STEPS_PER_BAR;
const LANE_STEPS = 32;

type Chord = { name: string; bass: number; pad: number[]; arp: number[] };

const D: Chord = { name: 'Dmaj9', bass: 50, pad: [62, 66, 69, 73, 76], arp: [69, 73, 76, 78] };
const BM: Chord = { name: 'Bm9', bass: 47, pad: [59, 62, 66, 69, 73], arp: [69, 71, 74, 78] };
const G: Chord = { name: 'Gmaj7', bass: 43, pad: [55, 59, 62, 66, 69], arp: [71, 74, 78, 81] };
const A: Chord = { name: 'Aadd9', bass: 45, pad: [57, 61, 64, 66, 69], arp: [69, 73, 76, 81] };
const G_LYD: Chord = { name: 'Gmaj7#11', bass: 43, pad: [55, 59, 62, 66, 73], arp: [71, 74, 78, 81] };

// One chord per two bars, twelve chords for twenty-four bars:
// D · Bm · G · A | D (the moon) · Bm · then the crown: G · Bm · G · A | D · D.
const CHORDS: Chord[] = [D, BM, G, A, D, BM, G_LYD, BM, G, A, D, D];

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Hidden melody lanes: degrees into the current chord's lead set (the arp plus
// the same notes an octave up). Any step on any bar lands on a chord tone.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // dim — a lullaby: slow arches that never leave the chord.
  0: [
    0, 1, 2, 1, 2, 3, 2, 1,
    0, 1, 2, 3, 4, 3, 2, 1,
    1, 2, 3, 2, 3, 4, 3, 2,
    2, 3, 4, 5, 4, 3, 2, 0,
  ],
  // stir — the first glow: rising thirds with a turn at the top of each bar.
  1: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 3, 4, 2, 3, 1, 2, 0,
    1, 3, 2, 4, 3, 5, 4, 6,
    5, 4, 5, 3, 4, 2, 3, 1,
  ],
  // bloom — glitter falling from the top of the register.
  2: [
    7, 5, 6, 4, 5, 3, 4, 2,
    6, 4, 5, 3, 4, 2, 3, 1,
    7, 6, 5, 6, 4, 5, 3, 4,
    5, 3, 4, 2, 3, 1, 2, 0,
  ],
  // tide — syncopated zig-zag broken chords; dense volleys ring as fast runs.
  3: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 2, 6, 1, 5, 3, 7,
    7, 3, 6, 2, 5, 1, 4, 0,
  ],
  // crown — tolling peals, descending with a climb back: chips ring like bowls.
  4: [
    7, 4, 5, 2, 6, 3, 4, 1,
    5, 2, 3, 0, 4, 1, 2, 0,
    7, 5, 6, 4, 5, 3, 4, 2,
    3, 1, 2, 0, 4, 5, 6, 7,
  ],
};

// The player's instruments by act. Gains are set for equal perceived loudness,
// not equal numbers: a triangle body needs more gain than a sine to sit at the
// same level, and every voice has its own tuned value.
type PlayerVoice = {
  kill: { type: OscillatorType; decay: number; gain: number; partials: number; sparkle: number; cutoff: number };
  lock: { type: OscillatorType; gain: number; cutoff: number; decay: number };
  fire: { cutoff: number; noise: number };
};

const PLAYER_VOICES: Record<SectionIndex, PlayerVoice> = {
  0: {
    kill: { type: 'sine', decay: 0.55, gain: 0.15, partials: 0.25, sparkle: 0.2, cutoff: 3600 },
    lock: { type: 'sine', gain: 0.1, cutoff: 3000, decay: 0.22 },
    fire: { cutoff: 1500, noise: 0.03 },
  },
  1: {
    kill: { type: 'sine', decay: 0.5, gain: 0.155, partials: 0.5, sparkle: 0.4, cutoff: 4200 },
    lock: { type: 'triangle', gain: 0.12, cutoff: 3200, decay: 0.2 },
    fire: { cutoff: 1900, noise: 0.04 },
  },
  2: {
    kill: { type: 'sine', decay: 0.62, gain: 0.15, partials: 0.75, sparkle: 0.9, cutoff: 5200 },
    lock: { type: 'triangle', gain: 0.115, cutoff: 3800, decay: 0.2 },
    fire: { cutoff: 2600, noise: 0.05 },
  },
  3: {
    kill: { type: 'triangle', decay: 0.34, gain: 0.19, partials: 0.6, sparkle: 0.55, cutoff: 3800 },
    lock: { type: 'triangle', gain: 0.13, cutoff: 3400, decay: 0.16 },
    fire: { cutoff: 2300, noise: 0.055 },
  },
  4: {
    kill: { type: 'triangle', decay: 0.5, gain: 0.2, partials: 0.9, sparkle: 0.25, cutoff: 3000 },
    lock: { type: 'triangle', gain: 0.12, cutoff: 2600, decay: 0.18 },
    fire: { cutoff: 1700, noise: 0.05 },
  },
};

// Where the "bar" of each piece of the arrangement lives, for readability.
const BARS = STRANDLINE_BARS;

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-2nqi',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createStrandlineAudio,
});

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;

  // Live state the run writes into the score: how much of the parasite
  // undertow is left, whether the parent is bare, and where the serene
  // resolution begins.
  const state = {
    broodKills: 0,
    infection: 1,
    exposed: false,
    resolveFrom: -1,
    parentId: -1,
    stageBreaks: 0,
  };
  const kindById = new Map<number, string>();

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    sections: STRANDLINE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.95,
    score,
    runAlignment: 'step',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -20, ratio: 4, attack: 0.008, release: 0.28 },
      delay: { time: SIXTEENTH * 3, feedback: 0.36, dampHz: 2400, sendGain: 1 },
      reverb: { seconds: 3.4, decay: 2.6, level: 0.5, returnTo: 'duck' },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      state.broodKills = 0;
      state.infection = 1;
      state.exposed = false;
      state.resolveFrom = -1;
      state.parentId = -1;
      state.stageBreaks = 0;
      kindById.clear();
      score.clearOverride();
    },
    onRunEnd() {
      score.clearOverride();
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createStrandlineVoices({ trace, context: () => ctx, mix: runtime.mix });
  const { heart, kick, tok, swish, bass, pad, bell, riser, dive, bloomHit, crownHit, drone, glint, tone, swell, noiseHit } = voices;
  const sfx = () => voices.sfxDestination();

  // ---- the arrangement -------------------------------------------------------------
  // Every pattern is one bar of sixteenths per 16 characters.

  const HEART = 'P..p....P..p....';
  const HEART_HALF = 'P..p............';
  const HEART_FAST = 'P.p.P.p.P.p.P.p.';
  const KICK_TIDE = 'K.......K..k..K.';
  const KICK_CROWN = 'K.......K.......';
  const OFFBEAT_SWISH = '..s...s...s...s.';
  const SIXTEENTH_SWISH = 'sxsxsxsxsxsxsxsx';
  const TOK = '....t.......t...';
  const ARP_EIGHTHS = 'A.A.A.A.A.A.A.A.';
  const ARP_SIXTEENTHS = 'AaAaAaAaAaAaAaAa';
  const ARP_SPARSE = 'A...a...A.a.....';
  const BASS_LONG = 'B...............';
  const BASS_STIR = 'B.....b.B.......';
  const BASS_TIDE = 'B..b..b.B.b...b.';
  const BASS_CROWN = 'B.......b.......';
  const ARP_ORDER = [0, 2, 1, 3, 2, 0, 3, 1];

  const chordPad = (bright: number) => fn<Chord>(({ bar, step, time, chord }) => {
    if (bar % 2 === 0 && step === 0) pad(time, chord.pad, BAR * 2 + 0.3, bright);
  });

  const heartTrack = (pattern: string, vel = 1) => hits<Chord>(pattern, { P: 1, p: 0.58 }, ({ time }, velocity, symbol) => {
    heart(time, velocity * vel, symbol === 'p' ? 1 : 0);
  });

  const kickTrack = (pattern: string, vel = 1) => hits<Chord>(pattern, { K: 1, k: 0.7 }, ({ time }, velocity) => kick(time, velocity * vel));

  const swishTrack = (pattern: string, vel: number) => hits<Chord>(pattern, { s: vel, x: vel * 0.45 }, ({ time }, velocity, symbol) => {
    swish(time, velocity, symbol === 's' ? 0.09 : 0.035);
  });

  const tokTrack = (vel = 1) => hits<Chord>(TOK, { t: vel }, ({ time }, velocity) => tok(time, velocity));

  const bassTrack = (pattern: string, decay: number, vel = 1) => hits<Chord>(pattern, { B: vel, b: vel * 0.7 }, ({ time, chord }, velocity, symbol) => {
    bass(time, chord.bass + (symbol === 'b' ? 12 : 0), velocity, decay);
  });

  // Backing bells stay below the register the player's kill lane owns.
  const bellTrack = (pattern: string, vel: number, decay = 0.45) => hits<Chord>(pattern, { A: vel, a: vel * 0.6 }, ({ time, step, chord }, velocity) => {
    bell(time, chord.arp[ARP_ORDER[Math.floor(step / 2) % ARP_ORDER.length]] - 12, velocity, decay);
  });

  // Sparse glass in the dim: one note a bar, and a rising answer every fourth.
  const dimBells = fn<Chord>(({ bar, step, time, chord }) => {
    if (step === 0) bell(time, chord.arp[bar % 4] - 12, 0.5, 0.9);
    if (step === 10 && bar % 4 === 3) bell(time, chord.arp[3], 0.32, 1.1);
  });

  // The dead water shimmers back: on the bloom, the arp cascades in glitter.
  const sparkleTrack = (vel: number) => fn<Chord>(({ step, time, chord, bar }) => {
    if (step % 2 !== 0) return;
    const index = ((step / 2) + bar * 3) % 8;
    const lead = [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
    glint(time, lead[index], vel * (step % 4 === 0 ? 1 : 0.6));
  });

  const droneTrack = fn<Chord>(({ step, time, chord }) => {
    if (step === 0) drone(time, chord.bass, BAR, state.infection);
  });

  // As the webbing dies back the crown's bells wake up.
  const crownBells = fn<Chord>(({ step, time, chord, position }) => {
    const wake = 1 - state.infection;
    if (step % 4 === 2 && wake > 0.25 && (position + step) % 3 !== 0) {
      bell(time, chord.arp[(position >> 2) % 4], 0.22 + wake * 0.34, 0.7);
    }
    if (step === 0) bell(time, chord.arp[0] - 12, 0.4, 0.9);
    if (step === 8) bell(time, chord.arp[2] - 12, 0.3, 0.8);
  });

  const exposedTrack = fn<Chord>(({ step, time, chord, bar }) => {
    if (!state.exposed) return;
    if (step === 0) pad(time, chord.pad.map((midi) => midi + 12), BAR + 0.2, 0.9);
    if (step % 4 === 0) glint(time, chord.arp[(step / 4 + bar) % 4] + 12, 0.45);
  });

  // ---- sections ---------------------------------------------------------------------

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      // The strands are dark. The pulse, a slow pad, a few notes of glass.
      { name: 'dim', fromBar: BARS.dim, toBar: BARS.stir, tracks: [chordPad(0.05), heartTrack(HEART, 0.7), dimBells] },
      // First glow: bass, surf, a wooden knock, bells in eighths.
      {
        name: 'stir',
        fromBar: BARS.stir,
        toBar: BARS.swing,
        tracks: [chordPad(0.22), heartTrack(HEART, 0.95), bassTrack(BASS_LONG, 1.6, 0.8), swishTrack(OFFBEAT_SWISH, 0.05), tokTrack(0.55), bellTrack(ARP_EIGHTHS, 0.32)],
      },
      // The rail leaves the forest: pad brightens, riser toward the moon.
      {
        name: 'swing',
        fromBar: BARS.swing,
        toBar: BARS.bloom,
        tracks: [
          chordPad(0.4),
          heartTrack(HEART, 1),
          bassTrack(BASS_STIR, 1.1, 0.9),
          swishTrack(OFFBEAT_SWISH, 0.07),
          tokTrack(0.7),
          bellTrack(ARP_EIGHTHS, 0.38),
          oneShot(1, 0, ({ time }) => riser(time, BAR)),
          // last beat of bar 7: surf rolls
          fn<Chord>(({ barInSection, step, time }) => {
            if (barInSection === 1 && step >= 12) swish(time, 0.09 + (step - 12) * 0.02, 0.05);
          }),
        ],
      },
      // The moon. The bell fills the sky and the D chord opens like a hand.
      {
        name: 'bloom',
        fromBar: BARS.bloom,
        toBar: BARS.tide,
        tracks: [
          chordPad(0.85),
          heartTrack(HEART, 1),
          kickTrack(KICK_TIDE, 0.6),
          bassTrack(BASS_STIR, 1.3, 0.95),
          swishTrack(SIXTEENTH_SWISH, 0.06),
          tokTrack(0.6),
          sparkleTrack(0.6),
          oneShot(0, 0, ({ time, chord }) => bloomHit(time, [...chord.pad, chord.pad[0] + 12, chord.pad[2] + 12, chord.pad[4] + 12])),
          // the swing ends: surf falls away into the dive (bar 9 beat 3)
          oneShot(1, 8, ({ time }) => dive(time, BAR * 0.5)),
        ],
      },
      // The dive back in: groove, knock, syncopated bass, bells in sixteenths.
      {
        name: 'tide',
        fromBar: BARS.tide,
        toBar: BARS.crown,
        tracks: [
          chordPad(0.6),
          heartTrack(HEART, 0.7),
          kickTrack(KICK_TIDE, 1),
          bassTrack(BASS_TIDE, 0.28, 1),
          swishTrack(SIXTEENTH_SWISH, 0.075),
          tokTrack(1),
          bellTrack(ARP_SIXTEENTHS, 0.36, 0.3),
          oneShot(0, 0, ({ time }) => swish(time, 0.16, 0.6)),
        ],
      },
      // The crown. Half-time weight, the violet undertow, the pulse alone in the cold.
      {
        name: 'crown',
        fromBar: BARS.crown,
        tracks: [
          chordPad(0.18),
          droneTrack,
          heartTrack(HEART, 0.9),
          kickTrack(KICK_CROWN, 0.85),
          bassTrack(BASS_CROWN, 1.5, 0.9),
          crownBells,
          swishTrack(SIXTEENTH_SWISH, 0.035),
          oneShot(0, 0, ({ time }) => crownHit(time)),
          oneShot(0, 8, ({ time }) => riser(time, BAR * 0.5)),
          exposedTrack,
        ],
      },
    ],
  });

  // The resolution: no drums, a warm pad, glass falling slowly through it, and
  // the pulse — once fast, now slow enough to rest on.
  const SERENE_CHORDS: Chord[] = [D, G, D, BM];
  const sereneChordAt = (position: number) => SERENE_CHORDS[Math.floor(position / (STEPS_PER_BAR * 2)) % SERENE_CHORDS.length];
  const sereneTracks = (level: number) => [
    fn<Chord>(({ bar, step, time, chord }) => {
      if (bar % 2 === 0 && step === 0) pad(time, chord.pad.concat(chord.pad[0] + 12), BAR * 2 + 0.4, 0.5 * level + 0.15);
    }),
    hits<Chord>('P...............' + '................', { P: 0.6 * level }, ({ time }, velocity) => heart(time, velocity, 0)),
    fn<Chord>(({ step, time, chord, bar }) => {
      // pentatonic twinkle, one high note every two beats, walking up the chord
      if (step % 8 === 4) bell(time, chord.arp[(bar * 2 + Math.floor(step / 8)) % 4] + 12, 0.3 * level + 0.1, 1.4);
      if (step === 0) bass(time, chord.bass - 12, 0.7 * level, 2.6);
    }),
  ];
  const sereneArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: sereneChordAt,
    sections: [{ name: 'serene', fromBar: 0, tracks: sereneTracks(1) }],
  });
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: sereneChordAt,
    sections: [{ name: 'ambient', fromBar: 0, tracks: sereneTracks(0.6) }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      ambientArrangement.schedule(position, time);
      return;
    }
    if (state.resolveFrom >= 0) {
      if (position >= state.resolveFrom) sereneArrangement.schedule(position - state.resolveFrom, time);
      return;
    }
    runArrangement.schedule(position, time);
  }

  // ---- the player's instruments ----------------------------------------------------------

  const layersFor = (mix: SectionMix<SectionIndex>): Array<[SectionIndex, number]> =>
    mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];

  const actionTime = () => (ctx ? score.quantizePlayerAction(ctx.currentTime) : 0);

  function killNote(time: number, position: number, mix: SectionMix<SectionIndex>, chain: number, kind: string | undefined) {
    const output = sfx();
    if (!ctx || !output) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    const from = PLAYER_VOICES[mix.from].kill;
    const to = PLAYER_VOICES[mix.to].kill;
    const voice = mix.t >= 0.5 ? to : from;
    const vel = Math.min(1.35, 1 + chain * 0.1) * (kind === 'spore' ? 0.55 : kind === 'brood' ? 1.1 : 1);
    const decay = lerp(from.decay, to.decay, mix.t) * (kind === 'leech' ? 0.7 : kind === 'brooder' ? 1.2 : 1);
    const gain = lerp(from.gain, to.gain, mix.t) * vel;
    const partials = lerp(from.partials, to.partials, mix.t);
    const sparkle = lerp(from.sparkle, to.sparkle, mix.t);

    // fundamental + a body an octave down that keeps the pluck from being thin
    tone({ time, midi, type: voice.type, gain, decay, cutoff: voice.cutoff, delaySend: 0.42, reverbSend: 0.3, destination: output });
    tone({ time, midi: midi - 12, gain: gain * 0.5, decay: decay * 0.8, destination: output });
    // glassy inharmonic partials
    tone({ time, frequency: midiToFreq(midi) * 2.76, gain: gain * 0.28 * partials, decay: decay * 0.36, reverbSend: 0.25, destination: output });
    tone({ time, frequency: midiToFreq(midi) * 5.4, gain: gain * 0.1 * partials, decay: decay * 0.14, destination: output });
    if (chain >= 2 || sparkle > 0.8) {
      tone({ time: time + SIXTEENTH * 0.5, midi: midi + 12, gain: gain * 0.3 * sparkle, decay: decay * 0.9, delaySend: 0.55, reverbSend: 0.4, destination: output });
    }
    // the freed strand exhales: bubbles rising out of the parasite's grip
    noiseHit(time, 0.035 + sparkle * 0.03, 0.09, 'highpass', 5600, output);
    if (kind === 'clamper' || kind === 'brood') {
      tone({ time, midi: midi - 5, glideTo: midiToFreq(midi + 7), glideTime: 0.14, gain: gain * 0.16, decay: 0.16, destination: output });
    }
  }

  bus.on('spawn', ({ enemyId, kind }) => {
    kindById.set(enemyId, kind);
    if (!ctx) return;
    const output = sfx();
    if (!output) return;
    if (kind === 'parent') {
      state.parentId = enemyId;
      return;
    }
    if (kind === 'spore') {
      // A parasite sneezes: a small sour blurp, off the key on purpose.
      const time = score.nextGridTime(ctx.currentTime);
      tone({ time, midi: 51, glideTo: midiToFreq(45), glideTime: 0.12, type: 'sawtooth', gain: 0.035, decay: 0.14, cutoff: 700, destination: output });
      tone({ time, midi: 52, glideTo: midiToFreq(46), glideTime: 0.12, type: 'sawtooth', gain: 0.03, decay: 0.14, cutoff: 700, destination: output });
    } else if (kind === 'brood') {
      const time = score.nextGridTime(ctx.currentTime);
      tone({ time, frequency: 150, glideTo: 82, glideTime: 0.16, gain: 0.16, decay: 0.2, destination: output });
      noiseHit(time, 0.06, 0.1, 'lowpass', 700, output);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kind = kindById.get(enemyId);
    if (kind === 'parent') {
      finale(true);
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0, kind);
    if (kind === 'brood') {
      state.broodKills += 1;
      const before = state.infection;
      state.infection = state.broodKills >= 10 ? 0.12 : state.broodKills >= 4 ? 0.5 : 1;
      if (state.infection < before) webDiesBack(kill.time + SIXTEENTH * 2, position);
    }
  });

  bus.on('miss', ({ enemyId }) => {
    if (!ctx) return;
    const kind = kindById.get(enemyId);
    if (kind === 'parent') {
      finale(false);
      return;
    }
    const output = sfx();
    if (!output) return;
    const time = ctx.currentTime;
    tone({ time, frequency: 130, glideTo: 68, glideTime: 0.12, gain: 0.04, decay: 0.13, destination: output });
  });

  // A veil dies back: violet undertow sinks a semitone, glass climbs the chord.
  function webDiesBack(time: number, position: number) {
    const output = sfx();
    if (!ctx || !output) return;
    const at = score.nextGridTime(time, 2);
    const lead = score.leadSetAt(score.arrangementPositionAt(at));
    tone({ time: at, midi: 54, glideTo: midiToFreq(42), glideTime: 0.5, type: 'sawtooth', gain: 0.05, decay: 0.6, cutoff: 900, reverbSend: 0.4, destination: output });
    noiseHit(at, 0.12, 0.6, 'bandpass', 1400, output);
    lead.slice(0, 6).forEach((midi, index) => {
      tone({ time: at + index * SIXTEENTH * 1.5, midi: midi + 12, gain: 0.08, decay: 0.7, delaySend: 0.55, reverbSend: 0.5, destination: output });
    });
    void position;
  }

  bus.on('lock', ({ lockCount, enemyId }) => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = actionTime();
    const position = score.arrangementPositionAt(time);
    const midi = score.leadSetAt(position)[Math.min(7, Math.max(0, lockCount - 1))];
    for (const [section, weight] of layersFor(score.sectionMixAt(position))) {
      if (weight < 0.02) continue;
      const voice = PLAYER_VOICES[section].lock;
      // a bubble: the note rises into place
      tone({
        time,
        midi,
        type: voice.type,
        gain: voice.gain * weight * (kindById.get(enemyId) === 'spore' ? 0.6 : 1),
        decay: voice.decay,
        cutoff: voice.cutoff + lockCount * 160,
        glideTo: midiToFreq(midi),
        glideTime: 0.045,
        frequency: midiToFreq(midi) * 0.78,
        delaySend: 0.3,
        reverbSend: 0.3,
        destination: output,
      });
    }
    if (lockCount === 6) {
      // Six locks: a held chord under the sweep — the volley is an event.
      const chord = score.chordAt(position);
      for (const note of [chord.arp[0], chord.arp[2], chord.arp[3] + 12]) {
        tone({ time, midi: note + 12, gain: 0.05, decay: 0.5, delaySend: 0.5, reverbSend: 0.5, destination: output });
      }
    }
  });

  bus.on('unlock', () => {
    // silent: unlocking happens on release and the fire sound covers it
  });

  bus.on('fire', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = actionTime();
    const position = score.arrangementPositionAt(time);
    const mix = score.sectionMixAt(position);
    const from = PLAYER_VOICES[mix.from].fire;
    const to = PLAYER_VOICES[mix.to].fire;
    const root = score.chordAt(position).bass;
    // A bubble stream: the root's octave falls a fifth as water closes behind it.
    tone({ time, midi: root + 24, glideTo: midiToFreq(root + 12), glideTime: 0.09, gain: 0.075, decay: 0.11, cutoff: lerp(from.cutoff, to.cutoff, mix.t), reverbSend: 0.2, destination: output });
    noiseHit(time, lerp(from.noise, to.noise, mix.t), 0.05, 'bandpass', 2600, output);
  });

  // Non-lethal hits: shell chips on brooders and carapace on the parent. Chips
  // on the parent ring deep and grow with damage dealt.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfx();
    if (lethal || !ctx || !output) return;
    const kind = kindById.get(enemyId);
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (kind === 'parent') {
      const intensity = 1 - hitPointsRemaining / 11;
      const root = midiToFreq(chord.bass);
      tone({ time, frequency: root * 2.5, glideTo: root, glideTime: 0.1, gain: 0.26 + 0.14 * intensity, decay: 0.5, destination: output });
      for (const midi of chord.pad) {
        tone({ time, midi, type: 'triangle', gain: 0.03 + 0.02 * intensity, decay: 0.26, cutoff: 1800 + 2600 * intensity, delaySend: 0.3, destination: output });
      }
      const lead = score.leadSetAt(position);
      tone({ time, midi: lead[Math.min(lead.length - 1, Math.floor(intensity * lead.length))] + 12, gain: 0.07 + 0.06 * intensity, decay: 0.55, delaySend: 0.5, reverbSend: 0.5, destination: output });
      noiseHit(time, 0.12 + 0.06 * intensity, 0.06, 'bandpass', 1300, output);
      return;
    }
    // brooder shell: three glassy ticks climbing the chord
    [0, 1, 2].forEach((index) => {
      tone({ time: time + SIXTEENTH * 0.5 * index, midi: chord.arp[index] + 12, gain: 0.07 - index * 0.01, decay: 0.16, cutoff: 4400, delaySend: 0.38, destination: output });
    });
    noiseHit(time, 0.035, 0.035, 'highpass', 5600, output);
  });

  // A stage break: the brooder's shell splits, or the parent's carapace tears.
  bus.on('stage', ({ enemyId }) => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (enemyId === state.parentId) {
      state.stageBreaks += 1;
      runtime.mix()?.duckAt(time, 0.35, 0.9);
      tone({ time, frequency: 240, glideTo: 46, glideTime: 0.5, gain: 0.5, decay: 0.8, destination: output });
      noiseHit(time, 0.2, 0.8, 'bandpass', 1500, output);
      for (const midi of chord.pad) {
        tone({ time, midi: midi + 12, type: 'sawtooth', gain: 0.03, decay: 0.7, cutoff: 3000, delaySend: 0.4, reverbSend: 0.5, destination: output });
      }
      return;
    }
    noiseHit(time, 0.14, 0.14, 'bandpass', 2400, output);
    tone({ time, midi: chord.arp[2] + 12, gain: 0.12, decay: 0.4, delaySend: 0.5, reverbSend: 0.4, destination: output });
  });

  // A clean volley of four or more earns a flourish: the chord, struck on the
  // next beat, and glass falling through it.
  bus.on('volley', ({ size, kills }) => {
    const output = sfx();
    if (!ctx || !output || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      tone({ time, midi: midi + 12, type: 'triangle', gain: 0.05, decay: 0.6, cutoff: 2600, delaySend: 0.5, reverbSend: 0.6, destination: output });
    }
    noiseHit(time, 0.07, 0.4, 'highpass', 6200, output);
    if (kills >= 6) {
      [0, 1, 2, 3].forEach((index) => {
        tone({ time: time + index * SIXTEENTH, midi: chord.arp[3 - index] + 24, gain: 0.06, decay: 0.5, delaySend: 0.6, reverbSend: 0.5, destination: output });
      });
    }
  });

  // Rejected release: the water refuses it. A dull thunk over a sour dyad.
  bus.on('reject', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    tone({ time, frequency: 220, glideTo: 82, glideTime: 0.18, type: 'triangle', gain: 0.16, decay: 0.22, cutoff: 900, destination: output });
    tone({ time: time + 0.02, frequency: 233, glideTo: 88, glideTime: 0.18, type: 'sawtooth', gain: 0.05, decay: 0.2, cutoff: 700, destination: output });
    noiseHit(time, 0.13, 0.1, 'bandpass', 560, output);
  });

  // The one out-of-key sound: a hull hit is a low boom under a tritone.
  bus.on('playerhit', () => {
    const output = sfx();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    runtime.mix()?.duckAt(time, 0.55, 0.5);
    tone({ time, frequency: 96, glideTo: 36, glideTime: 0.3, gain: 0.5, decay: 0.42, destination: output });
    for (const midi of [57, 63]) tone({ time, midi, type: 'sawtooth', gain: 0.06, decay: 0.3, cutoff: 1200, destination: output });
    noiseHit(time, 0.18, 0.16, 'bandpass', 800, output);
  });

  bus.on('bossphase', ({ phase }) => {
    const output = sfx();
    if (!ctx || !output) return;
    if (phase === 'exposed') {
      // The parent is bare. The undertow cuts out on a held breath; a bright
      // rising swell says: now.
      state.exposed = true;
      state.infection = 0;
      const time = score.nextGridTime(ctx.currentTime, 4);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      runtime.mix()?.duckAt(time, 0.4, 0.8);
      tone({ time, frequency: 180, glideTo: 720, glideTime: 0.7, gain: 0.07, attack: 0.5, decay: 0.3, reverbSend: 0.5, destination: output });
      for (const midi of chord.pad) {
        swell({ time, midi: midi + 12, type: 'triangle', gain: 0.035, attack: 0.35, hold: 0.4, release: 1.2, cutoff: 3200, reverbSend: 0.6, destination: output });
      }
    }
  });

  // The parent lets go. The music ducks out for a breath, one last pulse falls
  // on the grid, and D major blooms — then the arrangement hands over to the
  // serene score at the next bar.
  function finale(killed: boolean) {
    const output = sfx();
    const mix = runtime.mix();
    if (!ctx || !output || !mix || state.resolveFrom >= 0) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const position = score.arrangementPositionAt(time);
    state.resolveFrom = (Math.floor(position / STEPS_PER_BAR) + 1) * STEPS_PER_BAR;
    state.infection = 0;
    mix.duckAt(time, killed ? 0.12 : 0.3, killed ? 2.4 : 1.6);

    // one enormous, final heartbeat
    tone({ time, frequency: 110, glideTo: 32, glideTime: 0.7, gain: 0.55, decay: 1.2, destination: output });
    noiseHit(time, 0.12, 0.7, 'lowpass', 500, output);
    // the water clears: D major in four octaves, blooming
    const bloomAt = time + SIXTEENTH * 2;
    for (const midi of [38, 50, 57, 62, 66, 69, 73, 76, 81]) {
      for (const detune of [-5, 5]) {
        swell({ time: bloomAt, midi, type: 'triangle', gain: 0.03, attack: 0.9, hold: 1.4, release: 2.6, cutoff: 2400, detune, reverbSend: 0.7, delaySend: 0.2, destination: output });
      }
    }
    // pentatonic glass rising, slow and unhurried
    [74, 76, 78, 81, 83, 86, 88, 90, 93].forEach((midi, index) => {
      tone({ time: bloomAt + 0.35 + index * SIXTEENTH * 2.5, midi, gain: 0.09 - index * 0.004, decay: 1.1, delaySend: 0.6, reverbSend: 0.6, destination: output });
    });
    noiseHit(bloomAt, killed ? 0.16 : 0.08, 1.4, 'highpass', 6800, output);
  }

  return runtime;
}
