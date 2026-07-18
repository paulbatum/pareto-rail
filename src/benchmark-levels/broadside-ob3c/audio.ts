import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import {
  HORN,
  TROMBONE,
  TRUMPET,
  TUBA,
  createBroadsideVoices,
  type BrassColour,
} from './audio-voices';
import {
  BROADSIDE_BARS,
  BROADSIDE_BPM,
  BROADSIDE_SCORE_SECTIONS,
  BROADSIDE_STEPS_PER_BAR,
  BROADSIDE_TIME,
  type BroadsideSection,
} from './timing';

// BROADSIDE is scored, not accompanied. The orchestra plays the battle: the
// catapult is a trombone rip, the friendly cruiser's guns land on the downbeat
// of every bar of the flank run, and the enemy warship's shadow takes the
// arrangement away entirely and leaves you with strings and a heartbeat.
//
// The player is the soloist. Every kill plays whatever note the hidden melody
// lane holds at that step of the bar, tuned out of the live chord, in the
// current section's brass voice — so chained kills walk the lane and a full
// six-lock broadside performs a real phrase, in the register the arrangement
// deliberately leaves empty for it. Locks are a celesta figure climbing the
// pentatonic; even the gun retunes as the progression moves.

const STEP = BROADSIDE_TIME.stepSeconds;
const THIRTYSECOND = STEP / 2;
const STEPS_PER_BAR = BROADSIDE_STEPS_PER_BAR;
const LANE_STEPS = 32;

// D minor, i–VI–III–VII: the space-opera progression. Two bars per chord, so
// the eight-bar harmonic cycle lines up with the level's phrase structure.
type Chord = { bass: number; pad: number[]; arp: number[]; brass: number[] };

const CHORDS: Chord[] = [
  { bass: 38, pad: [50, 57, 62, 65], arp: [69, 72, 74, 77], brass: [50, 57, 62] }, // Dm
  { bass: 34, pad: [46, 53, 58, 62], arp: [70, 74, 77, 81], brass: [46, 53, 58] }, // Bb
  { bass: 41, pad: [48, 57, 60, 65], arp: [69, 72, 77, 81], brass: [48, 53, 57] }, // F
  { bass: 36, pad: [48, 55, 60, 64], arp: [67, 72, 76, 79], brass: [48, 55, 60] }, // C
];

// The last bar turns the run to D major. It is the only time in sixty seconds
// that the harmony leaves the minor mode, and it is the moment she breaks.
const VICTORY_CHORD: Chord = { bass: 38, pad: [50, 57, 62, 66], arp: [69, 74, 78, 81], brass: [50, 57, 62, 66] };

/** Locks climb a D minor pentatonic — one rung per gun, six guns. */
const LOCK_SCALE = [69, 72, 74, 77, 81, 84];

// The hidden melody. Degrees index the current chord's lead set (its arp plus
// those notes an octave up), so a kill on any step of any bar lands on a chord
// tone. Each contour is written for what the player is doing there: open
// fanfare shapes in the crossfire, long ascending runs under the broadside,
// almost nothing in the eye of the battle, angular leaps at the flagship, and
// a pure climb to the top of the register inside the trench.
const KILL_LANES: Record<BroadsideSection, number[]> = {
  0: [
    0, 2, 4, 2, 0, 2, 4, 5,
    4, 2, 0, 2, 4, 5, 7, 5,
    4, 2, 4, 5, 7, 5, 4, 2,
    0, 2, 4, 7, 5, 4, 2, 0,
  ],
  1: [
    0, 1, 2, 3, 4, 5, 6, 7,
    6, 5, 4, 3, 4, 5, 6, 7,
    2, 3, 4, 5, 6, 7, 6, 5,
    4, 5, 6, 7, 7, 6, 5, 4,
  ],
  2: [
    0, 1, 0, 2, 1, 0, 1, 2,
    3, 2, 1, 0, 1, 2, 3, 2,
    0, 1, 2, 1, 0, 2, 1, 0,
    2, 3, 2, 1, 0, 1, 0, 2,
  ],
  3: [
    4, 0, 5, 1, 6, 2, 7, 3,
    5, 1, 6, 2, 7, 3, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 7, 5, 6, 3, 4, 2, 0,
  ],
  4: [
    0, 2, 4, 5, 4, 5, 7, 5,
    4, 5, 7, 6, 5, 7, 6, 7,
    2, 4, 6, 7, 4, 6, 7, 6,
    5, 6, 7, 7, 6, 7, 7, 7,
  ],
};

