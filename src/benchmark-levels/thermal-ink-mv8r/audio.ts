import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, hits, oneShot, type ArrangementTrack } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import { createThermalInkVoices, type ThermalInkBuses } from './audio-voices';
import { ARM_ATTACKS } from './gameplay';
import { onThermalChange, sense } from './sense';
import { BAR, BARS, BEAT, INK_CLOUDS, SCORE_SECTIONS, STEPS_PER_BAR, THERMAL_INK_BPM, TIME, bar, type ScoreSectionIndex } from './timing';

// THE SCORE. A slow industrial pulse at 96 BPM: a steam-hammer kick, a heavy
// bass that bounces off it (side-chained), sparse clanks and chain rattles,
// sodium-lamp hum under everything, and one haunting melody in D minor.
//
// The melody always speaks with two voices at once — a hazy, detuned murk
// voice and a bright, dry, exact thermal voice — and the player's sight picks
// which one you hear. In thermal the noise bus falls back and the melody
// focuses; blind in ink without it, the whole score muffles as if underwater.
//
// Player actions are notes: locks climb the live chord, harpoons fire on the
// root, kills play a written lane (struck pipes in murk, sonar pings in
// thermal), wounds on the creature ring a wet anvil that grows as it dies,
// and the killing blow gets a scored finale that resolves into D major as
// the harbor lamps come back.

const STEP = TIME.stepSeconds;

type Chord = { name: string; bass: number; pad: readonly number[]; arp: readonly number[] };
const A7: Chord = { name: 'A7', bass: 33, pad: [57, 61, 64, 67], arp: [69, 73, 76, 79] };
const DM: Chord = { name: 'Dm', bass: 38, pad: [57, 62, 65, 69], arp: [74, 77, 81, 86] };
const BB: Chord = { name: 'Bbmaj7', bass: 34, pad: [58, 62, 65, 69], arp: [70, 74, 77, 81] };
const GM: Chord = { name: 'Gm7', bass: 31, pad: [55, 58, 62, 65], arp: [67, 70, 74, 79] };
const DMAJ: Chord = { name: 'D', bass: 38, pad: [57, 62, 66, 69], arp: [74, 78, 81, 86] };

// Kill lanes: degrees into the live lead set (the chord's arp plus the same an
// octave up). Each section writes its own contour so volleys play phrases.
const KILL_LANES: Record<ScoreSectionIndex, number[]> = {
  // Murk: a questioning figure that circles and lifts.
  0: [2, 3, 4, 3, 2, 1, 2, 4, 3, 4, 5, 4, 3, 2, 3, 5, 4, 5, 6, 5, 4, 3, 4, 6, 5, 4, 3, 2, 3, 4, 5, 7],
  // Ink: high sonar answers, searching.
  1: [4, 6, 5, 4, 6, 7, 6, 4, 5, 4, 6, 5, 7, 6, 5, 4, 4, 5, 6, 7, 6, 5, 4, 5, 6, 4, 5, 6, 7, 6, 5, 4],
  // Circling: broken-chord zig-zags that race around the creature.
  2: [0, 2, 4, 6, 1, 3, 5, 7, 2, 4, 6, 4, 3, 5, 7, 5, 4, 2, 0, 2, 5, 3, 1, 3, 6, 4, 2, 4, 7, 5, 3, 5],
  // Mantle: climbing runs toward the top of the register.
  3: [1, 2, 3, 4, 5, 6, 7, 6, 2, 3, 4, 5, 6, 7, 6, 5, 3, 4, 5, 6, 7, 6, 5, 4, 4, 5, 6, 7, 7, 6, 7, 7],
  // Blackout and lamps: falling peals.
  4: [7, 6, 5, 4, 6, 5, 4, 3, 5, 4, 3, 2, 4, 3, 2, 1, 7, 5, 6, 4, 5, 3, 4, 2, 3, 1, 2, 0, 4, 5, 6, 7],
};
const LOCK_DEGREES = [1, 2, 3, 4, 5, 6];

