import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createStrandlineVoices, type BellTimbre } from './audio-voices';
import { crownChannel } from './crown';
import { strandPasses } from './forest';
import {
  SECTION,
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_SCORE_SECTIONS,
  STRANDLINE_STEPS_PER_BAR,
  STRANDLINE_TIME,
  type SectionIndex,
} from './timing';

// Strandline's score is the jellyfish coming back to life. It opens on the
// animal's own heartbeat — one slow bell contraction per bar — under a dark
// pad, a few drips, and the parasite's sour drone. Each phrase adds light:
// glass plucks and a soft pulse when the forest kindles, a wordless choir and
// chimes when the bell fills the frame, the full water-percussion groove on
// the climb upstream. At the crown the parasite's drone returns in three
// layers — one per web sector — and each brood cleared silences one. When
// the parent is torn loose the pulse halves, the harmony resolves to D major,
// and the heartbeat turns serene.
//
// The player is the soloist: locks are droplets climbing the live chord,
// shots are bubbles rooted on it, and every kill plays the next note of a
// hidden per-section melody lane, so a volley performs a phrase.

const SIXTEENTH = STRANDLINE_TIME.stepSeconds;
const STEPS = STRANDLINE_STEPS_PER_BAR;
const BAR = STRANDLINE_TIME.barSeconds;

type Chord = { name: string; bass: number; pad: readonly number[]; lead: readonly number[] };

const chord = (name: string, bass: number, pad: number[], lead: number[]): Chord => ({ name, bass, pad, lead });

// B minor and D major share a key; the level walks from one to the other.
const H = {
  Bm9: chord('Bm9', 35, [50, 54, 57, 61], [66, 69, 71, 73, 74, 78, 81, 83]),
  Gmaj9: chord('Gmaj9', 31, [50, 54, 57, 59], [67, 69, 71, 74, 78, 79, 81, 83]),
  Dmaj9: chord('Dmaj9', 38, [49, 54, 57, 64], [66, 69, 73, 74, 76, 78, 81, 85]),
  A6sus: chord('A6sus', 33, [52, 54, 59, 62], [64, 66, 69, 71, 76, 78, 81, 83]),
  Gmaj7s11: chord('Gmaj7#11', 31, [50, 54, 59, 61], [66, 67, 71, 73, 74, 78, 79, 83]),
  DoverFs: chord('D/F#', 42, [50, 57, 61, 64], [66, 69, 73, 74, 76, 78, 81, 85]),
  Em11: chord('Em11', 40, [50, 55, 57, 62], [64, 67, 69, 71, 74, 76, 79, 81]),
  Bmadd9: chord('Bm(add9)', 35, [50, 54, 59, 61], [66, 69, 71, 73, 74, 78, 81, 83]),
  CoverB: chord('C/B', 35, [48, 52, 55, 59], [64, 67, 71, 72, 76, 79, 83, 84]),
  Gmaj7: chord('Gmaj7', 31, [50, 54, 55, 59], [66, 67, 71, 74, 78, 79, 83, 86]),
  Fs7sus: chord('F#7sus', 30, [49, 54, 59, 64], [66, 71, 73, 76, 78, 83, 85, 88]),
  DmajPedal: chord('Dmaj9', 38, [54, 57, 61, 64], [66, 69, 73, 74, 76, 78, 81, 85]),
  GoverD: chord('Gmaj9/D', 38, [55, 59, 62, 66], [67, 69, 71, 74, 78, 79, 81, 83]),
  D69: chord('D6/9', 38, [54, 59, 62, 64], [66, 69, 71, 74, 76, 78, 81, 83]),
} as const;

const SERENE: readonly Chord[] = [H.DmajPedal, H.GoverD, H.DmajPedal, H.D69];
const BLIGHT: readonly Chord[] = [H.Bmadd9, H.CoverB];

