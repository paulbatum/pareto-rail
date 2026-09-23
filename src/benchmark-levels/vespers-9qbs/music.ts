import { VESPERS_BARS, VESPERS_STEPS_PER_BAR } from './timing';

// The written music of Vespers: harmony, the fugue subject, and every voice
// part, in D minor. Everything the audio spine plays or pitches from lives
// here as data. The run is 24 bars of 16 sixteenth-note steps.
//
// A note on the ending: every pitch here is written in minor. When the rose
// burns, `toMajor` rewrites F→F♯, B♭→B and C→C♯ on the fly, so the same
// counterpoint carries on in D major — i→I, iv→IV, VI→vi, ii°→ii — and the
// Tuba, held back all night, enters with the subject over it.

const STEPS = VESPERS_STEPS_PER_BAR;

export type ChordName = 'Dm' | 'A' | 'Gm' | 'Eo' | 'E' | 'Am' | 'C' | 'F' | 'Bb';

/** Pitch classes relative to D (0 = D), root first. */
export const CHORD_TONES: Record<ChordName, readonly number[]> = {
  Dm: [0, 3, 7],
  A: [7, 11, 2],
  Gm: [5, 8, 0],
  Eo: [2, 5, 8],
  E: [2, 6, 9],
  Am: [7, 10, 2],
  C: [10, 2, 5],
  F: [3, 7, 10],
  Bb: [8, 0, 3],
};

const SUBJECT_HARMONY: ChordName[][] = [
  ['Dm', 'A', 'Gm', 'Gm'],
  ['Eo', 'Gm', 'A', 'Dm'],
];

// One chord per beat for all 24 bars.
export const HARMONY: ChordName[][] = [
  ['Dm', 'Dm', 'Dm', 'Dm'], // 0  pedal alone
  ['Dm', 'Dm', 'Dm', 'Dm'], // 1
  ...SUBJECT_HARMONY, // 2–3  alto: subject over the held D
  ['Dm', 'Dm', 'Dm', 'Dm'], // 4  soprano: answer over an A pedal
  ['E', 'Am', 'E', 'Am'], // 5
  ...SUBJECT_HARMONY, // 6–7  tenor: subject
  ...SUBJECT_HARMONY, // 8–9  pedal: subject, choir enters
  ['Dm', 'Gm', 'C', 'F'], // 10 episode: descending fifths
  ['Bb', 'Eo', 'A', 'A'], // 11 half cadence — the swell's peak
  ...SUBJECT_HARMONY, // 12–13 the dark span: one flute alone
  ['A', 'A', 'A', 'A'], // 14 the Thing wakes over a low A
  ...SUBJECT_HARMONY, // 15–16 passacaglia: the subject becomes the ground
  ...SUBJECT_HARMONY, // 17–18
  ...SUBJECT_HARMONY, // 19–20
  ...SUBJECT_HARMONY, // 21–22
  ['Dm', 'Dm', 'Dm', 'Dm'], // 23 final chord
];

export function chordAtStep(step: number): ChordName {
  const bar = Math.floor(step / STEPS);
  const beat = Math.floor((step % STEPS) / 4);
  return HARMONY[((bar % HARMONY.length) + HARMONY.length) % HARMONY.length][beat];
}

const D_PITCH_CLASS = 2;
const RAISED_IN_MAJOR = new Set([3, 8, 10]);

export function toMajor(midi: number) {
  const relative = (((midi - D_PITCH_CLASS) % 12) + 12) % 12;
  return RAISED_IN_MAJOR.has(relative) ? midi + 1 : midi;
}

export function chordPitchClasses(chord: ChordName, major: boolean) {
  return CHORD_TONES[chord].map((pc) => (major && RAISED_IN_MAJOR.has(pc) ? (pc + 1) % 12 : pc));
}

/** Every MIDI note in [lo, hi] belonging to the chord, ascending. */
export function chordTonesIn(chord: ChordName, lo: number, hi: number, major = false) {
  const classes = chordPitchClasses(chord, major);
  const tones: number[] = [];
  for (let midi = lo; midi <= hi; midi += 1) {
    const relative = (((midi - D_PITCH_CLASS) % 12) + 12) % 12;
    if (classes.includes(relative)) tones.push(midi);
  }
  return tones;
}

// ---- notation --------------------------------------------------------------------

