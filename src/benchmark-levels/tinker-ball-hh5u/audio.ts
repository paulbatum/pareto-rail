import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore, type SectionMix } from '../../engine/score';
import { createTinkerVoices, type BellSpec } from './audio-voices';
import { onTinker } from './channel';
import { TINKER_BARS, TINKER_BPM, TINKER_SCORE_SECTIONS, TINKER_STEPS_PER_BAR, TINKER_TIME } from './timing';

// Tinker Ball's score: bright, eccentric workshop pop. The key climbs a whole
// step at each size-up (C for the marble, D for the tennis ball, E for the
// melon), the spill drags it into E minor, and the heart's defeat lands on
// E major. The player is the lead: every kill strikes the next note of a
// hidden melody on a mallet that grows with the ball — glockenspiel, marimba,
// vibraphone, the spill's tubular bells, a music box for the coda — and every
// piece that sticks to the ball adds a music-box tick from the live chord.

const SIXTEENTH = TINKER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS = TINKER_STEPS_PER_BAR;

type Chord = { name: string; bass: number; stab: number[]; mallet: number[]; arp: number[]; root: number };

const chord = (name: string, root: number, bass: number, stab: number[], mallet: number[], arp: number[]): Chord => ({ name, root, bass, stab, mallet, arp });
const shift = (c: Chord, semitones: number, name: string): Chord => ({
  name,
  root: c.root + semitones,
  bass: c.bass + semitones,
  stab: c.stab.map((m) => m + semitones),
  mallet: c.mallet.map((m) => m + semitones),
  arp: c.arp.map((m) => m + semitones),
});

// The marble's four-bar loop in C; the tennis ball and melon reuse it a whole
// step and two whole steps up.
const C_LOOP: Chord[] = [
  chord('C6/9', 60, 36, [55, 60, 64, 69], [55, 60, 64, 67], [72, 74, 76, 79]),
  chord('Am7', 57, 33, [55, 60, 64, 67], [57, 60, 64, 67], [72, 76, 79, 81]),
  chord('Fmaj9', 53, 41, [53, 57, 60, 64], [57, 60, 64, 65], [72, 76, 77, 79]),
  chord('G7sus4', 55, 43, [55, 60, 62, 65], [55, 59, 62, 65], [72, 74, 77, 79]),
];
const D_LOOP = C_LOOP.map((c, i) => shift(c, 2, ['D6/9', 'Bm7', 'Gmaj9', 'A7sus4'][i]));
const E_RISE: Chord[] = [
  shift(C_LOOP[0], 4, 'E6/9'),
  shift(C_LOOP[1], 4, 'C#m7'),
  chord('B7sus4', 59, 35, [54, 59, 64, 69], [54, 59, 64, 66], [71, 76, 78, 81]),
];
// The spill: E minor with a raised seventh pulling it back to the tonic.
const SPILL_LOOP: Chord[] = [
  chord('Em9', 52, 40, [55, 59, 62, 66], [55, 59, 62, 64], [76, 78, 79, 83]),
  chord('Cmaj7#11', 48, 36, [55, 59, 64, 66], [55, 60, 64, 66], [76, 79, 83, 84]),
  chord('Am9', 57, 33, [55, 59, 60, 64], [57, 60, 64, 67], [76, 79, 81, 83]),
  chord('B7b9', 59, 35, [54, 57, 60, 63], [54, 57, 59, 63], [75, 78, 81, 83]),
];
const CODA: Chord[] = [
  chord('Emaj9', 52, 40, [56, 59, 63, 66], [56, 59, 63, 64], [76, 78, 80, 83]),
  chord('E6/9', 52, 40, [56, 61, 64, 66], [56, 59, 61, 64], [76, 78, 80, 85]),
];

