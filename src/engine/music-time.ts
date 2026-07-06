export type MusicTimeOptions = {
  /** Beats in one bar. Defaults to 4 for common-time levels. */
  beatsPerBar?: number;
  /** Authoring grid density for helpers that address steps. Defaults to 16. */
  stepsPerBar?: number;
};

export type MusicMarkerInput = number | readonly [bar: number, beat: number];

export type MusicTime = ReturnType<typeof createMusicTime>;

/**
 * Converts musical positions into the seconds consumed by gameplay systems.
 * Bars are zero-based arrangement bars; beats are continuous and may be fractional.
 */
export function createMusicTime(bpm: number, options: MusicTimeOptions = {}) {
  const beatsPerBar = options.beatsPerBar ?? 4;
  const stepsPerBar = options.stepsPerBar ?? 16;
  const beatSeconds = 60 / bpm;
  const barSeconds = beatSeconds * beatsPerBar;
  const stepSeconds = barSeconds / stepsPerBar;

  function beats(count: number) {
    return count * beatSeconds;
  }

  function bar(index: number, beat = 0) {
    return (index * beatsPerBar + beat) * beatSeconds;
  }

  function step(barIndex: number, stepInBar = 0) {
    return barIndex * barSeconds + stepInBar * stepSeconds;
  }

  function seconds(value: number) {
    return value;
  }

  function markers<const T extends Record<string, MusicMarkerInput>>(values: T): { [K in keyof T]: number } {
    const result = {} as { [K in keyof T]: number };
    for (const key of Object.keys(values) as Array<keyof T>) {
      const value = values[key] as MusicMarkerInput;
      result[key] = typeof value === 'number' ? bar(value) : bar(value[0], value[1]);
    }
    return result;
  }

  return {
    bpm,
    beatsPerBar,
    stepsPerBar,
    beatSeconds,
    barSeconds,
    stepSeconds,
    beats,
    bar,
    step,
    seconds,
    markers,
  };
}
