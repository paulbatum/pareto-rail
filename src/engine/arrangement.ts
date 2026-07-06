import type { AudioTraceSink } from './audio-trace';

export type ArrangementSection<Chord> = {
  /** Absolute arrangement bar where the section begins. */
  fromBar: number;
  /** Optional absolute arrangement bar where the section stops. Defaults to the next section. */
  toBar?: number;
  name: string;
  tracks: Array<ArrangementTrack<Chord>>;
};

export type ArrangementContext<Chord> = {
  /** Absolute arrangement position in configured steps. */
  position: number;
  /** Absolute arrangement bar. */
  bar: number;
  /** Bar offset from the current section start. */
  barInSection: number;
  /** Step within the current bar. */
  step: number;
  stepsPerBar: number;
  time: number;
  chord: Chord;
  section: ArrangementSection<Chord>;
};

export type ArrangementTrack<Chord> = {
  run(context: ArrangementContext<Chord>): void;
  patternLength?: number;
};

export type ArrangementOptions<Chord> = {
  stepsPerBar: number;
  sections: Array<ArrangementSection<Chord>>;
  chordAt(position: number): Chord;
  trace?: AudioTraceSink;
  emitSections?: boolean;
};

export type HitVelocityMap = Record<string, number>;

/**
 * Pattern-string track. One character is one step; '.' is a rest. Pattern
 * length must be a multiple of stepsPerBar, and the pattern cycles from the
 * start of the current section.
 */
export function hits<Chord>(
  pattern: string,
  velocities: HitVelocityMap,
  play: (context: ArrangementContext<Chord>, velocity: number, symbol: string) => void,
): ArrangementTrack<Chord> {
  return {
    patternLength: pattern.length,
    run(context) {
      const index = (context.barInSection * context.stepsPerBar + context.step) % pattern.length;
      const symbol = pattern[index];
      if (!symbol || symbol === '.') return;
      const velocity = velocities[symbol];
      if (velocity === undefined) throw new Error(`Arrangement hit pattern symbol '${symbol}' has no velocity mapping`);
      play(context, velocity, symbol);
    },
  };
}

export function fn<Chord>(run: (context: ArrangementContext<Chord>) => void): ArrangementTrack<Chord> {
  return { run };
}

/** Section-relative one-shot. `bar` is measured from the section's fromBar. */
export function oneShot<Chord>(
  bar: number,
  step: number,
  play: (context: ArrangementContext<Chord>) => void,
): ArrangementTrack<Chord> {
  return fn((context) => {
    if (context.barInSection === bar && context.step === step) play(context);
  });
}

export function createArrangement<Chord>(options: ArrangementOptions<Chord>) {
  const sections = [...options.sections].sort((a, b) => a.fromBar - b.fromBar);
  for (const section of sections) {
    for (const track of section.tracks) {
      if (track.patternLength !== undefined && track.patternLength % options.stepsPerBar !== 0) {
        throw new Error(`Arrangement hit pattern length ${track.patternLength} is not a multiple of ${options.stepsPerBar}`);
      }
    }
  }

  function sectionAt(bar: number) {
    for (let index = sections.length - 1; index >= 0; index -= 1) {
      const section = sections[index];
      const toBar = section.toBar ?? sections[index + 1]?.fromBar ?? Infinity;
      if (bar >= section.fromBar && bar < toBar) return section;
    }
    return null;
  }

  function recordSectionStart(time: number, bar: number) {
    if (!options.emitSections || !options.trace) return;
    const section = sections.find((candidate) => candidate.fromBar === bar);
    if (section) options.trace.record(time, 'section', { section: section.name, bar });
  }

  function schedule(position: number, time: number) {
    const bar = Math.floor(position / options.stepsPerBar);
    const step = position % options.stepsPerBar;
    const section = sectionAt(bar);
    if (!section) return;
    const context: ArrangementContext<Chord> = {
      position,
      bar,
      barInSection: bar - section.fromBar,
      step,
      stepsPerBar: options.stepsPerBar,
      time,
      chord: options.chordAt(position),
      section,
    };
    for (const track of section.tracks) track.run(context);
  }

  return { schedule, recordSectionStart, sectionAt };
}
