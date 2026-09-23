import type { EventBus } from '../../events';
import { createBeatLevelAudio, type BeatLevelAudioRuntime, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createArrangement, fn, oneShot, type ArrangementContext } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { createScore } from '../../engine/score';
import {
  AMBIENT_BARS,
  AMBIENT_PARTS,
  AMEN_CHORD,
  chordAtStep,
  chordTonesIn,
  HARMONY,
  KILL_LANES,
  LEAD_FLOOR,
  PARTS,
  toMajor,
  tubaLine,
  type ChordName,
  type NoteEvent,
  type PartName,
} from './music';
import { createOrgan, type OrganStop } from './organ';
import {
  VESPERS_BARS,
  VESPERS_BPM,
  VESPERS_SCORE_SECTIONS,
  VESPERS_STEPS_PER_BAR,
  VESPERS_TIME,
  type VespersSection,
} from './timing';

// The building's own organ. The arrangement is a fugue exposition over a
// held pedal (voices enter one at a time), a swell with choir and bells, a
// single tremulant flute in the dark, then a passacaglia on the subject for
// the fight at the rose. No percussion anywhere: the pulse is the
// counterpoint moving.
//
// The player is a voice in the polyphony:
// - locks are a stopped flute climbing the chord that is sounding;
// - each shot is a pipe's speech (a chiff on the chord root), and the first
//   shot of a volley sounds a pedal reed under it — six locks add a full
//   plenum stab;
// - kills play a Cornet solo from the score's kill lanes (chord tones only,
//   quantized to the sixteenth grid), echoed an octave up by the glass a
//   beat later — the moment the light lands back in its window;
// - the rose's heart is a bell that climbs the scale with every hit.
// When the heart dies the organ breathes out for a beat, then every rank
// opens in D major and the Tuba — held back all night — takes the subject.

const STEPS = VESPERS_STEPS_PER_BAR;
const STEP_SECONDS = VESPERS_TIME.stepSeconds;
const BEAT_SECONDS = VESPERS_TIME.beatSeconds;
const B = VESPERS_BARS;

type SectionName =
  | 'pedal' | 'alto' | 'soprano' | 'tenor' | 'swell' | 'episode' | 'quiet' | 'wake' | 'rose' | 'deadline' | 'amen';

type Voice = PartName | 'tuba';
type Stop = { stop: OrganStop; gain: number; reverb: number; chiff?: number; double?: { stop: OrganStop; gain: number; interval: number } };