/** Rotate a loop so its first chord lands on `fromBar` (the score indexes by absolute bar). */
function startingAt(chords: Chord[], fromBar: number) {
  const n = chords.length;
  return chords.map((_, i) => chords[(((i - fromBar) % n) + n) % n]);
}

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// Kill-melody lanes: degrees into the section's lead set (the chord's four
// arp tones plus the same an octave up), one per sixteenth over two bars.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Marble / glockenspiel: a skipping nursery figure.
  0: [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 4, 5, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 5, 4, 3, 2, 1, 0, 2],
  // Tennis / marimba: bouncing broken chords, up and over.
  1: [0, 4, 2, 5, 3, 6, 4, 7, 7, 5, 6, 4, 5, 3, 4, 2, 0, 2, 4, 6, 1, 3, 5, 7, 6, 4, 2, 0, 1, 3, 5, 7],
  // Melon / vibraphone: wide, singing leaps.
  2: [0, 4, 7, 4, 2, 5, 7, 5, 1, 4, 6, 4, 3, 5, 7, 6, 0, 3, 5, 7, 6, 4, 2, 4, 5, 7, 6, 5, 4, 3, 2, 1],
  // Spill / tubular bells: tolls that fall and climb back.
  3: [7, 6, 5, 4, 7, 6, 5, 4, 6, 5, 4, 3, 6, 5, 4, 3, 5, 4, 3, 2, 5, 4, 3, 2, 3, 4, 5, 6, 7, 6, 7, 7],
  // Coda / music box: a lullaby run up the major chord.
  4: [0, 2, 4, 7, 4, 2, 4, 7, 5, 7, 6, 4, 2, 4, 5, 7, 0, 1, 2, 4, 5, 6, 7, 6, 4, 2, 4, 5, 7, 7, 6, 7],
};

// Octave placement of each section's lead so the player owns the register
// above the band: bells ring high, the tubular bells hang lower and darker.
const LEAD_SHIFT: Record<SectionIndex, number> = { 0: 12, 1: 0, 2: 0, 3: -12, 4: 12 };

const KILL_VOICES: Record<SectionIndex, BellSpec> = {
  0: { partials: [{ ratio: 1, gain: 1, decay: 0.55 }, { ratio: 2.76, gain: 0.32, decay: 0.16 }, { ratio: 5.4, gain: 0.12, decay: 0.06 }], click: [0.02, 0.01, 7000], beat: 0, gain: 0.16, send: 0.35 },
  1: { partials: [{ ratio: 1, gain: 1, decay: 0.4 }, { ratio: 3.93, gain: 0.42, decay: 0.07 }, { ratio: 9.8, gain: 0.1, decay: 0.02 }], click: [0.03, 0.012, 3000], beat: 0, gain: 0.24, send: 0.25 },
  2: { partials: [{ ratio: 1, gain: 1, decay: 1.2 }, { ratio: 4, gain: 0.22, decay: 0.35 }, { ratio: 3.01, gain: 0.08, decay: 0.6 }], click: [0.012, 0.01, 6000], beat: 9, gain: 0.17, send: 0.4 },
  3: { partials: [{ ratio: 1, gain: 1, decay: 1.8 }, { ratio: 2.0, gain: 0.55, decay: 1.3 }, { ratio: 3.0, gain: 0.4, decay: 1.0 }, { ratio: 4.2, gain: 0.28, decay: 0.7 }, { ratio: 5.4, gain: 0.18, decay: 0.45 }], click: [0.04, 0.02, 4000], beat: 0, gain: 0.13, send: 0.45 },
  4: { partials: [{ ratio: 1, gain: 1, decay: 0.9 }, { ratio: 3, gain: 0.28, decay: 0.25 }, { ratio: 6.2, gain: 0.12, decay: 0.1 }], click: [0.015, 0.008, 8000], beat: 0, gain: 0.16, send: 0.5 },
};