// Kill lanes: degrees into the live chord's lead set, one bar long. Each
// section's contour is its own melody; a volley walks it step by step.
const KILL_LANES: Record<SectionIndex, readonly number[]> = {
  [SECTION.drift]: [0, 2, 4, 3, 5, 4, 2, 3, 4, 6, 5, 3, 4, 2, 1, 2],
  [SECTION.kindle]: [0, 2, 4, 5, 4, 2, 4, 6, 5, 4, 2, 4, 5, 7, 6, 4],
  [SECTION.moon]: [7, 5, 6, 4, 5, 3, 4, 2, 3, 4, 5, 6, 7, 6, 5, 4],
  [SECTION.upstream]: [0, 4, 2, 5, 3, 6, 4, 7, 5, 3, 6, 4, 2, 5, 1, 4],
  [SECTION.crown]: [7, 6, 5, 3, 6, 5, 4, 2, 5, 4, 3, 1, 4, 3, 2, 0],
  [SECTION.serene]: [4, 5, 7, 5, 4, 2, 4, 5, 7, 6, 5, 4, 2, 4, 5, 7],
  [SECTION.blight]: [0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 3, 2],
};

// The player's instruments brighten as the animal wakes.
const KILL_TIMBRE: Record<SectionIndex, BellTimbre> = {
  [SECTION.drift]: { wave: 'sine', partial: 2.76, partialGain: 0.22, decay: 0.95, cutoff: 3000, gain: 0.16 },
  [SECTION.kindle]: { wave: 'triangle', partial: 4.01, partialGain: 0.3, decay: 0.55, cutoff: 3200, gain: 0.15 },
  [SECTION.moon]: { wave: 'sine', partial: 2.76, partialGain: 0.45, decay: 1.3, cutoff: 4000, gain: 0.16 },
  [SECTION.upstream]: { wave: 'triangle', partial: 3.0, partialGain: 0.36, decay: 0.45, cutoff: 3600, gain: 0.15 },
  [SECTION.crown]: { wave: 'square', partial: 2.76, partialGain: 0.3, decay: 0.5, cutoff: 2100, gain: 0.075 },
  [SECTION.serene]: { wave: 'sine', partial: 2.76, partialGain: 0.3, decay: 1.6, cutoff: 4000, gain: 0.16 },
  [SECTION.blight]: { wave: 'sine', partial: 2.2, partialGain: 0.25, decay: 0.6, cutoff: 2000, gain: 0.12 },
};
const LOCK_BRIGHTNESS: Record<SectionIndex, number> = {
  [SECTION.drift]: 0,
  [SECTION.kindle]: 0.3,
  [SECTION.moon]: 0.6,
  [SECTION.upstream]: 0.5,
  [SECTION.crown]: 0.75,
  [SECTION.serene]: 0.8,
  [SECTION.blight]: 0,
};
const FIRE_CUTOFF: Record<SectionIndex, number> = {
  [SECTION.drift]: 900,
  [SECTION.kindle]: 1300,
  [SECTION.moon]: 1800,
  [SECTION.upstream]: 2000,
  [SECTION.crown]: 2400,
  [SECTION.serene]: 2000,
  [SECTION.blight]: 800,
};

// Parasite drones at the crown: one layer per living web sector.
const SOUR_LAYERS = [47, 54, 60];

export function createAudio(bus: EventBus) {
  return createStrandlineAudio(bus).audio;
}

export const traceStrandlineAudio = createAudioTraceHarness({
  level: 'strandline-tmbx',
  bpm: STRANDLINE_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: 60,
  createAudio: createStrandlineAudio,
});

type Ending = { kind: 'serene' | 'blight'; fromBar: number };

function createStrandlineAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let ending: Ending | null = null;
  let sectorsAlive = 3;
  let exposed = false;
  let parentHp = 12;
  let parentId = -1;
  // Behind the run summary the water keeps the ending's key: serene if she
  // was freed, the sick drift otherwise.
  let afterglow: Ending['kind'] | null = null;

  const endingChord = (position: number): Chord | null => {
    if (!ending) return null;
    const bar = Math.floor(position / STEPS);
    if (bar < ending.fromBar) return null;
    const cycle = ending.kind === 'serene' ? SERENE : BLIGHT;
    return cycle[(bar - ending.fromBar) % cycle.length];
  };

  const score = createScore<Chord, SectionIndex>({
    bpm: STRANDLINE_BPM,
    stepsPerBar: STEPS,
    chords: [H.Bm9, H.Gmaj9],
    barsPerChord: 2,
    // Alternate sets index by absolute bar, so each list starts where its
    // first bar lands in the cycle.
    alternateChordSets: [
      { fromBar: STRANDLINE_BARS.kindle, toBar: STRANDLINE_BARS.swing, chords: [H.Bm9, H.Gmaj9, H.Dmaj9, H.A6sus], barsPerChord: 1 },
      { fromBar: STRANDLINE_BARS.swing, toBar: STRANDLINE_BARS.upstream, chords: [H.DoverFs, H.Em11, H.Gmaj7s11], barsPerChord: 1 },
      { fromBar: STRANDLINE_BARS.upstream, toBar: STRANDLINE_BARS.crown, chords: [H.Gmaj9, H.Dmaj9, H.A6sus, H.Bm9], barsPerChord: 1 },
      { fromBar: STRANDLINE_BARS.crown, chords: [H.CoverB, H.Gmaj7, H.Fs7sus, H.Bmadd9], barsPerChord: 1 },
    ],
    sections: STRANDLINE_SCORE_SECTIONS,
    killLanes: KILL_LANES,
    leadSet: (base, position) => (endingChord(position) ?? base).lead,
  });

  const harmonyAt = (position: number) => endingChord(position) ?? score.chordAt(position);

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.85,
    score,
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -16, ratio: 4, attack: 0.006, release: 0.25 },
      delay: { time: SIXTEENTH * 3, feedback: 0.36, dampHz: 2400 },
      reverb: { seconds: 3.4, decay: 2.6, level: 0.42 },
      noiseSeconds: 2,
    },
    onPostBuild(context) {
      ctx = context;
    },
    onStep: scheduleStep,
    onRunStart() {
      ending = null;
      afterglow = null;
      sectorsAlive = 3;
      exposed = false;
      parentHp = 12;
      score.clearOverride();
    },
    onRunEnd() {
      afterglow = ending?.kind ?? null;
      score.clearOverride();
    },
    onDispose() {
      ctx = null;
    },
  });

  const voices = createStrandlineVoices({ trace, context: () => runtime.context() ?? ctx, mix: runtime.mix });

  // ---- arrangement ------------------------------------------------------------

  const every = (bars: number, play: (time: number, chordNow: Chord) => void): ArrangementTrack<Chord> =>
    fn(({ step, barInSection, time, chord: chordNow }) => {
      if (step === 0 && barInSection % bars === 0) play(time, chordNow);
    });

  const pulseTrack = (vel: number, pattern = 'P...............') =>
    hits<Chord>(pattern, { P: vel, p: vel * 0.55 }, ({ time, chord: chordNow }, velocity) => voices.pulse(time, chordNow.bass + 12, velocity));

  const padTrack = (bars: number, cutoff: number, gain: number) =>
    every(bars, (time, chordNow) => voices.pad(time, chordNow.pad, BAR * bars * 1.02, cutoff, gain));

  const dripTrack = (pattern: string, vel: number) =>
    hits<Chord>(pattern, { d: vel, D: vel * 1.4 }, ({ time, step, bar, chord: chordNow }, velocity) => {
      const lead = chordNow.lead;
      voices.drip(time, lead[(step * 3 + bar * 5) % lead.length] + 12, velocity);
    });

  const ARP_ORDER = [0, 2, 1, 4, 2, 5, 3, 6];
  const arpTrack = (pattern: string, vel: number, bright: number, octave = 0) =>
    hits<Chord>(pattern, { a: vel, A: vel * 1.35 }, ({ time, step, chord: chordNow }, velocity) => {
      const index = ARP_ORDER[Math.floor(step / 2) % ARP_ORDER.length];
      voices.glass(time, chordNow.lead[index] - 12 + octave, velocity, bright);
    });

  const kickTrack = (pattern: string) => hits<Chord>(pattern, { K: 1, k: 0.65 }, ({ time }, vel) => voices.kick(time, vel));
  const shakerTrack = (pattern: string, level: number) =>
    hits<Chord>(pattern, { s: level, S: level * 1.8 }, ({ time }, vel) => voices.shaker(time, vel));
  const clickTrack = (pattern: string) => hits<Chord>(pattern, { c: 0.6, C: 1 }, ({ time }, vel) => voices.click(time, vel));
  const bassTrack = (pattern: string, length: number) =>
    hits<Chord>(pattern, { B: 1, b: 0.7, o: 0.7, f: 0.65 }, ({ time, chord: chordNow }, vel, symbol) => {
      const offset = symbol === 'o' ? 12 : symbol === 'f' ? 7 : 0;
      voices.bass(time, chordNow.bass + 12 + offset, vel, length);
    });

  // The parasite's drone: in the drift one quiet layer, at the crown one per
  // living web sector.
  const sourTrack = (layers: () => number, gain: number) =>
    fn<Chord>(({ step, time }) => {
      if (step !== 0) return;
      for (let i = 0; i < layers(); i += 1) voices.sour(time, SOUR_LAYERS[i], BAR * 1.05, gain);
    });

  // Upstream counter-line in the flute register, clear of the kill lane.
  const FLUTE_LINE: ReadonlyArray<readonly [step: number, degree: number, length: number]> = [
    [0, 4, 3], [6, 3, 2], [8, 2, 4], [16, 3, 3], [22, 5, 2], [24, 4, 6],
  ];
  const fluteTrack = fn<Chord>(({ step, barInSection, time, chord: chordNow }) => {
    const position = (barInSection % 2) * STEPS + step;
    for (const [at, degree, length] of FLUTE_LINE) {
      if (at === position) voices.flute(time, chordNow.lead[degree] - 12, length * SIXTEENTH * 2, 1);
    }
  });

  const chimeTrack = (pattern: string, vel: number) =>
    hits<Chord>(pattern, { c: vel }, ({ time, step, chord: chordNow }, velocity) => {
      const lead = chordNow.lead;
      voices.chime(time, lead[lead.length - 1 - (Math.floor(step / 4) % 4)] + 12, velocity);
    });

  const choirTrack = (gain: number) => every(1, (time, chordNow) => voices.choir(time, chordNow.pad.map((m) => m + 12).slice(0, 3), BAR * 1.1, gain));

  const run = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: harmonyAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'drift',
        fromBar: 0,
        toBar: 4,
        tracks: [
          pulseTrack(0.8),
          padTrack(2, 620, 0.03),
          dripTrack('....d.......d.....d.........D...', 0.8),
          sourTrack(() => 1, 0.014),
        ],
      },
      {
        name: 'kindle',
        fromBar: 4,
        toBar: 8,
        tracks: [
          pulseTrack(0.85),
          padTrack(1, 1050, 0.028),
          arpTrack('a.a.a.a.a.a.a.a.', 0.75, 0.2),
          kickTrack('k.......k.......'),
          shakerTrack('..s...s...s...s.', 0.025),
          bassTrack('B...............', BAR * 0.9),
          dripTrack('..........d.....', 0.6),
          oneShot(3, 8, ({ time }) => voices.riser(time, BAR * 0.5, 0.09)),
        ],
      },
      {
        name: 'green moon',
        fromBar: 8,
        toBar: 11,
        tracks: [
          pulseTrack(0.95),
          padTrack(1, 2400, 0.03),
          choirTrack(0.012),
          chimeTrack('c...c...c...c...', 0.9),
          arpTrack('a...a...a...a...', 0.6, 0.6, 12),
          bassTrack('B...............', BAR * 1.1),
          oneShot(2, 8, ({ time }) => voices.riser(time, BAR * 0.5, 0.12)),
        ],
      },
      {
        name: 'upstream',
        fromBar: 11,
        toBar: 15,
        tracks: [
          pulseTrack(1),
          padTrack(1, 1800, 0.024),
          arpTrack('aaAaaaAaaaAaaaAa', 0.55, 0.5),
          kickTrack('K.....k.k.......'),
          clickTrack('....C.......C..c'),
          shakerTrack('ssSsssSsssSsssSs', 0.02),
          bassTrack('B..o..b.B...f.o.', SIXTEENTH * 2.5),
          fluteTrack,
          oneShot(3, 0, ({ time }) => voices.riser(time, BAR, 0.14)),
        ],
      },
      {
        name: 'the crown',
        fromBar: 15,
        tracks: [
          pulseTrack(1, 'P.......p.......'),
          padTrack(1, 900, 0.026),
          kickTrack('k...k...k...k...'),
          clickTrack('..c...c...c..cc.'),
          shakerTrack('.s.s.s.s.s.s.s.s', 0.018),
          bassTrack('B.B...B.B...B.o.', SIXTEENTH * 1.6),
          arpTrack('a.a.a.a.a.a.a.a.', 0.5, 0.4),
          sourTrack(() => (exposed ? 0 : sectorsAlive), 0.013),
          fn<Chord>(({ step, time, chord: chordNow }) => {
            // Bare: the green harmony comes back over the fight.
            if (exposed && step === 0) voices.choir(time, chordNow.pad.map((m) => m + 12).slice(0, 3), BAR * 1.1, 0.01);
          }),
        ],
      },
    ],
  });

  // Endings, scheduled from the bar they start on (local positions).
  const endingHarmony = (local: number) => harmonyAt(local + (ending?.fromBar ?? 0) * STEPS);
  const serene = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: endingHarmony,
    trace,
    emitSections: true,
    sections: [{
      name: 'serene',
      fromBar: 0,
      tracks: [
        pulseTrack(0.7, 'P...............................'),
        padTrack(1, 3000, 0.032),
        choirTrack(0.014),
        hits<Chord>('c...c...c...c...c.......c.......', { c: 0.8 }, ({ time, step }, vel) => {
          const peal = [86, 83, 81, 78, 76, 74, 71, 69];
          voices.chime(time, peal[Math.floor(step / 4) % peal.length], vel);
        }),
        bassTrack('B...............', BAR * 1.2),
      ],
    }],
  });

  const blight = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: endingHarmony,
    trace,
    emitSections: true,
    sections: [{
      name: 'blight',
      fromBar: 0,
      tracks: [
        pulseTrack(0.55, 'P...............'),
        padTrack(1, 520, 0.024),
        sourTrack(() => 3, 0.016),
      ],
    }],
  });

  const ambient = createArrangement<Chord>({
    stepsPerBar: STEPS,
    chordAt: (position) => {
      const bar = Math.floor(position / STEPS);
      if (afterglow === 'serene') return SERENE[bar % SERENE.length];
      if (afterglow === 'blight') return BLIGHT[bar % BLIGHT.length];
      return score.chordAt(position % (STEPS * 4));
    },
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        pulseTrack(0.55),
        fn<Chord>(({ step, bar, time, chord: chordNow }) => {
          if (step !== 0) return;
          const serene = afterglow === 'serene';
          if (bar % 2 === 0) voices.pad(time, chordNow.pad, BAR * 2.04, serene ? 2600 : 560, serene ? 0.028 : 0.026);
          if (serene && bar % 2 === 1) voices.chime(time + SIXTEENTH * 4, chordNow.lead[7] + 12, 0.5);
        }),
        dripTrack('......d...................d.....', 0.55),
      ],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') {
      ambient.schedule(position, time);
      return;
    }
    const bar = Math.floor(position / STEPS);
    if (ending && bar >= ending.fromBar) {
      const local = position - ending.fromBar * STEPS;
      const arrangement = ending.kind === 'serene' ? serene : blight;
      if (local === 0) arrangement.recordSectionStart(time, 0);
      arrangement.schedule(local, time);
      return;
    }
    if (position % STEPS === 0) run.recordSectionStart(time, bar);
    run.schedule(position, time);
    scheduleStrandPasses(position, time);
  }

  // The rail threads close past strands; each pass is a breath of moving
  // water on the side it passes. Deterministic: the passes come from the same
  // forest and camera path the visuals draw.
  const passes = strandPasses();
  let nextPass = 0;
  function scheduleStrandPasses(position: number, time: number) {
    const from = position * SIXTEENTH;
    if (position === 0) nextPass = 0;
    while (nextPass < passes.length && passes[nextPass].time < from) nextPass += 1;
    while (nextPass < passes.length && passes[nextPass].time < from + SIXTEENTH) {
      const pass = passes[nextPass];
      voices.whoosh(time + (pass.time - from), pass.pan, 0.012 + pass.closeness * 0.03);
      nextPass += 1;
    }
  }

  // ---- musical position ---------------------------------------------------------

  const context = () => runtime.context() ?? ctx;

  function positionAt(time: number) {
    return score.arrangementPositionAt(time);
  }

  function sectionLayers(position: number): Array<[SectionIndex, number]> {
    const mix = score.sectionMixAt(position);
    return mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  function startEnding(kind: Ending['kind']) {
    const c = context();
    if (!c || ending) return;
    const nextBar = Math.ceil((positionAt(c.currentTime) + 2) / STEPS);
    ending = { kind, fromBar: nextBar };
    score.overrideSection(kind === 'serene' ? SECTION.serene : SECTION.blight);
  }

  // ---- the player's instruments ----------------------------------------------------

  bus.on('lock', ({ lockCount }) => {
    const c = context();
    if (!c) return;
    const time = score.quantizePlayerAction(c.currentTime);
    const position = positionAt(time);
    const lead = score.leadSetAt(position);
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    let bright = 0;
    for (const [section, weight] of sectionLayers(position)) bright += LOCK_BRIGHTNESS[section] * weight;
    voices.droplet(time, midi, 0.1 + lockCount * 0.008, bright);
    if (lockCount === 6) voices.sparkle(time + SIXTEENTH, lead[lead.length - 1] + 12, 0.05);
  });

  bus.on('fire', ({ indexInVolley }) => {
    const c = context();
    if (!c) return;
    const time = score.quantizePlayerAction(c.currentTime);
    const position = positionAt(time);
    let cutoff = 0;
    for (const [section, weight] of sectionLayers(position)) cutoff += FIRE_CUTOFF[section] * weight;
    const root = harmonyAt(position).bass + 24;
    voices.thoop(time, root + ((indexInVolley ?? 0) % 2 === 1 ? 7 : 0), 0.07, cutoff);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const c = context();
    if (!c) return;
    if (enemyId === parentId) {
      parentFinale();
      return;
    }
    const kill = score.nextKill(c.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    const chain = indexInVolley ?? 0;
    const vel = Math.min(1.35, 1 + chain * 0.1);
    for (const [section, weight] of sectionLayers(position)) {
      if (weight < 0.03) continue;
      voices.killBell(kill.time, kill.midi, KILL_TIMBRE[section], vel, weight);
    }
    if (chain >= 2) voices.sparkle(kill.time, kill.midi + 12, 0.035 + chain * 0.006);
  });

  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const c = context();
    if (!c || lethal) return;
    const time = score.nextGridTime(c.currentTime, 0.5);
    const position = positionAt(time);
    const lead = score.leadSetAt(position);
    if (enemyId === parentId) {
      // Tearing at the parent rings a climbing bell over a sub: the closer
      // it is to coming loose, the higher and brighter.
      const torn = 1 - hitPointsRemaining / parentHp;
      voices.chime(time, lead[Math.min(lead.length - 1, Math.floor(torn * lead.length))] + 12, 0.45 + torn * 0.35);
      voices.subDrop(time, 90, 45, 0.08 + torn * 0.07, 0.35);
      return;
    }
    voices.chip(time, lead[2] + 12, 0.07);
  });

  bus.on('volley', ({ size, kills }) => {
    const c = context();
    if (!c || kills < 5 || kills < size) return;
    const time = score.nextGridTime(c.currentTime, 4);
    const pad = harmonyAt(positionAt(time)).pad;
    voices.bloom(time, pad.map((m) => m + 24), 0.035, SIXTEENTH / 2);
  });

  bus.on('reject', () => {
    const c = context();
    if (c) voices.sourBlurp(c.currentTime);
  });

  // Only parasites that get away sink with a blub — not spores that already
  // landed, not the crown's own clock at the end of the run.
  const kinds = new Map<number, string>();
  bus.on('miss', ({ enemyId, letter }) => {
    const c = context();
    const kind = kinds.get(enemyId);
    kinds.delete(enemyId);
    if (c && letter === undefined && kind !== 'spore' && kind !== 'crown') voices.blub(c.currentTime);
  });

  bus.on('playerhit', () => {
    const c = context();
    if (c) voices.sting(c.currentTime);
  });

  bus.on('spawn', ({ kind, enemyId }) => {
    const c = context();
    kinds.set(enemyId, kind);
    if (kind === 'parent') parentId = enemyId;
    if (!c) return;
    if (kind === 'spore') {
      // The spit lands on the grid, pitched to the parasite's sour C.
      voices.sporePop(score.nextGridTime(c.currentTime, 1), 60);
    }
  });

  bus.on('runstart', () => {
    parentId = -1;
    kinds.clear();
  });

  bus.on('stage', ({ enemyId }) => {
    const c = context();
    if (!c || enemyId !== parentId) return;
    const time = score.nextGridTime(c.currentTime, 1);
    voices.tear(time, 0.16);
    voices.subDrop(time, 120, 38, 0.4, 0.9);
    voices.sourStab(time, [47, 48, 54], 0.05);
  });

  function parentFinale() {
    const c = context();
    const mix = runtime.mix();
    if (!c || !mix) return;
    const time = score.nextGridTime(c.currentTime, 2);
    // The music holds its breath, then everything resolves onto D.
    mix.duckAt(time, 0.18, 2.6);
    voices.subDrop(time, 146.8, 36.7, 0.5, 1.6);
    voices.tear(time, 0.12);
    voices.bloom(time, [62, 66, 69, 73, 76, 81], 0.06, SIXTEENTH / 2);
    voices.bloom(time + SIXTEENTH * 8, [86, 83, 81, 78, 74, 69, 66, 62], 0.045, SIXTEENTH);
    startEnding('serene');
  }

  crownChannel(bus).on((signal) => {
    const c = context();
    if (!c) return;
    const time = score.nextGridTime(c.currentTime, 1);
    switch (signal.type) {
      case 'arrive':
        voices.sourStab(time, [47, 54, 60], 0.045);
        voices.subDrop(time, 70, 40, 0.3, 1.2);
        break;
      case 'pump':
        // A wet gulp from the crown as the brood is pushed out.
        voices.subDrop(time, 95, 55, 0.22, 0.4);
        voices.sourStab(time, [SOUR_LAYERS[signal.sector] ?? 47], 0.035);
        break;
      case 'wither': {
        sectorsAlive = signal.remaining;
        const lead = score.leadSetAt(positionAt(time));
        voices.tear(time, 0.07);
        voices.bloom(time, [lead[0], lead[2], lead[4], lead[6]].map((m) => m + 12), 0.04, SIXTEENTH / 2);
        break;
      }
      case 'expose':
        exposed = true;
        voices.riser(time, BAR * 0.5, 0.12);
        voices.bloom(time + BAR * 0.5, harmonyAt(positionAt(time)).pad.map((m) => m + 12), 0.04, 0);
        break;
      case 'tear':
        break;
      case 'burrow':
        voices.sourStab(time, [47, 48, 54, 60], 0.06);
        startEnding('blight');
        break;
    }
  });

  return runtime;
}