export type NoteEvent = { step: number; midi: number; dur: number };

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C#4' → 61. Octave numbering: C4 = 60. */
export function noteToMidi(name: string) {
  const match = name.match(/^([A-G])(#|b)?(-?\d)$/);
  if (!match) throw new Error(`Bad note ${name}`);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return 12 * (Number(match[3]) + 1) + NOTE_INDEX[match[1]] + accidental;
}

/** Parse "D4:4 A4:4 r:2 ..." (durations in sixteenth steps) starting at a bar. */
export function part(atBar: number, text: string): NoteEvent[] {
  const events: NoteEvent[] = [];
  let step = atBar * STEPS;
  for (const token of text.trim().split(/\s+/)) {
    const [name, length] = token.split(':');
    const dur = Number(length);
    if (name !== 'r') events.push({ step, midi: noteToMidi(name), dur });
    step += dur;
  }
  return events;
}

export const SUBJECT_A = 'D4:4 A4:4 Bb4:2 A4:2 G4:2 F4:2';
export const SUBJECT_B = 'E4:2 F4:2 D4:2 E4:2 C#4:4 D4:4';
const transpose = (events: NoteEvent[], semitones: number) => events.map((event) => ({ ...event, midi: event.midi + semitones }));

// ---- generated figuration (the passacaglia variations) ---------------------------

function nearestChordTone(chord: ChordName, lo: number, hi: number, previous: number) {
  const tones = chordTonesIn(chord, lo, hi);
  let best = tones[0];
  let bestScore = Infinity;
  for (const tone of tones) {
    // Prefer small steps; a held repeat costs a little so lines keep moving.
    const score = Math.abs(tone - previous) + (tone === previous ? 1.6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = tone;
    }
  }
  return best;
}

/** A line of chord tones moving by the smallest steps, `unit` steps per note. */
function descant(fromBar: number, toBar: number, lo: number, hi: number, unit: number, start: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  let previous = start;
  for (let step = fromBar * STEPS; step < toBar * STEPS; step += unit) {
    previous = nearestChordTone(chordAtStep(step), lo, hi, previous);
    events.push({ step, midi: previous, dur: unit });
  }
  return events;
}

/** Broken-chord figuration: per beat, `pattern` walks the chord tones around a pivot that drifts from `fromPivot` to `toPivot`. */
function figuration(fromBar: number, toBar: number, lo: number, hi: number, unit: number, pattern: readonly number[], fromPivot: number, toPivot: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  const first = fromBar * STEPS;
  const last = toBar * STEPS;
  for (let beatStep = first; beatStep < last; beatStep += 4) {
    const tones = chordTonesIn(chordAtStep(beatStep), lo, hi);
    const pivot = fromPivot + (toPivot - fromPivot) * ((beatStep - first) / Math.max(1, last - first - 4));
    let base = 0;
    for (let i = 0; i < tones.length; i += 1) if (Math.abs(tones[i] - pivot) < Math.abs(tones[base] - pivot)) base = i;
    base = Math.min(base, Math.max(0, tones.length - 1 - Math.max(...pattern)));
    for (let i = 0; i < 4 / unit; i += 1) {
      const index = Math.min(tones.length - 1, base + pattern[i % pattern.length]);
      events.push({ step: beatStep + i * unit, midi: tones[index], dur: unit });
    }
  }
  return events;
}

// ---- the parts -------------------------------------------------------------------

const ROSE = VESPERS_BARS.rose;

const groundBass = [15, 17, 19, 21].flatMap((bar) => transpose(part(bar, `${SUBJECT_A} ${SUBJECT_B}`), -24));

export const PARTS = {
  pedal: [
    ...part(0, 'D2:64'),
    ...part(4, 'A2:16 E2:4 A2:4 E2:4 A2:4'),
    ...transpose(part(8, `${SUBJECT_A} ${SUBJECT_B}`), -24),
    ...part(10, 'D2:4 G2:4 C2:4 F2:4 Bb1:4 E2:4 A1:8'),
    ...groundBass,
  ],
  alto: [
    ...part(2, `${SUBJECT_A} ${SUBJECT_B}`),
    ...part(4, 'F4:2 G4:2 A4:2 F4:2 A4:4 F4:4 E4:2 G#4:2 E4:4 D4:2 B3:2 C4:4'),
    ...part(6, 'F4:4 E4:4 D4:4 G4:4 G4:8 A4:8'),
    ...part(8, 'F4:2 A4:2 E4:2 A4:2 G4:2 Bb4:2 D5:2 Bb4:2 G4:2 E4:2 D4:2 G4:2 A4:2 E4:2 F4:2 D4:2'),
    ...part(10, 'D5:2 A4:2 Bb4:2 G4:2 C5:2 G4:2 A4:2 F4:2 Bb4:2 F4:2 G4:2 Bb4:2 A4:2 C#5:2 E5:2 C#5:2'),
    ...figuration(ROSE, ROSE + 2, 60, 72, 2, [0, 2, 1, 2], 62, 66),
    ...descant(ROSE + 2, ROSE + 4, 60, 71, 4, 65),
    ...figuration(ROSE + 4, ROSE + 6, 60, 74, 1, [0, 1, 2, 1], 62, 68),
    ...figuration(ROSE + 6, ROSE + 8, 60, 72, 1, [2, 1, 0, 1], 62, 70),
  ],
  soprano: [
    ...part(4, 'A4:4 D5:4 F5:2 E5:2 D5:2 C5:2 B4:2 C5:2 A4:2 B4:2 G#4:4 A4:4'),
    ...part(6, 'F5:2 D5:2 E5:2 C#5:2 D5:4 Bb4:4 Bb4:4 D5:4 E5:2 C#5:2 D5:4'),
    ...part(8, 'A5:8 Bb5:4 G5:4 G5:8 E5:4 F5:4 F5:4 G5:4 E5:4 F5:4 F5:4 G5:4 A5:8'),
    ...descant(ROSE, ROSE + 2, 72, 84, 4, 77),
    ...figuration(ROSE + 2, ROSE + 4, 70, 86, 1, [0, 1, 2, 1], 72, 79),
    ...descant(ROSE + 4, ROSE + 6, 74, 86, 8, 81),
    ...figuration(ROSE + 6, ROSE + 8, 72, 88, 1, [0, 1, 2, 3], 74, 82),
  ],
  tenor: [
    ...transpose(part(6, `${SUBJECT_A} ${SUBJECT_B}`), -12),
    ...part(8, 'A3:4 C#4:4 D4:4 Bb3:4 Bb3:8 A3:8'),
    ...part(10, 'A3:4 Bb3:4 G3:4 A3:4 D4:4 E4:4 C#4:8'),
    ...descant(ROSE, ROSE + 4, 50, 60, 4, 57),
    ...figuration(ROSE + 4, ROSE + 6, 50, 62, 2, [0, 1], 53, 57),
    ...descant(ROSE + 6, ROSE + 8, 50, 60, 4, 57),
  ],
  // The dark span: the subject alone, high, on a tremulant flute.
  flute: [
    ...part(VESPERS_BARS.quiet, `D5:4 A5:4 Bb5:2 A5:2 G5:2 F5:2 E5:2 F5:2 D5:2 E5:2 C#5:4 D5:4`),
    ...part(VESPERS_BARS.wake, 'A4:16'),
  ],
} satisfies Record<string, NoteEvent[]>;

export type PartName = keyof typeof PARTS;

/** The Tuba, held back all night: the subject in whichever half of the ground is sounding, then the high tonic. */
export function tubaLine(startBar: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let bar = Math.max(startBar, ROSE); bar < VESPERS_BARS.amen; bar += 1) {
    events.push(...part(bar, (bar - ROSE) % 2 === 0 ? SUBJECT_A : SUBJECT_B));
  }
  events.push(...part(VESPERS_BARS.amen, 'D5:26'));
  return events;
}

/** The final chord when the rose burns (written minor; played major). */
export const AMEN_CHORD = ['D2', 'A2', 'D3', 'A3', 'F4', 'A4', 'D5'].map(noteToMidi);

// ---- the player's lanes ----------------------------------------------------------

/** Chord tones from F4 upward — the player's instrument lives inside the polyphony. */
export const LEAD_FLOOR = 65;

// Kill lanes: degrees into the lead set, one per sixteenth step over two bars.
// A chained volley walks consecutive steps, so it plays a phrase.
export const KILL_LANES: Record<0 | 1 | 2 | 3 | 4, number[]> = {
  // Exposition: a small arch that grows, like a voice finding its range.
  0: [
    0, 1, 2, 1, 2, 3, 2, 1,
    2, 3, 4, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 2, 1,
    3, 4, 5, 6, 5, 4, 3, 2,
  ],
  // Swell: rising runs, each starting a step higher — the organ climbing.
  1: [
    0, 1, 2, 3, 4, 5, 4, 3,
    1, 2, 3, 4, 5, 6, 5, 4,
    2, 3, 4, 5, 6, 7, 6, 5,
    3, 4, 5, 6, 7, 6, 5, 4,
  ],
  // The dark span: high, hesitant.
  2: [
    5, 4, 5, 6, 5, 4, 3, 4,
    5, 6, 7, 6, 5, 4, 5, 6,
    5, 4, 5, 6, 5, 4, 3, 4,
    5, 6, 7, 6, 5, 4, 3, 2,
  ],
  // The rose: falling peals, like bells rung down.
  3: [
    7, 6, 5, 4, 6, 5, 4, 3,
    5, 4, 3, 2, 4, 3, 2, 1,
    6, 5, 4, 3, 5, 4, 3, 2,
    4, 3, 2, 1, 2, 3, 4, 5,
  ],
  // Gloria: fanfare arpeggios in major.
  4: [
    0, 2, 4, 6, 7, 6, 4, 2,
    1, 3, 5, 7, 6, 4, 2, 0,
    0, 2, 4, 6, 7, 6, 4, 2,
    3, 4, 5, 6, 7, 6, 5, 4,
  ],
};

// ---- attract loop ----------------------------------------------------------------

export const AMBIENT_BARS = 8;
export const AMBIENT_PARTS = {
  pedal: part(0, 'D2:32 D2:32 D2:32 D2:32'),
  flute: [
    ...part(2, `${SUBJECT_A} ${SUBJECT_B}`),
    ...part(6, 'A4:4 D5:4 F5:2 E5:2 D5:2 C5:2 E5:2 F5:2 D5:2 E5:2 C#5:4 D5:4'),
  ],
};