/** The soloist's voice, section by section. Brass throughout — this level never leaves the orchestra. */
const SECTION_VOICES: Record<BroadsideSection, {
  kill: BrassColour & { decay: number; octave: number };
  lock: { gain: number; octave: number };
  fire: BrassColour;
}> = {
  // Off the deck and into the crossfire: warm horn, generous ring.
  0: { kill: { ...HORN, gain: 0.135, decay: 0.5, octave: 0 }, lock: { gain: 0.85, octave: 0 }, fire: TROMBONE },
  // The broadside: the soloist matches the ship — full trumpet, tight and hot.
  1: { kill: { ...TRUMPET, gain: 0.105, decay: 0.34, octave: 0 }, lock: { gain: 0.7, octave: 1 }, fire: TRUMPET },
  // The eye of the battle: covered, low, and a long way off.
  2: { kill: { ...HORN, bright: 0.14, gain: 0.115, decay: 0.72, octave: -1 }, lock: { gain: 0.5, octave: -1 }, fire: HORN },
  // The flagship: heavy brass, edged, trombones underneath.
  3: { kill: { ...TROMBONE, gain: 0.12, decay: 0.4, octave: 0 }, lock: { gain: 0.8, octave: 0 }, fire: TROMBONE },
  // The trench: the whole section at the top of its register.
  4: { kill: { ...TRUMPET, bright: 1.15, gain: 0.115, decay: 0.44, octave: 0 }, lock: { gain: 0.9, octave: 1 }, fire: TRUMPET },
};

/** The main theme. Four bars over Dm–Bb, stated under the friendly cruiser's guns. */
type ThemeNote = { bar: number; step: number; midi: number; beats: number };

const FLANK_THEME: ThemeNote[] = [
  { bar: 0, step: 0, midi: 69, beats: 2 },
  { bar: 0, step: 8, midi: 74, beats: 2 },
  { bar: 1, step: 0, midi: 72, beats: 1 },
  { bar: 1, step: 4, midi: 74, beats: 1 },
  { bar: 1, step: 8, midi: 77, beats: 2 },
  { bar: 2, step: 0, midi: 74, beats: 2 },
  { bar: 2, step: 8, midi: 70, beats: 2 },
  { bar: 3, step: 0, midi: 72, beats: 2 },
  { bar: 3, step: 8, midi: 69, beats: 1.6 },
];

/** The same opening phrase, reopened in D major, for the pull-out. */
const VICTORY_THEME: ThemeNote[] = [
  { bar: 0, step: 0, midi: 69, beats: 1 },
  { bar: 0, step: 4, midi: 74, beats: 1 },
  { bar: 0, step: 8, midi: 78, beats: 2 },
];

const CAPITAL_KINDS = new Set(['generator', 'core']);

export function createAudio(bus: EventBus) {
  return createBroadsideAudio(bus).audio;
}

function createBroadsideAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  // Which enemy is which: `hit` carries no kind, and the flagship's machinery
  // has to sound nothing like a swarm craft taking a round.
  const enemyKinds = new Map<number, string>();
  const capitalDamage = new Map<number, number>();
  let generatorsDown = 0;
  let victory = false;

  const score = createScore<Chord, BroadsideSection>({
    bpm: BROADSIDE_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: BROADSIDE_BARS.victory, chords: [VICTORY_CHORD], barsPerChord: 1 }],
    sections: BROADSIDE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    stepSeconds: STEP,
    stepsPerBar: STEPS_PER_BAR,
    volumeScale: 0.82,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -20, ratio: 4.5, attack: 0.006, release: 0.26 },
      // A hall, because this is an orchestra. The delay is short and dark — it
      // is depth on the brass, not an effect you should be able to name.
      reverb: { seconds: 2.8, decay: 2.3, level: 0.42 },
      delay: { time: STEP * 3, feedback: 0.2, dampHz: 2000, sendGain: 0.8 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      enemyKinds.clear();
      capitalDamage.clear();
      generatorsDown = 0;
      victory = false;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (context) strings(context.currentTime + 0.05, VICTORY_CHORD.pad, 0.75, 5.5);
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createBroadsideVoices({ context: () => ctx, mix: runtime.mix });
  const { timpani, basses, brass, strings, spiccato, tremolo, celesta, choir, cymbal, snare, riser, noise } = voices;
  const sfx = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  function sends(gain: number) {
    const mix = runtime.mix();
    const list: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.reverbSend) list.push({ destination: mix.reverbSend, gain });
    if (mix?.delaySend) list.push({ destination: mix.delaySend, gain: gain * 0.5 });
    return list.length > 0 ? list : undefined;
  }

  // ---- the arrangement --------------------------------------------------------------------

  const EMPTY_BAR = '................';

  const TIMPANI = {
    heartbeat: 'T.......t.......',
    drive: 'T...t...T...t...',
    march: 'T..t..T.T..t..t.',
    charge: 'T.t.T.t.T.t.T.t.',
    roll: 'TtttTtttTtttTttt',
  };

  const SNARE = {
    martial: '..s.s.....s.s...',
    tight: '..s.s...s.s.s.s.',
  };

  function timpaniTrack(pattern: string) {
    return hits<Chord>(pattern, { T: 1, t: 0.55 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel));
  }

  function snareTrack(pattern: string, weight = 1) {
    return hits<Chord>(pattern, { S: 1, s: 0.5 }, ({ time }, vel) => snare(time, vel * weight));
  }

  /** The string bed. Chords last two bars, so it is stamped on alternating bars. */
  function padTrack(fromBar: number, vel = 1) {
    const pattern = fromBar % 2 === 0
      ? `P...............${EMPTY_BAR}`
      : `${EMPTY_BAR}P...............`;
    return hits<Chord>(pattern, { P: vel }, ({ time, chord }, velocity) =>
      strings(time, chord.pad, velocity, STEP * STEPS_PER_BAR * 2 * 1.02));
  }

  /** Running spiccato: the engine under every driving section. */
  function ostinatoTrack(pattern: string, vel: number) {
    return hits<Chord>(pattern, { A: vel, a: vel * 0.65 }, ({ time, step, chord }, velocity) => {
      const order = [0, 1, 2, 3, 2, 1, 0, 2];
      spiccato(time, chord.arp[order[Math.floor(step / 2) % order.length] % chord.arp.length] - 12, velocity);
    });
  }

  function bassTrack(pattern = 'B.......b.......', vel = 1) {
    return hits<Chord>(pattern, { B: vel, b: vel * 0.7 }, ({ time, chord }, velocity) =>
      basses(time, chord.bass, velocity, STEP * 7));
  }

  /** A named brass theme played from a note table, section-relative. */
  function themeTrack(notes: ThemeNote[], colour: BrassColour, vel: number): ArrangementTrack<Chord> {
    return fn(({ barInSection, step, time }) => {
      for (const note of notes) {
        if (note.bar !== barInSection || note.step !== step) continue;
        brass(time, [note.midi, note.midi - 12], vel, note.beats * STEP * 4, colour);
      }
    });
  }

  /** Sustained low brass under everything: the weight of a capital ship. */
  function pedalTrack(vel: number, colour: BrassColour = TUBA) {
    return fn<Chord>(({ step, time, chord }) => {
      if (step !== 0) return;
      brass(time, [chord.bass + 12], vel, STEP * STEPS_PER_BAR * 0.96, colour);
    });
  }

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'standing-off',
      fromBar: 0,
      tracks: [
        padTrack(0, 0.55),
        hits(`T...............${EMPTY_BAR}`, { T: 0.4 }, ({ time, chord }, vel) => timpani(time, chord.bass - 12, vel)),
        hits('........A.......', { A: 0.35 }, ({ time, chord }, vel) => celesta(time, chord.arp[2], vel)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [
      // --- On the deck. One drone and one heartbeat: everything held back.
      {
        name: 'deck',
        fromBar: BROADSIDE_BARS.deck,
        toBar: 1,
        tracks: [
          padTrack(0, 0.6),
          timpaniTrack(TIMPANI.heartbeat),
          oneShot(0, 12, ({ time }) => riser(time, STEP * 4, 0.1)),
        ],
      },
      // --- The catapult. A trombone rip, a cymbal, and the orchestra arrives.
      {
        name: 'catapult',
        fromBar: 1,
        toBar: BROADSIDE_BARS.gauntlet,
        tracks: [
          padTrack(1, 0.85),
          timpaniTrack(TIMPANI.drive),
          bassTrack(),
          oneShot(0, 0, ({ time, chord }) => {
            cymbal(time, 1.1, 1.6);
            // The shot down the deck: three rising brass hits inside one beat.
            [0, 1, 2].forEach((index) => {
              brass(time + index * THIRTYSECOND * 2, [chord.brass[index] ?? chord.brass[0]], 0.9, STEP * 5, TROMBONE);
            });
          }),
          oneShot(1, 0, ({ time, chord }) => brass(time, chord.brass, 0.8, STEP * 12, HORN)),
          hits(`${EMPTY_BAR}A.A.A.A.A.A.A.A.`, { A: 0.7 }, ({ time, step, chord }, vel) =>
            spiccato(time, chord.arp[Math.floor(step / 2) % chord.arp.length] - 12, vel)),
        ],
      },
      // --- The gauntlet. The ostinato starts here and does not stop until the
      // warship's shadow takes it away.
      {
        name: 'gauntlet',
        fromBar: BROADSIDE_BARS.gauntlet,
        toBar: 6,
        tracks: [
          padTrack(BROADSIDE_BARS.gauntlet, 0.95),
          timpaniTrack(TIMPANI.drive),
          bassTrack(),
          ostinatoTrack('A.a.A.a.A.a.A.a.', 0.85),
          snareTrack(SNARE.martial, 0.8),
          pedalTrack(0.5),
        ],
      },
      {
        name: 'gauntlet-press',
        fromBar: 6,
        toBar: BROADSIDE_BARS.flank,
        tracks: [
          padTrack(6, 1),
          timpaniTrack(TIMPANI.march),
          bassTrack('B...b...B...b...'),
          ostinatoTrack('AaaAAaaAAaaAAaaA', 0.75),
          snareTrack(SNARE.tight, 0.9),
          pedalTrack(0.62),
          oneShot(1, 8, ({ time }) => riser(time, STEP * 8, 0.13)),
        ],
      },
      // --- The flank run. Her guns fire on every downbeat of this section, and
      // the main theme is stated over the top of them.
      {
        name: 'flank',
        fromBar: BROADSIDE_BARS.flank,
        toBar: BROADSIDE_BARS.belly,
        tracks: [
          padTrack(BROADSIDE_BARS.flank, 1),
          timpaniTrack(TIMPANI.march),
          bassTrack('B...b...B...b...'),
          ostinatoTrack('A.a.A.a.A.a.A.a.', 0.9),
          snareTrack(SNARE.tight),
          themeTrack(FLANK_THEME, TRUMPET, 1.0),
          hits('C...............', { C: 0.85 }, ({ time }, vel) => cymbal(time, vel, 1.3)),
          pedalTrack(0.55, TROMBONE),
        ],
      },
      // --- In her shadow. The battle is somewhere else and the arrangement
      // goes with it: strings, a heartbeat, and a distant choir.
      {
        name: 'eye',
        fromBar: BROADSIDE_BARS.belly,
        toBar: 15,
        tracks: [
          padTrack(BROADSIDE_BARS.belly, 0.75),
          timpaniTrack('T...............'),
          fn(({ barInSection, step, time, chord }) => {
            if (step !== 0 || barInSection % 2 !== 0) return;
            choir(time, chord.pad.slice(1), 0.7, STEP * STEPS_PER_BAR * 2);
          }),
          oneShot(2, 8, ({ time, chord }) => brass(time, [chord.bass + 12], 0.55, STEP * 10, HORN)),
        ],
      },
      // --- She is out there. One long swell as the flagship comes up ahead.
      {
        name: 'flagship-approach',
        fromBar: 15,
        toBar: BROADSIDE_BARS.flagship,
        tracks: [
          padTrack(15, 0.8),
          timpaniTrack('T.......T...t.t.'),
          bassTrack('B...............', 0.9),
          oneShot(0, 0, ({ time }) => riser(time, STEP * 16, 0.16)),
          oneShot(0, 8, ({ time, chord }) => brass(time, [chord.bass, chord.bass + 7], 0.85, STEP * 12, TUBA)),
        ],
      },
      // --- The flagship. Martial and heavy, and deliberately without the
      // ostinato: that register is left open for the soloist to work in.
      {
        name: 'flagship',
        fromBar: BROADSIDE_BARS.flagship,
        toBar: 19,
        tracks: [
          padTrack(BROADSIDE_BARS.flagship, 0.9),
          timpaniTrack(TIMPANI.march),
          bassTrack('B..b..B...b..b..'),
          snareTrack(SNARE.tight),
          pedalTrack(0.75, TUBA),
          hits('M.....M...M.....', { M: 0.7 }, ({ time, chord }, vel) =>
            brass(time, [chord.brass[0]], vel, STEP * 3, TROMBONE)),
        ],
      },
      {
        name: 'flagship-press',
        fromBar: 19,
        toBar: BROADSIDE_BARS.fighters,
        tracks: [
          padTrack(19, 1),
          timpaniTrack(TIMPANI.march),
          bassTrack('B..b..B...b..b..'),
          ostinatoTrack('A.a.A.a.A.a.A.a.', 0.7),
          snareTrack(SNARE.tight),
          pedalTrack(0.8, TUBA),
          hits('M...M.....M.M...', { M: 0.8 }, ({ time, chord }, vel) =>
            brass(time, [chord.brass[0], chord.brass[1]], vel, STEP * 3, TRUMPET)),
        ],
      },
      // --- Her wings launch. Everything at once, sixteenths under the whole bar.
      {
        name: 'fighters',
        fromBar: BROADSIDE_BARS.fighters,
        toBar: BROADSIDE_BARS.trench,
        tracks: [
          padTrack(BROADSIDE_BARS.fighters, 1),
          timpaniTrack(TIMPANI.charge),
          bassTrack('B.b.B.b.B.b.B.b.'),
          ostinatoTrack('AaAaAaAaAaAaAaAa', 0.8),
          snareTrack(SNARE.tight, 1.1),
          hits('..M...M...M...M.', { M: 0.85 }, ({ time, chord }, vel) =>
            brass(time, chord.brass, vel, STEP * 2, TRUMPET)),
          hits('C.......C.......', { C: 0.7 }, ({ time }, vel) => cymbal(time, vel, 0.9)),
        ],
      },
      // --- The trench. Tremolo strings, timpani closing up, and a brass figure
      // that climbs a step higher every bar.
      {
        name: 'trench',
        fromBar: BROADSIDE_BARS.trench,
        toBar: 26,
        tracks: [
          timpaniTrack(TIMPANI.charge),
          bassTrack('B.b.B.b.B.b.B.b.'),
          hits('tttttttttttttttt', { t: 0.55 }, ({ time, step, chord }, vel) =>
            tremolo(time, chord.pad[step % chord.pad.length], vel)),
          fn(({ barInSection, step, time, chord }) => {
            if (step % 4 !== 0) return;
            const rung = Math.min(chord.brass.length - 1, Math.min(2, Math.floor(step / 4)));
            brass(time, [chord.brass[rung] + barInSection * 2], 0.7, STEP * 3, TROMBONE);
          }),
          snareTrack(SNARE.tight, 1.1),
        ],
      },
      {
        name: 'trench-critical',
        fromBar: 26,
        toBar: BROADSIDE_BARS.victory,
        tracks: [
          timpaniTrack(TIMPANI.roll),
          bassTrack('BbBbBbBbBbBbBbBb', 0.8),
          hits('tttttttttttttttt', { t: 0.7 }, ({ time, step, chord }, vel) =>
            tremolo(time, chord.pad[step % chord.pad.length] + 12, vel)),
          snareTrack(SNARE.tight, 1.2),
          oneShot(0, 0, ({ time }) => riser(time, STEP * 16, 0.2)),
        ],
      },
      // --- The pull-out. D major, the theme restated, and the whole engagement
      // in frame behind it.
      {
        name: 'victory',
        fromBar: BROADSIDE_BARS.victory,
        toBar: BROADSIDE_BARS.end,
        tracks: [
          padTrack(BROADSIDE_BARS.victory, 1.2),
          timpaniTrack('TtttT...T...t...'),
          bassTrack('B.......B.......', 1.1),
          themeTrack(VICTORY_THEME, TRUMPET, 1.15),
          fn(({ barInSection, step, time, chord }) => {
            if (barInSection !== 0 || step !== 0) return;
            cymbal(time, 1.3, 2.6);
            brass(time, chord.brass, 1.0, STEP * STEPS_PER_BAR * 0.95, HORN);
            choir(time, [...chord.pad, chord.pad[0] + 12], 1.0, STEP * STEPS_PER_BAR * 1.1);
          }),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player's instrument ----------------------------------------------------------

  /**
   * A kill is a note. It takes the grid step the transport is actually on,
   * reads the section's melody lane at that step, tunes it out of the live
   * chord, and plays it in the section's brass voice.
   */
  function killNote(time: number, position: number, mix: SectionMix<BroadsideSection>, chain: number) {
    const out = sfx();
    if (!ctx || !out) return;
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    if (midi === undefined) return;

    const from = SECTION_VOICES[mix.from].kill;
    const to = SECTION_VOICES[mix.to].kill;
    // Chained kills crescendo, and from the third onward the octave above opens
    // up, so a volley audibly gathers as it lands.
    const velocity = Math.min(1.4, 1 + chain * 0.11);
    const duration = lerp(from.decay, to.decay, mix.t);

    const layers: Array<[typeof from, number]> = mix.from === mix.to
      ? [[to, 1]]
      : [[from, 1 - mix.t], [to, mix.t]];
    for (const [colour, weight] of layers) {
      if (weight < 0.02) continue;
      voices.brassTone.play({
        context: ctx,
        time,
        midi: midi + colour.octave * 12,
        gain: colour.gain * velocity * weight,
        duration,
        colour,
        destination: out,
        sends: sends(0.34),
      });
    }
    // A pure body an octave down keeps the saw stack from sounding thin.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + duration + 0.06,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi - 12),
      gainAutomation: [
        { type: 'set', value: 0.075 * velocity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + duration * 0.85 },
      ],
      destination: out,
    });
    if (chain >= 2) celesta(time, midi + 12, 0.42 + chain * 0.05);
    noise(time, 0.028, 0.05, 'highpass', 5400, out);
  }

  bus.on('spawn', ({ enemyId, kind }) => enemyKinds.set(enemyId, kind));

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const kind = enemyKinds.get(enemyId);
    enemyKinds.delete(enemyId);
    capitalDamage.delete(enemyId);
    if (!ctx) return;
    // The last core's death is the finale's downbeat; a lane note there would
    // step on the cadence, so cores are silent and the finale speaks for them.
    if (kind === 'core') return;
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, score.sectionMixAt(position), indexInVolley ?? 0);
    if (kind === 'generator') generatorDown();
  });

  bus.on('miss', ({ enemyId }) => {
    enemyKinds.delete(enemyId);
    capitalDamage.delete(enemyId);
  });

  // Locks are a celesta figure climbing the pentatonic, quantized to the real
  // transport grid so a fast sweep reads as a run rather than a rattle.
  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const voice = SECTION_VOICES[score.sectionMixAt(score.arrangementPositionAt(time)).to].lock;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1] + voice.octave * 12;
    celesta(time, midi, voice.gain);
    // The sixth lock is the battery going to full: a second note an octave up.
    if (lockCount >= LOCK_SCALE.length) celesta(time + THIRTYSECOND, midi + 12, voice.gain * 0.8);
  });

  // The gun is a brass attack rooted on the live chord, so it retunes as the
  // progression moves under it. Only the first shot of a volley speaks — the
  // rest of the release is carried by the kill line.
  bus.on('fire', ({ indexInVolley }) => {
    const out = sfx();
    if (!ctx || !out || (indexInVolley ?? 0) > 0) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const colour = SECTION_VOICES[score.sectionMixAt(position).to].fire;
    const root = score.chordAt(position).bass;
    voices.brassTone.play({
      context: ctx,
      time,
      midi: root + 24,
      gain: 0.055,
      duration: 0.16,
      colour,
      frequencyAutomation: [
        { type: 'set', value: midiToFreq(root + 24), time },
        { type: 'exponentialRamp', value: midiToFreq(root + 17), time: time + 0.13 },
      ],
      destination: out,
    });
    noise(time, 0.045, 0.035, 'highpass', 2600, out);
  });

  // Chipping armour: a short bowed figure for ordinary targets, and for the
  // flagship's own machinery an escalating anvil that grows with the damage
  // already dealt, so the fight audibly ratchets toward the break.
  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    const out = sfx();
    if (lethal || !ctx || !out) return;
    const kind = enemyKinds.get(enemyId);
    if (kind && CAPITAL_KINDS.has(kind)) {
      const seen = Math.max(capitalDamage.get(enemyId) ?? 0, hitPointsRemaining + 1);
      capitalDamage.set(enemyId, seen);
      capitalStrike(1 - hitPointsRemaining / seen);
      return;
    }
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const arp = score.chordAt(score.arrangementPositionAt(time)).arp;
    [0, 1].forEach((index) => spiccato(time + index * THIRTYSECOND, arp[index] + 12, 0.6 - index * 0.15));
    noise(time, 0.03, 0.03, 'highpass', 5000, out);
  });

  /** A round into capital armour: struck iron, and a beacon climbing with the damage. */
  function capitalStrike(intensity: number) {
    const out = sfx();
    if (!ctx || !out) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);

    timpani(time, chord.bass - 12, 0.45 + intensity * 0.4);
    for (const midi of chord.brass) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'bandpass', frequency: 1600 + 2400 * intensity, Q: 3 },
        gainAutomation: [
          { type: 'set', value: 0.05 + 0.03 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
        ],
        destination: out,
      });
    }
    const lead = score.leadSetAt(position);
    celesta(time, lead[Math.min(lead.length - 1, Math.floor(intensity * lead.length))] + 12, 0.5 + intensity * 0.5);
    noise(time, 0.1 + 0.07 * intensity, 0.07, 'bandpass', 1500, out);
  }

  /** One fifth of her shield goes. Each confirmation is pitched a tone above the last. */
  function generatorDown() {
    if (!ctx) return;
    generatorsDown += 1;
    const time = score.nextGridTime(ctx.currentTime, 2);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    cymbal(time, 0.6 + generatorsDown * 0.08, 1.1);
    brass(time, [chord.brass[0] + generatorsDown * 2, chord.brass[1] + generatorsDown * 2], 0.85, STEP * 6, TROMBONE);
    timpani(time, chord.bass - 12, 0.9);
  }

  bus.on('bossphase', ({ phase }) => {
    const mix = runtime.mix();
    const out = sfx();
    if (!ctx || !out || !mix) return;

    if (phase === 'exposed') {
      // Her shield lets go: the mix ducks for a breath and the brass falls
      // through two octaves before the arrangement comes back in.
      const time = score.nextGridTime(ctx.currentTime, 2);
      mix.duckAt(time, 0.3, 1.4);
      cymbal(time, 1.2, 2.2);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      [0, 1, 2, 3, 4, 5].forEach((index) => {
        brass(time + index * STEP, [chord.brass[0] + 24 - index * 5], 0.75 - index * 0.06, STEP * 3, TRUMPET);
      });
      timpani(time, chord.bass - 12, 1.1);
      return;
    }

    if (phase === 'destroyed' && !victory) {
      victory = true;
      flagshipFinale();
    }
  });

  /**
   * The killing blow. The battle stops for a beat, the flagship goes, and the
   * score lands on the victory theme in D major.
   */
  function flagshipFinale() {
    const out = sfx();
    const mix = runtime.mix();
    if (!ctx || !out || !mix) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    score.overrideSection(4);
    mix.duckAt(time, 0.14, 2.4);

    // The hull letting go: a sub drop under a wall of noise.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1.6,
      oscillatorType: 'sine',
      frequency: 150,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 32, time: time + 0.7 }],
      gainAutomation: [
        { type: 'set', value: 0.6, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 1.5 },
      ],
      destination: out,
    });
    noise(time, 0.32, 1.5, 'lowpass', 900, out);
    cymbal(time, 1.4, 3.0);

    // D major, brass through three octaves, and the theme opening over it.
    const beat = STEP * 4;
    brass(time + beat, VICTORY_CHORD.brass, 1.1, beat * 6, HORN);
    brass(time + beat, [VICTORY_CHORD.bass, VICTORY_CHORD.bass + 12], 1.0, beat * 6, TUBA);
    choir(time + beat, [...VICTORY_CHORD.pad, VICTORY_CHORD.pad[0] + 12], 1.0, beat * 6);
    [69, 74, 78, 81].forEach((midi, index) => {
      brass(time + beat * (1 + index * 0.5), [midi, midi - 12], 1.0, beat * (index === 3 ? 4 : 0.6), TRUMPET);
    });
    timpani(time + beat, VICTORY_CHORD.bass - 12, 1.2);
    timpani(time + beat * 1.5, VICTORY_CHORD.bass - 12, 0.7);
    timpani(time + beat * 2, VICTORY_CHORD.bass - 12, 1.0);
  }

  // A clean volley of five or more: the orchestra answers on the next beat.
  bus.on('volley', ({ size, kills }) => {
    if (!ctx || kills < 5 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    brass(time, chord.brass.map((midi) => midi + 12), 0.85, STEP * 4, TRUMPET);
    cymbal(time, 0.8, 1.2);
  });

  // Rejected release: deliberately the one out-of-key sound in the level. A
  // tritone in the low brass over a dead skin — a round bouncing off armour.
  bus.on('reject', () => {
    const out = sfx();
    if (!ctx || !out) return;
    const time = ctx.currentTime;
    for (const [midi, gain] of [[43, 0.09], [49, 0.075]] as const) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.34,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: {
          type: 'lowpass',
          frequencyAutomation: [
            { type: 'set', value: 1400, time },
            { type: 'exponentialRamp', value: 320, time: time + 0.28 },
          ],
        },
        gainAutomation: [
          { type: 'set', value: gain, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
        ],
        destination: out,
      });
    }
    noise(time, 0.14, 0.1, 'bandpass', 800, out);
    noise(time + 0.03, 0.06, 0.13, 'highpass', 2200, out);
  });

  // Taking a round: a hull boom under a minor-second string cluster.
  bus.on('playerhit', () => {
    const out = sfx();
    if (!ctx || !out) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.55,
      oscillatorType: 'sine',
      frequency: 110,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 30, time: time + 0.4 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
      ],
      destination: out,
    });
    for (const midi of [61, 62]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.34,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1600 },
        gainAutomation: [
          { type: 'set', value: 0.05, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
        ],
        destination: out,
      });
    }
    noise(time, 0.22, 0.16, 'bandpass', 950, out);
  });

  return runtime;
}
