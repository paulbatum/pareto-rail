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

export function createScore<Chord, Section extends string | number>(config: ScoreConfig<Chord, Section>) {
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