// The melody: [step, midi, length in steps], one row per bar. The phrase runs
// over Dm | Dm | Bb | Bb | Gm | Gm | A | A and hangs on the leading tone.
type Note = readonly [number, number, number];
const PHRASE: ReadonlyArray<readonly Note[]> = [
  [[0, 74, 6], [6, 69, 2], [8, 65, 8]],
  [[0, 64, 4], [4, 65, 2], [6, 67, 2], [8, 69, 8]],
  [[0, 74, 6], [6, 69, 2], [8, 65, 4], [12, 74, 2], [14, 72, 2]],
  [[0, 70, 12], [12, 69, 4]],
  [[0, 67, 6], [6, 70, 2], [8, 74, 8]],
  [[0, 72, 4], [4, 70, 4], [8, 69, 4], [12, 67, 4]],
  [[0, 69, 6], [6, 73, 2], [8, 76, 8]],
  [[0, 77, 4], [4, 76, 4], [8, 73, 8]],
];
// The mantle: the opening two bars again, an octave higher.
const CLIMAX: ReadonlyArray<readonly Note[]> = [
  [[0, 86, 6], [6, 81, 2], [8, 77, 8]],
  [[0, 76, 4], [4, 77, 2], [6, 79, 2], [8, 81, 8]],
];
// The blackout: only fragments survive in the dark.
const FRAGMENTS: ReadonlyArray<readonly Note[]> = [
  [[0, 76, 10]],
  [[8, 73, 8]],
];
// The lamps: the leading tone finally resolves, into major.
const RESOLVE: ReadonlyArray<readonly Note[]> = [
  [[0, 78, 8], [8, 76, 4], [12, 74, 4]],
  [[0, 74, 16]],
];

// Section grooves. One character per sixteenth.
const KICK = {
  heart: 'K.......k.......',
  murk: 'K.......K.....k.',
  drive: 'K.......K..k..k.',
  mantle: 'K...K...K...K.k.',
};
const BASS = {
  held: 'B...............',
  murk: 'B.....b.B..b..f.',
  drive: 'B..bB..bB..b.bf.',
  mantle: 'B.bbB.bbB.bbBbfb',
  lamps: 'B.......f.......',
};
const HAMMER = {
  murk: '....H.......H...',
  drive: '....H...h...H..h',
  mantle: '..h.H.h...h.H.hh',
};

/** Step lengths until the next hit in a pattern, for sustained bass notes. */
function holdLengths(pattern: string) {
  const lengths: number[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    let next = i + 1;
    while (next < pattern.length && pattern[next] === '.') next += 1;
    lengths.push(next - i);
  }
  return lengths;
}

// Set pieces the score hits on the same clock as the fight.
type Cue = { time: number; play: (time: number) => void };

export function createAudio(bus: EventBus) {
  return createThermalInkAudio(bus).audio;
}

export const traceThermalInkAudio = createAudioTraceHarness({
  level: 'thermal-ink-mv8r',
  bpm: THERMAL_INK_BPM,
  stepSeconds: STEP,
  defaultSeconds: 60,
  createAudio: createThermalInkAudio,
});

function createThermalInkAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let buses: ThermalInkBuses | null = null;
  let filters: {
    metal: BiquadFilterNode;
    metalGain: GainNode;
    bass: BiquadFilterNode;
    music: BiquadFilterNode;
    rumble: GainNode;
    hum: GainNode;
  } | null = null;

  const score = createScore<Chord, ScoreSectionIndex>({
    bpm: THERMAL_INK_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: [A7, DM, BB, GM],
    barsPerChord: 2,
    alternateChordSets: [{ fromBar: 18, chords: [DM, A7, DMAJ], barsPerChord: 2 }],
    sections: SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP,
    volumeScale: 0.85,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -16, knee: 8, ratio: 4, attack: 0.004, release: 0.25 },
      delay: { time: STEP * 3, feedback: 0.36, dampHz: 2400 },
      reverb: { seconds: 3.4, decay: 2.4, level: 0.42 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      const gain = (value: number) => {
        const node = context.createGain();
        node.gain.value = value;
        return node;
      };
      const lowpass = (frequency: number, q = 0.7) => {
        const node = context.createBiquadFilter();
        node.type = 'lowpass';
        node.frequency.value = frequency;
        node.Q.value = q;
        return node;
      };
      const musicIn = gain(1);
      const music = lowpass(18000);
      musicIn.connect(music).connect(mix.duck);
      const drums = gain(0.9);
      drums.connect(musicIn);
      const metal = gain(1);
      const metalFilter = lowpass(14000);
      const metalGain = gain(1);
      metal.connect(metalFilter).connect(metalGain).connect(musicIn);
      const bass = gain(1);
      const bassFilter = lowpass(6000);
      bass.connect(bassFilter).connect(musicIn);
      const tone = gain(1);
      tone.connect(musicIn);
      const melMurk = gain(1);
      const melThermal = gain(0);
      melMurk.connect(musicIn);
      melThermal.connect(musicIn);
      const reverb = mix.reverbSend ?? gain(0);
      const delay = mix.delaySend ?? gain(0);
      buses = { drums, metal, bass, tone, melMurk, melThermal, reverb, delay, sfx: mix.sfx };

      // Ink pressure: a low rumble that swells while you are inside the cloud.
      const rumbleSource = context.createBufferSource();
      rumbleSource.buffer = mix.noiseBuffer ?? null;
      rumbleSource.loop = true;
      const rumbleFilter = lowpass(160, 1.2);
      const rumble = gain(0);
      rumbleSource.connect(rumbleFilter).connect(rumble).connect(mix.duck);
      rumbleSource.start();

      // Sodium-lamp hum, tuned to D: it dies with the lamps and returns with them.
      const hum = gain(0.0);
      const humFilter = lowpass(1100, 1);
      humFilter.connect(hum).connect(tone);
      for (const [type, freq, level] of [['sine', 73.42, 1], ['triangle', 146.83, 0.45], ['sawtooth', 293.66, 0.08]] as const) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        const oscGain = gain(level);
        osc.connect(oscGain).connect(humFilter);
        osc.start();
      }
      filters = { metal: metalFilter, metalGain, bass: bassFilter, music, rumble, hum };
      applySenses(context.currentTime, 0.05);
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      coreId = -1;
      coreMaxHp = 0;
      nodeMaxHp.clear();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      const time = score.nextGridTime(context.currentTime, 4);
      voices.foghorn(time, 38, 3, 0.8);
      voices.pad(time, [...DMAJ.pad], BAR * 2, 1);
    },
    onDispose() {
      ctx = null;
      buses = null;
      filters = null;
      offThermal();
    },
  });

  const voices = createThermalInkVoices({ trace, context: () => ctx, mix: runtime.mix, buses: () => buses });

  // ---- the senses, in the mix ----------------------------------------------------

  function applySenses(time: number, smoothing: number) {
    if (!filters || !buses) return;
    const thermal = sense.thermalOn ? 1 : 0;
    const blind = sense.ink * (1 - thermal);
    filters.metalGain.gain.setTargetAtTime(thermal ? 0.22 : 1 - blind * 0.4, time, smoothing);
    filters.metal.frequency.setTargetAtTime(thermal ? 1300 : 14000 - blind * 11000, time, smoothing);
    filters.bass.frequency.setTargetAtTime(thermal ? 480 : 6000, time, smoothing);
    buses.melMurk.gain.setTargetAtTime(thermal ? 0 : 1, time, smoothing);
    buses.melThermal.gain.setTargetAtTime(thermal ? 1.35 : 0, time, smoothing);
    filters.music.frequency.setTargetAtTime(thermal ? 17000 : 17000 - blind * 16300, time, smoothing * 2);
    filters.rumble.gain.setTargetAtTime(sense.ink * (thermal ? 0.04 : 0.11), time, 0.2);
    filters.hum.gain.setTargetAtTime(sense.lamps * 0.02 * (1 - thermal * 0.7), time, 0.08);
  }

  const offThermal = onThermalChange((on) => {
    const context = runtime.context();
    if (!context) return;
    applySenses(context.currentTime, on ? 0.015 : 0.09);
    voices.sightSwitch(context.currentTime, on);
  });

  // ---- arrangement ---------------------------------------------------------------

  const bassHolds = Object.fromEntries(Object.entries(BASS).map(([key, pattern]) => [key, holdLengths(pattern)])) as Record<keyof typeof BASS, number[]>;

  function kickTrack(pattern: string, level = 1): ArrangementTrack<Chord> {
    return hits(pattern, { K: level, k: level * 0.72 }, ({ time }, vel) => voices.kick(time, vel));
  }

  function bassTrack(name: keyof typeof BASS, level = 1): ArrangementTrack<Chord> {
    const holds = bassHolds[name];
    return hits(BASS[name], { B: level, b: level * 0.85, f: level * 0.8 }, ({ time, chord, step }, vel, symbol) => {
      const offset = symbol === 'b' ? 12 : symbol === 'f' ? 7 : 0;
      voices.bass(time, chord.bass + offset, vel, holds[step] * STEP * 0.92);
    });
  }

  function hammerTrack(name: keyof typeof HAMMER, level = 1): ArrangementTrack<Chord> {
    return hits(HAMMER[name], { H: level, h: level * 0.55 }, ({ time, chord }, vel, symbol) => {
      voices.hammer(time, chord.bass + (symbol === 'H' ? 36 : 43), vel);
    });
  }

  const gritTrack = (level: number, dense: boolean) =>
    fn<Chord>(({ time, step }) => {
      if (!dense && step % 2 === 1) return;
      voices.grit(time, level * (step % 4 === 2 ? 1 : 0.55 + Math.random() * 0.3));
    });

  const chainTrack = (everyBars: number) =>
    fn<Chord>(({ time, step, barInSection }) => {
      if (step === 14 && barInSection % everyBars === everyBars - 1) voices.chain(time, 1);
    });

  const hissTrack = hits<Chord>('......S.......S.', { S: 1 }, ({ time }, vel) => voices.hiss(time, vel, BEAT * 0.9));

  const padTrack = (level: number) =>
    fn<Chord>(({ time, step, bar: absoluteBar, chord }) => {
      if (step === 0 && absoluteBar % 2 === 0) voices.pad(time, [...chord.pad], BAR * 2, level);
    });

  function melodyTrack(rows: ReadonlyArray<readonly Note[]>, vel = 1, transpose = 0): ArrangementTrack<Chord> {
    return fn<Chord>(({ time, step, barInSection }) => {
      const row = rows[barInSection % rows.length];
      for (const [at, midi, length] of row) {
        if (at === step) voices.melody(time, midi + transpose, length * STEP, vel);
      }
    });
  }

  const sonarTrack = fn<Chord>(({ time, step, chord }) => {
    if (step === 0) voices.bell(time, chord.arp[3] + 12, 0.35);
  });

  // Set pieces on the fight's clock: arms erupting, ink jets, the crane, the blackout.
  const cues: Cue[] = [
    ...ARM_ATTACKS.map((attack) => ({
      time: attack.from + attack.riseSeconds * 0.35,
      play: (time: number) => {
        voices.splash(time, 1);
        voices.groan(time, 33, 1.6, 0.7, 0.8);
      },
    })),
    ...INK_CLOUDS.map((cloud, index) => ({
      time: bar(cloud[0]) - 1.4,
      play: (time: number) => {
        voices.groan(time, index === 2 ? 28 : 31, 2.6, 1.1, 0.62);
        voices.riser(time, 1.3, 0.8);
      },
    })),
    { time: bar(BARS.crane), play: (time: number) => voices.steelCrash(time, 1.6) },
    { time: bar(BARS.blackout) - BEAT, play: (time: number) => voices.blackout(time) },
  ];
  const cueTrack = fn<Chord>(({ time, position }) => {
    const stepStart = position * STEP;
    for (const cue of cues) {
      if (cue.time >= stepStart && cue.time < stepStart + STEP) cue.play(time + (cue.time - stepStart));
    }
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'intro',
        fromBar: BARS.intro,
        toBar: BARS.murk,
        tracks: [
          oneShot(0, 0, ({ time }) => voices.foghorn(time, 33, BAR * 1.4, 1)),
          fn(({ time, step, barInSection }) => {
            if (barInSection === 1 && (step === 0 || step === 8)) voices.kick(time, step === 0 ? 0.7 : 0.5);
          }),
          padTrack(0.8),
          gritTrack(0.5, false),
          cueTrack,
        ],
      },
      {
        name: 'sodium-murk',
        fromBar: BARS.murk,
        toBar: BARS.ink,
        tracks: [kickTrack(KICK.murk), bassTrack('murk'), hammerTrack('murk'), chainTrack(2), gritTrack(0.8, false), padTrack(1), melodyTrack(PHRASE), cueTrack],
      },
      {
        name: 'first-ink',
        fromBar: BARS.ink,
        toBar: BARS.circling,
        tracks: [kickTrack(KICK.heart), bassTrack('held', 0.9), padTrack(1.1), melodyTrack(PHRASE.slice(4).concat(PHRASE.slice(0, 4))), sonarTrack, cueTrack],
      },
      {
        name: 'circling',
        fromBar: BARS.circling,
        toBar: BARS.mantle,
        tracks: [kickTrack(KICK.drive), bassTrack('drive'), hammerTrack('drive'), chainTrack(1), hissTrack, gritTrack(1, true), padTrack(1), melodyTrack(PHRASE), cueTrack],
      },
      {
        name: 'mantle',
        fromBar: BARS.mantle,
        toBar: BARS.blackout,
        tracks: [
          kickTrack(KICK.mantle),
          bassTrack('mantle'),
          hammerTrack('mantle', 1.1),
          chainTrack(1),
          hissTrack,
          gritTrack(1.1, true),
          padTrack(1),
          melodyTrack(PHRASE.slice(6).concat(CLIMAX), 1.1),
          oneShot(3, 0, ({ time }) => voices.riser(time, BAR, 1.2)),
          cueTrack,
        ],
      },
      {
        name: 'blackout',
        fromBar: BARS.blackout,
        toBar: BARS.lamps,
        tracks: [kickTrack(KICK.heart, 0.9), bassTrack('held', 0.8), padTrack(0.7), melodyTrack(FRAGMENTS, 0.9), sonarTrack, cueTrack],
      },
      {
        name: 'lamps',
        fromBar: BARS.lamps,
        toBar: BARS.end,
        tracks: [
          oneShot(0, 0, ({ time }) => voices.kick(time, 0.8)),
          oneShot(0, 8, ({ time }) => voices.foghorn(time, 38, BAR * 1.2, 0.9)),
          bassTrack('lamps', 0.7),
          padTrack(1.3),
          melodyTrack(RESOLVE, 1),
          fn(({ time, step, chord }) => {
            if (step % 4 === 0) voices.bell(time + STEP * 0.5, chord.arp[(step / 4) % 4], 0.3);
          }),
        ],
      },
      {
        name: 'after',
        fromBar: BARS.end,
        tracks: [padTrack(0.8), fn(({ time, step, barInSection }) => {
          if (step === 0 && barInSection % 4 === 0) voices.foghorn(time, 38, BAR, 0.5);
        })],
      },
    ],
  });

  // The attract screen: the harbor at night — lamp hum, a slow heartbeat under
  // the water, the melody drifting in murk, and a foghorn every four bars.
  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0.8),
        fn(({ time, step, barInSection }) => {
          if (step === 0 && barInSection % 4 === 0) voices.foghorn(time, 33, BAR * 1.2, 0.55);
          if (step === 0) voices.kick(time, 0.35);
        }),
        melodyTrack([[], [], ...PHRASE, [], [], [], [], [], [], [], []], 0.65),
        gritTrack(0.35, false),
      ],
    }],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
    if (ctx && position % 4 === 0) applySenses(time, 0.12);
  }

  // ---- the player's instruments ---------------------------------------------------------

  let coreId = -1;
  let coreMaxHp = 0;
  const nodeMaxHp = new Map<number, number>();
  const kinds = new Map<number, string>();

  const thermalLevel = () => (sense.thermalOn ? 1 : 0);

  bus.on('spawn', ({ enemyId, kind }) => {
    kinds.set(enemyId, kind);
    if (kind === 'core') coreId = enemyId;
    if (!ctx) return;
    if (kind === 'bellbuoy') {
      // Harbor bell buoys toll as they surface, tuned to the live chord.
      const time = score.nextGridTime(ctx.currentTime, 2);
      const chord = score.chordAt(score.arrangementPositionAt(time));
      voices.bell(time, chord.arp[0] - 12, 0.7);
    }
  });

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    const midi = lead[LOCK_DEGREES[Math.min(LOCK_DEGREES.length, Math.max(1, lockCount)) - 1]];
    voices.lockTick(time, midi, lockCount, thermalLevel());
  });

  bus.on('fire', ({ volleySize, indexInVolley }) => {
    if (!ctx) return;
    if ((indexInVolley ?? 0) > 0 && volleySize > 3 && (indexInVolley ?? 0) % 2 === 1) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.harpoon(time, chord.bass, volleySize);
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    const kind = kinds.get(enemyId);
    kinds.delete(enemyId);
    if (enemyId === coreId) {
      coreFinale();
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    voices.killNote(kill.time, kill.midi, indexInVolley ?? 0, thermalLevel());
    if (kind === 'node') sever(kill.time);
  });

  bus.on('hit', ({ enemyId, lethal, hitPointsRemaining }) => {
    if (!ctx || lethal) return;
    const kind = kinds.get(enemyId);
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    if (kind === 'node' || kind === 'core') {
      const max = kind === 'core'
        ? (coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1))
        : Math.max(nodeMaxHp.get(enemyId) ?? 0, hitPointsRemaining + 1);
      if (kind === 'node') nodeMaxHp.set(enemyId, max);
      const intensity = 1 - hitPointsRemaining / max;
      voices.fleshAnvil(time, chord.bass + 24 + Math.round(intensity * 7), intensity);
    } else {
      voices.bell(time, chord.arp[1], 0.4);
    }
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx) return;
    const time = score.nextGridTime(ctx.currentTime, 1);
    if (enemyId === coreId) {
      voices.groan(time, 30, 2.2, 1, 0.55);
      voices.subDrop(time, 80, 30, 1.2, 0.8);
    } else {
      voices.groan(time, 36, 0.9, 0.6, 0.7);
    }
  });

  // An arm severed: the bass drops out from under it, the live chord stabs,
  // and the creature howls.
  function sever(time: number) {
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.subDrop(time, 92, 32, 1.3, 1);
    voices.chordStab(time, chord.pad.map((midi) => midi + 12), 1, 1.3);
    voices.groan(time + STEP, 40, 1.8, 1, 0.55);
    voices.splash(time + 1.1, 0.8);
  }

  // The killing blow: the score holds its breath, the creature's last sound
  // falls through the floor, and a peal resolves the leading tone to D major.
  function coreFinale() {
    const mix = runtime.mix();
    if (!ctx || !mix) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    mix.duckAt(time, 0.12, 3.2);
    voices.subDrop(time, 110, 26, 2, 1.2);
    voices.groan(time, 26, 3.4, 1.4, 0.45);
    voices.chordStab(time, [62, 66, 69, 74, 78], 1.3, 2.4);
    voices.peal(time + STEP * 2, [90, 86, 81, 78, 74, 69, 66, 62], STEP);
  }

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 6 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    voices.chordStab(time, chord.arp.map((midi) => midi - 12), 0.8, 0.8);
  });

  bus.on('reject', () => {
    if (!ctx) return;
    voices.rejectBuzz(ctx.currentTime);
  });

  bus.on('miss', ({ enemyId }) => {
    if (!ctx) return;
    const kind = kinds.get(enemyId);
    kinds.delete(enemyId);
    if (kind === 'barb' || kind === undefined) return;
    voices.missThud(ctx.currentTime);
  });

  bus.on('playerhit', () => {
    if (!ctx) return;
    voices.hullHit(ctx.currentTime);
  });

  return runtime;
}
