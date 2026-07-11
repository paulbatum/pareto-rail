import { getActionSfxQuantization } from './action-sfx-quantization';

export type ScoreSection<Section extends string | number> = {
  index: Section;
  /** Bar where this section is fully active. Crossfades, when present, lead into this bar. */
  fromBar: number;
  crossfadeBars?: number;
};

export type ScoreChordSet<Chord> = {
  chords: readonly Chord[];
  barsPerChord?: number;
};

export type ScoreAlternateChordSet<Chord> = ScoreChordSet<Chord> & {
  fromBar: number;
  toBar?: number;
};

export type SectionMix<Section extends string | number> = {
  from: Section;
  to: Section;
  t: number;
};

export type KillLaneResult = {
  step: number;
  time: number;
  midi: number;
};

export type ScoreConfig<Chord, Section extends string | number> = {
  bpm: number;
  stepsPerBar: number;
  chords: readonly Chord[];
  barsPerChord?: number;
  alternateChordSets?: readonly ScoreAlternateChordSet<Chord>[];
  sections?: readonly ScoreSection<Section>[];
  leadSet?: (chord: Chord, position: number) => readonly number[];
  killLanes?: Partial<Record<Section, readonly number[]>>;
};

export type Score<Chord, Section extends string | number> = ReturnType<typeof createScore<Chord, Section>>;