// Locks are small struck ticks climbing the section's pentatonic.
const LOCK_VOICE: BellSpec = { partials: [{ ratio: 1, gain: 1, decay: 0.09 }, { ratio: 3, gain: 0.3, decay: 0.03 }], click: [0.02, 0.006, 5000], beat: 0, gain: 0.075, send: 0.2 };
const PENTATONIC = [0, 2, 4, 7, 9, 12];
const MINOR_PENTATONIC = [0, 3, 5, 7, 10, 12];
const SECTION_KEY: Record<SectionIndex, { tonic: number; minor: boolean }> = {
  0: { tonic: 84, minor: false },
  1: { tonic: 86, minor: false },
  2: { tonic: 88, minor: false },
  3: { tonic: 76, minor: true },
  4: { tonic: 88, minor: false },
};

function sectionForBar(bar: number): SectionIndex {
  let current: SectionIndex = 0;
  for (const section of TINKER_SCORE_SECTIONS) if (bar >= section.fromBar) current = section.index;
  return current;
}

export function createAudio(bus: EventBus) {
  return createTinkerAudio(bus).audio;
}

export const traceTinkerAudio = createAudioTraceHarness({
  level: 'tinker-ball-hh5u',
  bpm: TINKER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createTinkerAudio,
});

function createTinkerAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let heartId = -1;
  let heartMaxHp = 0;
  let lastPickupSlot = -1;
  let pickupsThisSlot = 0;

  const score = createScore<Chord, SectionIndex>({
    bpm: TINKER_BPM,
    stepsPerBar: STEPS,
    chords: startingAt(C_LOOP, 0),
    barsPerChord: 1,
    alternateChordSets: [
      { fromBar: TINKER_BARS.growTennis, toBar: TINKER_BARS.growMelon, chords: startingAt(D_LOOP, TINKER_BARS.growTennis) },
      { fromBar: TINKER_BARS.growMelon, toBar: TINKER_BARS.spill, chords: startingAt(E_RISE, TINKER_BARS.growMelon) },
      { fromBar: TINKER_BARS.spill, toBar: TINKER_BARS.coda, chords: startingAt(SPILL_LOOP, TINKER_BARS.spill) },
      { fromBar: TINKER_BARS.coda, chords: startingAt(CODA, TINKER_BARS.coda) },
    ],
    sections: TINKER_SCORE_SECTIONS,
    killLanes: KILL_LANES,
    leadSet: (c, position) => {
      const offset = LEAD_SHIFT[sectionForBar(Math.floor(position / STEPS))];
      return [...c.arp.map((m) => m + offset), ...c.arp.map((m) => m + 12 + offset)];
    },
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -16, ratio: 4, attack: 0.004, release: 0.2 },
      delay: { time: SIXTEENTH * 3, feedback: 0.3, dampHz: 3200 },
      reverb: { seconds: 1.6, decay: 2.4, level: 0.28 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      heartId = -1;
      heartMaxHp = 0;
    },
    onRunEnd() {
      score.clearOverride();
      const context = runtime.context();
      if (!context) return;
      const time = score.nextGridTime(context.currentTime, 4);
      const final = CODA[1];
      band.organ(time, final.stab, BAR_SECONDS_LOCAL * 1.6, 1.1);
      final.arp.forEach((midi, i) => player.bell(time + i * SIXTEENTH, midi + 12, KILL_VOICES[4], 0.8));
    },
    onDispose() {
      ctx = null;
    },
  });

  const { band, player } = createTinkerVoices({ trace, context: () => ctx, mix: runtime.mix });

  // ── Patterns ─────────────────────────────────────────────────────────────
  const kickLight = 'K.......K..k....';
  const kickFour = 'K...K...K...K...';
  const kickFill = 'K...K...K.K.KKKK';
  const clapBack = '....C.......C...';
  const tickOff = '..t...t...t...t.';
  const tickSixteen = 'tTttTttTtTttTtTt';
  const shakerRun = '.s.s.s.s.s.sss.s';
  const woodblocks = 'w..w..w...w.w...';
  const bassBounce = 'B..bU..bB..bU.b.';
  const bassDrive = 'B.bUB.bUB.bUBbU.';
  const bassSpill = 'B..B..b.B..U.b.b';
  const stabLight = '......S.......S.';
  const stabOff = '..S...S...S...S.';
  const stabSpill = '..S..S....S..S..';
  const malletEights = 'M.m.M.m.M.m.M.m.';
  const malletSparkle = 'MmMmMmMmMmMmMmMm';
  const bubbles = '.....b.....b..b.';

  const kickTrack = (pattern: string) => hits<Chord>(pattern, { K: 1, k: 0.75 }, ({ time }, vel) => band.kick(time, vel));
  const clapTrack = (vel = 1) => hits<Chord>(clapBack, { C: vel }, ({ time }, v) => band.clap(time, v));
  const tickTrack = (pattern: string, vel = 1) => hits<Chord>(pattern, { t: 0.05 * vel, T: 0.09 * vel }, ({ time }, v) => band.tick(time, v));
  const shakerTrack = (vel = 1) => hits<Chord>(shakerRun, { s: 0.06 * vel }, ({ time }, v) => band.shaker(time, v));
  const woodTrack = () => hits<Chord>(woodblocks, { w: 0.9 }, ({ time, step, chord }, v) => band.woodblock(time, chord.mallet[(step / 3) % 4 | 0] + 24, v));
  const bassTrack = (pattern: string, vel = 1) => hits<Chord>(pattern, { B: vel, b: 0.7 * vel, U: 0.8 * vel }, ({ time, chord }, v, symbol) => {
    band.bass(time, chord.bass + (symbol === 'U' ? 12 : 0), v, symbol === 'B' ? SIXTEENTH * 2.6 : SIXTEENTH * 1.4);
  });
  const stabTrack = (pattern: string, vel: number, brightness: number) => hits<Chord>(pattern, { S: vel }, ({ time, chord }, v) => band.stab(time, chord.stab, v, brightness));
  const malletTrack = (pattern: string, vel: number) => hits<Chord>(pattern, { M: vel, m: vel * 0.7 }, ({ time, step, chord }, v) => {
    const order = [0, 2, 1, 3, 2, 0, 3, 1];
    band.mallet(time, chord.mallet[order[(step >> 1) % order.length]], v);
  });
  const organTrack = (vel: number) => hits<Chord>('O' + '.'.repeat(15), { O: vel }, ({ time, chord }, v) => band.organ(time, chord.stab, BAR_SECONDS_LOCAL * 0.96, v));
  const bubbleTrack = () => hits<Chord>(bubbles, { b: 0.8 }, ({ time, step }, v) => band.bubble(time, 50 + ((step * 7) % 12), v));
  const tinkTrack = () => hits<Chord>('..............i.', { i: 1 }, ({ time, chord, bar }, v) => {
    if (bar % 2 === 1) band.tink(time, chord.arp[bar % 4] + 24, v);
  });
  const twangTrack = () => hits<Chord>('T' + '.'.repeat(15), { T: 1 }, ({ time, chord }, v) => band.twang(time, chord.bass + 24, v));
  const zipInto = (bar: number) => oneShot<Chord>(bar, 8, ({ time }) => band.zip(time, SIXTEENTH * 8));
  const droneTrack = () => hits<Chord>('D' + '.'.repeat(31), { D: 1 }, ({ time, chord }, v) => band.drone(time, chord.bass + 12, BAR_SECONDS_LOCAL * 2, v));
  const every = (bars: number, track: ArrangementTrack<Chord>) => fn<Chord>((context) => {
    if (context.barInSection % bars === bars - 1) track.run(context);
  });

  const ambient = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        malletTrack('M...m...M...m...', 0.6),
        hits<Chord>('O' + '.'.repeat(31), { O: 0.7 }, ({ time, chord }, v) => band.organ(time, chord.stab, BAR_SECONDS_LOCAL * 1.9, v)),
        tickTrack('........t.......', 0.7),
      ],
    }],
  });

  const run = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'windup', fromBar: 0, toBar: 1, tracks: [malletTrack(malletEights, 0.75), tickTrack(tickOff, 0.8), zipInto(0)] },
      { name: 'marble', fromBar: 1, toBar: 5, tracks: [kickTrack(kickLight), bassTrack(bassBounce, 0.85), tickTrack(tickOff), stabTrack(stabLight, 0.8, 0.3), malletTrack(malletEights, 0.8)] },
      {
        name: 'marble-drive',
        fromBar: 5,
        toBar: 9,
        tracks: [
          fn<Chord>((c) => (c.barInSection === 3 ? kickTrack(kickFill) : kickTrack(kickFour)).run(c)),
          clapTrack(), shakerTrack(0.8), bassTrack(bassBounce), tickTrack(tickOff), stabTrack(stabOff, 0.85, 0.4),
          malletTrack(malletEights, 0.8), woodTrack(), zipInto(3),
        ],
      },
      {
        name: 'tennis',
        fromBar: 9,
        toBar: 14,
        tracks: [kickTrack(kickFour), clapTrack(), tickTrack(tickSixteen, 0.9), bassTrack(bassDrive), stabTrack(stabOff, 0.9, 0.55), malletTrack(malletEights, 0.85), woodTrack(), every(2, twangTrack())],
      },
      {
        name: 'tennis-drive',
        fromBar: 14,
        toBar: 19,
        tracks: [
          fn<Chord>((c) => (c.barInSection === 4 ? kickTrack(kickFill) : kickTrack(kickFour)).run(c)),
          clapTrack(), tickTrack(tickSixteen), shakerTrack(), bassTrack(bassDrive), stabTrack(stabOff, 0.95, 0.65),
          malletTrack(malletEights, 0.85), woodTrack(), tinkTrack(), organTrack(0.6), zipInto(4),
        ],
      },
      {
        name: 'melon',
        fromBar: 19,
        toBar: 21,
        tracks: [kickTrack(kickFour), clapTrack(1.1), tickTrack(tickSixteen), shakerTrack(), bassTrack(bassBounce, 1.1), stabTrack('S.......S.......', 1.1, 0.7), organTrack(1), malletTrack(malletSparkle, 0.6)],
      },
      {
        name: 'spill-reveal',
        fromBar: 21,
        toBar: 22,
        tracks: [kickTrack('K.......K.......'), droneTrack(), bubbleTrack(), tickTrack(tickOff), oneShot<Chord>(0, 0, ({ time }) => band.riser(time, BAR_SECONDS_LOCAL * 0.98)), stabTrack('S...............', 1, 0.2)],
      },
      {
        name: 'spill',
        fromBar: 22,
        toBar: 27,
        tracks: [kickTrack(kickFour), clapTrack(), tickTrack(tickSixteen, 0.9), bassTrack(bassSpill, 1.05), stabTrack(stabSpill, 0.9, 0.25), droneTrack(), bubbleTrack(), woodTrack(), malletTrack(malletEights, 0.6)],
      },
      {
        name: 'heart',
        fromBar: 27,
        toBar: 30,
        tracks: [
          fn<Chord>((c) => {
            // Bar 29's back half drops away for the heart's last stand.
            if (c.barInSection === 2 && c.step >= 8) return;
            kickTrack(kickFour).run(c);
          }),
          clapTrack(), tickTrack(tickSixteen), shakerTrack(1.1), bassTrack(bassDrive, 1.1), stabTrack(stabOff, 1, 0.45),
          droneTrack(), organTrack(0.8), bubbleTrack(),
          oneShot<Chord>(2, 8, ({ time }) => band.riser(time, BAR_SECONDS_LOCAL * 0.49)),
        ],
      },
      {
        name: 'coda',
        fromBar: 30,
        tracks: [
          hits<Chord>('O' + '.'.repeat(31), { O: 1.1 }, ({ time, chord }, v) => band.organ(time, chord.stab, BAR_SECONDS_LOCAL * 1.95, v)),
          malletTrack(malletSparkle, 0.7),
          fn<Chord>((c) => { if (c.barInSection === 0) clapTrack(0.8).run(c); }),
          fn<Chord>((c) => { if (c.barInSection === 0) kickTrack('K.......K.......').run(c); }),
          hits<Chord>('B...............', { B: 1 }, ({ time, chord }, v) => band.bass(time, chord.bass, v, BAR_SECONDS_LOCAL * 0.9)),
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambient.schedule(position, time);
    else {
      if (position % STEPS === 0) run.recordSectionStart(time, position / STEPS);
      run.schedule(position, time);
    }
  }

  // ── The player's instruments ────────────────────────────────────────────
  const sectionLayers = (mix: SectionMix<SectionIndex>): Array<[SectionIndex, number]> => (
    mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]]
  );

  // Kills: each lands on the next free sixteenth and strikes the lane note,
  // so a chained volley plays the hidden melody. Longer chains ring louder,
  // and from the fourth link a soft octave doubles the line.
  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === heartId) {
      heartFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const mix = score.sectionMixAt(position);
    const chain = indexInVolley ?? 0;
    const velocity = Math.min(1.35, 0.95 + chain * 0.08);
    for (const [section, weight] of sectionLayers(mix)) {
      if (weight < 0.02) continue;
      player.bell(kill.time, kill.midi, KILL_VOICES[section], velocity * weight);
    }
    if (chain >= 3) player.bell(kill.time, kill.midi + 12, KILL_VOICES[mix.to], 0.35);
    player.plop(kill.time, score.chordAt(position).root, 0.8);
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const key = SECTION_KEY[score.sectionMixAt(position).to];
    const scale = key.minor ? MINOR_PENTATONIC : PENTATONIC;
    const midi = key.tonic + scale[Math.min(scale.length, Math.max(1, lockCount)) - 1] - 12;
    player.lock(time, midi, LOCK_VOICE, 0.8 + lockCount * 0.06);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const root = score.chordAt(score.arrangementPositionAt(time)).root;
    player.spritz(time, root, (indexInVolley ?? 0) === 0 ? 1 : 0.55);
  });

  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    if (!ctx || lethal) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    if (enemyId === heartId) {
      // The heart's shell rings a tubular bell that climbs with the damage.
      heartMaxHp = Math.max(heartMaxHp, hitPointsRemaining + 1);
      const intensity = 1 - hitPointsRemaining / heartMaxHp;
      const midi = lead[Math.min(lead.length - 1, Math.floor(intensity * lead.length))];
      player.bell(time, midi, KILL_VOICES[3], 0.7 + intensity * 0.6);
      player.crack(time, score.chordAt(position).root + 24, 0.8 + intensity * 0.5);
      return;
    }
    player.crack(time, lead[hitPointsRemaining % 4] + 12, 1);
  });

  // A shell layer cracks off a spill core: an organ stab and a cascade of
  // falling bell notes — the rescued pieces showering the route.
  bus.on('stage', ({ enemyId }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const position = score.arrangementPositionAt(time);
    const c = score.chordAt(position);
    player.stab(time, c.stab.map((m) => m + 12), enemyId === heartId ? 1.3 : 1, 0.8);
    const lead = score.leadSetAt(position);
    for (let i = 0; i < 6; i += 1) player.bell(time + i * THIRTYSECOND * 1.5, lead[7 - i] + 12, KILL_VOICES[0], 0.55 - i * 0.05, 0.6);
  });

  // A clean sweep of four or more: the organ and the table applaud.
  bus.on('volley', ({ size, kills }) => {
    if (!ctx || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const c = score.chordAt(score.arrangementPositionAt(time));
    player.stab(time, c.stab.map((m) => m + 12), size === 6 ? 1.3 : 1, size === 6 ? 1 : 0.6);
    player.applause(time, size === 6 ? 1 : 0.7);
    if (size === 6) player.applause(time + SIXTEENTH * 2, 0.8);
  });

  bus.on('reject', () => {
    if (ctx) player.reject(ctx.currentTime);
  });

  bus.on('miss', ({ enemyId }) => {
    if (!ctx || enemyId === heartId) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    player.miss(time, score.chordAt(score.arrangementPositionAt(time)).root + 12);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    player.splat(ctx.currentTime, score.chordAt(score.arrangementPositionAt(ctx.currentTime)).root);
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    if (!ctx) return;
    if (kind === 'spill-heart') {
      heartId = enemyId;
      // The heart surfaces: two rising organ blasts over the drone.
      const time = score.nextGridTime(ctx.currentTime, 2);
      const c = score.chordAt(score.arrangementPositionAt(time));
      player.stab(time, c.stab, 1.2, 0.3);
      player.stab(time + SIXTEENTH * 3, c.stab.map((m) => m + 5), 1.3, 0.5);
    } else if (kind === 'spill-core') {
      const time = score.nextGridTime(ctx.currentTime, 1);
      band.bubble(time, 47, 1.4);
      band.bubble(time + SIXTEENTH, 52, 1.1);
    } else if (kind === 'glue-glob') {
      band.bubble(ctx.currentTime, 62, 0.9);
    }
  });

  // Every piece that sticks plays a music-box tick from the live chord — a
  // debris field rolled up becomes a glittering patter. Capped per 32nd.
  onTinker(bus, 'tinker:pickup', ({ size, rescued }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const slot = Math.round(time / THIRTYSECOND);
    if (slot === lastPickupSlot) {
      pickupsThisSlot += 1;
      if (pickupsThisSlot > 1) return;
    } else {
      lastPickupSlot = slot;
      pickupsThisSlot = 0;
    }
    const position = score.arrangementPositionAt(time);
    const arp = score.chordAt(position).arp;
    const midi = arp[(slot * 3) % arp.length] + (size > 0.6 ? 12 : 24);
    player.pickup(time + (pickupsThisSlot ? THIRTYSECOND * 0.5 : 0), midi, rescued ? 1 : 0.6);
  });

  // Size-up: the ball swells and the song lifts a whole step with it.
  onTinker(bus, 'tinker:grow', ({ tier }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    const from = tier === 1 ? 60 : 62;
    player.swell(time, from, from + 2);
  });

  onTinker(bus, 'tinker:clean', () => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 2) + SIXTEENTH * 4;
    const sparkle = [88, 92, 95, 100, 104, 107, 112];
    sparkle.forEach((midi, i) => player.pickup(time + i * THIRTYSECOND, midi, 1.4));
  });

  // The heart's killing blow: the band bows out for a breath, a great bell
  // tolls the tonic, the organ opens into E major, and a glockenspiel runs
  // up the major chord while the table applauds.
  function heartFinale() {
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    const time = score.nextGridTime(ctx.currentTime, 2);
    mix.duckAt(time, 0.15, 2.2);
    score.overrideSection(4);
    player.gong(time, 40);
    player.stab(time, [52, 56, 59, 63, 66], 1.4, 0.9);
    [76, 80, 83, 88, 92, 95, 100].forEach((midi, i) => player.bell(time + SIXTEENTH * (2 + i), midi, KILL_VOICES[0], 0.9 - i * 0.06));
    player.applause(time + SIXTEENTH * 4, 1);
    player.applause(time + SIXTEENTH * 6, 0.8);
  }

  return runtime;
}

const BAR_SECONDS_LOCAL = TINKER_TIME.barSeconds;