// Registration: which ranks each voice draws in each section. Gains are set
// by ear for perceived loudness — the plenum and reeds are far richer than
// the flutes, so they sit at lower numbers.
const REGISTRATION: Record<SectionName, Partial<Record<Voice, Stop>>> = {
  pedal: { pedal: { stop: 'pedal', gain: 0.085, reverb: 0.6 } },
  alto: {
    pedal: { stop: 'pedal', gain: 0.075, reverb: 0.6 },
    alto: { stop: 'principal', gain: 0.078, reverb: 0.55, chiff: 0.5 },
  },
  soprano: {
    pedal: { stop: 'pedal', gain: 0.085, reverb: 0.6 },
    alto: { stop: 'principal', gain: 0.066, reverb: 0.55, chiff: 0.35 },
    soprano: { stop: 'principal', gain: 0.076, reverb: 0.55, chiff: 0.5 },
  },
  tenor: {
    alto: { stop: 'principal', gain: 0.062, reverb: 0.55, chiff: 0.3 },
    soprano: { stop: 'principal', gain: 0.068, reverb: 0.55, chiff: 0.3 },
    tenor: { stop: 'principal', gain: 0.086, reverb: 0.55, chiff: 0.5 },
  },
  swell: {
    pedal: { stop: 'pedal', gain: 0.11, reverb: 0.6, double: { stop: 'principal', gain: 0.05, interval: 12 } },
    alto: { stop: 'plenum', gain: 0.05, reverb: 0.6, chiff: 0.2 },
    soprano: { stop: 'plenum', gain: 0.058, reverb: 0.6, chiff: 0.2 },
    tenor: { stop: 'plenum', gain: 0.052, reverb: 0.6, chiff: 0.2 },
  },
  episode: {
    pedal: { stop: 'pedal', gain: 0.12, reverb: 0.6, double: { stop: 'reed', gain: 0.03, interval: 0 } },
    alto: { stop: 'plenum', gain: 0.056, reverb: 0.6, chiff: 0.2 },
    soprano: { stop: 'plenum', gain: 0.064, reverb: 0.6, chiff: 0.2 },
    tenor: { stop: 'plenum', gain: 0.056, reverb: 0.6, chiff: 0.2 },
  },
  quiet: { flute: { stop: 'flute', gain: 0.055, reverb: 0.95 } },
  wake: { flute: { stop: 'flute', gain: 0.045, reverb: 0.95 } },
  rose: {
    pedal: { stop: 'pedal', gain: 0.14, reverb: 0.6, double: { stop: 'reed', gain: 0.045, interval: 0 } },
    alto: { stop: 'plenum', gain: 0.052, reverb: 0.6, chiff: 0.15 },
    soprano: { stop: 'plenum', gain: 0.056, reverb: 0.6, chiff: 0.15 },
    tenor: { stop: 'plenum', gain: 0.056, reverb: 0.6, chiff: 0.15 },
  },
  deadline: {
    pedal: { stop: 'pedal', gain: 0.14, reverb: 0.6, double: { stop: 'reed', gain: 0.045, interval: 0 } },
    alto: { stop: 'plenum', gain: 0.052, reverb: 0.6, chiff: 0.15 },
    soprano: { stop: 'plenum', gain: 0.056, reverb: 0.6, chiff: 0.15 },
    tenor: { stop: 'plenum', gain: 0.056, reverb: 0.6, chiff: 0.15 },
  },
  amen: {},
};

// Every rank open: the registration once the rose burns.
const GLORIA: Partial<Record<Voice, Stop>> = {
  pedal: { stop: 'pedal', gain: 0.13, reverb: 0.65, double: { stop: 'reed', gain: 0.05, interval: 0 } },
  alto: { stop: 'plenum', gain: 0.058, reverb: 0.65, chiff: 0.15 },
  soprano: { stop: 'plenum', gain: 0.064, reverb: 0.65, chiff: 0.15, double: { stop: 'principal', gain: 0.025, interval: 12 } },
  tenor: { stop: 'plenum', gain: 0.06, reverb: 0.65, chiff: 0.15 },
  tuba: { stop: 'tuba', gain: 0.13, reverb: 0.7, chiff: 0.25 },
};

// Rung down and changed: the peal after the rose ignites (written minor).
const PEAL_ROUNDS = [
  [86, 84, 82, 81, 79, 77, 76, 74],
  [84, 86, 81, 82, 77, 79, 74, 76],
  [84, 81, 86, 77, 82, 74, 79, 76],
  [81, 84, 77, 86, 74, 82, 76, 79],
];

// The heart's bell climbs the D minor scale, hit by hit.
const HEART_BELLS = [50, 52, 53, 55, 57, 58, 60, 62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79];

function eventsByStep(events: NoteEvent[]) {
  const map = new Map<number, NoteEvent[]>();
  for (const event of events) {
    const bucket = map.get(event.step);
    if (bucket) bucket.push(event);
    else map.set(event.step, [event]);
  }
  return map;
}

const RUN_PARTS = (Object.keys(PARTS) as PartName[]).map((name) => ({ name, events: eventsByStep(PARTS[name]) }));
const AMBIENT_PEDAL = eventsByStep(AMBIENT_PARTS.pedal);
const AMBIENT_FLUTE = eventsByStep(AMBIENT_PARTS.flute);

export function createAudio(bus: EventBus) {
  return createVespersAudio(bus).audio;
}

export const traceVespersAudio = createAudioTraceHarness({
  level: 'vespers-9qbs',
  bpm: VESPERS_BPM,
  stepSeconds: STEP_SECONDS,
  defaultSeconds: 60,
  createAudio: createVespersAudio,
});