export function validateScoreConfig<Chord, Section extends string | number>(config: ScoreConfig<Chord, Section>) {
  const issues: string[] = [];
  const positiveInteger = (value: number | undefined, label: string) => {
    if (value === undefined || !Number.isInteger(value) || value <= 0) issues.push(`${label} must be a positive integer`);
  };

  if (!Number.isFinite(config.bpm) || config.bpm <= 0) issues.push('bpm must be a positive finite number');
  positiveInteger(config.stepsPerBar, 'stepsPerBar');
  if (!config.chords.length) issues.push('chords must not be empty');
  positiveInteger(config.barsPerChord ?? 1, 'barsPerChord');

  const alternateSets = config.alternateChordSets ?? [];
  for (const [index, set] of alternateSets.entries()) {
    if (!Number.isInteger(set.fromBar) || set.fromBar < 0) issues.push(`alternateChordSets[${index}].fromBar must be a non-negative integer`);
    if (set.toBar !== undefined && (!Number.isInteger(set.toBar) || set.toBar <= set.fromBar)) {
      issues.push(`alternateChordSets[${index}].toBar must be greater than fromBar`);
    }
    if (!set.chords.length) issues.push(`alternateChordSets[${index}].chords must not be empty`);
    positiveInteger(set.barsPerChord ?? config.barsPerChord ?? 1, `alternateChordSets[${index}].barsPerChord`);
    for (const other of alternateSets.slice(index + 1)) {
      const overlaps = (set.toBar === undefined || other.fromBar < set.toBar)
        && (other.toBar === undefined || set.fromBar < other.toBar);
      if (overlaps) issues.push(`alternateChordSets[${index}] overlaps another alternate chord set`);
    }
  }

  const sections = [...(config.sections ?? [])].sort((a, b) => a.fromBar - b.fromBar);
  const sectionIndexes = new Set<Section>();
  const sectionBars = new Set<number>();
  for (const section of sections) {
    if (!Number.isInteger(section.fromBar) || section.fromBar < 0) issues.push(`section ${String(section.index)} fromBar must be a non-negative integer`);
    if (sectionIndexes.has(section.index)) issues.push(`duplicate section index ${String(section.index)}`);
    if (sectionBars.has(section.fromBar)) issues.push(`duplicate section fromBar ${section.fromBar}`);
    sectionIndexes.add(section.index);
    sectionBars.add(section.fromBar);
    if (section.crossfadeBars !== undefined && (!Number.isFinite(section.crossfadeBars) || section.crossfadeBars < 0)) {
      issues.push(`section ${String(section.index)} crossfadeBars must be non-negative`);
    }
  }

  const killLanes = config.killLanes;
  const laneEntries: Array<[string, readonly number[] | undefined]> = killLanes ? Object.entries(killLanes) : [];
  if (laneEntries.length && !sections.length) issues.push('killLanes requires at least one section');
  if (laneEntries.length) {
    for (const section of sections) {
      if (!Object.prototype.hasOwnProperty.call(killLanes, String(section.index))) issues.push(`missing kill lane for section ${String(section.index)}`);
    }
  }
  for (const [section, lane] of laneEntries) {
    if (!lane?.length) {
      issues.push(`kill lane for section ${section} must not be empty`);
      continue;
    }
    for (const [index, degree] of lane.entries()) {
      if (!Number.isInteger(degree) || degree < 0) issues.push(`kill lane ${section}[${index}] must be a non-negative integer`);
    }
  }

  const validGrid = Number.isInteger(config.stepsPerBar) && config.stepsPerBar > 0;
  if (config.chords.length && laneEntries.length && validGrid) {
    const chordPositions = config.chords.map((_chord, index) => index * (config.barsPerChord ?? 1) * config.stepsPerBar);
    const alternatePositions = alternateSets.flatMap((set) => set.chords.map((_chord, index) => (set.fromBar + index * (set.barsPerChord ?? config.barsPerChord ?? 1)) * config.stepsPerBar));
    const sectionPositions = sections.map((section) => section.fromBar * config.stepsPerBar);
    const positions = [...new Set([0, ...chordPositions, ...alternatePositions, ...sectionPositions])];
    const leads: Array<{ position: number; length: number }> = [];
    for (const position of positions) {
      const chord = chordAtPosition(config, position);
      if (chord === undefined) {
        issues.push(`chord set at position ${position} is empty`);
        continue;
      }
      let lead: readonly number[] | undefined;
      try {
        lead = config.leadSet
          ? config.leadSet(chord, position)
          : (chord as { arp?: readonly number[] }).arp
            ? [...(chord as { arp: readonly number[] }).arp, ...(chord as { arp: readonly number[] }).arp.map((midi) => midi + 12)]
            : [];
      } catch (error) {
        issues.push(`lead set at position ${position} could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!lead?.length) {
        issues.push(`lead set at position ${position} must not be empty when killLanes are configured`);
        continue;
      }
      for (const [index, midi] of lead.entries()) {
        if (!Number.isFinite(midi)) issues.push(`lead set at position ${position} contains a non-finite MIDI value at index ${index}`);
      }
      leads.push({ position, length: lead.length });
    }
    for (const [section, lane] of laneEntries) {
      if (!lane?.length) continue;
      const maxDegree = Math.max(...lane);
      for (const lead of leads) {
        if (maxDegree >= lead.length) issues.push(`kill lane ${section} degree ${maxDegree} is outside the lead set at position ${lead.position}`);
      }
    }
  }

  return issues;
}

export function createScore<Chord, Section extends string | number>(config: ScoreConfig<Chord, Section>) {
  const validationIssues = validateScoreConfig(config);
  if (validationIssues.length) throw new Error(`Invalid score configuration:\n${validationIssues.map((issue) => `- ${issue}`).join('\n')}`);
  const stepSeconds = (60 / config.bpm * 4) / config.stepsPerBar;
  const sixteenthSeconds = 60 / config.bpm / 4;
  const sections = [...(config.sections ?? [])].sort((a, b) => a.fromBar - b.fromBar);
  let epoch = 0;
  let arrangementStart = 0;
  let sectionOverride: Section | null = null;
  let lastKillStep = -1;

  function setEpoch(time: number) {
    epoch = time;
  }

  function restartArrangement(stepIndex: number, options: { align: 'bar' | 'step' }) {
    arrangementStart = options.align === 'bar'
      ? stepIndex + ((config.stepsPerBar - (stepIndex % config.stepsPerBar)) % config.stepsPerBar)
      : stepIndex;
    resetKillLane();
    return arrangementStart;
  }

  function resetKillLane() {
    lastKillStep = -1;
  }

  function nextGridTime(time: number, gridSixteenths = 1) {
    const grid = sixteenthSeconds * gridSixteenths;
    const stepsFromEpoch = Math.max(0, Math.ceil((time - epoch) / grid - 1e-4));
    return epoch + stepsFromEpoch * grid;
  }

  function quantizePlayerAction(time: number) {
    const { enabled, gridThirtyseconds } = getActionSfxQuantization();
    if (!enabled) return time;
    return nextGridTime(time, gridThirtyseconds / 2);
  }

  function arrangementPositionAt(time: number) {
    const step = Math.round((time - epoch) / stepSeconds);
    return Math.max(0, step - arrangementStart);
  }

  function barAt(position: number) {
    return Math.floor(position / config.stepsPerBar);
  }

  function chordAt(position: number) {
    const bar = barAt(position);
    const alternate = config.alternateChordSets?.find((set) => bar >= set.fromBar && (set.toBar === undefined || bar < set.toBar));
    const chordSet: ScoreChordSet<Chord> = alternate ?? config;
    const barsPerChord = chordSet.barsPerChord ?? config.barsPerChord ?? 1;
    return chordSet.chords[Math.floor(bar / barsPerChord) % chordSet.chords.length];
  }

  function leadSetAt(position: number) {
    const chord = chordAt(position);
    if (config.leadSet) return config.leadSet(chord, position);
    const arp = (chord as { arp?: readonly number[] }).arp;
    if (!arp) return [];
    return [...arp, ...arp.map((midi) => midi + 12)];
  }

  function sectionMixAt(position: number): SectionMix<Section> {
    if (!sections.length) throw new Error('score.sectionMixAt requires at least one section');
    if (sectionOverride !== null) return { from: sectionOverride, to: sectionOverride, t: 1 };

    const bar = position / config.stepsPerBar;
    let current = sections[0];
    for (const section of sections) {
      if (bar >= section.fromBar) current = section;
      else break;
    }

    const next = sections.find((section) => section.fromBar > current.fromBar);
    const crossfadeBars = next?.crossfadeBars ?? 0;
    if (next && crossfadeBars > 0 && bar >= next.fromBar - crossfadeBars && bar < next.fromBar) {
      return { from: current.index, to: next.index, t: clamp01((bar - (next.fromBar - crossfadeBars)) / crossfadeBars) };
    }
    return { from: current.index, to: current.index, t: 1 };
  }

  function sectionLayers(mix: SectionMix<Section>) {
    return mix.from === mix.to ? [[mix.to, 1] as const] : [[mix.from, 1 - mix.t] as const, [mix.to, mix.t] as const];
  }

  function overrideSection(index: Section) {
    sectionOverride = index;
  }

  function clearOverride() {
    sectionOverride = null;
  }

  function nextKill(time: number, section?: Section): KillLaneResult {
    let step = Math.round((nextGridTime(time) - epoch) / stepSeconds);
    if (step <= lastKillStep) step = lastKillStep + 1;
    lastKillStep = step;
    const killTime = epoch + step * stepSeconds;
    const position = Math.max(0, step - arrangementStart);
    const laneSection = section ?? sectionMixAt(position).to;
    const lane = config.killLanes?.[laneSection];
    if (!lane?.length) throw new Error(`Missing kill lane for section ${String(laneSection)}`);
    const lead = leadSetAt(position);
    const degree = lane[position % lane.length];
    const midi = lead[degree];
    if (midi === undefined) throw new Error(`Kill lane degree ${degree} is outside the lead set`);
    return { step, time: killTime, midi };
  }

  return {
    get epoch() {
      return epoch;
    },
    get arrangementStart() {
      return arrangementStart;
    },
    stepSeconds,
    sixteenthSeconds,
    setEpoch,
    restartArrangement,
    resetKillLane,
    nextGridTime,
    quantizePlayerAction,
    arrangementPositionAt,
    barAt,
    chordAt,
    leadSetAt,
    sectionMixAt,
    sectionLayers,
    overrideSection,
    clearOverride,
    nextKill,
  };
}

function chordAtPosition<Chord, Section extends string | number>(config: ScoreConfig<Chord, Section>, position: number) {
  const bar = Math.floor(position / config.stepsPerBar);
  const alternate = config.alternateChordSets?.find((set) => bar >= set.fromBar && (set.toBar === undefined || bar < set.toBar));
  const chordSet = alternate ?? config;
  const barsPerChord = chordSet.barsPerChord ?? config.barsPerChord ?? 1;
  return chordSet.chords[Math.floor(bar / barsPerChord) % chordSet.chords.length];
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function blendNumber<Section extends string | number>(
  mix: SectionMix<Section>,
  values: Record<Section, number>,
) {
  return lerp(values[mix.from], values[mix.to], mix.t);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