function createVespersAudio(bus: EventBus, trace?: AudioTraceSink) {
  let runtimeRef: BeatLevelAudioRuntime | null = null;
  let burned = false;
  let majorFromTime = Infinity;
  let majorFromPosition = Infinity;
  let tuba = new Map<number, NoteEvent[]>();
  let heartId = -1;
  let heartHits = 0;
  let ambientQuietUntil = 0;
  let lastMissAt = -1;
  let lastDrainAt = -1;
  let choirVoicing = [57, 62, 65];

  const inRun = () => runtimeRef?.mode() === 'run';
  const isMajorAt = (position: number) => inRun() && position >= majorFromPosition;

  const score = createScore<readonly ChordName[], VespersSection>({
    bpm: VESPERS_BPM,
    stepsPerBar: STEPS,
    chords: HARMONY,
    barsPerChord: 1,
    sections: VESPERS_SCORE_SECTIONS,
    killLanes: KILL_LANES,
    // The player's instrument always sounds the chord of the current beat.
    leadSet: (_bar, position) => chordTonesIn(harmonyAt(position), LEAD_FLOOR, 104, isMajorAt(position)).slice(0, 8),
  });

  function harmonyAt(position: number): ChordName {
    return inRun() ? chordAtStep(position) : 'Dm';
  }

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: STEP_SECONDS,
    stepsPerBar: STEPS,
    volumeScale: 0.78,
    score,
    runAlignment: 'step',
    beatNumber: 'position',
    mix: {
      compressor: { threshold: -20, knee: 12, ratio: 3.2, attack: 0.012, release: 0.35 },
      reverb: { seconds: 5.5, decay: 2.4, level: 0.5, returnTo: 'master' },
      noiseSeconds: 2,
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
      burned = false;
      majorFromTime = Infinity;
      majorFromPosition = Infinity;
      tuba = new Map();
      heartId = -1;
      heartHits = 0;
      choirVoicing = [57, 62, 65];
    },
    onRunEnd() {
      const context = runtime.context();
      ambientQuietUntil = (context?.currentTime ?? 0) + 7;
    },
  });
  runtimeRef = runtime;

  const organ = createOrgan({ trace, context: runtime.context, mix: runtime.mix });

  // ---- musical position ------------------------------------------------------

  const positionAt = (time: number) => score.arrangementPositionAt(time);

  /** Next time on the arrangement's own grid (the run starts on a step, not a bar). */
  function nextArrangementGrid(time: number, gridSteps: number) {
    const start = score.epoch + score.arrangementStart * STEP_SECONDS;
    const grid = gridSteps * STEP_SECONDS;
    return start + Math.max(0, Math.ceil((time - start) / grid - 1e-4)) * grid;
  }

  function currentChordTones(time: number, lo: number, hi: number) {
    const position = positionAt(time);
    return chordTonesIn(harmonyAt(position), lo, hi, isMajorAt(position));
  }

  // ---- the written music ------------------------------------------------------

  function voiceNote(event: NoteEvent, time: number, registration: Stop, major: boolean, swell = 1) {
    const midi = major ? toMajor(event.midi) : event.midi;
    const duration = event.dur * STEP_SECONDS * (event.dur >= 8 ? 0.98 : 0.9);
    organ.pipe(time, midi, duration, registration.stop, registration.gain * swell, 'music', registration.reverb, registration.chiff ?? 0);
    if (registration.double) {
      organ.pipe(time, midi + registration.double.interval, duration, registration.double.stop, registration.double.gain * swell, 'music', registration.reverb, 0);
    }
  }

  function playParts(context: ArrangementContext<readonly ChordName[]>) {
    const { position, time, section, barInSection } = context;
    const name = section.name as SectionName;
    const major = burned && time >= majorFromTime - 1e-4;
    const escaped = !burned && context.bar >= B.deadline;
    const sectionBars = Math.max(1, (section.toBar ?? B.end) - section.fromBar);
    // Swells crescendo through their bars; the organist opens the box.
    const swell = name === 'swell' || name === 'episode' ? 0.85 + 0.3 * ((barInSection * STEPS + context.step) / (sectionBars * STEPS)) : 1;

    for (const { name: voice, events } of RUN_PARTS) {
      const bucket = events.get(position);
      if (!bucket) continue;
      if (voice === 'alto' && tubaStartsBy(position)) continue; // the Tuba takes the alto's register
      if (escaped && voice !== 'pedal' && !(voice === 'tenor' && context.step < 8)) continue;
      const registration = major ? GLORIA[voice] : REGISTRATION[name][voice];
      if (!registration) continue;
      for (const event of bucket) {
        if (voice === 'flute') {
          organ.tremulant(time, event.midi, event.dur * STEP_SECONDS * 0.96, registration.gain, registration.reverb);
        } else {
          voiceNote(event, time, registration, major, escaped ? 0.75 : swell);
        }
      }
    }

    const tubaBucket = tuba.get(position);
    if (tubaBucket) for (const event of tubaBucket) voiceNote(event, time, GLORIA.tuba!, true);
  }

  function tubaStartsBy(position: number) {
    for (const step of tuba.keys()) if (step <= position) return true;
    return false;
  }

  function voiceChoir(chord: ChordName, major: boolean) {
    const candidates = chordTonesIn(chord, 55, 76, major);
    const used = new Set<number>();
    const next = choirVoicing.map((previous) => {
      let best = candidates[0];
      let bestScore = Infinity;
      for (const tone of candidates) {
        const score = Math.abs(tone - previous) + (used.has(tone % 12) ? 6 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = tone;
        }
      }
      used.add(best % 12);
      return best;
    }).sort((a, b) => a - b);
    choirVoicing = next;
    return next;
  }

  function choirTrack(gain: number) {
    return fn<readonly ChordName[]>((context) => {
      if (context.step % 4 !== 0) return;
      const major = burned && context.time >= majorFromTime - 1e-4;
      const escaped = !burned && context.bar >= B.deadline;
      if (escaped) return;
      const chord = chordAtStep(context.position);
      organ.choir(context.time, voiceChoir(chord, major), BEAT_SECONDS * 1.05, gain * (major ? 1.5 : 1));
    });
  }

  function bell(bar: number, beat: number, midi: number, gain: number, decay: number) {
    return oneShot<readonly ChordName[]>(bar, beat * 4, ({ time }) => organ.bell(time, midi, gain, decay, 'music'));
  }

  // Once the rose burns: the bells are rung down in changes on every eighth.
  const pealTrack = fn<readonly ChordName[]>((context) => {
    if (!burned || context.time < majorFromTime + BEAT_SECONDS - 1e-4 || context.step % 2 !== 0) return;
    const index = Math.floor((context.position - majorFromPosition) / 2);
    const round = PEAL_ROUNDS[Math.floor(index / 8) % PEAL_ROUNDS.length];
    const midi = toMajor(round[index % 8]);
    organ.bell(context.time, midi, 0.028 + (index % 8 === 0 ? 0.014 : 0), 2.8, 'music');
    if (context.step === 0) organ.bell(context.time, toMajor(50), 0.07, 5, 'music');
  });

  const amenTrack = oneShot<readonly ChordName[]>(0, 0, ({ time }) => {
    const hold = STEPS * 1.6 * STEP_SECONDS;
    if (burned) {
      for (const midi of AMEN_CHORD) {
        organ.pipe(time, toMajor(midi), hold, 'plenum', midi < 50 ? 0.05 : 0.036, 'music', 0.75, 0.1);
      }
      organ.pipe(time, 38, hold, 'pedal', 0.13, 'music', 0.7, 0);
      organ.pipe(time, 50, hold, 'reed', 0.04, 'music', 0.7, 0);
      organ.rumble(time, 26, hold, 0.16);
      organ.choir(time, [62, 66, 69, 74], hold, 0.07);
      for (const [midi, gain] of [[50, 0.12], [57, 0.08], [62, 0.07], [66, 0.05], [74, 0.04]] as const) organ.bell(time, toMajor(midi), gain, 6.5, 'music');
    } else {
      // The dark ending: only the pedal note the piece began with.
      organ.pipe(time, 38, hold, 'pedal', 0.12, 'music', 0.8, 0);
      organ.bell(time, 38, 0.1, 7, 'music');
    }
  });

  const runArrangement = createArrangement<readonly ChordName[]>({
    stepsPerBar: STEPS,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      { name: 'pedal', fromBar: B.pedal, toBar: B.alto, tracks: [fn(playParts)] },
      { name: 'alto', fromBar: B.alto, toBar: B.soprano, tracks: [fn(playParts)] },
      { name: 'soprano', fromBar: B.soprano, toBar: B.tenor, tracks: [fn(playParts)] },
      { name: 'tenor', fromBar: B.tenor, toBar: B.swell, tracks: [fn(playParts)] },
      {
        name: 'swell',
        fromBar: B.swell,
        toBar: B.episode,
        tracks: [fn(playParts), choirTrack(0.028), bell(0, 0, 50, 0.12, 5.5), bell(0, 0, 62, 0.05, 4)],
      },
      {
        name: 'episode',
        fromBar: B.episode,
        toBar: B.quiet,
        tracks: [fn(playParts), choirTrack(0.036), bell(0, 0, 50, 0.1, 5), bell(1, 2, 45, 0.15, 6.5), bell(1, 2, 57, 0.09, 5)],
      },
      { name: 'quiet', fromBar: B.quiet, toBar: B.wake, tracks: [fn(playParts)] },
      {
        name: 'wake',
        fromBar: B.wake,
        toBar: B.rose,
        tracks: [fn(playParts), oneShot(0, 0, ({ time }) => organ.rumble(time, 33, STEPS * STEP_SECONDS, 0.12)), bell(0, 2, 45, 0.06, 6)],
      },
      {
        name: 'rose',
        fromBar: B.rose,
        toBar: B.deadline,
        tracks: [
          fn(playParts),
          choirTrack(0.026),
          pealTrack,
          bell(0, 0, 38, 0.2, 7),
          bell(0, 0, 50, 0.1, 5),
          bell(2, 0, 50, 0.1, 5),
          bell(4, 0, 50, 0.1, 5),
          bell(6, 0, 50, 0.1, 5),
          oneShot(0, 0, ({ time }) => organ.hiss(time, 1.6, 'lowpass', 520, 0.09, 'music')),
        ],
      },
      { name: 'deadline', fromBar: B.deadline, toBar: B.amen, tracks: [fn(playParts), choirTrack(0.03), pealTrack] },
      { name: 'amen', fromBar: B.amen, toBar: B.end, tracks: [fn(playParts), amenTrack, pealTrack] },
    ],
  });

  function scheduleAmbient(position: number, time: number) {
    if (time < ambientQuietUntil) return;
    const loop = position % (AMBIENT_BARS * STEPS);
    for (const event of AMBIENT_PEDAL.get(loop) ?? []) {
      organ.pipe(time, event.midi, event.dur * STEP_SECONDS, 'pedal', 0.055, 'music', 0.7, 0);
    }
    for (const event of AMBIENT_FLUTE.get(loop) ?? []) {
      organ.pipe(time, event.midi, event.dur * STEP_SECONDS * 0.92, 'gedackt', 0.05, 'music', 0.85, 0.4);
    }
    if (loop % (4 * STEPS) === 0) organ.bell(time, 50, 0.035, 5, 'music');
  }

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') scheduleAmbient(position, time);
    else if (position < B.end * STEPS) runArrangement.schedule(position, time);
  }

  // ---- the finale -------------------------------------------------------------

  function burn() {
    const context = runtime.context();
    const mix = runtime.mix();
    if (!context || !mix || burned) return;
    burned = true;
    score.overrideSection(4);
    const start = context.currentTime;
    // A breath: the organ lets go of its wind, then lands on the next beat.
    // Same breath the visuals wait before igniting the rose (visuals/index.ts).
    const tutti = nextArrangementGrid(start + 0.32, 4);
    majorFromTime = tutti;
    majorFromPosition = positionAt(tutti);
    const duck = mix.duck.gain;
    duck.cancelScheduledValues(start);
    duck.setValueAtTime(duck.value, start);
    duck.linearRampToValueAtTime(0.06, start + 0.1);
    duck.setValueAtTime(0.06, tutti - 0.015);
    duck.linearRampToValueAtTime(1, tutti + 0.01);

    const nextBar = nextArrangementGrid(tutti + BEAT_SECONDS * 0.9, STEPS);
    const hold = Math.max(BEAT_SECONDS, nextBar - tutti) + 0.1;
    for (const midi of AMEN_CHORD) organ.pipe(tutti, toMajor(midi), hold, 'plenum', midi < 50 ? 0.05 : 0.038, 'sfx', 0.8, 0.2);
    for (const midi of [50, 57, 62]) organ.pipe(tutti, midi, hold, 'reed', 0.035, 'sfx', 0.8, 0);
    organ.rumble(tutti, 26, hold + STEPS * STEP_SECONDS, 0.16);
    organ.choir(tutti, [62, 66, 69, 74], hold + STEPS * STEP_SECONDS, 0.08);
    for (const [midi, gain] of [[38, 0.15], [50, 0.12], [57, 0.09], [62, 0.07], [74, 0.045]] as const) organ.bell(tutti, toMajor(midi), gain, 7, 'sfx');
    organ.hiss(tutti, 2.2, 'lowpass', 900, 0.12, 'sfx');
    organ.glass(tutti, 98, 0.05, 'sfx');

    // The Tuba enters at the next bar line with whichever half of the subject
    // the ground bass is on, and arrives on the high tonic in the final bar.
    const startBar = Math.floor((positionAt(nextBar) + 0.5) / STEPS);
    tuba = eventsByStep(tubaLine(startBar));
  }

  // ---- the player's instruments ----------------------------------------------

  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind === 'heart') {
      heartId = enemyId;
      return;
    }
    if (kind === 'shard' || kind === 'letter' || !inRun()) return;
    const context = runtime.context();
    if (!context || context.currentTime - lastDrainAt < 0.09) return;
    lastDrainAt = context.currentTime;
    // The light being drawn out of a window: a high chord tone that sags.
    const tones = currentChordTones(context.currentTime, 86, 100);
    organ.drain(score.quantizePlayerAction(context.currentTime), tones[enemyId % tones.length] ?? 93, 0.012);
  });

  bus.on('lock', ({ lockCount }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    // A stopped flute climbing the chord that is sounding now.
    const tones = currentChordTones(time, 67, 96);
    const midi = tones[Math.min(tones.length - 1, lockCount - 1)] ?? 74;
    organ.pipe(time, midi, 0.17, 'gedackt', 0.05 + lockCount * 0.004, 'sfx', 0.55, 0.9);
    if (lockCount >= 6) organ.pipe(time, midi + 12, 0.28, 'cornet', 0.03, 'sfx', 0.7, 0.4);
  });

  bus.on('fire', ({ indexInVolley, volleySize }) => {
    const context = runtime.context();
    if (!context) return;
    const time = score.quantizePlayerAction(context.currentTime);
    const root = currentChordTones(time, 38, 49)[0] ?? 38;
    // Every shot is a pipe speaking: mostly chiff, a little tone.
    organ.pipe(time, root + 24, 0.07, 'principal', 0.022, 'sfx', 0.35, 2.2);
    if ((indexInVolley ?? 0) !== 0) return;
    // The volley's first shot sounds the pedal reed under everything.
    organ.pipe(time, root + 12, 0.34 + volleySize * 0.03, 'reed', 0.03 + volleySize * 0.007, 'sfx', 0.6, 0.3);
    if (volleySize >= 6) {
      const stab = nextArrangementGrid(time + 0.01, 2);
      for (const midi of currentChordTones(stab, 55, 79)) organ.pipe(stab, midi, 0.3, 'plenum', 0.028, 'sfx', 0.75, 0.2);
      organ.bell(stab, (currentChordTones(stab, 74, 86)[0] ?? 74), 0.04, 2.5, 'sfx');
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    const context = runtime.context();
    if (!context) return;
    if (enemyId === heartId && inRun()) {
      burn();
      return;
    }
    const kill = score.nextKill(context.currentTime, inRun() ? undefined : 0);
    const chain = indexInVolley ?? 0;
    // The Cornet solo: the kill lane's note on the grid.
    organ.pipe(kill.time, kill.midi, 0.36, 'cornet', 0.07 * Math.min(1.35, 1 + chain * 0.07), 'sfx', 0.6, 0.35);
    // A beat later the light reaches its window: the glass answers an octave up.
    organ.glass(kill.time + BEAT_SECONDS, kill.midi + 12, 0.028 + chain * 0.003, 'sfx');
  });

  bus.on('hit', ({ enemyId, lethal }) => {
    const context = runtime.context();
    if (!context || lethal) return;
    const time = score.quantizePlayerAction(context.currentTime);
    if (enemyId === heartId) {
      // The heart's bell climbs the scale as the shell breaks.
      const midi = HEART_BELLS[Math.min(HEART_BELLS.length - 1, heartHits)];
      heartHits += 1;
      const intensity = heartHits / HEART_BELLS.length;
      organ.bell(time, midi, 0.07 + intensity * 0.08, 2.4 + intensity, 'sfx');
      organ.hiss(time, 0.12, 'highpass', 5200, 0.05 + intensity * 0.05, 'sfx');
      return;
    }
    // Armour chip: a short principal on the chord's third, and cracking glass.
    const tones = currentChordTones(time, 69, 84);
    organ.pipe(time, tones[1] ?? 72, 0.09, 'principal', 0.04, 'sfx', 0.5, 0.8);
    organ.hiss(time, 0.08, 'highpass', 6000, 0.05, 'sfx');
  });

  bus.on('stage', ({ enemyId }) => {
    const context = runtime.context();
    if (!context || enemyId !== heartId) return;
    const time = nextArrangementGrid(context.currentTime, 2);
    // A shell of thorns gives way: a low bell and the whole chord in the reeds.
    organ.bell(time, 38, 0.16, 5, 'sfx');
    for (const midi of currentChordTones(time, 50, 69)) organ.pipe(time, midi, 0.5, 'reed', 0.03, 'sfx', 0.7, 0);
    organ.hiss(time, 0.5, 'highpass', 3500, 0.14, 'sfx');
  });

  bus.on('bossphase', ({ phase }) => {
    const context = runtime.context();
    if (!context || phase !== 'exposed') return;
    const time = nextArrangementGrid(context.currentTime, 2);
    // It tears loose: a bell and a sung minor chord, hard.
    organ.bell(time, 45, 0.14, 5, 'sfx');
    organ.choir(time, currentChordTones(time, 57, 72), BEAT_SECONDS * 2, 0.06);
    organ.hiss(time, 1, 'bandpass', 700, 0.1, 'sfx');
  });

  bus.on('reject', () => {
    const context = runtime.context();
    if (!context) return;
    // A cipher: stuck reeds a semitone apart while the wind sags.
    organ.cipher(context.currentTime, 63, 0.035);
  });

  bus.on('miss', ({ enemyId }) => {
    const context = runtime.context();
    if (!context || !inRun() || enemyId === heartId) return;
    if (context.currentTime - lastMissAt < 0.2) return;
    lastMissAt = context.currentTime;
    const time = score.quantizePlayerAction(context.currentTime);
    const tones = currentChordTones(time, 62, 74);
    // A sigh: the light leaving with it.
    organ.pipe(time, (tones[0] ?? 62), 0.3, 'gedackt', 0.022, 'sfx', 0.8, 0);
    organ.pipe(time + STEP_SECONDS * 2, (tones[0] ?? 62) - 1, 0.35, 'gedackt', 0.016, 'sfx', 0.8, 0);
  });

  bus.on('playerhit', () => {
    const context = runtime.context();
    if (!context) return;
    const time = context.currentTime;
    // The one deliberately wrong sound: a low reed cluster and breaking glass.
    for (const midi of [26, 27, 33]) organ.pipe(time, midi + 12, 0.45, 'reed', 0.06, 'sfx', 0.6, 0);
    organ.hiss(time, 0.6, 'highpass', 2600, 0.16, 'sfx');
  });

  return runtime;
}
